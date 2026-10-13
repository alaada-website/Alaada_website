"""Private product execution receipts; SQLite is only the isolated test adapter."""
import base64
import hashlib
import hmac
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import httpx
import pytest
from fastapi.testclient import TestClient
from test_personal_workspaces import m


def test_readiness_probe_is_bounded_and_rechecks_access(monkeypatch):
    import asyncio
    calls, checks = [], []
    async def probe():
        calls.append(True)
        raise httpx.ConnectError('Still starting')
    async def revalidate():
        checks.append(True)
    async def no_delay(_):
        pass
    monkeypatch.setattr(m.asyncio, 'sleep', no_delay)
    assert asyncio.run(m.readiness_probe(probe, revalidate)) == (503, None)
    assert len(calls) == 10 and len(checks) == 9


@pytest.mark.parametrize('phase', ['reserve_operation', 'audit'])
def test_accounts_writes_do_not_block_other_platform_requests(tmp_path, monkeypatch, phase):
    import asyncio
    entered, released, finished = threading.Event(), threading.Event(), threading.Event()
    async def auth(token):
        return m.Identity('alice')
    def provider(request):
        return httpx.Response(200 if request.method == 'GET' else 201,
            json={'capabilities': {}} if request.method == 'GET' else {'id': 'new-company'},
            headers={'x-alaada-workspace-enforced': 'v1'})
    app = m.create_app(tmp_path/'nonblocking.db', authenticate=auth, accounts_url='https://accounts.invalid',
        accounts_secret='accounts-gateway-secret-at-least-32', accounts_transport=httpx.MockTransport(provider))
    browser = TestClient(app)
    wid = browser.get('/api/workspaces', headers={'Authorization': 'Bearer alice'}).json()['workspaces'][0]['id']
    original = getattr(app.state.store, phase)
    def delayed(*args, **kwargs):
        entered.set()
        try:
            assert released.wait(3), 'Database work blocked the application request loop'
            return original(*args, **kwargs)
        finally:
            finished.set()
    monkeypatch.setattr(app.state.store, phase, delayed)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            task = asyncio.create_task(client.post(f'/api/workspaces/{wid}/accounts/companies', json={'name':'Test'},
                headers={'Authorization':'Bearer alice', 'X-Alaada-Workspace':wid, 'Idempotency-Key':'nonblocking-test-operation'}))
            try:
                assert await asyncio.to_thread(entered.wait, 3)
                assert not finished.is_set()
                assert (await client.get('/health')).status_code == 200
            finally:
                released.set()
            assert (await task).status_code == 201
    asyncio.run(run())


@pytest.mark.parametrize('second_status', [200, 401])
@pytest.mark.parametrize('first_status', [200, 401, 502, 503, 504])
def test_accounts_cold_start_refreshes_only_handshake(tmp_path, monkeypatch, second_status, first_status):
    clock, health, writes = [1000], [], []
    monkeypatch.setattr(m.time, 'time', lambda: clock[0])
    async def auth(token):
        return m.Identity('alice')
    def provider(req):
        claim = json.loads(base64.urlsafe_b64decode(req.headers['x-alaada-gateway-context']))
        if req.url.path == '/workspace-gateway/health':
            health.append(claim['iat'])
            if len(health) == 1:
                clock[0] += 50
                return httpx.Response(first_status)
            assert claim['iat'] == clock[0]
            return httpx.Response(second_status, json={'capabilities': {}}, headers={'x-alaada-workspace-enforced': 'v1'})
        writes.append(req)
        return httpx.Response(201, json={'id': 'company', 'name': 'Test'}, headers={'x-alaada-workspace-enforced': 'v1'})
    app = m.create_app(tmp_path/'accounts-cold.db', authenticate=auth, accounts_url='https://accounts.invalid',
        accounts_secret='accounts-gateway-secret-at-least-32', accounts_transport=httpx.MockTransport(provider))
    browser = TestClient(app)
    wid = browser.get('/api/workspaces', headers={'Authorization': 'Bearer alice'}).json()['workspaces'][0]['id']
    result = browser.post(f'/api/workspaces/{wid}/accounts/companies', json={'name': 'Test'},
        headers={'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid})
    assert result.status_code == (201 if second_status == 200 else 503), result.text
    assert health == ([1000, 1050, 1050] if first_status != 401 and second_status == 401 else [1000, 1050])
    assert len(writes) == (1 if second_status == 200 else 0)

@pytest.mark.parametrize('second_status', [200, 401])
@pytest.mark.parametrize('first_status', [200, 401, 502, 503, 504])
def test_cold_start_re_signs_health_without_repeating_execution(tmp_path, monkeypatch, second_status, first_status):
    clock = [1000]
    monkeypatch.setattr(m.time, 'time', lambda: clock[0])
    attempts = []
    scans = []
    secret = 'test-cold-start-gateway-secret-32'
    async def authenticate(token):
        return m.Identity('alice')
    def provider(req):
        if req.url.path == '/health':
            assert 'x-alaada-gateway-context' not in req.headers
            return httpx.Response(200, json={'product': 'Alaada Website Analyser', 'status': 'ok'})
        claim = json.loads(base64.urlsafe_b64decode(req.headers['x-alaada-gateway-context']))
        assert hmac.compare_digest(req.headers['x-alaada-gateway-signature'],
            hmac.new(secret.encode(), req.headers['x-alaada-gateway-context'].encode(), hashlib.sha256).hexdigest())
        if req.method == 'GET':
            attempts.append(claim['iat'])
            if len(attempts) == 1:
                clock[0] += 50  # Render wake-up exceeds the provider's 15-second signature TTL.
                assert abs(clock[0] - claim['iat']) > 15
                return httpx.Response(first_status, json={'error': 'Provider still starting'})
            assert abs(clock[0] - claim['iat']) <= 15
            return httpx.Response(second_status, json={'ok': True},
                headers={'X-Alaada-Workspace-Enforced': 'v1'} if second_status == 200 else {})
        scans.append(claim)
        return httpx.Response(200, json={'summary': {key: {} for key in
            ('seo', 'security', 'accessibility', 'dom', 'resources')}},
            headers={'X-Alaada-Workspace-Enforced': 'v1'})
    app = m.create_app(tmp_path / 'cold.db', authenticate=authenticate,
        analyser_url='https://analyser.invalid', analyser_secret=secret, analyser_transport=httpx.MockTransport(provider))
    client = TestClient(app)
    wid = client.get('/api/workspaces', headers={'Authorization': 'Bearer alice'}).json()['workspaces'][0]['id']
    response = client.post(f'/api/workspaces/{wid}/analyser/analyze',
        headers={'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid, 'X-Alaada-Operation': 'cold-start-operation-001'},
        json={'url': 'https://example.com'})
    assert response.status_code == (200 if second_status == 200 else 503), response.text
    assert attempts == ([1000, 1050, 1050] if first_status != 401 and second_status == 401 else [1000, 1050])
    with app.state.store.db() as db:
        assert len(scans) == len(db.rows('product_operations', {})) == (1 if second_status == 200 else 0)
        assert sum(row['amount'] for row in db.rows('usage', {})) == len(scans)



@pytest.fixture(params=['orbit', 'analyser'])
def execution(request, tmp_path):
    product = request.param
    secret = 'test-only-analyser-gateway-secret-32'
    users = {name: m.Identity(name, {'team': ['editor']}) for name in ('alice', 'colleague')}
    users['outsider'] = m.Identity('outsider')
    state = {'calls': 0, 'health': 0}
    report = {'summary': {key: {} for key in ('seo', 'security', 'accessibility', 'dom', 'resources')},
              'ai_summary': 'private answer'}

    async def authenticate(token):
        return users[token]

    def provider(req):
        if product == 'analyser':
            if req.url.path == '/health':
                return httpx.Response(200, json=state.get('public_health', {'product': 'Alaada Website Analyser', 'status': 'ok'}))
            encoded = req.headers['x-alaada-gateway-context']
            assert hmac.compare_digest(req.headers['x-alaada-gateway-signature'],
                hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest())
            claim = json.loads(base64.urlsafe_b64decode(encoded))
            assert claim['workspace'] == wid and claim['body'] == hashlib.sha256(req.content).hexdigest()
            if req.method == 'GET':
                state['health'] += 1
                return httpx.Response(200, json={'ok': True}, headers={'X-Alaada-Workspace-Enforced': 'v1'})
            assert len(claim['operation_id']) == 64
        else:
            if req.method == 'GET':
                assert req.url.path == '/health'
                assert 'authorization' not in req.headers
                state['health'] += 1
                if state.get('revoke_health'):
                    users['alice'] = m.Identity('alice')
                statuses = state.get('health_statuses', [])
                return httpx.Response(statuses.pop(0) if statuses else 200, json=state.get('health_payload', {
                    'status': 'ok', 'stateless': True, 'gateway_only': True,
                    'openai_configured': True, 'models': ['simplex1']}))
            assert req.headers['authorization'] == 'Bearer test-only-orbit-key'
            assert json.loads(req.content)['privacy'] is True
        state['calls'] += 1
        if state.get('entered'):
            state['entered'].set()
            assert state['release'].wait(5)
        if state.get('revoke'):
            users['alice'] = m.Identity('alice')
        if state.get('edit'):
            with app.state.store.db() as db:
                db.update('resources', {'id': rid}, {'title': 'Concurrent edit'}, increments={'version': 1})
        if state.get('timeout'):
            raise httpx.ReadTimeout('Private provider details must not leak')
        content = json.dumps({'text': 'private answer'} if product == 'orbit' else report)
        if state.get('malformed'):
            content = '{}'
        if state.get('oversized'):
            content = 'x' * 1_000_001
        headers = {} if state.get('unsigned') else {'X-Alaada-Workspace-Enforced': 'v1'}
        return httpx.Response(200, content=content, headers=headers)

    def build(available=True):
        return m.create_app(tmp_path / 'execution.db', authenticate=authenticate,
            orbit_url='https://orbit.invalid' if available else None, orbit_key='test-only-orbit-key' if available else None,
            orbit_transport=httpx.MockTransport(provider),
            analyser_url='https://analyser.invalid' if available else None, analyser_secret=secret if available else None,
            analyser_transport=httpx.MockTransport(provider))

    app = build()
    client = TestClient(app)
    wid = app.state.store.organisation('team', 'Company', licensed=False)
    headers = {'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid}
    rid = None
    data = {'url': 'https://example.com'}
    if product == 'orbit':
        row = client.put(f'/api/workspaces/{wid}/products/orbit/records/conversation/thread',
            headers=headers, json={'version': 0, 'title': 'Conversation',
                'payload': {'id': 'thread', 'messages': [{'role': 'user', 'text': 'Private question'}]}}).json()
        rid = row['id']
        data = {'conversation': rid, 'version': row['version']}

    def total():
        with app.state.store.db() as db:
            return sum(row['amount'] for row in db.rows('usage', {'workspace': wid, 'product': product}))
    baseline = total()

    def call(user='alice', body=None, key='test-analysis-operation-01', active_client=None):
        h = {**headers, 'Authorization': 'Bearer ' + user}
        if key is not None:
            h['X-Alaada-Operation'] = key
        return (active_client or client).post(f'/api/workspaces/{wid}/{product}/' +
            ('reply' if product == 'orbit' else 'analyze'), headers=h, json=data if body is None else body)

    return product, state, users, app, client, wid, call, lambda: total() - baseline, build, data


@pytest.mark.parametrize('execution', ['orbit'], indirect=True)
@pytest.mark.parametrize('cold_status', [502, 503, 504])
def test_orbit_wakes_readonly_before_reserving_or_sending(execution, cold_status, monkeypatch):
    _, state, _, app, _, _, call, usage, _, _ = execution
    state['health_statuses'] = [cold_status, 200]
    async def no_delay(_):
        with app.state.store.db(readonly=True) as db:
            assert db.rows('product_operations', {}) == []
        assert state['calls'] == usage() == 0
    monkeypatch.setattr(m.asyncio, 'sleep', no_delay)
    assert call().status_code == 200
    assert state['health'] == 2 and state['calls'] == usage() == 1
    assert call().headers['x-alaada-replayed'] == 'true'
    assert state['health'] == 2 and state['calls'] == usage() == 1


@pytest.mark.parametrize('execution', ['orbit'], indirect=True)
@pytest.mark.parametrize('health', [{}, {'status': 'ok'}, {
    'status': 'ok', 'stateless': True, 'gateway_only': True,
    'openai_configured': False, 'models': ['simplex1']}])
def test_orbit_unready_does_not_spend_or_poison_the_prompt(execution, health, monkeypatch):
    _, state, _, app, _, _, call, usage, _, _ = execution
    state['health_payload'] = health
    async def no_delay(_):
        pass
    monkeypatch.setattr(m.asyncio, 'sleep', no_delay)
    result = call()
    assert result.status_code == 503 and 'no AI request was sent' in result.text
    assert state['calls'] == usage() == 0
    with app.state.store.db(readonly=True) as db:
        assert db.rows('product_operations', {}) == []
    del state['health_payload']
    assert call().status_code == 200  # The same saved prompt can safely retry.
    assert state['calls'] == usage() == 1


@pytest.mark.parametrize('execution', ['analyser'], indirect=True)
@pytest.mark.parametrize('health', [{}, {'status': 'ok'}, '<html>Service is starting</html>'])
def test_analyser_public_wake_must_be_ready_before_signed_handshake(execution, health, monkeypatch):
    _, state, _, app, _, _, call, usage, _, _ = execution
    state['public_health'] = health
    async def no_delay(_):
        pass
    monkeypatch.setattr(m.asyncio, 'sleep', no_delay)
    result = call()
    assert result.status_code == 503
    assert state['calls'] == state['health'] == usage() == 0
    with app.state.store.db(readonly=True) as db:
        assert db.rows('product_operations', {}) == []
    del state['public_health']
    assert call().status_code == 200
    assert state['calls'] == state['health'] == usage() == 1


@pytest.mark.parametrize('execution', ['orbit'], indirect=True)
def test_orbit_access_revoked_while_waking_never_sends(execution):
    _, state, _, _, _, _, call, usage, _, _ = execution
    state['revoke_health'] = True
    assert call().status_code == 403
    assert state['calls'] == usage() == 0


@pytest.mark.parametrize('execution,phase', [('orbit', phase) for phase in ('resource', 'reserve_operation', 'audit')]
                         + [('analyser', phase) for phase in ('workspace', 'reserve_operation', 'audit')], indirect=['execution'])
def test_product_database_phases_do_not_freeze_other_products(execution, monkeypatch, phase):
    import asyncio
    product, _, _, app, _, wid, _, _, _, data = execution
    entered, released, finished = threading.Event(), threading.Event(), threading.Event()
    original = getattr(app.state.store, phase)
    def delayed(*args, **kwargs):
        entered.set()
        try:
            assert released.wait(3), 'Product database work blocked other platform requests'
            return original(*args, **kwargs)
        finally:
            finished.set()
    monkeypatch.setattr(app.state.store, phase, delayed)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            operation = 'reply' if product == 'orbit' else 'analyze'
            task = asyncio.create_task(client.post(f'/api/workspaces/{wid}/{product}/{operation}', json=data,
                headers={'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid,
                         'X-Alaada-Operation': 'nonblocking-analyser-check'}))
            try:
                assert await asyncio.to_thread(entered.wait, 3)
                assert not finished.is_set()
                assert (await client.get('/health')).status_code == 200
            finally:
                released.set()
            assert (await task).status_code == 200
    asyncio.run(run())


def test_replay_after_restart_and_provider_disconnect(execution):
    product, state, _, app, _, wid, call, usage, build, data = execution
    first = call()
    assert first.status_code == 200, first.text
    replay = call(active_client=TestClient(build(False)))
    assert replay.status_code == 200 and replay.json() == first.json()
    assert replay.headers['x-alaada-replayed'] == 'true'
    assert state['calls'] == usage() == 1
    with app.state.store.db() as db:
        receipt = db.rows('product_operations', {'workspace': wid})[0]
        assert receipt['state'] == 'succeeded'
        assert list(json.loads(receipt['response'])) == ['resource']
        assert 'private answer' not in receipt['response']
        assert len(db.rows('audit', {'workspace': wid, 'action': product + (':reply' if product == 'orbit' else ':complete')})) == 1
        assert len(db.rows('notifications', {'workspace': wid})) == 1
    if product == 'analyser':
        assert call(body={'url': 'https://different.example'}).status_code == 409
    else:
        assert call(user='colleague').headers['x-alaada-replayed'] == 'true'
    assert call(user='outsider').status_code == 403
    assert state['calls'] == usage() == 1


@pytest.mark.parametrize('failure', ['timeout', 'malformed', 'oversized'])
def test_ambiguous_failure_never_reexecutes(execution, failure):
    _, state, _, _, _, _, call, usage, build, _ = execution
    state[failure] = True
    first = call()
    assert first.status_code == 502 and first.json()['state'] == 'unknown'
    assert 'Private provider' not in first.text
    repeated = call(active_client=TestClient(build()))
    assert repeated.json() == first.json()
    assert state['calls'] == usage() == 1


def test_concurrent_duplicate_and_orbit_collaborator(execution):
    product, state, _, _, _, _, call, usage, _, _ = execution
    state.update(entered=threading.Event(), release=threading.Event())
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call)
        try:
            assert state['entered'].wait(5)
            duplicate = call(user='colleague' if product == 'orbit' else 'alice')
            assert duplicate.status_code == 409 and duplicate.json()['state'] == 'pending'
        finally:
            state['release'].set()
        assert first.result(timeout=5).status_code == 200
    assert state['calls'] == usage() == 1


def test_revocation_discards_answer_and_keeps_private_receipt(execution):
    _, state, _, app, _, wid, call, usage, _, _ = execution
    state['revoke'] = True
    result = call()
    assert result.status_code == 403 and 'private answer' not in result.text
    assert call().status_code == 403
    with app.state.store.db() as db:
        receipt = db.rows('product_operations', {'workspace': wid})[0]
        assert receipt['state'] == 'unknown' and 'private answer' not in receipt['response']
    assert state['calls'] == usage() == 1


def test_deleted_result_cannot_be_replayed_from_receipt(execution):
    product, state, _, app, _, wid, call, usage, _, _ = execution
    result = call()
    rid = result.json()['id'] if product == 'orbit' else result.headers['x-alaada-report']
    with app.state.store.db() as db:
        db.delete('resources', {'id': rid})
    assert call().status_code == 404
    assert state['calls'] == usage() == 1


@pytest.mark.parametrize('committed', [False, True])
def test_lost_persistence_acknowledgement_never_duplicates(execution, monkeypatch, committed):
    _, state, _, app, _, _, call, usage, _, _ = execution
    store = app.state.store
    original_db = store.db
    injected = False

    @contextmanager
    def uncertain_db(*, readonly=False):
        nonlocal injected
        if readonly:
            with original_db(readonly=True) as db:
                yield db
            return
        terminal = False
        with original_db() as db:
            yield db
            receipt = db.rows('product_operations', {})
            terminal = bool(receipt and receipt[0]['state'] == 'succeeded' and not injected)
            if terminal and not committed:
                injected = True
                raise RuntimeError('Persistence rolled back')
        if terminal and committed:
            injected = True
            raise RuntimeError('Commit succeeded but its acknowledgement was lost')

    monkeypatch.setattr(store, 'db', uncertain_db)
    first = call()
    assert first.status_code == 502
    replay = call()
    assert replay.status_code == (200 if committed else 502)
    assert state['calls'] == usage() == 1


def test_input_validation_and_execution_capabilities(execution):
    product, state, _, _, client, wid, call, usage, _, data = execution
    if product == 'analyser':
        for key in (None, '', 'short', 'invalid space in key'):
            assert call(key=key).status_code == 400
        for url in ('https://[invalid', 'file:///private', 'https://user:pass@example.com'):
            assert call(body={'url': url}).status_code == 400
    else:
        for version in (None, True, 0, -1, '1'):
            assert call(body={**data, 'version': version}).status_code == 400
    assert state['calls'] == usage() == 0
    policy = client.get(f'/api/workspaces/{wid}/entitlements', headers={'Authorization': 'Bearer alice'}).json()
    assert policy['products'][product]['capabilities']['execution_receipts'] is True


def test_conflicting_or_unsigned_completion_is_never_repeated(execution):
    product, state, _, app, _, _, call, usage, _, data = execution
    if product != 'orbit':
        state['unsigned'] = True
        assert call().status_code == 502
        assert call().status_code == 502
        assert state['calls'] == usage() == 1
        return
    state['edit'] = True
    assert call().status_code == 409
    assert call().status_code == 409
    with app.state.store.db() as db:
        row = db.one('resources', {'id': data['conversation']})
        assert row['title'] == 'Concurrent edit'
        assert len(json.loads(row['payload'])['data']['messages']) == 1
    assert state['calls'] == usage() == 1

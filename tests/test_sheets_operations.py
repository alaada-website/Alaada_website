"""Appwrite-authorized execution receipts; local SQL is an isolated test adapter."""
import base64
import hashlib
import hmac
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_personal_workspaces import m


@pytest.fixture
def gateway(tmp_path):
    secret = 'isolated-sheets-gateway-secret-32-characters'
    users = {'alice': m.Identity('alice', {'team': ['editor']}), 'bob': m.Identity('bob')}
    state = {'available': True, 'calls': 0, 'health': 0, 'status': 200,
             'body': {'success': True, 'reply': 'Private answer'}, 'execution': 'started'}

    async def auth(token):
        if token not in users:
            raise HTTPException(401, 'Expired')
        return users[token]

    def upstream(request):
        encoded = request.headers['x-alaada-gateway-context']
        assert hmac.compare_digest(request.headers['x-alaada-gateway-signature'],
            hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest())
        context = json.loads(base64.urlsafe_b64decode(encoded))
        assert context['method'] == request.method and context['target'] == request.url.path
        assert context['body'] == hashlib.sha256(request.content).hexdigest()
        assert context['workspace'] == request.headers['x-alaada-workspace']
        assert context['user'] == 'alice'
        headers = {'X-Alaada-Workspace-Enforced': 'v1', 'X-Alaada-Execution': state['execution']}
        if request.method == 'GET':
            state['health'] += 1
            return httpx.Response(200, json={'capabilities': {'ai-chat': state['available']}}, headers=headers)
        assert len(context['operation_id']) == 64
        assert 'workspace_id' not in json.loads(request.content)
        state['calls'] += 1
        if state.get('entered'):
            state['entered'].set()
            assert state['release'].wait(5)
        if state.get('revoke'):
            users['alice'] = m.Identity('alice')
        if state.get('timeout'):
            raise httpx.ReadTimeout('Uncertain upstream outcome')
        if state.get('unsigned'):
            headers = {}
        return httpx.Response(state['status'], json=state['body'], headers=headers)

    def build():
        return m.create_app(tmp_path / 'receipts.db', authenticate=auth,
            sheets_url='https://sheets.example.invalid', sheets_secret=secret,
            sheets_transport=httpx.MockTransport(upstream))

    app = build()
    client = TestClient(app)
    wid = client.get('/api/workspaces', headers={'Authorization': 'Bearer alice'}).json()['workspaces'][0]['id']
    def call(operation_id='logical-operation-0001', data=None, user='alice', workspace=None, active_client=None):
        target = workspace or wid
        return (active_client or client).post(f'/api/workspaces/{target}/sheets/execute/ai-chat',
            json=data if data is not None else {'messages': [{'role': 'user', 'content': 'Sum'}]},
            headers={'Authorization': 'Bearer ' + user, 'X-Alaada-Workspace': target,
                     'X-Alaada-Operation': operation_id})
    def usage(workspace=None):
        with app.state.store.db() as db:
            rows = db.rows('usage', {'workspace': workspace or wid, 'product': 'sheets'})
            return sum(row['amount'] for row in rows)
    return state, users, app, client, wid, call, usage, build


def test_receipt_replays_across_restart_even_if_provider_is_down(gateway):
    state, _, _, _, _, call, usage, build = gateway
    first = call()
    assert first.status_code == 200
    state['available'] = False
    repeated = call(active_client=TestClient(build()))
    assert repeated.json() == first.json()
    assert repeated.headers['x-alaada-replayed'] == 'true'
    assert state['calls'] == state['health'] == usage() == 1
    assert call(data={'messages': []}).status_code == 409
    assert usage() == 1


@pytest.mark.parametrize('scenario', ['timeout', 'unsigned'])
def test_uncertain_outcomes_are_durable_and_never_executed_twice(gateway, scenario):
    state, _, _, _, _, call, usage, _ = gateway
    state[scenario] = True
    first = call()
    assert first.status_code == 502 and first.json()['state'] == 'unknown'
    assert call().json() == first.json()
    assert state['calls'] == usage() == 1


@pytest.mark.parametrize('execution,expected', [('rejected', 0), ('started', 1), (None, 1)])
def test_only_confirmed_pre_execution_validation_refunds(gateway, execution, expected):
    state, _, _, _, _, call, usage, _ = gateway
    state.update(status=422, body={'detail': 'Invalid operation'}, execution=execution or 'legacy')
    assert call().status_code == 422
    assert call().status_code == 422
    assert state['calls'] == 1 and usage() == expected


def test_unavailable_or_unauthorized_requests_do_not_reserve(gateway):
    state, _, _, _, wid, call, usage, _ = gateway
    assert call(user='bob').status_code == 403
    assert call(data={'workspace_id': 'another-workspace'}).status_code == 403
    assert call(operation_id='short').status_code == 400
    state['available'] = False
    assert call().status_code == 503
    assert state['calls'] == usage() == 0


def test_inflight_revocation_discards_private_result(gateway):
    state, _, app, _, _, call, usage, _ = gateway
    org = app.state.store.organisation('team', 'Company', licensed=False)
    state['revoke'] = True
    response = call(workspace=org)
    assert response.status_code == 403 and 'Private answer' not in response.text
    assert call(workspace=org).status_code == 403
    assert state['calls'] == usage(org) == 1
    with app.state.store.db() as db:
        saved = db.rows('product_operations', {'workspace': org})[0]
        assert saved['state'] == 'unknown' and 'Private answer' not in saved['response']


def test_concurrent_duplicate_reserves_and_executes_once(gateway):
    state, _, _, _, _, call, usage, _ = gateway
    state.update(entered=threading.Event(), release=threading.Event())
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call)
        try:
            assert state['entered'].wait(5)
            duplicate = call()
            assert duplicate.status_code == 409 and duplicate.json()['state'] == 'pending'
        finally:
            state['release'].set()
        assert first.result(timeout=5).status_code == 200
    assert state['calls'] == usage() == 1

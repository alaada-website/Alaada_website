"""Real transaction regressions; Dodo and Appwrite identity are isolated fakes."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import httpx

import pytest
from standardwebhooks import Webhook
from test_personal_workspaces import dodo_app, m, env, request


def deliver(env, event_id, data, *, occurred=None, event_type='subscription.active'):
    signed_at = datetime.now(timezone.utc)
    raw = json.dumps({'type': event_type, 'timestamp': (occurred or signed_at).isoformat(),
                      'business_id': 'test', 'data': data}, separators=(',', ':')).encode()
    headers = {'webhook-id': event_id, 'webhook-timestamp': str(int(signed_at.timestamp())),
               'webhook-signature': Webhook(env['key']).sign(event_id, signed_at, raw.decode()),
               'Content-Type': 'application/json'}
    return env['client'].post('/api/dodo/webhook', content=raw, headers=headers), raw


def activate(env):
    wid = env['workspace']
    headers = {'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid}
    assert env['client'].post(f'/api/workspaces/{wid}/subscription', json={'plan': 'Pro'}, headers=headers).status_code == 201
    event = {'subscription_id': 'sub_reliability', 'product_id': 'pdt_pro_test', 'status': 'active',
             'next_billing_date': (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
             'metadata': env['calls']['checkout']['metadata']}
    response, _ = deliver(env, 'activation', event)
    assert response.status_code == 200, response.text
    return headers, event


@pytest.mark.parametrize('status,end', [('paused', 30), ('on_hold', 30), ('past_due', -1), ('active', -1), ('active', None), ('active', 'invalid')])
def test_stale_paid_row_never_bypasses_current_eligibility(tmp_path, status, end):
    env = dodo_app(tmp_path)
    headers, event = activate(env)
    expires = ((datetime.now(timezone.utc) + timedelta(days=end)).isoformat()
               if type(end) is int else end)
    store, wid = env['app'].state.store, env['workspace']
    with store.db() as db:
        db.update('dodo_subscriptions', {'workspace': wid}, {'status': status, 'current_period_end': expires})
        # Reproduce a missed event / stale cached paid row.
        db.update('subscriptions', {'workspace': wid}, {'plan': 'Pro'})
        db.insert('usage', {'workspace': wid, 'product': 'orbit', 'month': m.time.strftime('%Y-%m', m.time.gmtime()), 'amount': store.limits['Free']})
    for endpoint in ('subscription', 'entitlements'):
        response = env['client'].get(f'/api/workspaces/{wid}/{endpoint}', headers=headers)
        assert response.json()['plan'] == 'Free', response.text
    with store.db() as db, pytest.raises(m.HTTPException) as rejected:
        store.quota(db, wid, 'orbit')
    assert rejected.value.status_code == 429


def test_expiry_never_removes_data(tmp_path):
    env = dodo_app(tmp_path)
    headers, _ = activate(env)
    wid = env['workspace']
    resource = env['client'].post(f'/api/workspaces/{wid}/resources', headers=headers,
        json={'product': 'sheets', 'kind': 'workbook', 'title': 'Keep', 'payload': {'data': 42}}).json()
    with env['app'].state.store.db() as db:
        db.update('dodo_subscriptions', {'workspace': wid}, {'current_period_end': '2000-01-01T00:00:00Z'})
    response = env['client'].get(f'/api/workspaces/{wid}/resources/{resource["id"]}', headers=headers)
    assert response.status_code == 200 and response.json()['payload']['data'] == 42


def test_changed_payload_same_event_id_is_not_silently_deduplicated(tmp_path):
    env = dodo_app(tmp_path)
    headers, event = activate(env)
    response, _ = deliver(env, 'activation', dict(event, status='cancelled'), event_type='subscription.cancelled')
    assert response.status_code == 409
    assert env['client'].get(f'/api/workspaces/{env["workspace"]}/subscription', headers=headers).json()['plan'] == 'Pro'


def test_failed_verified_receipt_is_durable_and_contains_no_raw_pii(tmp_path):
    env = dodo_app(tmp_path)
    response, raw = deliver(env, 'unlinked', {'subscription_id': 'sub_unlinked', 'status': 'active',
        'product_id': 'pdt_pro_test', 'customer': {'email': 'private@example.invalid'}})
    assert response.status_code == 409
    with env['app'].state.store.db() as db:
        receipt = db.one('billing_receipts', {'id': 'dodo-event:' + hashlib.sha256(b'unlinked').hexdigest()})
        assert receipt['state'] == 'failed' and receipt['attempts'] == 1
        assert receipt['payload_hash'] == hashlib.sha256(raw).hexdigest()
        assert 'private@example.invalid' not in json.dumps(dict(receipt))


def test_late_plan_change_cannot_restore_cancelled_subscription(tmp_path):
    env = dodo_app(tmp_path)
    headers, event = activate(env)
    older = datetime.now(timezone.utc) - timedelta(days=1)
    assert deliver(env, 'cancel', dict(event, status='cancelled'), event_type='subscription.cancelled')[0].status_code == 200
    response, _ = deliver(env, 'old-plan', dict(event, product_id='pdt_elite_test'), occurred=older, event_type='subscription.plan_changed')
    assert response.status_code == 200 and response.json()['stale']
    assert env['client'].get(f'/api/workspaces/{env["workspace"]}/subscription', headers=headers).json()['plan'] == 'Free'


def test_configured_sheets_reports_calculation_capability(tmp_path):
    async def auth(token):
        return m.Identity('alice')
    app = m.create_app(tmp_path / 'caps.db', authenticate=auth,
        sheets_url='https://sheets.example.invalid', sheets_secret='x' * 32,
        sheets_transport=httpx.MockTransport(lambda _: httpx.Response(503)))
    from fastapi.testclient import TestClient
    client = TestClient(app)
    headers = {'Authorization': 'Bearer alice'}
    wid = client.get('/api/workspaces', headers=headers).json()['workspaces'][0]['id']
    product = client.get(f'/api/workspaces/{wid}/entitlements', headers=headers).json()['products']['sheets']
    assert product['execution_available'] is True
    assert product['capabilities']['formula'] is True
    assert product['capabilities']['ai'] is False




def test_accounts_gateway_preserves_and_signs_idempotency_key(tmp_path):
    import base64
    import hmac
    from fastapi.testclient import TestClient
    secret = 'accounts-gateway-secret-more-than-32-characters'
    seen = []
    async def auth(token):
        return m.Identity('alice')
    async def upstream(req):
        context = json.loads(base64.urlsafe_b64decode(req.headers['x-alaada-gateway-context']))
        assert hmac.compare_digest(req.headers['x-alaada-gateway-signature'],
            hmac.new(secret.encode(), req.headers['x-alaada-gateway-context'].encode(), hashlib.sha256).hexdigest())
        seen.append((req.method, req.url.path, context.get('idempotency'), req.headers.get('idempotency-key')))
        return httpx.Response(200 if req.method == 'GET' else 201, json={'id': 'company-retry'},
            headers={'x-alaada-workspace-enforced': 'v1'})
    application = m.create_app(tmp_path / 'accounts-key.db', authenticate=auth,
        accounts_url='http://127.0.0.1', accounts_secret=secret, accounts_transport=httpx.MockTransport(upstream))
    client = TestClient(application)
    wid = client.get('/api/workspaces', headers={'Authorization': 'Bearer alice'}).json()['workspaces'][0]['id']
    headers = {'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid, 'Idempotency-Key': 'retry-company-key-123'}
    path = f'/api/workspaces/{wid}/accounts/companies'
    assert client.post(path, headers=headers, json={'name': 'Business'}).status_code == 201
    assert seen == [('GET', '/workspace-gateway/health', '', None),
        ('POST', '/companies', 'retry-company-key-123', 'retry-company-key-123')]
    seen.clear()
    for value in ('short', 'spaces are not allowed'):
        assert client.post(path, headers=headers | {'Idempotency-Key': value}, json={}).status_code == 400
    assert client.post(path, headers=headers | {'X-Idempotency-Key': 'conflicting-retry-key'}, json={}).status_code == 400
    assert seen == []


def test_accounts_retry_reserves_quota_and_emits_company_notification_once(tmp_path):
    from fastapi.testclient import TestClient
    received, reply_status = [], [201]
    async def auth(token):
        return m.Identity('alice')
    async def upstream(req):
        marker = {'x-alaada-workspace-enforced': 'v1'}
        if req.method == 'GET':
            return httpx.Response(200, json={'status': 'ok'}, headers=marker)
        received.append(req.headers['idempotency-key'])
        return httpx.Response(reply_status[0], json={'id': 'retry-created-company'}, headers=marker)
    application = m.create_app(tmp_path / 'accounts-quota.db', authenticate=auth,
        accounts_url='http://127.0.0.1', accounts_secret='accounts-gateway-secret-more-than-32-characters',
        accounts_transport=httpx.MockTransport(upstream))
    client = TestClient(application)
    wid = client.get('/api/workspaces', headers={'Authorization': 'Bearer alice'}).json()['workspaces'][0]['id']
    headers = {'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid, 'Idempotency-Key': 'retry-quota-company-key'}
    path = f'/api/workspaces/{wid}/accounts/companies'
    for _ in range(3):
        assert client.post(path, headers=headers, json={'name': 'Business'}).status_code == 201
    assert len(received) == 3  # A receipt never bypasses backend authorization.
    with application.state.store.db() as db:
        assert db.one('usage', {'workspace': wid, 'product': 'accounts'})['amount'] == 1
        assert len(db.rows('notifications', {'workspace': wid, 'action': 'accounts:create'})) == 1
        assert len(db.rows('accounts_bindings', {'workspace': wid})) == 1
    assert client.post(path, headers=headers, json={'name': 'Changed input'}).status_code == 409
    assert len(received) == 3
    reply_status[0] = 403
    assert client.post(path, headers=headers, json={'name': 'Business'}).status_code == 403
    # Revoked access on replay neither leaks a cached response nor refunds an
    # already completed operation's legitimate usage.
    with application.state.store.db() as db:
        assert db.one('usage', {'workspace': wid, 'product': 'accounts'})['amount'] == 1
    headers['Idempotency-Key'] = 'uncertain-quota-company-key'
    reply_status[0] = 503
    assert client.post(path, headers=headers, json={'name': 'Business'}).status_code == 503
    reply_status[0] = 201
    assert client.post(path, headers=headers, json={'name': 'Business'}).status_code == 201
    with application.state.store.db() as db:
        assert db.one('usage', {'workspace': wid, 'product': 'accounts'})['amount'] == 2
    headers['Idempotency-Key'] = 'rejected-quota-company-key'
    reply_status[0] = 422
    assert client.post(path, headers=headers, json={'name': 'Business'}).status_code == 422
    with application.state.store.db() as db:
        assert db.one('usage', {'workspace': wid, 'product': 'accounts'})['amount'] == 2
    reply_status[0] = 201
    assert client.post(path, headers=headers, json={'name': 'Business'}).status_code == 201
    with application.state.store.db() as db:
        assert db.one('usage', {'workspace': wid, 'product': 'accounts'})['amount'] == 3


def test_public_billing_readiness_uses_same_origin_api_rewrite(env):
    direct = env[0].get('/health')
    frontend = env[0].get('/api/health')
    assert direct.status_code == frontend.status_code == 200
    assert direct.json() == frontend.json()
    assert frontend.json()['dodo_billing']['checkout_enabled'] is False
    assert 'api_key' not in frontend.text and 'test-secret' not in frontend.text


def test_sharing_notifies_recipient_private_inbox_once_and_revoke_revokes_access(env):
    alice = env[3]
    bob = next(w['id'] for w in request(env, 'bob', 'GET', '/workspaces').json()['workspaces'] if w['kind'] == 'personal')
    resource = request(env, 'alice', 'POST', f'/workspaces/{alice}/resources',
        {'product': 'sheets', 'kind': 'workbook', 'title': 'Shared', 'payload': {}}, alice).json()['id']
    share = f'/workspaces/{alice}/resources/{resource}/sharing'
    for _ in range(2):
        assert request(env, 'alice', 'POST', share, {'user': 'bob', 'permission': 'read'}, alice).status_code == 200
    assert request(env, 'bob', 'GET', f'/workspaces/{alice}/notifications').status_code == 403
    inbox = request(env, 'bob', 'GET', f'/workspaces/{bob}/notifications').json()['items']
    assert len(inbox) == 1 and inbox[0]['resource'] == resource
    assert request(env, 'alice', 'GET', f'/workspaces/{bob}/notifications').status_code == 403
    assert request(env, 'bob', 'GET', f'/workspaces/{alice}/resources/{resource}').status_code == 200
    assert request(env, 'alice', 'POST', share, {'user': 'bob', 'permission': 'revoke'}, alice).status_code == 200
    assert request(env, 'bob', 'GET', f'/workspaces/{alice}/resources/{resource}').status_code == 403
    items = request(env, 'bob', 'GET', f'/workspaces/{bob}/notifications').json()['items']
    assert len(items) == 2 and items[0]['action'] == 'share:revoke'


def test_production_rejects_alternate_database_even_through_factory(tmp_path, monkeypatch):
    monkeypatch.setenv('ALAADA_ENV', 'production')
    with pytest.raises(ValueError, match='Appwrite TablesDB'):
        m.create_app(tmp_path / 'must-not-be-created.db')
    assert not (tmp_path / 'must-not-be-created.db').exists()


def test_admin_requires_operator_configured_verified_appwrite_membership(env, monkeypatch):
    monkeypatch.delenv('ALAADA_PLATFORM_ADMIN_TEAM', raising=False)
    assert request(env, 'admin', 'GET', '/admin/overview').status_code == 403
    monkeypatch.setenv('ALAADA_PLATFORM_ADMIN_TEAM', 'team')
    assert request(env, 'alice', 'GET', '/admin/overview').status_code == 403
    response = request(env, 'admin', 'GET', '/admin/overview')
    assert response.status_code == 200 and response.json()['totals']['workspaces'] >= 2
    env[1]['admin'] = m.Identity('admin')
    assert request(env, 'admin', 'GET', '/admin/overview').status_code == 403


def test_paused_effectively_free_subscription_can_still_be_cancelled(tmp_path):
    env = dodo_app(tmp_path)
    headers, event = activate(env)
    assert deliver(env, 'paused', dict(event, status='paused'), event_type='subscription.paused')[0].status_code == 200
    endpoint = f'/api/workspaces/{env["workspace"]}/subscription'
    assert env['client'].get(endpoint, headers=headers).json()['plan'] == 'Free'
    response = env['client'].post(endpoint, headers=headers, json={'plan': 'Free'})
    assert response.status_code == 202 and len(env['calls']['cancel']) == 1


@pytest.mark.parametrize('code', [408, 409, 429, 500])
def test_ambiguous_checkout_response_keeps_lock_and_never_creates_another_session(tmp_path, code):
    import httpx
    from dodopayments import APIStatusError
    env = dodo_app(tmp_path)
    calls = []
    def ambiguous(**kwargs):
        calls.append(kwargs)
        raise APIStatusError('uncertain', response=httpx.Response(code,
            request=httpx.Request('POST', 'https://example.invalid/checkout')), body={})
    env['app'].state.dodo_client.checkout_sessions.create = ambiguous
    headers = {'Authorization': 'Bearer alice', 'X-Alaada-Workspace': env['workspace']}
    endpoint = f'/api/workspaces/{env["workspace"]}/subscription'
    assert env['client'].post(endpoint, headers=headers, json={'plan': 'Pro'}).status_code == 503
    assert env['client'].post(endpoint, headers=headers, json={'plan': 'Pro'}).status_code == 409
    assert len(calls) == 1
    with env['app'].state.store.db() as db:
        assert db.one('billing_requests', {'workspace': env['workspace']})['state'] == 'pending'
        assert db.one('dodo_checkouts', {'workspace': env['workspace']})['state'] == 'unknown'

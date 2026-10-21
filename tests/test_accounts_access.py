"""Company discovery and Appwrite team authority at the real gateway boundary."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from test_personal_workspaces import m


@pytest.mark.parametrize('native', [False, True])
def test_company_pagination_filters_access_before_counting_and_slicing(tmp_path, native):
    visible = {'b': {'id': 'b'}, 'd': {'id': 'd'}, 'unregistered': {'id': 'unregistered'}}
    calls = []
    async def auth(token):
        return m.Identity(token)
    async def backend(req):
        if req.url.path == '/health/live':
            return httpx.Response(200, json={'status': 'alive', 'persistence': 'appwrite-tablesdb'})
        calls.append(req.url.path)
        marker = {'x-alaada-workspace-enforced': 'v1'}
        if req.url.path == '/workspace-gateway/health':
            return httpx.Response(200, headers=marker, json={'capabilities': {'company_memberships': native}})
        if req.url.path == '/companies':
            return httpx.Response(200, headers=marker, json={'items': list(visible.values()), 'meta': {'total': len(visible)}})
        company = req.url.path.rsplit('/', 1)[-1]
        return httpx.Response(200 if company in visible else 404, headers=marker, json=visible.get(company, {}))
    app = m.create_app(tmp_path / 'list.db', authenticate=auth, accounts_url='http://127.0.0.1',
        accounts_secret='x' * 40, accounts_transport=httpx.MockTransport(backend))
    client = TestClient(app)
    headers = {'Authorization': 'Bearer alice'}
    wid = client.get('/api/workspaces', headers=headers).json()['workspaces'][0]['id']
    headers['X-Alaada-Workspace'] = wid
    with app.state.store.db() as db:
        for name in 'abcd':
            db.insert('accounts_bindings', {'company': name, 'workspace': wid, 'created_by': 'alice', 'created': 1})
    path = f'/api/workspaces/{wid}/accounts/companies'
    for page, ids in [(1, ['b']), (2, ['d']), (3, [])]:
        response = client.get(path + f'?page={page}&page_size=1', headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()['total'] == 2
        assert [row['id'] for row in response.json()['items']] == ids
    if native:
        assert '/companies/a' not in calls and '/companies/c' not in calls
    for invalid in ('page=0', 'page_size=101', 'page_size=1&page_size=2', 'q=ignored', 'page=bad'):
        assert client.get(path + '?' + invalid, headers=headers).status_code == 400


@pytest.mark.parametrize('failure', ['short', 'duplicates', 'wrong-id', 'revoked', 'marker'])
def test_company_listing_rejects_incomplete_or_revoked_results(tmp_path, failure):
    async def auth(token):
        return m.Identity(token)
    async def backend(req):
        if req.url.path == '/health/live':
            return httpx.Response(200, json={'status': 'alive', 'persistence': 'appwrite-tablesdb'})
        marker = {'x-alaada-workspace-enforced': 'v1'}
        if req.url.path == '/workspace-gateway/health':
            return httpx.Response(200, headers=marker, json={'capabilities': {'company_memberships': True}})
        if req.url.path == '/companies':
            rows = [{'id': 'a'}] * (2 if failure == 'duplicates' else 1)
            return httpx.Response(200, headers=marker, json={'items': rows, 'meta': {'total': 2 if failure in ('duplicates', 'short') else 1}})
        return httpx.Response(404 if failure == 'revoked' else 200,
            headers={} if failure == 'marker' else marker, json={'id': 'b' if failure == 'wrong-id' else 'a'})
    app = m.create_app(tmp_path / 'bad-list.db', authenticate=auth, accounts_url='http://127.0.0.1',
        accounts_secret='x' * 40, accounts_transport=httpx.MockTransport(backend))
    client = TestClient(app)
    headers = {'Authorization': 'Bearer alice'}
    wid = client.get('/api/workspaces', headers=headers).json()['workspaces'][0]['id']
    headers['X-Alaada-Workspace'] = wid
    with app.state.store.db() as db:
        db.insert('accounts_bindings', {'company': 'a', 'workspace': wid, 'created_by': 'alice', 'created': 1})
    response = client.get(f'/api/workspaces/{wid}/accounts/companies', headers=headers)
    assert response.status_code == (409 if failure == 'revoked' else 502), response.text


def test_directory_verifies_confirmed_members_and_paginates_without_contact_retention():
    offsets = []
    def handler(req):
        assert req.headers['x-appwrite-jwt'] == 'caller-token'
        assert 'x-appwrite-key' not in req.headers
        queries = [json.loads(query) for query in req.url.params.get_list('queries[]')]
        offset = next(query['values'][0] for query in queries if query['method'] == 'offset')
        offsets.append(offset)
        rows = [{'userId': str(i), 'teamId': 'team', 'confirm': i != 1, 'roles': ['editor'],
            'userName': 'Member ' + str(i), 'userEmail': 'must-not-be-retained@example.test'} for i in range(offset, min(offset + 100, 101))]
        return httpx.Response(200, json={'memberships': rows, 'total': 101})
    result = asyncio.run(m.appwrite_team_members('caller-token', 'team', transport=httpx.MockTransport(handler)))
    assert offsets == [0, 100] and len(result) == 100
    assert '1' not in [member['user_id'] for member in result]
    assert 'must-not-be-retained' not in json.dumps(result)


@pytest.mark.parametrize('response', [
    {'memberships': [], 'total': 1},
    {'memberships': [{'userId': 'bob', 'roles': [], 'teamId': 'wrong', 'confirm': True}], 'total': 1},
    {'memberships': [{'userId': 'bob', 'roles': [], 'confirm': True}], 'total': -1},
])
def test_directory_fails_closed_on_incomplete_or_cross_team_data(response):
    with pytest.raises(m.HTTPException) as error:
        asyncio.run(m.appwrite_team_members('token', 'team', transport=httpx.MockTransport(
            lambda req: httpx.Response(200, json=response))))
    assert error.value.status_code == 503


@pytest.mark.parametrize('failure', [None, 'revoked', 'wrong-backend', 'invalid-json'])
def test_accounts_wakes_without_identity_then_checks_fresh_access(tmp_path, monkeypatch, failure):
    import base64
    now, requests, checks = [1000], [], []
    monkeypatch.setattr(m.time, 'time', lambda: now[0])
    async def no_delay(_):
        pass
    monkeypatch.setattr(m.asyncio, 'sleep', no_delay)
    async def auth(token):
        checks.append(now[0])
        if failure == 'revoked' and now[0] > 1000:
            raise m.HTTPException(401, 'Session revoked')
        return m.Identity('alice')
    def provider(request):
        requests.append(request)
        if request.url.path == '/health/live':
            assert 'authorization' not in request.headers
            assert 'x-alaada-gateway-context' not in request.headers
            now[0] += 50
            if len(requests) == 1:
                return httpx.Response(503, text='Service is waking')
            if failure == 'invalid-json':
                return httpx.Response(200, text='<html>Still waking</html>')
            return httpx.Response(200, json={'status': 'alive',
                'persistence': 'local-disk' if failure == 'wrong-backend' else 'appwrite-tablesdb'})
        claim = json.loads(base64.urlsafe_b64decode(request.headers['x-alaada-gateway-context']))
        assert claim['iat'] == now[0]
        return httpx.Response(200, json={'gateway': 'v1'}, headers={'x-alaada-workspace-enforced': 'v1'})
    app = m.create_app(tmp_path / 'warmup.db', authenticate=auth, accounts_url='https://accounts.invalid',
        accounts_secret='x' * 40, accounts_transport=httpx.MockTransport(provider))
    browser = TestClient(app)
    headers = {'Authorization': 'Bearer alice'}
    wid = browser.get('/api/workspaces', headers=headers).json()['workspaces'][0]['id']
    result = browser.get(f'/api/workspaces/{wid}/accounts/health', headers=headers | {'X-Alaada-Workspace': wid})
    assert result.status_code == (401 if failure == 'revoked' else 503 if failure else 200)
    signed = [request for request in requests if request.url.path == '/workspace-gateway/health']
    assert len(signed) == (0 if failure else 1)
    assert all(request.method == 'GET' for request in requests)
    assert len(checks) >= 3


@pytest.mark.parametrize('legacy', [False, True])
def test_accounts_wake_avoids_duplicate_schema_probe_with_legacy_compatibility(tmp_path, legacy):
    seen = []
    async def auth(token):
        return m.Identity('alice')
    def provider(request):
        seen.append(request.url.path)
        if request.url.path == '/health/live':
            assert 'authorization' not in request.headers
            return httpx.Response(404) if legacy else httpx.Response(200,
                json={'status': 'alive', 'persistence': 'appwrite-tablesdb'})
        if request.url.path == '/health':
            assert legacy and 'authorization' not in request.headers
            return httpx.Response(200, json={'status': 'ok', 'persistence': 'appwrite-tablesdb'})
        assert request.url.path == '/workspace-gateway/health'
        assert 'x-alaada-gateway-signature' in request.headers
        return httpx.Response(200, json={'gateway': 'v1'}, headers={'x-alaada-workspace-enforced': 'v1'})
    app = m.create_app(tmp_path / 'wake.db', authenticate=auth, accounts_url='http://127.0.0.1',
        accounts_secret='x' * 40, accounts_transport=httpx.MockTransport(provider))
    browser = TestClient(app)
    headers = {'Authorization': 'Bearer alice'}
    wid = browser.get('/api/workspaces', headers=headers).json()['workspaces'][0]['id']
    response = browser.get(f'/api/workspaces/{wid}/accounts/health', headers=headers | {'X-Alaada-Workspace': wid})
    assert response.status_code == 200
    assert seen == ['/health/live'] + (['/health'] if legacy else []) + ['/workspace-gateway/health']

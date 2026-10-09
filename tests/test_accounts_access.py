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

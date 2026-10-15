"""Database latency must not block health or unrelated product requests."""
import asyncio
import threading
from contextlib import contextmanager

import httpx
import pytest

from test_personal_workspaces import env


@pytest.mark.parametrize('method,path,payload', [
    ('GET', path, None) for path in (
        '/api/workspaces',
        '/api/workspaces/bootstrap?product=orbit',
        '/api/workspaces/bootstrap?product=sheets',
        '/api/workspaces/bootstrap?product=accounts',
        '/api/workspaces/bootstrap?product=analyser',
        '/api/workspaces/{wid}/access',
        '/api/workspaces/{wid}/resources',
        '/api/workspaces/{wid}/resources/{rid}',
        '/api/workspaces/{wid}/folders/{rid}/children',
        '/api/workspaces/{wid}/entitlements?product=orbit',
        '/api/workspaces/{wid}/subscription',
        '/api/workspaces/{wid}/notifications',
        '/api/account/preferences',
        '/api/shared',
    )
] + [
    ('POST', '/api/workspaces/{wid}/notifications/{nid}/read', {}),
    ('PUT', '/api/account/preferences', {'version': 0, 'personal_activity': False, 'organisation_activity': True}),
    ('POST', '/api/workspaces/{wid}/resources', {'product': 'sheets', 'kind': 'workbook', 'title': 'New', 'payload': {}}),
    ('PUT', '/api/workspaces/{wid}/resources/{rid}', {'version': 1, 'title': 'Updated', 'payload': {}}),
    ('PUT', '/api/workspaces/{wid}/products/sheets/records/workbook/test', {'version': 0, 'title': 'Saved', 'payload': {}}),
])
def test_workspace_database_wait_does_not_block_other_requests(env, monkeypatch, method, path, payload):
    app, wid = env[4], env[3]
    headers = {'Authorization': 'Bearer alice', 'X-Alaada-Workspace': wid}
    resource = env[0].post('/api/workspaces/' + wid + '/resources', headers=headers,
        json={'product': 'platform', 'kind': 'folder', 'title': 'Folder', 'payload': {}}).json()
    with app.state.store.db() as db:
        db.insert('notifications', {'workspace': wid, 'recipient': 'alice', 'action': 'test',
            'resource': resource['id'], 'created': 1})
    notification = env[0].get('/api/workspaces/' + wid + '/notifications', headers=headers).json()['items'][0]
    path = path.format(wid=wid, rid=resource['id'], nid=notification['id'])
    if method == 'PUT' and path.endswith(resource['id']):
        payload = dict(payload, version=resource['version'])
    original = app.state.store.db
    entered, release = threading.Event(), threading.Event()
    event_thread = threading.get_ident()

    @contextmanager
    def delayed_db(*args, **kwargs):
        assert threading.get_ident() != event_thread, 'Database work blocked the async request loop'
        entered.set()
        assert release.wait(5), 'Health could not respond while the database was waiting'
        with original(*args, **kwargs) as db:
            yield db

    monkeypatch.setattr(app.state.store, 'db', delayed_db)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            pending = asyncio.create_task(client.request(method, path, json=payload, headers=headers))
            try:
                # Surface a direct event-loop database call immediately.
                for _ in range(200):
                    if entered.is_set() or pending.done():
                        break
                    await asyncio.sleep(.005)
                if pending.done():
                    await pending
                assert entered.is_set()
                health = await asyncio.wait_for(client.get('/health'), 1)
                assert health.status_code == 200 and not pending.done()
            finally:
                release.set()
            response = await pending
            assert response.status_code == 200, response.text

    asyncio.run(exercise())

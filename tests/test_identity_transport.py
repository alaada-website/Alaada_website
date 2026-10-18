"""Pooled sockets must never pool authentication, cookies or stale permissions."""
import asyncio
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from test_personal_workspaces import m


def page(key, rows):
    return httpx.Response(200, json={key: rows, 'total': len(rows)})


def boundary(request, *, teams=1, confirmed=True, roles=None):
    uid = request.headers['x-appwrite-jwt']
    assert request.headers['x-appwrite-project'] == m.PROJECT
    assert 'x-appwrite-key' not in request.headers and 'cookie' not in request.headers
    if request.url.path.endswith('/account'):
        return httpx.Response(200, json={'$id': uid, 'status': True},
                              headers={'set-cookie': 'private-session=' + uid + '; Path=/'})
    if request.url.path.endswith('/teams'):
        return page('teams', [{'$id': 'team' + str(i), 'name': 'Team ' + str(i)} for i in range(teams)])
    queries = [json.loads(q) for q in request.url.params.get_list('queries[]')]
    assert next(q['values'] for q in queries if q.get('attribute') == 'userId') == [uid]
    tid = request.url.path.split('/')[-2]
    return page('memberships', [{'userId': uid, 'teamId': tid, 'confirm': confirmed,
                                'roles': roles if roles is not None else ['editor']}])


def test_concurrent_identities_have_no_shared_credentials_cookies_or_cached_permissions():
    seen, confirmed, roles = [], True, ['editor']
    async def handle(request):
        seen.append(request)
        await asyncio.sleep(0)
        return boundary(request, confirmed=confirmed, roles=roles)

    async def exercise():
        nonlocal confirmed, roles
        auth = m.AppwriteIdentity(transport=httpx.MockTransport(handle))
        await auth.start()
        client = auth._client
        try:
            users = ['user' + str(i) for i in range(12)]
            results = await asyncio.gather(*(auth(uid) for uid in users))
            assert [result.user for result in results] == users
            assert all(result.teams == {'team0': ['editor']} for result in results)
            assert len(seen) == 36
            assert not client.cookies and 'x-appwrite-jwt' not in client.headers
            roles = ['reader']
            assert (await auth('user0')).teams == {'team0': ['reader']}
            confirmed = False
            assert not (await auth('user0')).teams
            assert len(seen) == 42  # Every request rechecks account, team and membership.
        finally:
            await auth.close()
        assert client.is_closed and auth._client is None

    asyncio.run(exercise())


def test_membership_queries_are_bounded_parallel_and_leave_no_tasks():
    active, peak, finished = 0, 0, 0
    reached = None
    async def handle(request):
        nonlocal active, peak, finished
        if request.url.path.endswith('/memberships'):
            active += 1
            peak = max(peak, active)
            if active == 4:
                reached.set()
            try:
                await asyncio.wait_for(reached.wait(), 1)
                await asyncio.sleep(.005)
            finally:
                active -= 1
                finished += 1
        return boundary(request, teams=8)

    async def exercise():
        nonlocal reached
        reached = asyncio.Event()
        result = await m.AppwriteIdentity(transport=httpx.MockTransport(handle))('alice')
        assert len(result.teams) == 8 and peak == 4 and active == 0 and finished == 8

    asyncio.run(exercise())


@pytest.mark.parametrize('failure', ['timeout', 'rejected', 'cancelled'])
def test_timeout_denial_and_cancellation_cancel_all_pending_memberships(failure):
    active, finished = 0, 0
    all_started = None
    async def handle(request):
        nonlocal active, finished
        if request.url.path.endswith('/memberships'):
            active += 1
            if active == 4:
                all_started.set()
            try:
                await all_started.wait()
                if failure == 'rejected' and '/team0/' in request.url.path:
                    return httpx.Response(401)
                await asyncio.Event().wait()
            finally:
                active -= 1
                finished += 1
        return boundary(request, teams=4)

    async def exercise():
        nonlocal all_started
        all_started = asyncio.Event()
        auth = m.AppwriteIdentity(transport=httpx.MockTransport(handle))
        auth.deadline = .1
        pending = asyncio.create_task(auth('alice'))
        if failure == 'cancelled':
            await asyncio.wait_for(all_started.wait(), 1)
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
        else:
            with pytest.raises(HTTPException) as caught:
                await pending
            assert caught.value.status_code == (401 if failure == 'rejected' else 503)
        assert active == 0 and finished == 4

    asyncio.run(exercise())


@pytest.mark.parametrize('body', [None, [], {}, {'$id': '../bob', 'status': True},
                                 {'$id': 'alice', 'status': 'true'}])
def test_malformed_accounts_never_grant_access(body):
    async def exercise():
        auth = m.AppwriteIdentity(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body)))
        with pytest.raises(HTTPException) as caught:
            await auth('alice')
        assert caught.value.status_code == 503
    asyncio.run(exercise())


@pytest.mark.parametrize('body', [
    {'teams': [], 'total': 1}, {'teams': [], 'total': True}, {'teams': [], 'total': -1},
    {'teams': [{'$id': 'team0'}, {'$id': 'team0'}], 'total': 2},
    {'teams': [{'$id': '../team'}], 'total': 1},
    {'teams': [{'$id': 'team0'}], 'total': 0}, {'teams': [None], 'total': 1},
    {'teams': 'invalid', 'total': 1}, {'teams': [], 'total': 50001},
])
def test_malformed_team_pages_never_return_partial_authority(body):
    def handle(request):
        return httpx.Response(200, json=body) if request.url.path.endswith('/teams') else boundary(request)
    async def exercise():
        with pytest.raises(HTTPException) as caught:
            await m.AppwriteIdentity(transport=httpx.MockTransport(handle))('alice')
        assert caught.value.status_code == 503
    asyncio.run(exercise())


@pytest.mark.parametrize('override', [
    {'userId': 'bob'}, {'teamId': 'other'}, {'confirm': 'true'}, {'roles': 'admin'},
    {'roles': [None]}, {'roles': ['']}, {'roles': ['x' * 129]},
])
def test_invalid_membership_never_grants_roles(override):
    def handle(request):
        if request.url.path.endswith('/memberships'):
            return page('memberships', [dict(userId='alice', teamId='team0', confirm=True, roles=['editor']) | override])
        return boundary(request)
    async def exercise():
        with pytest.raises(HTTPException) as caught:
            await m.AppwriteIdentity(transport=httpx.MockTransport(handle))('alice')
        assert caught.value.status_code == 503
    asyncio.run(exercise())


@pytest.mark.parametrize('second', [
    {'teams': [], 'total': 2},
    {'teams': [{'$id': 'team1'}], 'total': 3},
    {'teams': [{'$id': 'team0'}], 'total': 2},
])
def test_truncated_changing_or_repeated_pages_cannot_hide_permissions(second):
    calls = []
    def handle(request):
        calls.append(request.url.path)
        if request.url.path.endswith('/teams'):
            queries = [json.loads(q) for q in request.url.params.get_list('queries[]')]
            offset = next(q['values'][0] for q in queries if q['method'] == 'offset')
            return httpx.Response(200, json=second if offset else {'teams': [{'$id': 'team0'}], 'total': 2})
        return boundary(request)
    async def exercise():
        with pytest.raises(HTTPException) as caught:
            await m.AppwriteIdentity(transport=httpx.MockTransport(handle))('alice')
        assert caught.value.status_code == 503
        assert not any(path.endswith('/memberships') for path in calls)
    asyncio.run(exercise())


def test_duplicate_memberships_do_not_select_a_more_privileged_row():
    def handle(request):
        if request.url.path.endswith('/memberships'):
            return page('memberships', [{'userId': 'alice', 'confirm': True, 'roles': [role]}
                                         for role in ('reader', 'owner')])
        return boundary(request)
    async def exercise():
        with pytest.raises(HTTPException) as caught:
            await m.AppwriteIdentity(transport=httpx.MockTransport(handle))('alice')
        assert caught.value.status_code == 503
    asyncio.run(exercise())


@pytest.mark.parametrize('kind', ['html', 'large', 'redirect', 'disabled', 'revoked'])
def test_bad_responses_are_bounded_and_never_retried_or_redirected(kind):
    seen = []
    def handle(request):
        seen.append(request)
        return {'html': httpx.Response(200, text='<html>not an identity</html>'),
                'large': httpx.Response(200, content=b' ' * 1_000_001),
                'redirect': httpx.Response(302, headers={'location': 'https://untrusted.test'}),
                'disabled': httpx.Response(200, json={'$id': 'alice', 'status': False}),
                'revoked': httpx.Response(401)}[kind]
    async def exercise():
        with pytest.raises(HTTPException) as caught:
            await m.AppwriteIdentity(transport=httpx.MockTransport(handle))('alice')
        assert caught.value.status_code == (401 if kind in ('disabled', 'revoked') else 503)
        assert len(seen) == 1
    asyncio.run(exercise())


def test_actual_http_connection_is_reused_across_identity_checks(monkeypatch):
    connections = []
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def setup(self):
            super().setup()
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        def do_GET(self):
            connections.append(self.client_address)
            assert not self.headers.get('Cookie')
            uid = self.headers['X-Appwrite-JWT']
            data = {'$id': uid, 'status': True} if self.path == '/v1/account' else {'teams': [], 'total': 0}
            body = json.dumps(data).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Set-Cookie', 'session=' + uid + '; Path=/')
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(m, 'ENDPOINT', 'http://127.0.0.1:' + str(server.server_port) + '/v1')
    async def exercise():
        auth = m.AppwriteIdentity()
        await auth.start()
        try:
            for uid in ('alice', 'bob', 'alice'):
                assert (await auth(uid)).user == uid
            assert len(connections) == 6 and len(set(connections)) == 1
            assert not auth._client.cookies
        finally:
            await auth.close()
    try:
        asyncio.run(exercise())
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_identity_pool_follows_application_lifespan(tmp_path):
    auth = m.AppwriteIdentity(transport=httpx.MockTransport(boundary))
    application = m.create_app(tmp_path / 'identity.sqlite3', authenticate=auth)
    assert auth._client is None
    with TestClient(application) as client:
        pool = auth._client
        assert pool is not None and not pool.is_closed
        response = client.get('/api/workspaces/bootstrap?product=orbit', headers={'authorization': 'Bearer alice'})
        assert response.status_code == 200 and response.json()['user'] == 'alice'
    assert auth._client is None and pool.is_closed

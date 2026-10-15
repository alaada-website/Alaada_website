"""Exercise the real SDK against the bounded admin-only HTTP transport."""
import json
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import httpx
import pytest
from appwrite.exception import AppwriteException
from appwrite.query import Query
from appwrite.services.tables_db import TablesDB


def row(data=None):
    return dict({'$id': 'row', '$sequence': '1', '$databaseId': 'db',
                 '$tableId': 'private', '$createdAt': '2026-10-15T00:00:00Z',
                 '$updatedAt': '2026-10-15T00:00:00Z', '$permissions': []},
                **(data or {}))


def test_real_sdk_preserves_queries_models_and_private_writes(module):
    seen = []
    def handle(request):
        seen.append(request)
        assert request.headers['x-appwrite-key'] == 'private-key'
        assert request.headers['x-appwrite-project'] == 'project'
        assert request.headers['x-appwrite-response-format'] == '2.0.0'
        if request.method == 'GET':
            assert request.url.params['queries[0]'] == Query.equal('workspace', 'private')
            assert request.url.params['total'] == 'false'
            assert request.url.params['transactionId'] == 'tx'
            return httpx.Response(200, json={'total': 1, 'rows': [row({'name': 'Saved'})]})
        if request.method == 'DELETE':
            return httpx.Response(204)
        data = json.loads(request.content)
        assert data['permissions'] == [] and data['transactionId'] == 'tx'
        assert data['data'] == {'name': 'বাংলা', 'amount': '12.34', 'enabled': False}
        return httpx.Response(201, json=row(data['data']))

    client = module._pooled_tablesdb_client('https://db.test/v1', 'project', 'private-key',
                                            transport=httpx.MockTransport(handle))
    try:
        service = TablesDB(client)
        result = service.list_rows(database_id='db', table_id='private',
                                   queries=[Query.equal('workspace', 'private')],
                                   total=False, transaction_id='tx')
        assert result.rows[0].data['name'] == 'Saved'
        created = service.create_row(database_id='db', table_id='private', row_id='row',
                                     data={'name': 'বাংলা', 'amount': '12.34', 'enabled': False},
                                     permissions=[], transaction_id='tx')
        assert created.data['amount'] == '12.34'
        service.delete_row(database_id='db', table_id='private', row_id='row', transaction_id='tx')
        assert len(seen) == 3
        assert all(request.extensions['timeout'] ==
                   {'connect': 5, 'read': 20, 'write': 20, 'pool': 5} for request in seen)
    finally:
        client.close()
    assert client._http.is_closed


@pytest.mark.parametrize('code', [401, 403, 404, 409, 429, 500])
def test_errors_keep_sdk_status_and_never_retry(module, code):
    seen = []
    def handle(request):
        seen.append(request)
        return httpx.Response(code, json={'message': 'Rejected', 'type': 'row_conflict'})
    client = module._pooled_tablesdb_client('https://db.test/v1', 'project', 'key',
                                            transport=httpx.MockTransport(handle))
    try:
        with pytest.raises(AppwriteException) as caught:
            client.call('post', '/tablesdb/db/tables/private/rows', params={'data': {}})
        assert caught.value.code == code and caught.value.type == 'row_conflict'
        assert len(seen) == 1
    finally:
        client.close()


@pytest.mark.parametrize('kind', ['empty', 'html', 'array', 'redirect'])
def test_invalid_responses_fail_closed(module, kind):
    responses = {'empty': httpx.Response(200, content=b''),
                 'html': httpx.Response(502, text='<html>Proxy unavailable</html>'),
                 'array': httpx.Response(200, json=[]),
                 'redirect': httpx.Response(302, headers={'location': 'https://other.test/secret'})}
    seen = []
    def handle(request):
        seen.append(request)
        return responses[kind]
    client = module._pooled_tablesdb_client('https://db.test/v1', 'project', 'secret',
                                            transport=httpx.MockTransport(handle))
    try:
        with pytest.raises(AppwriteException):
            client.call('get', '/tablesdb')
        assert len(seen) == 1
    finally:
        client.close()


def test_timeout_never_replays_ambiguous_write(module):
    seen = []
    def handle(request):
        seen.append(request)
        raise httpx.ReadTimeout('sensitive internal URL', request=request)
    client = module._pooled_tablesdb_client('https://db.test/v1', 'project', 'key',
                                            transport=httpx.MockTransport(handle))
    try:
        with pytest.raises(AppwriteException, match='not confirmed') as caught:
            client.call('patch', '/tablesdb/transactions/tx', params={'commit': True})
        assert caught.value.code == 503 and 'sensitive' not in str(caught.value)
        assert len(seen) == 1
    finally:
        client.close()


def test_concurrent_requests_do_not_mix_headers_or_replay_cookies(module):
    seen = []
    def handle(request):
        assert 'cookie' not in request.headers
        assert 'x-appwrite-jwt' not in request.headers
        assert request.headers['x-test-workspace'] == request.url.params['workspace']
        seen.append(request)
        return httpx.Response(200, json={'ok': True},
                              headers={'set-cookie': 'session=not-an-identity; Path=/'})
    client = module._pooled_tablesdb_client('https://db.test/v1', 'project', 'key',
                                            transport=httpx.MockTransport(handle))
    try:
        def send(number):
            name = 'workspace-' + str(number)
            return client.call('get', '/tablesdb',
                               headers={'x-test-workspace': name}, params={'workspace': name})
        with ThreadPoolExecutor(max_workers=8) as workers:
            assert all(item['ok'] for item in workers.map(send, range(32)))
        assert len(seen) == 32
        assert 'x-test-workspace' not in client.get_headers()
        with pytest.raises(AppwriteException, match='Unsupported'):
            client.call('get', '/account')
        assert len(seen) == 32
    finally:
        client.close()


def test_actual_http_connection_is_reused(module):
    connections = []
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def do_GET(self):
            connections.append(self.client_address)
            body = b'{"total":0,"rows":[]}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    client = module._pooled_tablesdb_client(
        'http://127.0.0.1:' + str(server.server_port) + '/v1', 'project', 'test-only')
    try:
        for _ in range(3):
            assert client.call('get', '/tablesdb')['total'] == 0
        assert len(connections) == 3 and len(set(connections)) == 1
    finally:
        client.close()
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)

@pytest.fixture
def module():
    from test_personal_workspaces import m
    return m

def test_gateway_pool_closes_on_shutdown(module, monkeypatch):
    from fastapi.testclient import TestClient
    client = module._pooled_tablesdb_client('https://db.test/v1', 'project', 'key',
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={})))
    monkeypatch.setattr(module, '_pooled_tablesdb_client', lambda *args: client)
    application = module.create_app('tablesdb:test-db', appwrite_api_key='key',
                                     appwrite_storage_bucket='private')
    with TestClient(application) as browser:
        assert browser.get('/health').status_code == 200
        assert not client._http.is_closed
    assert client._http.is_closed



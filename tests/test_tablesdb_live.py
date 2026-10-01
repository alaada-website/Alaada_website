"""Opt-in tests against real Appwrite TablesDB, using disposable test identities."""
import importlib.util
import os
from pathlib import Path
import sys
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(os.environ.get('ALAADA_LIVE_TABLESDB_TEST') != '1', reason='Requires explicit live Appwrite test configuration')
spec = importlib.util.spec_from_file_location('workspace_live', Path(__file__).parents[1] / 'alaada_workspaces.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


def test_live_personal_pro_enterprise_isolation_and_conflict():
    suffix = uuid.uuid4().hex[:20]
    owner, admin, team = 'probe_owner_' + suffix, 'probe_admin_' + suffix, 'probe_team_' + suffix
    identities = {'owner': m.Identity(owner, {team: ['editor']}), 'admin': m.Identity(admin, {team: ['admin']})}

    async def authenticate(token):
        return identities[token]

    app = m.create_app('tablesdb:' + os.environ['APPWRITE_DATABASE_ID'], authenticate=authenticate,
                       appwrite_api_key=os.environ['APPWRITE_API_KEY'],
                       appwrite_storage_bucket=os.environ['APPWRITE_STORAGE_BUCKET_ID'])
    store = app.state.store
    client = TestClient(app)
    workspaces = []

    def call(user, method, path, wid=None, data=None):
        return client.request(method, '/api' + path, json=data,
            headers={'Authorization': 'Bearer ' + user, 'X-Alaada-Workspace': wid or ''})

    try:
        org = store.organisation(team, 'Disposable acceptance organisation')
        workspaces.append(org)
        personal = 'p_' + m.hashlib.sha256(owner.encode()).hexdigest()
        admin_personal = 'p_' + m.hashlib.sha256(admin.encode()).hexdigest()
        workspaces.extend([personal, admin_personal])
        response = call('owner', 'GET', '/workspaces')
        assert response.status_code == 200, response.text
        assert {w['id'] for w in response.json()['workspaces']} == {personal, org}
        with store.db() as db:
            db.update('subscriptions', {'workspace': personal}, {'plan': 'Pro'})

        def create(wid):
            response = call('owner', 'POST', f'/workspaces/{wid}/resources', wid,
                {'product': 'sheets', 'kind': 'workbook', 'title': 'Disposable workbook', 'payload': {'sentinel': wid}})
            assert response.status_code == 200, response.text
            return response.json()['id']

        private, company = create(personal), create(org)
        assert call('admin', 'GET', f'/workspaces/{personal}/resources/{private}').status_code == 403
        assert call('owner', 'GET', f'/workspaces/{org}/resources/{private}').status_code == 404
        assert call('owner', 'POST', f'/workspaces/{personal}/resources', org,
            {'product': 'sheets', 'kind': 'workbook', 'title': 'Wrong workspace', 'payload': {}}).status_code == 409
        identities['owner'] = m.Identity(owner)
        assert call('owner', 'GET', f'/workspaces/{org}/resources/{company}').status_code == 403
        assert call('owner', 'GET', f'/workspaces/{personal}/resources/{private}').status_code == 200
        subscription = call('owner', 'GET', f'/workspaces/{personal}/subscription')
        assert subscription.status_code == 200, subscription.text
        assert subscription.json()['plan'] == 'Pro'

        # Another writer changes the resource after this transaction reads it.
        with pytest.raises(HTTPException) as conflict:
            with store.db() as db:
                row = db.one('resources', {'id': private})
                store.service.update_row(database_id=store.database_id, table_id='aw_resources',
                    row_id=db.row_id('resources', row), data={'title': 'Concurrent save', 'version': row['version'] + 1})
                db.update('resources', {'id': private}, {'title': 'Stale save'})
        assert conflict.value.status_code == 409
        with store.db() as db:
            assert db.one('resources', {'id': private})['title'] == 'Concurrent save'
    finally:
        with store.db() as db:
            for wid in workspaces:
                for table in ('resources', 'usage', 'audit', 'notifications', 'account_preferences', 'accounts_bindings', 'billing_requests', 'subscriptions'):
                    db.delete(table, {'workspace': wid})
                db.delete('workspaces', {'id': wid})

"""HTTP acceptance tests with a fake Appwrite boundary, real SQLite and permissions."""
import hashlib
import base64
import hmac
import importlib.util
import json
import re
import sys
import time
import subprocess
from email.parser import BytesParser
from email.policy import default as email_policy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import asyncio
import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("alaada_workspaces", Path(__file__).parents[1] / "alaada_workspaces.py")
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


@pytest.fixture
def env(tmp_path):
    users = {"alice": m.Identity("alice", {"team": ["editor"]}),
             "admin": m.Identity("admin", {"team": ["admin"]}),
             "bob": m.Identity("bob"), "reader": m.Identity("reader", {"team": []})}

    async def authenticate(token):
        if token not in users:
            raise HTTPException(401, "Invalid session")
        return users[token]

    files = {}

    def storage_boundary(req):
        assert req.headers['X-Appwrite-Key'] == 'test-storage-key'
        assert req.headers['X-Appwrite-Project'] == m.PROJECT
        base = '/v1/storage/buckets/test-bucket/files'
        if req.method == 'POST':
            assert req.url.path == base
            message = BytesParser(policy=email_policy).parsebytes(
                ('Content-Type: ' + req.headers['content-type'] + '\r\n\r\n').encode() + req.content)
            parts = {part.get_param('name', header='content-disposition'): part
                     for part in message.iter_parts()}
            file_id = parts['fileId'].get_payload(decode=True).decode()
            assert file_id not in files
            files[file_id] = parts['file'].get_payload(decode=True)
            return httpx.Response(201, json={'$id': file_id})
        assert req.url.path.startswith(base + '/')
        file_id = req.url.path[len(base) + 1:].split('/')[0]
        if file_id not in files:
            return httpx.Response(404)
        if req.method == 'GET':
            assert req.url.path == base + '/' + file_id + '/download'
            return httpx.Response(200, content=files[file_id])
        assert req.method == 'DELETE'
        assert req.url.path == base + '/' + file_id
        del files[file_id]
        return httpx.Response(204)

    app = m.create_app(tmp_path / "workspace.sqlite3", authenticate, billing_secret="test-secret",
                       appwrite_api_key='test-storage-key', appwrite_storage_bucket='test-bucket',
                       appwrite_storage_transport=httpx.MockTransport(storage_boundary))
    client = TestClient(app)
    org = app.state.store.organisation("team", "Enterprise")
    personal = client.get("/api/workspaces", headers={"Authorization": "Bearer alice"}).json()["workspaces"]
    personal = next(w["id"] for w in personal if w["kind"] == "personal")
    return client, users, org, personal, app


def request(env, who, method, path, data=None, workspace=None):
    return env[0].request(method, "/api" + path, json=data,
                          headers={"Authorization": "Bearer " + who, "X-Alaada-Workspace": workspace or ""})


def create(env, workspace, who="alice", product="sheets", kind="workbook"):
    return request(env, who, "POST", f"/workspaces/{workspace}/resources",
                   {"product": product, "kind": kind, "title": "Private workbook", "payload": {"secret": "private"}}, workspace)


def confirm(env, rid, plan, event="event1"):
    raw = json.dumps({"event": event, "request": rid, "plan": plan}).encode()
    stamp = str(int(time.time()))
    signature = hmac.new(b"test-secret", stamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return env[0].post("/api/billing/confirmed", content=raw, headers={"X-Alaada-Timestamp": stamp, "X-Alaada-Signature": signature})


def plan(env, personal, target, event):
    result = request(env, "alice", "POST", f"/workspaces/{personal}/subscription", {"plan": target}, personal)
    assert result.status_code == 202
    assert confirm(env, result.json()["id"], target, event).status_code == 200


@pytest.mark.parametrize('product,kind', [
    ('orbit','conversation'), ('orbit','memory'), ('sheets','workbook'),
    ('accounts','ledger'), ('analyser','report'), ('analyser','monitor'),
])
def test_pro_plus_enterprise_membership_removal_preserves_personal(env, product, kind):
    _, users, org, personal, app = env
    plan(env, personal, "Pro", "pro")
    def native(workspace):
        response = request(env, 'alice', 'PUT',
            f'/workspaces/{workspace}/products/{product}/records/{kind}/lifecycle-record',
            {'title':'Lifecycle record','payload':{'sentinel':workspace},'version':0}, workspace)
        assert response.status_code == 200, response.text
        return response.json()
    private = native(personal)
    business = native(org)
    for who in ("admin", "bob"):
        assert request(env, who, "GET", f"/workspaces/{personal}/resources").status_code == 403
        assert request(env, who, "GET", f"/workspaces/{personal}/resources/{private['id']}").status_code == 403
        assert request(env, who, "GET", f"/workspaces/{personal}/subscription").status_code == 403
    assert request(env, "alice", "GET", f"/workspaces/{org}/resources/{private['id']}").status_code == 404
    assert request(env, "alice", "GET", f"/workspaces/{personal}/resources/{business['id']}").status_code == 404
    # A reduced organisation role must take effect without changing personal rights.
    users['alice'].teams['team'] = []
    edit = {'title':'Updated','payload':private['payload'],'version':1}
    assert request(env, 'alice', 'PUT', f"/workspaces/{org}/resources/{business['id']}",
                   edit | {'payload':business['payload']}, org).status_code == 403
    saved = request(env, 'alice', 'PUT', f"/workspaces/{personal}/resources/{private['id']}", edit, personal)
    assert saved.status_code == 200
    # An explicit grant cannot override subsequent loss of Enterprise membership.
    assert request(env, 'admin', 'POST', f"/workspaces/{org}/resources/{business['id']}/sharing",
                   {'user':'alice','permission':'write'}, org).status_code == 200
    users["alice"].teams.clear()
    assert request(env, "alice", "GET", f"/workspaces/{org}/resources/{business['id']}").status_code == 403
    assert create(env, org).status_code == 403
    assert request(env, "alice", "POST", f"/workspaces/{org}/execute", {}, org).status_code == 403
    assert request(env, "alice", "GET", f"/workspaces/{personal}/resources/{private['id']}").status_code == 200
    assert request(env, "alice", "GET", f"/workspaces/{personal}/subscription").json()["plan"] == "Pro"
    remaining = request(env, 'alice', 'GET', '/workspaces').json()
    assert remaining['user'] == 'alice'
    assert {workspace['id'] for workspace in remaining['workspaces']} == {personal}
    assert request(env, 'alice', 'GET', '/shared').json() == []
    preserved = request(env, 'alice', 'GET', f"/workspaces/{personal}/resources/{private['id']}").json()
    assert preserved['payload'] == private['payload'] and preserved['version'] == 2
    retained = request(env, "admin", "GET", f"/workspaces/{org}/resources/{business['id']}")
    assert retained.status_code == 200 and retained.json()['payload'] == business['payload']


def test_sharing_is_resource_only_and_revocable(env):
    personal = env[3]
    first, second = create(env, personal).json(), create(env, personal).json()
    path = f"/workspaces/{personal}/resources/{first['id']}"
    assert request(env, "alice", "POST", path + "/sharing", {"user": "bob", "permission": "read"}, personal).status_code == 200
    assert request(env, "bob", "GET", path).status_code == 200
    assert request(env, "bob", "GET", f"/workspaces/{personal}/resources").status_code == 403
    assert request(env, "bob", "GET", f"/workspaces/{personal}/resources/{second['id']}").status_code == 403
    assert request(env, "bob", "PUT", path, first, personal).status_code == 403
    assert request(env, "bob", "POST", path + "/sharing", {"user": "admin", "permission": "read"}, personal).status_code == 403
    request(env, "alice", "POST", path + "/sharing", {"user": "bob", "permission": "write"}, personal)
    assert request(env, "bob", "PUT", path, first, personal).status_code == 200
    assert request(env, "bob", "PUT", path, first, personal).status_code == 409
    request(env, "alice", "POST", path + "/sharing", {"user": "bob", "permission": "revoke"}, personal)
    assert request(env, "bob", "GET", path).status_code == 403
    assert request(env, "bob", "GET", "/shared").json() == []


def test_transfer_requires_owner_both_workspaces_confirmation_and_clears_grants(env):
    org, personal = env[2:4]
    resource = create(env, personal).json()
    path = f"/workspaces/{personal}/resources/{resource['id']}"
    request(env, "alice", "POST", path + "/sharing", {"user": "bob", "permission": "write"}, personal)
    data = {"destination": org, "mode": "move", "version": 1, "confirm_ownership": org}
    assert request(env, "bob", "POST", path + "/transfer", data, personal).status_code == 403
    assert request(env, "alice", "POST", path + "/transfer", data | {"confirm_ownership": "no"}, personal).status_code == 400
    copied = request(env, "alice", "POST", path + "/transfer", data | {"mode": "copy"}, personal)
    assert copied.status_code == 200
    assert request(env, "alice", "GET", path).status_code == 200
    moved = request(env, "alice", "POST", path + "/transfer", data, personal)
    assert moved.status_code == 200
    assert request(env, "alice", "GET", path).status_code == 404
    assert request(env, "bob", "GET", f"/workspaces/{org}/resources/{moved.json()['id']}").status_code == 403
    assert request(env, "bob", "GET", "/shared").json() == []
    # An ordinary employee cannot export organisation data into personal ownership.
    assert request(env, "alice", "POST", f"/workspaces/{org}/resources/{moved.json()['id']}/transfer", data | {"destination": personal, "confirm_ownership": personal}, org).status_code == 403


@pytest.mark.parametrize("product,kind", [(p, k) for p, kinds in m.KINDS.items() for k in kinds])
def test_all_product_resource_kinds_are_isolated(env, product, kind):
    org, personal = env[2:4]
    resource = create(env, personal, product=product, kind=kind).json()
    assert request(env, "admin", "GET", f"/workspaces/{personal}/resources/{resource['id']}").status_code == 403
    assert request(env, "alice", "GET", f"/workspaces/{org}/resources/{resource['id']}").status_code == 404


def test_workspace_context_and_roles(env):
    org, personal = env[2:4]
    assert request(env, "alice", "POST", f"/workspaces/{personal}/resources", {}, org).status_code == 409
    assert create(env, org, who="reader").status_code == 403
    assert request(env, "reader", "GET", f"/workspaces/{org}/resources").status_code == 200
    assert request(env, "alice", "POST", f"/workspaces/{personal}/execute", {}, org).status_code == 409
    assert request(env, "alice", "POST", f"/workspaces/{personal}/execute", {}, personal).status_code == 503
    assert request(env, "invalid", "GET", "/workspaces").status_code == 401
    assert env[0].get("/api/workspaces").status_code == 401


def test_cancel_downgrade_and_billing_replay_do_not_delete_data(env):
    personal = env[3]
    resource = create(env, personal).json()
    plan(env, personal, "Elite", "elite")
    plan(env, personal, "Pro", "pro")
    result = request(env, "alice", "POST", f"/workspaces/{personal}/subscription", {"plan": "Free"}, personal)
    rid = result.json()["id"]
    assert request(env, "alice", "GET", f"/workspaces/{personal}/subscription").json()["plan"] == "Pro"
    assert confirm(env, rid, "Free", "cancel").status_code == 200
    assert confirm(env, rid, "Free", "cancel").json()["duplicate"]
    assert request(env, "alice", "GET", f"/workspaces/{personal}/subscription").json()["plan"] == "Free"
    assert request(env, "alice", "GET", f"/workspaces/{personal}/resources/{resource['id']}").status_code == 200
    assert env[0].post("/api/billing/confirmed", json={}).status_code == 401
    assert request(env, "admin", "POST", f"/workspaces/{personal}/subscription", {"plan": "Elite"}, personal).status_code == 403


def test_atomic_quota_concurrent_requests_and_read_after_downgrade(env):
    personal, app = env[3:5]
    app.state.store.limits["Free"] = 1
    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(pool.map(lambda _: create(env, personal).status_code, range(4)))
    assert sorted(statuses) == [200, 429, 429, 429]
    assert len(request(env, "alice", "GET", f"/workspaces/{personal}/resources").json()) == 1
    # Another product has its own quota; org quota is independent.
    assert create(env, personal, product="orbit", kind="memory").status_code == 200
    assert create(env, env[2]).status_code == 200


def test_organisation_grant_does_not_survive_membership_removal(env):
    org = env[2]
    resource = create(env, org).json()
    path = f"/workspaces/{org}/resources/{resource['id']}"
    assert request(env, "admin", "POST", path + "/sharing", {"user": "alice", "permission": "write"}, org).status_code == 200
    env[1]["alice"].teams.clear()
    assert request(env, "alice", "GET", path).status_code == 403
    assert request(env, "alice", "PUT", path, resource, org).status_code == 403
    assert request(env, "alice", "GET", "/shared").json() == []


def test_personal_provision_is_idempotent_and_html_contains_no_private_data(env):
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(lambda _: request(env, "bob", "GET", "/workspaces").json(), range(4)))
    assert len({r["workspaces"][0]["id"] for r in rows}) == 1
    assert all(len(r["workspaces"]) == 1 for r in rows)
    assert env[0].get("/workspaces").headers["cache-control"] == "no-store"


def test_appwrite_adapter_uses_verified_confirmed_memberships(monkeypatch):
    calls = []
    original = httpx.AsyncClient

    def handler(request):
        calls.append(request)
        assert request.headers["X-Appwrite-JWT"] == "opaque-token"
        assert "X-Appwrite-Key" not in request.headers
        if request.url.path.endswith("/account"):
            return httpx.Response(200, json={"$id": "alice", "status": True})
        if request.url.path.endswith("/teams"):
            offset = next(json.loads(q)["values"][0] for q in request.url.params.get_list("queries[]") if json.loads(q)["method"] == "offset")
            return httpx.Response(200, json={"total": 2, "teams": [{"$id": "team" if offset == 0 else "pending"}]})
        team = "team" if "/team/" in request.url.path else "pending"
        return httpx.Response(200, json={"total": 1, "memberships": [{"userId": "alice", "confirm": team == "team", "roles": ["editor"]}]})

    monkeypatch.setattr(m.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    identity = asyncio.run(m.AppwriteIdentity()("opaque-token"))
    assert identity.user == "alice"
    assert identity.teams == {"team": ["editor"]}
    assert len(calls) == 5


@pytest.mark.parametrize("status", [401, 403, 500])
def test_appwrite_failure_denies_access(monkeypatch, status):
    original = httpx.AsyncClient
    monkeypatch.setattr(m.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(lambda _: httpx.Response(status)), **kwargs))
    with pytest.raises(HTTPException) as error:
        asyncio.run(m.AppwriteIdentity()("opaque-token"))
    assert error.value.status_code == (503 if status == 500 else 401)


@pytest.mark.parametrize("product,kind", [("orbit","conversation"),("sheets","workbook"),("accounts","ledger"),("analyser","report")])
def test_native_product_records_have_workspace_ownership_and_versions(env, product, kind):
    personal, org = env[3], env[2]
    path = f"/workspaces/{personal}/products/{product}/records/{kind}/same-key"
    data = {"title":"Native record", "payload":{"private": True}, "version":0}
    created=request(env,"alice","PUT",path,data,personal)
    assert created.status_code==200
    assert request(env,"alice","PUT",path,data,personal).status_code==409
    assert request(env,"admin","PUT",path,data,personal).status_code==403
    company=request(env,"alice","PUT",path.replace(personal,org),data,org)
    assert company.status_code==200 and created.json()["id"]!=company.json()["id"]
    updated=request(env,"alice","PUT",path,data|{"version":1},personal)
    assert updated.status_code==200 and updated.json()["version"]==2
    resource=created.json()["id"]
    assert request(env,"alice","DELETE",f"/workspaces/{personal}/resources/{resource}",{"version":1},personal).status_code==409
    assert request(env,"alice","DELETE",f"/workspaces/{personal}/resources/{resource}",{"version":2},personal).status_code==200
    assert request(env,"alice","GET",f"/workspaces/{org}/resources/{company.json()['id']}").status_code==200


def test_product_client_javascript_behavior(tmp_path):
    source=tmp_path/'client.js'
    source.write_text(m.PRODUCT_CLIENT,encoding='utf-8')
    result=subprocess.run(['node',str(Path(__file__).with_name('test_workspace_product_client.cjs')),str(source)],capture_output=True,text=True,timeout=30)
    assert result.returncode==0, result.stdout+result.stderr


def test_native_transfer_preserves_a_resumable_key_without_overwrite(env):
    personal,org=env[3],env[2]
    path=f"/workspaces/{personal}/products/sheets/records/workbook/book"
    data={"version":0,"title":"Workbook","payload":{"sheets":[]}}
    created=request(env,'alice','PUT',path,data,personal).json()
    transfer=f"/workspaces/{personal}/resources/{created['id']}/transfer"
    body={"mode":"copy","destination":org,"confirm_ownership":org,"version":1}
    copied=request(env,'alice','POST',transfer,body,personal)
    assert copied.status_code==200
    assert request(env,'alice','POST',transfer,body,personal).status_code==409
    assert request(env,'alice','PUT',path.replace(personal,org),data|{"version":1},org).status_code==200


def test_signup_webhook_signature_idempotency_and_personal_plan_preserved(tmp_path):
    url='https://staging.example/api/appwrite/users-created'
    app=m.create_app(tmp_path/'signup.sqlite3',webhook_secret='webhook-secret',webhook_url=url)
    client=TestClient(app)
    raw=json.dumps({'$id':'new-user','registration':'2026-09-29T00:00:00Z','status':True}).encode()
    signature=base64.b64encode(hmac.new(b'webhook-secret',url.encode()+raw,hashlib.sha1).digest()).decode()
    headers={'X-Appwrite-Webhook-Signature':signature,'X-Appwrite-Webhook-Project-Id':m.PROJECT}
    assert client.post('/api/appwrite/users-created',content=raw).status_code==401
    first=client.post('/api/appwrite/users-created',content=raw,headers=headers)
    assert first.status_code==200
    wid=first.json()['workspace']
    with app.state.store.db() as db:
        db.execute("UPDATE subscriptions SET plan='Pro' WHERE workspace=?",(wid,))
    assert client.post('/api/appwrite/users-created',content=raw,headers=headers).json()==first.json()
    with app.state.store.db() as db:
        assert db.execute('SELECT plan FROM subscriptions WHERE workspace=?',(wid,)).fetchone()[0]=='Pro'
        assert db.execute('SELECT count(*) FROM workspaces').fetchone()[0]==1
    assert client.post('/api/appwrite/users-created',content=raw+b' ',headers=headers).status_code==401
    assert client.post('/api/appwrite/users-created',content=raw,headers=headers|{'X-Appwrite-Webhook-Project-Id':'other'}).status_code==403


def test_registered_user_backfill_pagination_retry_and_no_profile_retention(tmp_path,monkeypatch):
    store=m.Store(tmp_path/'backfill.sqlite3')
    original=httpx.AsyncClient
    def handler(request):
        assert request.headers['X-Appwrite-Key']=='read-only-key'
        queries=[json.loads(q) for q in request.url.params.get_list('queries[]')]
        cursor=next((q['values'][0] for q in queries if q['method']=='cursorAfter'),None)
        rows=[{'$id':f'user{i:03}','password':'must not persist','email':'must not persist'} for i in (range(100) if cursor is None else [100])]
        return httpx.Response(200,json={'users':rows,'total':101})
    monkeypatch.setattr(m.httpx,'AsyncClient',lambda **kwargs: original(transport=httpx.MockTransport(handler),**kwargs))
    for _ in range(2):assert asyncio.run(m.provision_registered_users(store,'read-only-key'))==101
    with store.db() as db:
        assert db.execute('SELECT count(*) FROM workspaces').fetchone()[0]==101
        assert db.execute("SELECT count(*) FROM subscriptions WHERE plan='Free'").fetchone()[0]==101
    assert b'must not persist' not in Path(store.path).read_bytes()


def test_staging_html_allowlist_and_client_route(env,tmp_path):
    (tmp_path/'Orbit.html').write_text('<h1>Orbit</h1>',encoding='utf-8')
    (tmp_path/'secret.env').write_text('private',encoding='utf-8')
    (tmp_path/'index.html').write_text('<h1>Alaada</h1>',encoding='utf-8')
    (tmp_path/'accounts-enterprise.css').write_text('body { color: black; }',encoding='utf-8')
    (tmp_path/'accounts-enterprise.js').write_text('window.accountsLoaded = true;',encoding='utf-8')
    client=TestClient(m.create_app(tmp_path/'web.sqlite3',web_root=tmp_path))
    assert client.get('/Orbit.html').status_code==200
    assert client.get('/secret.env').status_code==404
    assert client.get('/api/workspaces/client.js').headers['content-type'].startswith('text/javascript')
    assert client.get('/').text == '<h1>Alaada</h1>'
    assert client.get('/css/accounts-enterprise.css').headers['content-type'].startswith('text/css')
    assert client.get('/js/accounts-enterprise.js').text == 'window.accountsLoaded = true;'
    assert client.get('/js/accounts-enterprise.js').headers['x-content-type-options'] == 'nosniff'
    for private_path in ('/.env', '/alaada_workspaces.py', '/js/secret.env', '/css/%2e%2e/secret.env'):
        assert client.get(private_path).status_code == 404


def test_server_entitlements_follow_personal_plan_and_never_organisation_seat(env):
    personal,org=env[3],env[2]
    plan(env,personal,'Pro','personal-pro')
    create(env,personal)
    policy=request(env,'alice','GET',f'/workspaces/{personal}/entitlements').json()
    assert policy['plan']=='Pro'
    assert policy['products']['sheets']['remaining']==1999
    assert all(policy['products'][p]['monthly_writes']==2000 for p in m.KINDS)
    assert request(env,'reader','GET',f'/workspaces/{org}/entitlements').json()['plan']=='Enterprise'
    assert request(env,'admin','GET',f'/workspaces/{personal}/entitlements').status_code==403
    plan(env,personal,'Free','personal-free')
    assert request(env,'alice','GET',f'/workspaces/{personal}/entitlements').json()['products']['sheets']['remaining']==49
    assert request(env,'alice','GET',f'/workspaces/{org}/entitlements').json()['plan']=='Enterprise'


@pytest.mark.parametrize('scenario', ['unsigned', 'rejected', 'invalid_json', 'revoked'])
def test_accounts_gateway_negative_boundaries(tmp_path, scenario):
    users={'alice':m.Identity('alice',{'team':['editor']})}
    calls=[]
    async def authenticate(token):
        return users[token]
    async def upstream(req):
        calls.append(req.url.path)
        marker={'x-alaada-workspace-enforced':'v1'}
        if req.url.path=='/workspace-gateway/health':
            return httpx.Response(200,json={'ok':True},headers={} if scenario=='unsigned' else marker)
        if scenario=='revoked':
            users['alice']=m.Identity('alice')
            return httpx.Response(201,json={'id':'company-new','name':'Private result'},headers=marker)
        if scenario=='invalid_json':
            return httpx.Response(201,content=b'not json',headers=marker)
        return httpx.Response(422,json={'detail':'rejected'},headers=marker)
    app=m.create_app(tmp_path/'gateway.sqlite3',authenticate=authenticate,
        accounts_url='http://127.0.0.1',accounts_secret='test-gateway-secret-at-least-32-characters',
        accounts_transport=httpx.MockTransport(upstream))
    client=TestClient(app)
    org=app.state.store.organisation('team','Enterprise')
    response=client.post(f'/api/workspaces/{org}/accounts/companies',json={'name':'Test'},
        headers={'Authorization':'Bearer alice','X-Alaada-Workspace':org})
    assert response.status_code=={'unsigned':503,'rejected':422,'invalid_json':502,'revoked':403}[scenario]
    assert 'Private result' not in response.text
    with app.state.store.db() as db:
        usage=db.execute("SELECT COALESCE(SUM(amount),0) FROM usage WHERE workspace=? AND product='accounts'",(org,)).fetchone()[0]
    assert usage==(0 if scenario in ('unsigned','rejected') else 1)
    if scenario=='unsigned':
        assert calls==['/workspace-gateway/health']


@pytest.mark.parametrize('revoked', [False, True])
def test_orbit_context_isolation_and_revocation_during_execution(tmp_path, revoked):
    identities={'alice':m.Identity('alice',{'team':['editor']}), 'admin':m.Identity('admin',{'team':['admin']})}
    calls=[]
    async def auth(token):return identities[token]
    async def backend(req):
        payload=json.loads(req.content)
        calls.append(payload)
        assert req.headers['authorization']=='Bearer server-only-secret'
        assert payload['privacy'] is True and payload['tools']==[]
        assert 'personal-secret' not in req.content.decode()
        assert payload['messages']==[{'role':'user','content':'Organisation question'}]
        if revoked:identities['alice']=m.Identity('alice')
        return httpx.Response(200,json={'text':'Organisation answer','logs':['must never reach client']})
    app=m.create_app(tmp_path/'orbit.sqlite3',authenticate=auth,orbit_url='http://127.0.0.1',
        orbit_key='server-only-secret',orbit_transport=httpx.MockTransport(backend))
    client=TestClient(app)
    personal=client.get('/api/workspaces',headers={'Authorization':'Bearer alice'}).json()['workspaces'][0]['id']
    org=app.state.store.organisation('team','Enterprise')
    def put(wid,kind,key,payload):
        return client.put(f'/api/workspaces/{wid}/products/orbit/records/{kind}/{key}',json={'version':0,'title':key,'payload':payload},
            headers={'Authorization':'Bearer alice','X-Alaada-Workspace':wid}).json()
    private=put(personal,'conversation','private',{'id':'private','messages':[{'role':'user','text':'personal-secret'}]})
    put(personal,'memory','memory','personal-secret-memory')
    conversation=put(org,'conversation','business',{'id':'business','messages':[{'role':'user','text':'Organisation question'}]})
    put(org,'memory','memory','organisation-memory')
    def reply(wid,row,user='alice'):
        return client.post(f'/api/workspaces/{wid}/orbit/reply',json={'conversation':row['id'],'version':row['version']},
            headers={'Authorization':'Bearer '+user,'X-Alaada-Workspace':wid})
    assert reply(org,private).status_code==404
    assert reply(personal,private,'admin').status_code==403
    assert calls==[]
    result=reply(org,conversation)
    assert result.status_code==(403 if revoked else 200),result.text
    assert len(calls)==1 and 'organisation-memory' in calls[0]['system']
    assert 'must never reach client' not in result.text
    with app.state.store.db() as db:
        row=db.execute('SELECT * FROM resources WHERE id=?',(conversation['id'],)).fetchone()
        messages=json.loads(row['payload'])['data']['messages']
        assert len(messages)==(1 if revoked else 2)
        assert row['version']==(1 if revoked else 2)
    if not revoked:
        assert reply(org,conversation).status_code==409
        assert len(calls)==1


def test_orbit_profile_has_no_site_wide_cookie_copy():
    page=(Path(__file__).parents[1]/'Orbit.html').read_text(encoding='utf-8')
    assert 'document.cookie' not in page
    assert 'setCookie(' not in page
    assert 'storage.setItem("orbit_profile",JSON.stringify(profile))' in page


def test_file_bytes_sharing_transfer_and_membership_isolation(env):
    personal,org=env[3],env[2]
    content=b'private file\x00\xff'
    uploaded=request(env,'alice','POST',f'/workspaces/{personal}/files',{'name':'private.txt','content':base64.b64encode(content).decode()},personal)
    assert uploaded.status_code==200,uploaded.text
    rid=uploaded.json()['id']
    def download(wid,user='alice',file_id=rid):
        return request(env,user,'GET',f'/workspaces/{wid}/files/{file_id}/download')
    assert download(personal).content==content
    assert download(personal).headers['content-type']=='application/octet-stream'
    assert download(personal,'admin').status_code==403
    assert download(org).status_code==404
    resource=f'/workspaces/{personal}/resources/{rid}'
    assert request(env,'alice','POST',resource+'/sharing',{'user':'bob','permission':'read'},personal).status_code==200
    assert download(personal,'bob').content==content
    assert request(env,'bob','GET',f'/workspaces/{personal}/resources').status_code==403
    copied=request(env,'alice','POST',resource+'/transfer',{'destination':org,'mode':'copy','version':1,'confirm_ownership':org},personal)
    assert copied.status_code==200,copied.text
    org_id=copied.json()['id']
    assert download(org,'alice',org_id).content==content
    assert download(org,'bob',org_id).status_code==403
    env[1]['alice']=m.Identity('alice')
    assert download(org,'alice',org_id).status_code==403
    assert download(personal).content==content
    assert request(env,'alice','POST',resource+'/sharing',{'user':'bob','permission':'revoke'},personal).status_code==200
    assert download(personal,'bob').status_code==403


@pytest.mark.parametrize('name,content,status',[('../secret','eA==',400),('file','!bad!',400),('file',base64.b64encode(b'x'*(512*1024+1)).decode(),413),('empty','',200)],ids=['path','encoding','size','empty'])
def test_file_upload_validation(env,name,content,status):
    response=request(env,'alice','POST',f'/workspaces/{env[3]}/files',{'name':name,'content':content},env[3])
    assert response.status_code==status,response.text


def test_folder_ownership_cycles_sharing_and_nonempty_transfer(env):
    personal,org=env[3],env[2]
    def folder(wid,title):
        return request(env,'alice','POST',f'/workspaces/{wid}/resources',{'product':'platform','kind':'folder','title':title,'payload':{}},wid).json()
    first=folder(personal,'Parent');second=folder(personal,'Child');foreign=folder(org,'Business')
    def place(row,parent,version=1,user='alice'):
        return request(env,user,'PUT',f"/workspaces/{personal}/resources/{row['id']}/folder",{'parent':parent,'version':version},personal)
    assert place(second,foreign['id']).status_code==404
    assert place(second,first['id']).status_code==200
    assert place(first,second['id']).status_code==409
    assert place(second,None).status_code==409
    children=f"/workspaces/{personal}/folders/{first['id']}/children"
    assert len(request(env,'alice','GET',children).json())==1
    assert request(env,'alice','POST',f"/workspaces/{personal}/resources/{first['id']}/sharing",{'user':'bob','permission':'read'},personal).status_code==200
    assert request(env,'bob','GET',children).status_code==403
    assert request(env,'bob','GET',f"/workspaces/{personal}/resources/{second['id']}").status_code==403
    transfer=request(env,'alice','POST',f"/workspaces/{personal}/resources/{first['id']}/transfer",{'destination':org,'mode':'move','version':1,'confirm_ownership':org},personal)
    assert transfer.status_code==409
    # Deleting a folder removes its location links, not its separately owned children.
    assert request(env,'alice','DELETE',f"/workspaces/{personal}/resources/{first['id']}",{'version':1},personal).status_code==200
    assert request(env,'alice','GET',f"/workspaces/{personal}/resources/{second['id']}").status_code==200
    with env[4].state.store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM folder_membership').fetchone()[0]==0


@pytest.mark.parametrize('native', [False, True])
def test_shared_editor_cannot_reidentify_product_record(env, native):
    personal = env[3]
    if native:
        row = request(env, 'alice', 'PUT',
                      f'/workspaces/{personal}/products/sheets/records/workbook/shared-key',
                      {'title':'Shared', 'payload':{'cells':{}}, 'version':0}, personal).json()
    else:
        row = create(env, personal).json()
    path = f"/workspaces/{personal}/resources/{row['id']}"
    assert request(env, 'alice', 'POST', path+'/sharing',
                   {'user':'bob','permission':'write'}, personal).status_code == 200
    for forged in ({'native_key':'private-key','data':{}}, {}, {'native_key':None}):
        if not native and forged == {}:
            continue
        response = request(env, 'bob', 'PUT', path,
                           {'title':'Forged','payload':forged,'version':1}, personal)
        assert response.status_code == 409
        unchanged = request(env, 'alice', 'GET', path).json()
        assert unchanged['payload'] == row['payload'] and unchanged['version'] == 1
    valid = {'native_key':'shared-key','data':{'cells':{'A1':42}}} if native else {'value':42}
    assert request(env, 'bob', 'PUT', path,
                   {'title':'Shared edit','payload':valid,'version':1}, personal).status_code == 200
    assert request(env, 'bob', 'GET', f'/workspaces/{personal}/resources').status_code == 403


def test_permission_inventory_is_manage_only_and_resource_scoped(env):
    personal, org = env[3], env[2]
    first = create(env, personal).json()
    second = create(env, personal).json()
    path = f"/workspaces/{personal}/resources/{first['id']}/sharing"
    other = f"/workspaces/{personal}/resources/{second['id']}/sharing"
    assert request(env, 'alice', 'GET', path).json()['grants'] == []
    assert request(env, 'alice', 'POST', path, {'user':'bob','permission':'write'}, personal).status_code == 200
    listed = request(env, 'alice', 'GET', path).json()
    assert listed['grants'] == [{'user':'bob','permission':'write'}]
    assert listed['scope'] == 'resource_only'
    assert request(env, 'alice', 'GET', other).json()['grants'] == []
    for user in ('bob', 'admin'):
        assert request(env, user, 'GET', path).status_code == 403
    assert request(env, 'alice', 'POST', path, {'user':'bob','permission':'revoke'}, personal).status_code == 200
    assert request(env, 'alice', 'GET', path).json()['grants'] == []
    resource = create(env, org).json()
    org_path = f"/workspaces/{org}/resources/{resource['id']}/sharing"
    assert request(env, 'admin', 'GET', org_path).status_code == 200
    env[1]['admin'] = m.Identity('admin')
    assert request(env, 'admin', 'GET', org_path).status_code == 403


def test_failed_billing_request_preserves_plan_and_allows_retry(env):
    personal = env[3]
    plan(env, personal, 'Pro', 'existing-pro')
    resource = create(env, personal).json()
    pending = request(env, 'alice', 'POST', f'/workspaces/{personal}/subscription',
                      {'plan':'Elite'}, personal).json()
    raw = json.dumps({'event':'failed-elite','request':pending['id'],
                      'plan':'Elite','outcome':'failed'}).encode()
    stamp = str(int(time.time()))
    signature = hmac.new(b'test-secret', stamp.encode()+b'.'+raw, hashlib.sha256).hexdigest()
    headers = {'X-Alaada-Timestamp':stamp,'X-Alaada-Signature':signature}
    assert env[0].post('/api/billing/failed',content=raw).status_code == 401
    assert env[0].post('/api/billing/confirmed',content=raw,headers=headers).status_code == 400
    assert env[0].post('/api/billing/failed',content=raw,headers=headers).json() == {'failed':True}
    assert env[0].post('/api/billing/failed',content=raw,headers=headers).json() == {'duplicate':True}
    sub = request(env, 'alice', 'GET', f'/workspaces/{personal}/subscription').json()
    assert sub['plan'] == 'Pro' and sub['pending'] is None
    assert request(env, 'alice', 'GET', f"/workspaces/{personal}/resources/{resource['id']}").json()['payload'] == resource['payload']
    assert confirm(env, pending['id'], 'Elite', 'late-elite').status_code == 409
    retried = request(env, 'alice', 'POST', f'/workspaces/{personal}/subscription',
                      {'plan':'Free'}, personal)
    assert retried.status_code == 202 and retried.json()['id'] != pending['id']
    assert confirm(env, retried.json()['id'], 'Free', 'cancel-after-failure').status_code == 200


def test_health_is_safe_and_reports_configuration(env):
    response = env[0].get('/health')
    assert response.status_code == 200
    body = response.json()
    assert body['ok'] is True and body['appwrite_project'] == m.PROJECT
    assert 'secret' not in json.dumps(body).lower()


def test_workspace_manager_script_syntax(tmp_path):
    script=tmp_path/'manager.cjs'
    script.write_text('\n'.join(re.findall(r'<script>(.*?)</script>',m.UI,re.S)),encoding='utf-8')
    result=subprocess.run(['node','--check',str(script)],capture_output=True,text=True)
    assert result.returncode==0,result.stderr


def test_notifications_are_recipient_and_workspace_scoped(env):
    personal,org=env[3],env[2]
    with env[4].state.store.db() as db:
        env[4].state.store.audit(db,env[1]['alice'],personal,'file:upload','private-file')
        env[4].state.store.audit(db,env[1]['alice'],org,'analyser:complete','business-report')
        env[4].state.store.audit(db,m.Identity('billing-adapter'),personal,'subscription:confirmed:Pro')
    def inbox(wid,user='alice'):
        return request(env,user,'GET',f'/workspaces/{wid}/notifications')
    private=inbox(personal).json()['items']
    assert len(private)==2
    assert private[0]['action']=='subscription:confirmed:Pro'
    assert inbox(personal,'admin').status_code==403
    assert inbox(org,'admin').json()['items']==[]
    business=inbox(org).json()['items']
    assert len(business)==1 and business[0]['resource']=='business-report'
    nid=private[0]['id']
    assert request(env,'alice','POST',f'/workspaces/{org}/notifications/{nid}/read',{},org).status_code==404
    assert request(env,'alice','POST',f'/workspaces/{personal}/notifications/{nid}/read',{},personal).status_code==200
    assert inbox(personal).json()['items'][0]['read_at'] is not None
    env[1]['alice']=m.Identity('alice')
    assert inbox(org).status_code==403
    assert len(inbox(personal).json()['items'])==2


def test_account_preferences_stay_private_and_survive_membership_changes(env):
    personal,org=env[3],env[2]
    preferences=request(env,'alice','GET','/account/preferences').json()
    assert preferences['workspace']==personal and preferences['version']==0
    data={'version':0,'personal_activity':False,'organisation_activity':True}
    assert request(env,'alice','PUT','/account/preferences',data,org).status_code==409
    saved=request(env,'alice','PUT','/account/preferences',data,personal)
    assert saved.status_code==200,saved.text
    assert request(env,'alice','PUT','/account/preferences',data,personal).status_code==409
    assert request(env,'admin','GET','/account/preferences').json()['personal_activity'] is True
    assert request(env,'admin','PUT','/account/preferences',data,personal).status_code==409
    with env[4].state.store.db() as db:
        store=env[4].state.store
        store.audit(db,env[1]['alice'],personal,'file:upload','private-file')
        store.audit(db,env[1]['alice'],personal,'share:revoke','private-file')
        store.audit(db,env[1]['alice'],org,'analyser:complete','business-report')
    private=request(env,'alice','GET',f'/workspaces/{personal}/notifications').json()['items']
    assert [n['action'] for n in private]==['share:revoke']
    assert len(request(env,'alice','GET',f'/workspaces/{org}/notifications').json()['items'])==1
    env[1]['alice']=m.Identity('alice')
    assert request(env,'alice','GET','/account/preferences').json()==saved.json()


@pytest.mark.parametrize('revoked',[False,True])
def test_sheets_calculation_scope_and_inflight_revocation(tmp_path,revoked):
    users={'alice':m.Identity('alice',{'team':['editor']}),'admin':m.Identity('admin',{'team':['admin']})}
    secret='sheets-test-gateway-secret-at-least-32-characters'
    calls=[]
    async def auth(token):return users[token]
    async def backend(req):
        encoded=req.headers['x-alaada-gateway-context']
        assert req.headers['x-alaada-gateway-signature']==hmac.new(secret.encode(),encoded.encode(),hashlib.sha256).hexdigest()
        assertion=json.loads(base64.urlsafe_b64decode(encoded))
        assert assertion['workspace']==req.headers['x-alaada-workspace']
        assert assertion['user']=='alice' and assertion['aud']=='sheets-calculation'
        assert assertion['body']==hashlib.sha256(req.content).hexdigest()
        calls.append(req.url.path)
        if req.method=='GET':result={'status':'ok'}
        else:
            assert json.loads(req.content)['cells']=={'A1':'2'}
            if revoked:users['alice']=m.Identity('alice')
            result={'result':4,'success':True}
        return httpx.Response(200,json=result,headers={'x-alaada-workspace-enforced':'v1'})
    app=m.create_app(tmp_path/'sheets.db',authenticate=auth,sheets_url='http://127.0.0.1',sheets_secret=secret,sheets_transport=httpx.MockTransport(backend))
    client=TestClient(app)
    personal=client.get('/api/workspaces',headers={'Authorization':'Bearer alice'}).json()['workspaces'][0]['id']
    org=app.state.store.organisation('team','Enterprise')
    def calculate(wid,user='alice'):
        return client.post(f'/api/workspaces/{wid}/sheets/formula',json={'formula':'=A1*2','cells':{'A1':'2'}},headers={'Authorization':'Bearer '+user,'X-Alaada-Workspace':wid})
    assert calculate(personal,'admin').status_code==403
    assert not calls
    result=calculate(org)
    assert result.status_code==(403 if revoked else 200),result.text
    if not revoked:assert result.json()=={'result':4,'success':True}
    with app.state.store.db() as db:
        assert db.execute("SELECT amount FROM usage WHERE workspace=? AND product='sheets'",(org,)).fetchone()[0]==1


def test_shared_editor_capabilities_and_revocation_are_server_owned(env):
    personal=env[3]
    row=create(env,personal).json()
    path=f"/workspaces/{personal}/resources/{row['id']}"
    request(env,'alice','POST',path+'/sharing',{'user':'bob','permission':'read'},personal)
    view=request(env,'bob','GET',path).json()
    assert view['access']['write'] is False and view['access']['manage'] is False
    payload={'title':'Edited','payload':{'value':'shared edit'},'version':1,'access':{'write':True}}
    assert request(env,'bob','PUT',path,payload,personal).status_code==403
    request(env,'alice','POST',path+'/sharing',{'user':'bob','permission':'write'},personal)
    assert request(env,'bob','GET',path).json()['access']['write'] is True
    saved=request(env,'bob','PUT',path,payload,personal)
    assert saved.status_code==200 and saved.json()['access']['write'] is True
    assert saved.json()['access']['manage'] is False
    assert request(env,'bob','GET',f'/workspaces/{personal}/resources').status_code==403
    request(env,'alice','POST',path+'/sharing',{'user':'bob','permission':'revoke'},personal)
    assert request(env,'bob','PUT',path,payload|{'version':2},personal).status_code==403


@pytest.mark.parametrize('scenario',['success','revoked','unsigned'])
def test_analyser_signed_scope_persistence_and_revocation(tmp_path,scenario):
    users={'alice':m.Identity('alice',{'team':['editor']}),'admin':m.Identity('admin',{'team':['admin']})}
    calls=[]
    secret='analyser-dedicated-test-secret-32-characters'
    async def auth(token):return users[token]
    async def backend(req):
        encoded=req.headers['x-alaada-gateway-context']
        assert hmac.compare_digest(req.headers['x-alaada-gateway-signature'],hmac.new(secret.encode(),encoded.encode(),hashlib.sha256).hexdigest())
        assertion=json.loads(base64.urlsafe_b64decode(encoded))
        assert assertion['aud']=='analyser' and assertion['user']=='alice'
        assert assertion['workspace']==req.headers['x-alaada-workspace']
        assert assertion['body']==hashlib.sha256(req.content).hexdigest()
        assert assertion['target']==req.url.path and assertion['method']==req.method
        calls.append(req.url.path)
        if req.url.path=='/workspace-gateway/health':
            return httpx.Response(200,json={'ok':True},headers={} if scenario=='unsigned' else {'x-alaada-workspace-enforced':'v1'})
        if scenario=='revoked':users['alice']=m.Identity('alice')
        return httpx.Response(200,json={'summary':'private report'},headers={'x-alaada-workspace-enforced':'v1'})
    app=m.create_app(tmp_path/'analyser.db',authenticate=auth,analyser_url='http://127.0.0.1',analyser_secret=secret,analyser_transport=httpx.MockTransport(backend))
    client=TestClient(app)
    personal=client.get('/api/workspaces',headers={'Authorization':'Bearer alice'}).json()['workspaces'][0]['id']
    org=app.state.store.organisation('team','Enterprise')
    def run(wid,user='alice'):
        return client.post(f'/api/workspaces/{wid}/analyser/analyze',json={'url':'https://example.com'},headers={'Authorization':'Bearer '+user,'X-Alaada-Workspace':wid})
    assert run(personal,'admin').status_code==403
    result=run(org)
    assert result.status_code=={'success':200,'revoked':403,'unsigned':502}[scenario],result.text
    with app.state.store.db() as db:
        reports=db.execute("SELECT * FROM resources WHERE product='analyser'").fetchall()
        assert len(reports)==(1 if scenario=='success' else 0)
        if reports:
            assert reports[0]['workspace']==org
            assert result.headers['x-alaada-report']==reports[0]['id']
        assert db.execute("SELECT COALESCE(SUM(amount),0) FROM usage WHERE product='analyser'").fetchone()[0]==(0 if scenario=='unsigned' else 1)
    if scenario!='success':assert 'private report' not in result.text
    if scenario=='unsigned':assert calls==['/workspace-gateway/health']

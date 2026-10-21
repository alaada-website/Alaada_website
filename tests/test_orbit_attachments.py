"""Attachment ownership, bounded parsing and durable chat integration."""
import base64
import json
from contextlib import contextmanager
from email.parser import BytesParser
from email.policy import default

import httpx
import pytest
from fastapi.testclient import TestClient
from test_personal_workspaces import m


@pytest.fixture
def files(tmp_path):
    users = {'alice': m.Identity('alice', {'team': ['editor']}), 'bob': m.Identity('bob'),
             'reader': m.Identity('reader', {'team': []})}
    state = {'files': {}, 'downloads': [], 'prompts': [], 'health': 0}
    async def auth(token):
        return users[token]
    def storage(req):
        assert req.headers['X-Appwrite-Key'] == 'test-key'
        if req.method == 'POST':
            message = BytesParser(policy=default).parsebytes(
                ('Content-Type: '+req.headers['content-type']+'\r\n\r\n').encode()+req.content)
            parts = {p.get_param('name', header='content-disposition'): p for p in message.iter_parts()}
            key = parts['fileId'].get_payload(decode=True).decode()
            state['files'][key] = parts['file'].get_payload(decode=True)
            return httpx.Response(201, json={'$id': key})
        key = req.url.path.split('/')[-2]
        state['downloads'].append(key)
        if state.get('on_download'):
            state['on_download']()
        return httpx.Response(200, content=state['files'][key])
    def orbit(req):
        if req.method == 'GET':
            state['health'] += 1
            return httpx.Response(200, json={'status':'ok','stateless':True,'gateway_only':True,
                'openai_configured':True,'models':['simplex1']})
        state['prompts'].append(json.loads(req.content))
        return httpx.Response(200, json={'text': 'The total is 3.'})
    app = m.create_app(tmp_path/'files.db', authenticate=auth, appwrite_api_key='test-key',
        appwrite_storage_bucket='test-bucket', appwrite_storage_transport=httpx.MockTransport(storage),
        orbit_url='https://orbit.invalid', orbit_key='test-orbit-key', orbit_transport=httpx.MockTransport(orbit))
    client = TestClient(app)
    spaces = {name: client.get('/api/workspaces', headers={'Authorization':'Bearer '+name}).json()['workspaces'][0]['id']
              for name in ('alice', 'bob')}
    spaces['org'] = app.state.store.organisation('team', 'Team')
    def call(method, path, data=None, who='alice', wid=None):
        wid = wid or spaces[who]
        return client.request(method, f'/api/workspaces/{wid}'+path, json=data,
            headers={'Authorization':'Bearer '+who, 'X-Alaada-Workspace':wid})
    def upload(name='data.csv', content=b'value\n1\n2', who='alice', wid=None):
        response = call('POST','/files', {'name':name,'content':base64.b64encode(content).decode()}, who, wid)
        assert response.status_code == 200, response.text
        return response.json()
    def chat(attachments, wid=None):
        response = call('PUT','/products/orbit/records/conversation/one',
            {'title':'Analyze', 'version':0, 'payload':{'id':'one','messages':[
                {'role':'user','text':'Sum the values', 'attachments':attachments}]}}, wid=wid)
        assert response.status_code == 200, response.text
        return {'conversation': response.json()['id'], 'version': response.json()['version']}
    return call, upload, chat, state, users, spaces, app


def test_storage_references_cannot_be_forged_or_replaced(files):
    call, upload, _, state, _, spaces, _ = files
    owned = upload()
    victim = call('GET','/resources/'+owned['id']).json()
    forged = {'product':'platform','kind':'file','title':'stolen','payload':victim['payload']}
    assert call('POST','/resources',forged,who='bob').status_code == 400
    placeholder = call('POST','/resources',{'product':'platform','kind':'file','title':'notes','payload':{'note':'metadata only'}},who='bob').json()
    result = call('PUT','/resources/'+placeholder['id'], {'version':1,'title':'stolen','payload':victim['payload']},who='bob')
    assert result.status_code == 409
    assert call('PUT','/products/platform/records/file/forged', {'version':0,'title':'stolen','payload':victim['payload']},who='bob').status_code == 400
    assert call('GET','/files/'+owned['id']+'/download',who='bob').status_code == 404
    assert not state['downloads']
    assert call('PUT','/resources/'+owned['id'], {'version':1,'title':'Renamed','payload':victim['payload']}).status_code == 200
    assert call('GET','/files/'+owned['id']+'/download').content == b'value\n1\n2'


def test_authorized_file_reaches_model_as_reference_data_and_reply_replays_once(files):
    call, upload, chat, state, _, _, _ = files
    saved = upload()
    command = chat([{'id':saved['id'], 'name':'forged-display-name.csv'}])
    response = call('POST','/orbit/reply',command)
    assert response.status_code == 200, response.text
    prompt = state['prompts'][0]
    assert 'value\\n1\\n2' in prompt['messages'][-1]['content']
    assert 'data.csv' in prompt['messages'][-1]['content']
    assert 'forged-display-name' not in prompt['messages'][-1]['content']
    assert 'untrusted' in prompt['system'].lower() and prompt['tools'] == [] and prompt['privacy'] is True
    assert response.json()['payload']['data']['messages'][-1]['text'] == 'The total is 3.'
    assert call('POST','/orbit/reply',command).status_code == 200
    assert len(state['prompts']) == len(state['downloads']) == 1


@pytest.mark.parametrize('case', ['other-workspace','missing','malformed','binary','format','oversize','tampered','many'])
def test_invalid_attachments_never_reach_model_or_reserve_execution(files, case):
    call, upload, chat, state, _, _, app = files
    saved = upload(who='bob') if case == 'other-workspace' else upload(
        name='file.pdf' if case == 'format' else 'data.csv',
        content=b'\xff\x00' if case == 'binary' else b'x'*65537 if case == 'oversize' else b'value\n1\n2')
    attachments = [{'id':saved['id']}]
    if case == 'missing': attachments = [{'id':'missing'}]
    if case == 'malformed': attachments = 'not a list'
    if case == 'many': attachments *= 5
    if case == 'tampered': state['files'][saved['id']] = b'tampered'
    result = call('POST','/orbit/reply',chat(attachments))
    assert result.status_code in (400,404,409,413,415), result.text
    assert not state['prompts']
    with app.state.store.db() as db:
        assert not db.rows('product_operations', {})


def test_access_revoked_during_download_does_not_send_private_context(files):
    call, upload, chat, state, users, spaces, app = files
    saved = upload(wid=spaces['org'])
    command = chat([{'id':saved['id']}], wid=spaces['org'])
    state['on_download'] = lambda: users.update(alice=m.Identity('alice'))
    result = call('POST','/orbit/reply',command,wid=spaces['org'])
    assert result.status_code == 403
    assert not state['prompts']
    with app.state.store.db() as db:
        assert not db.rows('product_operations', {})


def test_lost_upload_commit_ack_keeps_the_committed_storage_object(files, monkeypatch):
    call, _, _, state, _, _, app = files
    original_db, original_audit = app.state.store.db, app.state.store.audit
    pending = [False]
    def audit(db, user, wid, action, rid=None):
        original_audit(db, user, wid, action, rid)
        if action == 'file:upload': pending[0] = True
    @contextmanager
    def uncertain_db(*args, **kwargs):
        with original_db(*args, **kwargs) as db:
            yield db
        if pending[0]:
            pending[0] = False
            raise RuntimeError('Committed but acknowledgement lost')
    monkeypatch.setattr(app.state.store, 'audit', audit)
    monkeypatch.setattr(app.state.store, 'db', uncertain_db)
    with pytest.raises(RuntimeError, match='acknowledgement lost'):
        call('POST','/files',{'name':'retained.csv','content':base64.b64encode(b'a,b').decode()})
    with original_db(readonly=True) as db:
        rows = db.rows('resources', {'product':'platform','kind':'file'})
        assert len(rows) == 1
        metadata = json.loads(rows[0]['payload'])
        assert state['files'][metadata['storage_file_id']] == b'a,b'

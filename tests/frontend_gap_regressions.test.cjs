const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function extract(source,start,end){const offset=source.indexOf(start);assert.ok(offset>=0,start);const finish=source.indexOf(end,offset);assert.ok(finish>offset,end);return source.slice(offset,finish+end.length);}
function fn(file,name,sandbox={}){return vm.runInNewContext('('+extract(read(file),'function '+name+'(', '\n}')+')',sandbox);}

function accountsIdentity(reply){
  const redirects=[],requests=[];
  class ApiError extends Error {constructor(message,status,data){super(message);this.status=status;this.data=data;}}
  const window={location:{origin:'https://www.alaada.com',pathname:'/Accounts.html',search:'?workspace=personal',hash:'',replace:url=>redirects.push(url)},
    AlaadaWorkspace:{ready:Promise.resolve(),verify:async()=>true,productFetch:async(url,options)=>{requests.push({url,options});return reply(url,options);}}};
  const source=read('Accounts.html'),start=source.indexOf('const APPWRITE_ENDPOINT ='),end=source.indexOf('async function apiAuthHeaders(',start);
  const context=vm.createContext({window,ApiError,AbortController,DOMException,setTimeout,clearTimeout,URL,Date,Error,
    normalizeConnectionError:error=>error instanceof ApiError?error:new ApiError('Connection unavailable',0,{code:error.name==='TimeoutError'?'REQUEST_TIMEOUT':'NETWORK_ERROR'})});
  vm.runInContext(source.slice(start,end),context);
  return {redirects,requests,run:expression=>vm.runInContext(expression,context)};
}

for(const [body,status,expected] of [['',200,502],['<html>Bad gateway</html>',502,502],['',503,503],['{',200,502],['{}',200,502],['',403,403]]){
  test(`Accounts auth does not redirect for an empty, malformed or non-auth failure (${status}, ${body})`,async()=>{
    const env=accountsIdentity(()=>new Response(body,{status}));
    await assert.rejects(env.run('ensureAccountsIdentity()'),error=>error.status===expected);
    assert.equal(env.redirects.length,0);
    assert.equal(env.requests.length,1);
  });
}
test('Accounts auth redirects only on a confirmed 401',async()=>{
  const env=accountsIdentity(()=>new Response('',{status:401}));
  await assert.rejects(env.run('ensureAccountsIdentity()'),error=>error.status===401);
  assert.equal(env.redirects.length,1);
  assert.match(env.redirects[0],/auth\.html\?next=%2FAccounts\.html/);
});
test('Accounts auth preserves network errors and never calls them sign-in failures',async()=>{
  const env=accountsIdentity(()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(env.run('ensureAccountsIdentity()'),error=>error.status===0);
  assert.equal(env.redirects.length,0);
});
test('Accounts empty JWT response is not accepted or automatically reissued',async()=>{
  const env=accountsIdentity(url=>new Response(url.endsWith('/account')?JSON.stringify({$id:'alice'}):''));
  await assert.rejects(env.run('getAppwriteJwt()'),error=>error.status===502&&error.data.code==='EMPTY_RESPONSE');
  assert.equal(env.requests.filter(r=>r.options.method==='POST').length,1);
  assert.equal(env.redirects.length,0);
  assert.equal(env.run('APPWRITE_JWT'),'');
});

for(const file of ['auth.html','onboarding.html']){
  test(file+' preserves safe product return paths',()=>{
    const source=extract(read(file),'function safeNext(value)', '\n    }');
    const next=vm.runInNewContext('('+source+')',{URL,location:{origin:'https://www.alaada.com'}});
    assert.equal(next('https://www.alaada.com/Spreadsheets.html?workspace=abc#range'),'/Spreadsheets.html?workspace=abc#range');
    assert.equal(next('/Orbit.html?workspace=abc'),'/Orbit.html?workspace=abc');
    for(const value of ['https://evil.invalid/Orbit.html','//evil.invalid','//www.alaada.com/Orbit.html','javascript:alert(1)','https://user:pass@www.alaada.com/Orbit.html','/\\evil.invalid','/\n/evil.invalid','/auth.html','/%61uth.html','/%5Cevil','relative.html'])assert.equal(next(value),'/account.html',value);
  });
}

for(const file of ['auth.html','onboarding.html','account.html','admin.html','accept-invitation.html','Accounts.html','Orbit.html','Spreadsheets.html','premium.html']){
  test(file+' inline scripts parse',()=>{
    for(const match of read(file).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      if(/\bsrc\s*=|application\/ld\+json|application\/json/i.test(match[1]))continue;
      new vm.Script(match[2],{filename:file});
    }
  });
}

test('Active identity pages use Appwrite and no alternate identity SDK',()=>{
  for(const file of ['auth.html','onboarding.html','account.html','admin.html','accept-invitation.html']){
    assert.match(read(file),/cloud\.appwrite\.io\/v1/);
    assert.doesNotMatch(read(file),/supabase|alaada-ums\.js/i);
  }
});

function sheetsChat(reply){
  const node=()=>({value:'',style:{},children:[],classList:{add(){}},append(...items){this.children.push(...items)},remove(){}});
  const nodes={chatTxt:node(),chatSend:node()},requests=[],messages=[];
  nodes.chatTxt.value='Sum the sales';
  const api={active:{id:'personal'},user:'alice',productFetch:async(url,options)=>{requests.push(options);return reply();}};
  const source=extract(read('Spreadsheets.html'),'G.chatSend=async function(', '\n};');
  const G={_chat:{busy:false,history:[]},_persist:{workbookId:'book'},_sheetsOperations:{'ai-chat':true},
    si:0,row:0,col:0,locale:'en',_compactSheets:()=>[{name:'Sales',cells:{A1:2}}],ref:()=> 'A1',_selectionRange:()=> 'A1',
    _chatPush:(role,text)=>{messages.push({role,text});return node();},_chatSugg(){},toast(){},
    _renderOrbitProposal(){G.proposals=(G.proposals||0)+1;},execOps(){assert.fail('Unapproved AI edits');}};
  vm.runInNewContext(source,{G,window:{AlaadaWorkspace:api},document:{getElementById:id=>nodes[id],createElement:()=>node()},
    API:'https://legacy.invalid',FORMULA_CATALOG:[],AbortController,JSON,Error});
  return {G,api,nodes,requests,messages};
}

test('Sheets AI failures preserve drafts and retry the exact original request once in history',async()=>{
  const env=sheetsChat(()=>({ok:false,json:async()=>({state:'unknown',detail:'Pending outcome'})}));
  await env.G.chatSend();await env.G.chatSend('Sum the sales');
  assert.equal(env.nodes.chatTxt.value,'Sum the sales');
  assert.equal(env.G._chat.history.length,1);
  assert.equal(env.requests.length,2);
  assert.equal(env.requests[0].body,env.requests[1].body);
  assert.equal(JSON.parse(env.requests[0].body).workspace_id,'personal');
  env.G._persist.workbookId='different';
  await env.G.chatSend('Sum the sales');
  assert.equal(env.requests.length,2);
});

test('Sheets unavailable AI never consumes or clears the draft',async()=>{
  const env=sheetsChat(()=>assert.fail('Disabled operation called'));
  env.G._sheetsOperations['ai-chat']=false;
  await env.G.chatSend();
  assert.equal(env.nodes.chatTxt.value,'Sum the sales');
  assert.equal(env.G._chat.history.length,0);
});

test('Sheets successful AI proposes changes and only then clears the matching draft',async()=>{
  const env=sheetsChat(()=>({ok:true,json:async()=>({success:true,reply:'Proposed',operations:[{type:'set_cell',ref:'A1',value:3}]})}));
  await env.G.chatSend();
  assert.equal(env.G.proposals,1);
  assert.equal(env.nodes.chatTxt.value,'');
  assert.equal(env.G._pendingOrbitRequest,null);
});

test('Sheets hides an AI response if its workbook changes while waiting',async()=>{
  let release;
  const env=sheetsChat(()=>new Promise(resolve=>release=resolve));
  const pending=env.G.chatSend();
  env.G._persist.workbookId='different';
  release({ok:true,json:async()=>({reply:'Private old workbook result',operations:[]})});
  await pending;
  assert.ok(!env.messages.some(message=>message.text==='Private old workbook result'));
  assert.equal(env.nodes.chatTxt.value,'Sum the sales');
});

test('Appwrite invitations never copy the secret into a login return URL',()=>{
  const source=extract(read('accept-invitation.html'),'function authUrl()',"}");
  const url=vm.runInNewContext('('+source+')',{invite:{secret:'must-not-leak'}})();
  assert.equal(url,'/auth.html?next=%2Faccept-invitation.html');
  assert.ok(read('accept-invitation.html').includes('name="referrer" content="no-referrer"'));
});

test('Paused paid subscriptions can still be cancelled when effective plan is Free',()=>{
  const source=extract(read('account.html'),'function canChange(plan)', '\n    }');
  const canChange=vm.runInNewContext('('+source+')',{
    subscription:{plan:'Free',provider:{status:'paused',cancel_at_period_end:false}},changingPlan:false,
    billing:{management_enabled:true}});
  assert.equal(canChange('Free'),true);
  assert.equal(canChange('Pro'),false);
});

test('Onboarding derives checkout availability from server readiness',()=>{
  const source=read('onboarding.html');
  assert.match(source,/billing\.checkout_enabled&&billing\.webhook_configured&&billing\.products_configured/);
  assert.match(source,/option\.disabled=!checkoutReady/);
  assert.match(source,/personal_plan:context\.subscription\.plan/);
});

test('A delayed inbox response cannot repopulate a different workspace',async()=>{
  const node=()=>({value:'',children:[],textContent:'',classList:{add(){},toggle(){}},replaceChildren(){this.children=[]},append(...values){this.children.push(...values)}});
  const nodes=Object.fromEntries(['inbox-workspace','inbox-items','inbox-more','inbox-refresh','inbox-status'].map(id=>[id,node()]));
  nodes['inbox-workspace'].value='one';let resolveFirst;
  const first=new Promise(resolve=>resolveFirst=resolve);
  const source=extract(read('account.html'),'async function loadInbox(reset=false)', '\n    }');
  const api=vm.runInNewContext(`let account={},workspaces=[{id:'one'},{id:'two'}],inboxEpoch=0,inboxBefore=null,inboxBusy=false;const idOf=w=>w.id;${source};({loadInbox})`,{
    $:id=>nodes[id],backend:path=>path.includes('/one/')?first:Promise.resolve({items:[],next_before:null}),
    document:{createElement:()=>node()},msg:()=>{},notificationTitle:()=> 'Notification'});
  const pending=api.loadInbox(true);nodes['inbox-workspace'].value='two';await api.loadInbox(true);
  resolveFirst({items:[{id:1,action:'share:read',created:1,resource:'private-one'}],next_before:1});await pending;
  assert.equal(nodes['inbox-items'].children.length,0);
});

test('Accounts retries only transient connection failures',()=>{
  const sandbox={};
  sandbox.errorCodeFromError=fn('Accounts.html','errorCodeFromError');
  sandbox.requestIdFromError=fn('Accounts.html','requestIdFromError');
  const classify=fn('Accounts.html','classifyAccountsError',sandbox);
  const disabled=classify({status:503,data:{code:'INTEGRATION_UNAVAILABLE'}},'opening');
  assert.equal(disabled.kind,'integration_unavailable');assert.equal(disabled.retryable,false);
  for(const status of [401,403,404,409,422,429])assert.equal(classify({status},'opening').retryable,false,status);
  for(const status of [0,502,503,504])assert.equal(classify({status},'opening').retryable,true,status);
});

test('Sheets checks cloud access without the unsupported legacy health route',async()=>{
  const nodes={cdot:{},ctxt:{},engineState:{}};
  const active={id:'workspace-one'};
  const api={active,entitlements:async()=>({products:{sheets:{execution_available:false}}}),productFetch:()=>assert.fail('Legacy health route used')};
  const method=extract(read('Spreadsheets.html'),'async checkConn(){','\n  },').slice(0,-1);
  const controller=vm.runInNewContext('({'+method+'})',{window:{AlaadaWorkspace:api},document:{getElementById:id=>nodes[id]},navigator:{onLine:true}});
  controller._collab={connected:false};
  await controller.checkConn();
  assert.equal(nodes.ctxt.textContent,'Cloud connected');
  assert.equal(nodes.engineState.textContent,'Local calculations');
  assert.equal(controller._connectionChecking,false);
});

test('Orbit denied capabilities never consume or clear a draft',async()=>{
  const input={value:'Keep my draft'};
  const source=extract(read('Orbit.html'),'async function send()','\n}');
  const send=vm.runInNewContext('('+source+')',{busy:false,orbitCapabilities:{text:false},toast:()=>{},document:{getElementById:()=>input}});
  await send();assert.equal(input.value,'Keep my draft');
});

test('Orbit failure keeps the draft and reuses its pending saved message',async()=>{
  const input={value:'Hello',style:{}};
  const thread={id:'one',messages:[]};
  const sandbox={busy:false,orbitCapabilities:{text:true},fileId:null,document:{getElementById:()=>input},
    activeThread:()=>thread,saveThreads:()=>{},renderChat:()=>{},lockInput:()=>{},stopSpeaking:()=>{},closeSidebar:()=>{},setStatus:()=>{},toast:()=>{},
    window:{AlaadaWorkspace:{active:{name:'Personal'},flush:async()=>{},orbitReply:async()=>{throw new Error('failed')}}}};
  const send=vm.runInNewContext('('+extract(read('Orbit.html'),'async function send()','\n}')+')',sandbox);
  await send();await send();
  assert.equal(input.value,'Hello');assert.equal(thread.messages.length,1);assert.equal(thread.pendingPrompt,'Hello');
});

test('Primary Sheets controls have permanent accessible labels',()=>{
  const html=read('Spreadsheets.html');
  for(const id of ['rfont','rsize','rcolor','rbg','rnf','aiin','chatTxt']){
    const element=html.match(new RegExp('<[^>]+\\bid="'+id+'"[^>]*>'))?.[0];
    assert.ok(element&&/aria-label="[^"]+"/.test(element),id);
  }
});

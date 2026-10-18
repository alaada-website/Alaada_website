const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','account.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
const flush=()=>new Promise(setImmediate);
const json=data=>new Response(JSON.stringify(data));
const alice={$id:'alice',name:'Alice',email:'alice@example.test',emailVerification:true,prefs:{onboarding_completed:true}};
const personal={id:'personal-alice',kind:'personal',name:'Personal',role:'owner'};
const ownSession=(id='phone',current=false)=>({$id:id,userId:'alice',current,clientName:'Chrome',osName:'Android',
  $createdAt:'2026-10-01T00:00:00Z',expire:'2026-11-01T00:00:00Z',providerAccessToken:'DO_NOT_RENDER',secret:'DO_NOT_STORE'});
function fakeDocument(){
  const nodes=new Map(),nav=[],panels=[];
  function node(tag='div'){
    let id='',classes=new Set(),value='';const listeners={};
    return {tagName:tag.toUpperCase(),children:[],textContent:'',innerHTML:'',disabled:false,hidden:false,checked:false,style:{},dataset:{},listeners,
      get id(){return id},set id(v){id=v;nodes.set(v,this)},get className(){return [...classes].join(' ')},set className(v){classes=new Set(v.split(/\s+/))},
      get value(){return value},set value(v){value=v},get options(){return this.children},
      classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on??!classes.has(c))classes.add(c);else classes.delete(c)}},
      append(...values){this.children.push(...values);if(this.tagName==='SELECT'&&!value&&values.length)value=values[0].value},
      replaceChildren(...values){this.children=values;if(this.tagName==='SELECT')value=values[0]?.value||''},
      setAttribute(k,v){this[k]=v},after(){},querySelector(){return node('h1')},focus(){this.focused=true},reset(){},
      addEventListener(k,fn){listeners[k]=fn},insertAdjacentHTML(_,markup){parse(markup)},
      async click(){if(this.disabled)return;return this.onclick?this.onclick():listeners.click?.({target:this,preventDefault(){}})}
    };
  }
  function parse(markup){for(const match of markup.matchAll(/<([\w-]+)\b([^>]*)>/g)){
    const attrs=match[2],id=/\bid="([^"]+)"/.exec(attrs)?.[1];if(!id)continue;
    const el=node(match[1]);el.id=id;el.className=/class="([^"]*)"/.exec(attrs)?.[1]||'';if(/\bdisabled\b/.test(attrs))el.disabled=true;
    if(el.className.split(' ').includes('panel'))panels.push(el);
  }}
  parse(html.split('<script>')[0]);
  for(const match of html.matchAll(/<button[^>]*data-panel="([^"]+)"[^>]*>/g)){const el=node('button');el.dataset.panel=match[1];nav.push(el)}
  return {nodes,hidden:false,getElementById:id=>nodes.get(id)||null,createElement:node,
    querySelectorAll:selector=>selector==='[data-panel]'?nav:selector==='.panel'?panels:[],addEventListener(){}};
}
function setup({hash='',search='',reply}={}){
  const document=fakeDocument(),requests=[],redirects=[];
  let rows=[ownSession('current-device',true),ownSession()];
  const context=vm.createContext({document,URL,URLSearchParams,AbortSignal,Set,Map,Date,console,
    history:{replaceState(){}},location:{hash,search,pathname:'/account.html',origin:'https://www.alaada.com',replace:p=>redirects.push(p)},
    fetch:async(url,options={})=>{
      const pathname=new URL(url,'https://www.alaada.com').pathname,req={pathname,url,method:options.method||'GET',options};requests.push(req);
      if(reply){const result=await reply(req);if(result!==undefined)return result}
      if(pathname==='/v1/account')return json(alice);
      if(pathname==='/v1/account/jwts')return json({jwt:'fixture-only'});
      if(pathname==='/v1/account/sessions')return json({total:rows.length,sessions:rows});
      if(pathname.startsWith('/v1/account/sessions/')&&req.method==='DELETE'){rows=rows.filter(r=>r.$id!==decodeURIComponent(pathname.split('/').pop()));return new Response(null,{status:204})}
      if(pathname==='/api/workspaces')return json({user:'alice',workspaces:[personal]});
      if(pathname.endsWith('/subscription'))return json({plan:'Free',billing:{checkout_enabled:false},pending:null});
      if(pathname==='/api/account/preferences')return json({workspace:personal.id,version:0,personal_activity:true,organisation_activity:false});
      if(pathname.endsWith('/notifications'))return json({items:[],next_before:null});
      throw Error('Unexpected request '+pathname);
    }});
  const exposed=source.replace('    load();','    globalThis.api={loadPanel,loadSessions,endSession,verifiedSessions,showPanel,lockAccount};globalThis.boot=load();');
  vm.runInContext(exposed,context);
  return {document,requests,redirects,api:context.api,boot:context.boot,$:id=>document.getElementById(id)};
}

test('Profile becomes usable with just Appwrite, without waking any workspace or billing service',async()=>{
  const env=setup();await env.boot;await flush();
  assert.equal(env.$('app').classList.contains('hidden'),false);
  assert.equal(env.$('display-name').value,'Alice');
  assert.deepEqual(env.requests.map(r=>r.pathname),['/v1/account']);
  assert.equal(env.$('change-plan').disabled,true);
  assert.equal(env.$('personal-activity').disabled,true);
});
test('Workspace calls are lazy and shared, while preferences and subscription stay independent',async()=>{
  let finish;const pending=new Promise(r=>finish=r);
  const env=setup({reply:req=>req.pathname==='/api/workspaces'?pending:undefined});await env.boot;
  const one=env.api.loadPanel('preferences'),two=env.api.loadPanel('subscription');await flush();
  assert.equal(env.requests.filter(r=>r.pathname==='/api/workspaces').length,1);
  assert.equal(env.$('app').classList.contains('hidden'),false);
  finish(json({user:'alice',workspaces:[personal]}));await Promise.all([one,two]);
  assert.equal(env.$('personal-activity').disabled,false);
  assert.equal(env.$('organisation-activity').checked,false);
  assert.match(env.$('current-plan').textContent,/Free/);
  assert.equal(env.requests.some(r=>r.pathname.endsWith('/health')),false);
});
test('A failed billing lookup has a local retry and cannot hide profile or security',async()=>{
  let unavailable=true;const env=setup({reply:req=>unavailable&&req.pathname.endsWith('/subscription')?new Response('',{status:503}):undefined});await env.boot;
  await env.api.loadPanel('subscription');assert.equal(env.$('app').classList.contains('hidden'),false);
  assert.equal(env.$('current-plan').textContent,'Unavailable');
  assert.equal(env.$('retry-subscription').classList.contains('hidden'),false);
  await env.api.loadPanel('security');assert.equal(env.$('session-items').children.length,2);
  unavailable=false;await env.$('retry-subscription').click();
  assert.match(env.$('current-plan').textContent,/Free/);
  assert.equal(env.$('retry-subscription').classList.contains('hidden'),true);
});
test('Malformed subscription success cannot advertise a plan or enable checkout',async()=>{
  const env=setup({reply:req=>req.pathname.endsWith('/subscription')?json({billing:{checkout_enabled:true}}):undefined});await env.boot;
  await env.api.loadPanel('subscription');assert.equal(env.$('current-plan').textContent,'Unavailable');
  assert.equal(env.$('change-plan').disabled,true);assert.match(env.$('plan-status').textContent,/could not be verified/);
});
test('A failed workspace lookup can be retried without reloading the account',async()=>{
  let unavailable=true;const env=setup({reply:req=>unavailable&&req.pathname==='/api/workspaces'?new Response('',{status:503}):undefined});await env.boot;
  await env.api.loadPanel('notifications');assert.equal(env.$('retry-notifications').classList.contains('hidden'),false);
  unavailable=false;await env.$('retry-notifications').click();
  assert.match(env.$('inbox-status').textContent,/No notifications/);
  assert.equal(env.$('app').classList.contains('hidden'),false);
});
test('Devices use Appwrite directly and retain only safe display fields',async()=>{
  const env=setup();await env.boot;await env.api.loadPanel('security');
  assert.equal(env.requests.some(r=>r.pathname.startsWith('/api/')),false);
  const sanitized=env.api.verifiedSessions({total:1,sessions:[ownSession()]},'alice')[0];
  assert.equal(sanitized.secret,undefined);assert.equal(sanitized.providerAccessToken,undefined);
  const title=env.$('session-items').children[0].children[0].children[0];assert.equal(title.textContent,'Chrome · Android');
});
test('Ending a selected other session requires confirmation, sends one DELETE and verifies removal',async()=>{
  const env=setup();await env.boot;await env.api.loadSessions();
  await env.$('session-items').children[1].children[1].click();
  assert.equal(env.requests.some(r=>r.method==='DELETE'),false);
  assert.equal(env.$('session-confirm').classList.contains('hidden'),false);
  await Promise.all([env.api.endSession(),env.api.endSession()]);
  assert.equal(env.requests.filter(r=>r.method==='DELETE').length,1);
  assert.equal(env.requests.find(r=>r.method==='DELETE').pathname,'/v1/account/sessions/phone');
  assert.match(env.$('sessions-status').textContent,/Session ended/);
  assert.equal(env.$('session-items').children.length,1);assert.equal(env.redirects.length,0);
});
test('Cancelling session confirmation performs no write',async()=>{
  const env=setup();await env.boot;await env.api.loadSessions();await env.$('session-items').children[1].children[1].click();
  await env.$('session-confirm-no').click();await env.api.endSession();assert.equal(env.requests.some(r=>r.method==='DELETE'),false);
});
test('Ending the current session redirects only after Appwrite confirms deletion',async()=>{
  const env=setup();await env.boot;await env.api.loadSessions();await env.$('session-items').children[0].children[1].click();await env.api.endSession();
  assert.deepEqual(env.redirects,['/auth.html?next=%2Faccount.html%23security']);
});
test('Lost delete response never claims success, repeats the write or redirects',async()=>{
  const env=setup({reply:req=>req.method==='DELETE'?new Response('',{status:502}):undefined});await env.boot;await env.api.loadSessions();
  await env.$('session-items').children[0].children[1].click();await env.api.endSession();await env.api.endSession();
  assert.match(env.$('sessions-status').textContent,/could not be confirmed/);assert.equal(env.redirects.length,0);
  assert.equal(env.requests.filter(r=>r.method==='DELETE').length,1);assert.equal(env.$('session-items').children.length,0);
});
test('Device list rejects other users, malformed lists, duplicate IDs, and path-like identifiers',async()=>{
  for(const data of [{},{total:1,sessions:[{...ownSession(),userId:'bob'}]},{total:2,sessions:[ownSession()]},
    {total:2,sessions:[ownSession(),ownSession()]},{total:1,sessions:[{...ownSession(),$id:'../other'}]}]){
    const env=setup({reply:req=>req.pathname==='/v1/account/sessions'?json(data):undefined});await env.boot;await env.api.loadSessions();
    assert.equal(env.$('session-items').children.length,0);assert.match(env.$('sessions-status').textContent,/incomplete/);
    assert.equal(env.requests.some(r=>r.method==='DELETE'),false);
  }
});
test('Account replacement while devices load erases private UI and prevents late rendering',async()=>{
  let changed=false;const env=setup({reply:req=>{
    if(req.pathname==='/v1/account')return json(changed?{...alice,$id:'bob'}:alice);
    if(req.pathname==='/v1/account/sessions'){changed=true;return json({total:1,sessions:[ownSession()]})}
  }});await env.boot;await env.api.loadSessions();
  assert.equal(env.$('app').classList.contains('hidden'),true);assert.equal(env.$('session-items').children.length,0);
  assert.match(env.$('failure-message').textContent,/account changed/);
});
test('An account switch before confirmation cannot end any session',async()=>{
  let changed=false;const env=setup({reply:req=>req.pathname==='/v1/account'&&changed?json({...alice,$id:'bob'}):undefined});await env.boot;await env.api.loadSessions();
  await env.$('session-items').children[1].children[1].click();changed=true;await env.api.endSession();
  assert.equal(env.requests.some(r=>r.method==='DELETE'),false);assert.equal(env.$('session-items').children.length,0);
});
test('Untrusted device labels are text, never HTML, and repeated refreshes share one request',async()=>{
  let finish;const pending=new Promise(r=>finish=r),env=setup({reply:req=>req.pathname==='/v1/account/sessions'?pending:undefined});await env.boot;
  const one=env.api.loadSessions(),two=env.api.loadSessions();await flush();assert.equal(env.requests.filter(r=>r.pathname==='/v1/account/sessions').length,1);
  finish(json({total:1,sessions:[{...ownSession(),clientName:'<img src=x onerror=alert(1)>'}]}));await Promise.all([one,two]);
  const title=env.$('session-items').children[0].children[0].children[0];assert.match(title.textContent,/<img/);assert.equal(title.innerHTML,'');
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Every product fits below the workspace bar without covering bottom controls',()=>{
  const source=read('workspace-product-client.js');
  assert.match(source,/--alaada-workspace-bar-height:36px/);
  for(const product of ['orbit','sheets','accounts','analyser'])assert(source.includes('body[data-alaada-product='+product+']'));
  for(const [file,product] of [['Orbit.html','orbit'],['Spreadsheets.html','sheets'],['Accounts.html','accounts'],['website-analyzer.html','analyser']])assert(read(file).includes('data-alaada-product="'+product+'"'));
  assert(source.includes('height:calc(100dvh - var(--alaada-workspace-bar-height))'));
  assert(source.includes('#topbar{top:var(--alaada-workspace-bar-height)}'));
  assert(source.includes('nav{top:var(--alaada-workspace-bar-height)}'));
  assert.match(read('Orbit.html'),/@media \(max-width: 899px\)/);
  assert.match(read('Orbit.html'),/#inputTextarea\{min-width:0\}/);
  assert.match(read('Orbit.html'),/#inputTextarea\{grid-row:1;grid-column:1 \/ 5;width:100%\}/);
  assert.match(read('Orbit.html'),/\.input-row \.rnd-btn\{grid-row:2\}/);
  assert.match(read('Orbit.html'),/#toast\{white-space:normal/);
  assert.match(read('Accounts.html'),/\.modal-backdrop\{position:fixed;inset:var\(--alaada-workspace-bar-height,36px\) 0 0/);
  assert.match(read('Accounts.html'),/\.modal\{[^\n]+max-height:100%;overflow:hidden;display:flex/);
});

test('Changed monolithic pages contain syntactically valid inline JavaScript',()=>{
  for(const file of ['index.html','about-us.html','Spreadsheets.html','Orbit.html','Accounts.html','website-analyzer.html']){
    let number=0;
    for(const script of read(file).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
      if(/\bsrc\s*=|application\/ld\+json|type=["']module/.test(script[1])||!script[2].trim())continue;
      assert.doesNotThrow(()=>new vm.Script(script[2],{filename:file+':script-'+(++number)}));
    }
  }
});

test('Accounts mobile controls and long company names remain inside the viewport',()=>{
  const source=read('Accounts.html');
  assert.match(source,/@media\(max-width:700px\)\{\s*:root\{--topbar-h:92px;\}/);
  assert.match(source,/#topbar\{display:grid;grid-template-columns:34px minmax\(0,1fr\) auto/);
  assert.match(source,/#company-picker\{grid-row:2;grid-column:1 \/ 3;min-width:0;\}/);
  assert.match(source,/#company-btn span.co-name\{flex:1;min-width:0;max-width:none/);
  assert.match(source,/#company-menu\{position:fixed;[^\n]+left:12px;right:12px;width:auto;max-height:/);
  assert.match(source,/#company-menu .co-menu-foot\{flex-shrink:0;\}/);
});

test('Saved cloud changes do not block navigation or call unavailable device exports',async()=>{
  const source=read('Accounts.html');
  assert(!source.includes("e.returnValue = 'Alaada has changes"));
  assert(source.includes("STATE.capabilities.company_export === true && !!STATE.companyId"));
  const state={companyId:'test-company',capabilities:{}},calls=[];
  const ctx=vm.createContext({STATE:state,backupNeeded:()=>true,saveLocalCompanyBackup:async options=>calls.push(options),console});
  vm.runInContext(extract(source,'async function refreshBackupBeforeLeaving(){','\n}'),ctx);
  await ctx.refreshBackupBeforeLeaving();assert.equal(calls.length,0);
  state.capabilities.company_export=true;
  await ctx.refreshBackupBeforeLeaving();assert.equal(calls.length,1);
});

test('Fast UI keeps hero content visible and removes decorative timers and Sheets blockers',()=>{
  const home=read('index.html'),sheet=read('Spreadsheets.html'),about=read('about-us.html');
  assert.match(home,/html\[data-alaada-fast\] \.hero-title[^\n]+opacity:1!important/);
  assert.match(about,/html\[data-alaada-fast\] \.page-hero h1[^\n]+opacity:1!important/);
  assert(!home.includes('setInterval('),'Homepage previews must not keep running animation loops');
  assert(!sheet.includes('ffOverlay'),'No mandatory welcome dialog');
  assert(!sheet.includes('/api/footfall'),'No unsupported startup tracking request');
  assert(sheet.includes('DOMContentLoaded')&&sheet.includes('await G._persist.initialized'));
  assert(!sheet.includes('data-state="saved" aria-live="polite">Saved'),'Do not claim unsynced data is saved');
});

test('Sheets restores cloud data even if IndexedDB is unavailable',async()=>{
  const source=extract(read('Spreadsheets.html'),'async _initPersistence(){','\n  },').slice(0,-1);
  const states=[],stored=new Map(),snapshot={name:'Existing workbook',sheets:[{name:'Data',cells:{A1:{value:'keep'}}}]};
  const W={storage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},list:()=>[{id:'existing'}],read:(kind,id)=>id==='existing'?snapshot:null};
  const controller=vm.runInNewContext('({'+source+'})',{window:{AlaadaWorkspace:W},Error});
  controller._persist={};controller._openWorkbookDb=async()=>null;controller._isPristineWorkbook=()=>true;
  controller._hydrateWorkbook=data=>{assert.deepEqual(JSON.parse(JSON.stringify(data)),snapshot);assert.notEqual(data,snapshot);data.sheets[0].cells.A1.value='local edit';assert.equal(snapshot.sheets[0].cells.A1.value,'keep');return true};controller.setSaveState=(...state)=>states.push(state);
  await controller._initPersistence();
  assert.equal(controller._persist.workbookId,'existing');assert.equal(stored.get('alaada.workbookId'),'existing');
  assert.deepEqual(states,[['saved','Saved to cloud']]);
});

test('An invalid saved workbook does not become an editable blank document',async()=>{
  const source=extract(read('Spreadsheets.html'),'async _initPersistence(){','\n  },').slice(0,-1);
  let writes=0;
  const W={storage:{getItem:()=>null,setItem:()=>writes++},list:()=>[{id:'existing'}],read:()=>({invalid:true})};
  const controller=vm.runInNewContext('({'+source+'})',{window:{AlaadaWorkspace:W},Error});
  controller._persist={};controller._openWorkbookDb=async()=>null;controller._isPristineWorkbook=()=>true;controller._hydrateWorkbook=()=>false;
  await assert.rejects(controller._initPersistence(),/not been overwritten/);assert.equal(writes,0);assert(!controller._persistenceReady);
});

test('Product pages bust the four-hour workspace script cache when its content changes',()=>{
  const version=require('node:crypto').createHash('sha256').update(read('workspace-product-client.js').replace(/\r\n/g,'\n')).digest('hex').slice(0,12);
  for(const file of ['Accounts.html','Orbit.html','Spreadsheets.html','website-analyzer.html']){
    assert.ok(read(file).includes(`/workspace-product-client.js?v=${version}"`),file);
  }
});

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

test('Accounts reuses verified workspace identity without duplicate JWT/startup reads',async()=>{
  const env=accountsIdentity(()=>{throw new Error('Unexpected duplicate auth request');});
  env.run("window.AlaadaWorkspace.user='alice'");
  assert.equal((await env.run('ensureAccountsIdentity()')).$id,'alice');
  assert.equal(env.requests.length,0);
  const source=read('Accounts.html');
  assert.match(source,/const delays = \[0\]/);
  assert(!source.includes("'/health', {}, 10000"));
  assert.match(source,/bundledCompany = await api\(`\/companies\/\$\{id\}\/bootstrap`\)/);
  assert.match(source,/bundledCompany \? \[\] : await Promise.allSettled/);
});

function companyForm(reply){
  const button={disabled:false,textContent:'Create company',setAttribute(){},removeAttribute(){}};
  const fields=Object.fromEntries(['name','legal','cur','tz','fystart','fyend','gst','pan','addr'].map(key=>['c-'+key,{value:key==='name'?'My company':''}]));
  fields['c-save']=button;
  const selected=[],errors=[],state={companyGeneration:1,companies:[],currentView:'ledgers'};
  const sandbox={document:{getElementById:id=>fields[id]},STATE:state,window:{AlaadaWorkspace:{active:{id:'personal'}}},
    modalBackdrop:{classList:{contains:()=>true}},api:reply,markBackupNeeded(){},setLoadState(){},renderCompanyMenu(){},toast(){},
    closeModal(){},selectCompany:async id=>selected.push(id),errToast:error=>errors.push(error),ApiError:Error};
  const submit=vm.runInNewContext('('+extract(read('Accounts.html'),'async function submitCompanyForm()', '\n}')+')',sandbox);
  return {button,fields,selected,errors,state,submit};
}

test('Company save is single-flight and opens the new company only once',async()=>{
  let finish,calls=0;
  const env=companyForm(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  const pending=env.submit();await env.submit();
  assert.equal(calls,1);assert.equal(env.button.disabled,true);assert.equal(env.button.textContent,'Creating company…');
  finish({id:'saved',name:'My company'});await pending;
  assert.deepEqual(env.selected,['saved']);assert.equal(env.state.companies.length,1);assert.equal(env.state.currentView,'dashboard');
  assert.equal(env.button.disabled,false);assert.equal(env.button.textContent,'Create company');
});

test('A failed company save preserves input and enables a safe retry',async()=>{
  const env=companyForm(async()=>{throw new Error('Service unavailable');});
  await env.submit();
  assert.equal(env.fields['c-name'].value,'My company');assert.equal(env.button.disabled,false);
  assert.equal(env.errors.length,1);assert.equal(env.selected.length,0);
});

test('A late company save does not replace a newly selected company',async()=>{
  let finish;
  const env=companyForm(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=env.submit();env.state.companyGeneration++;
  finish({id:'saved',name:'My company'});await pending;
  assert.equal(env.state.companies.length,1);assert.equal(env.selected.length,0);
});

test('Sheets detects XLSX encryption without an undefined signature byte',async()=>{
  const source=read('Spreadsheets.html');
  const start=source.indexOf('async loadFileSecure(event)'),end=source.indexOf('async loadFileEnhanced(event)',start);
  assert(start>0&&end>start);
  let imported=0;
  const controller=vm.runInNewContext('({'+source.slice(start,end)+'})',{
    Uint8Array,API:'https://sheets.invalid',btoa:value=>Buffer.from(value,'binary').toString('base64'),
    window:{AlaadaWorkspace:{productFetch:async()=>new Response(JSON.stringify({sheets:[{name:'Sheet1',cells:{}}]}),{headers:{'Content-Type':'application/json'}})}}});
  controller.toast=()=>{};controller._loadNamedStyles=()=>{};controller._showCompatibilityWarnings=()=>{};controller._finishImport=()=>{imported++;};
  const target={value:'input.xlsx',files:[{name:'input.xlsx',size:8,arrayBuffer:async()=>new Uint8Array([0x50,0x4b,3,4,0,0,0,0]).buffer}]};
  assert.equal(await controller.loadFileSecure({target}),true);
  assert.equal(imported,1);assert.equal(target.value,'');
});

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

for(const file of ['auth.html','onboarding.html','account.html','admin.html','accept-invitation.html','Accounts.html','Orbit.html','Spreadsheets.html','premium.html','website-analyzer.html']){
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

test('Paid plan changes require catalog release but cancellation does not',()=>{
  const source=extract(read('account.html'),'function canChange(plan)', '\n    }');
  const billing={management_enabled:true,products_configured:true,plan_changes_enabled:false};
  const canChange=vm.runInNewContext('('+source+')',{
    subscription:{plan:'Pro',provider:{status:'active',cancel_at_period_end:false}},changingPlan:false,billing});
  assert.equal(canChange('Elite'),false);
  assert.equal(canChange('Free'),true);
  billing.plan_changes_enabled=true;
  assert.equal(canChange('Elite'),true);
});

test('Account uses subscription readiness without another health request',async()=>{
  const source=extract(read('account.html'),'async function refreshSubscription()', '\n');
  const calls=[];
  const state={subscription:null,personal:{id:'p_me'},billing:{},idOf:w=>w.id,encodeURIComponent,
    backend:async path=>{calls.push(path);return {plan:'Free',billing:{provider:'dodo',checkout_enabled:false}}},
    renderSubscription(){}};
  await vm.runInNewContext('('+source+')',state)();
  assert.deepEqual(calls,['/workspaces/p_me/subscription']);
  assert.equal(state.billing.provider,'dodo');
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

test('Opening Orbit or New Chat reuses empty drafts without writing to the database',()=>{
  const source=read('Orbit.html'),input={value:''},writes=[];
  let next=0;
  const ctx=vm.createContext({threads:[{id:'saved-empty',title:'New Chat',messages:[],archived:false}],
    activeId:null,busy:false,composerDrafts:new Map(),composerAttachments:new Map(),transientThreads:new Set(),
    document:{getElementById:()=>input},crypto:{randomUUID:()=>`draft-${++next}`},
    openThread:id=>{ctx.activeId=id;input.value='';},renderThreads:()=>{},closeSidebar:()=>{},toast:()=>{},
    window:{AlaadaWorkspace:{storage:{setItem:(key,value)=>writes.push(JSON.parse(value))}}}});
  vm.runInContext(extract(source,'function createThread()','\n}')+extract(source,'function saveThreads()','\n}'),ctx);
  ctx.createThread();ctx.createThread();
  assert.equal(ctx.activeId,'saved-empty');assert.equal(ctx.threads.length,1);assert.equal(writes.length,0);
  input.value='Keep this unsent draft';ctx.composerDrafts.set('saved-empty',input.value);
  ctx.createThread();assert.equal(ctx.activeId,'draft-1');assert.equal(ctx.threads.length,2);
  ctx.createThread();assert.equal(ctx.threads.length,2);assert.equal(writes.length,0);
  ctx.saveThreads();assert.deepEqual(writes[0].map(t=>t.id),['saved-empty']);
  ctx.threads[0].messages.push({role:'user',text:'Hello'});ctx.saveThreads();
  assert.deepEqual(writes[1].map(t=>t.id),['draft-1','saved-empty']);
  ctx.busy=true;ctx.createThread();assert.equal(ctx.threads.length,2);
});

test('Orbit never blocks startup on a second profile and safely renders with blocked CDNs',()=>{
  const source=read('Orbit.html');
  assert(!source.includes('openSheet(true)'));
  assert(source.includes('Close profile'));
  assert(!source.includes('<animateTransform'));
  const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const render=vm.runInNewContext('('+extract(source,'function parseMathMarkdown(text)','\n}')+')',{window:{},escHtml:escape});
  assert.equal(render('<img src=x onerror=alert(1)>\nHello'),'&lt;img src=x onerror=alert(1)&gt;<br>Hello');
  assert(source.includes('return window.DOMPurify.sanitize(html,'));
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

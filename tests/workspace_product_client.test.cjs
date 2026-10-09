const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2] || require('node:path').join(__dirname,'..','workspace-product-client.js'), 'utf8').replaceAll('__ENDPOINT__','https://sfo.cloud.appwrite.io/v1').replaceAll('__PROJECT__','project');

const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
async function boot(product, requested='', seed=[], operationStorage=new Map(), config={}) {
  const requests=[], navigation=[], events={},cookies=[]; let currentUser='alice', revoked=false;
  let operationReply=()=>new Response(JSON.stringify({success:true,reply:'Scoped result'}),{status:200});
  let accountReply=()=>new Response(JSON.stringify({id:'company-id'}),{status:201});
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.style={};this.hidden=false;this.disabled=false;this.textContent='';this.value='';}
    append(...items){this.children.push(...items);for(const item of items)if(item.selected)this.value=item.value;}
    prepend(...items){this.children.unshift(...items);}
    setAttribute(){}
  }
  const document={readyState:'complete',currentScript:{dataset:{product}},body:new Element('body'),
    createElement:tag=>new Element(tag),addEventListener:(type,fn)=>events[type]=fn,hidden:false};
  Object.defineProperty(document,'cookie',{set:value=>cookies.push(value),get:()=>''});
  document.body.append(new Element('main'));
  const location={href:'https://alaada.test/'+product+'.html'+requested,origin:'https://alaada.test',pathname:'/'+product+'.html',search:requested,assign:url=>navigation.push(url)};
  const state={user:'alice',workspaces:[{id:'personal',name:'Personal',kind:'personal'},{id:'company',name:'Company',kind:'organisation'}]};
  const fetch=async(url,options={})=>{
    requests.push({url:String(url),options});
    const overridden=await config.fetch?.(String(url),options,requests);
    if(overridden!==undefined)return overridden;
    if(String(url).endsWith('/account'))return json({$id:currentUser});
    if(String(url).endsWith('/account/jwts'))return json({jwt:'verified-token'});
    if(String(url).includes('/sheets/execute/'))return operationReply();
    if(String(url).includes('/accounts/'))return accountReply();
    if(String(url).endsWith('/entitlements'))return json({role:'owner',products:{orbit:{execution_available:true,capabilities:{execution_receipts:true}},analyser:{capabilities:{analysis:true,execution_receipts:true}}}});
    if(String(url).endsWith('/analyser/analyze'))return new Response(JSON.stringify({summary:{seo:{},security:{},accessibility:{},dom:{},resources:{}}}),{headers:{'Content-Type':'application/json','X-Alaada-Execution':'succeeded'}});
    if(String(url).startsWith('/api/workspaces/bootstrap')){
      const workspaces=revoked?state.workspaces.slice(0,1):state.workspaces;
      const active=String(url).includes('workspace=company')?'company':'personal';
      return json({...state,workspaces,active:workspaces.some(item=>item.id===active)?active:null,resources:seed});
    }
    if(url==='/api/workspaces')return json({...state,workspaces:revoked?state.workspaces.slice(0,1):state.workspaces});
    if(String(url).endsWith('/orbit/reply'))return json({id:'saved',product:'orbit',kind:'conversation',version:2,payload:{native_key:'first',data:{id:'first',title:'First',messages:[{role:'assistant',text:'Scoped reply'}]}}});
    if(options.method==='PUT'){
      const body=JSON.parse(options.body),parts=url.split('/');
      return json({id:'saved',product:parts[5],kind:parts[7],version:body.version+1,payload:{native_key:decodeURIComponent(parts[8]),data:body.payload}});
    }
    return json(seed);
  };
  const window={fetch,addEventListener:(type,fn)=>events[type]=fn,
    sessionStorage:{getItem:key=>operationStorage.get(key)||null,setItem:(key,value)=>operationStorage.set(key,value)}};
  const context=vm.createContext({window,document,location,URL,Headers,Response,AbortController,DOMException,TextEncoder,Uint8Array,crypto:require('node:crypto').webcrypto,Map,Set,Promise,Error,JSON,encodeURIComponent,confirm:()=>true,console,
    setTimeout:(fn,ms)=>{config.timers?.push(ms);return setTimeout(fn,ms>=25000?(config.timeoutMs??ms):0);},clearTimeout,
    localStorage:{getItem(){throw Error('Legacy storage must never be read');}}});
  vm.runInContext(source,context);
  const W=window.AlaadaWorkspace;
  if(config.failure)await assert.rejects(W.ready,config.failure);else await W.ready;
  return {W,requests,navigation,document,events,cookies,operationStorage,setOperationReply:fn=>operationReply=fn,setAccountReply:fn=>accountReply=fn,setUser:u=>currentUser=u,revoke:()=>revoked=true};
}

(async()=>{
  for(const [product,kind] of [['orbit','conversation'],['sheets','workbook'],['accounts','ledger'],['analyser','report']]) {
    const env=await boot(product);
    assert.equal(env.W.active.id,'personal');
    assert.deepEqual(env.cookies.slice(0,2),['orbit_name=; Max-Age=0; Path=/; SameSite=Lax','orbit_email=; Max-Age=0; Path=/; SameSite=Lax']);
    assert.match(env.cookies.at(-1),/^alaada_active_workspace=personal;/);
    assert.equal(env.W.storage.getItem('legacy-data'),null);
    await env.W.save(kind,'resource-1',{value:product},'Private resource');
    await env.W.flush();
    const write=env.requests.find(x=>x.options.method==='PUT');
    assert.equal(write.options.headers['X-Alaada-Workspace'],'personal');
    assert.equal(write.url,`/api/workspaces/personal/products/${product}/records/${kind}/resource-1`);
    const count=env.requests.length;
    await assert.rejects(env.W.productFetch('https://legacy.example/execute',{method:'POST',body:'private data'}),/not connected/);
    assert(!env.requests.slice(count).some(r=>r.url.includes('legacy.example')));
    env.setUser('bob');
    await assert.rejects(env.W.save(kind,'other',{},'Should fail'),/account changed/);
    assert.equal(env.W.storage.length,0);
    assert.equal(env.document.body.children.at(-1).hidden,false);
  }
  const org=await boot('sheets','?workspace=company');
  assert.equal(org.W.active.id,'company');
  org.revoke();
  await assert.rejects(org.W.verify(),/membership was removed/);
  assert.equal(org.document.body.children.at(-1).hidden,false);
  await assert.rejects(boot('orbit','?workspace=forbidden'),/not authorised/);
  const orbit=await boot('orbit');
  orbit.W.storage.setItem('orbit_threads',JSON.stringify([{id:'first',title:'First',messages:[]},{id:'second',title:'Second',messages:[]}]));
  await orbit.W.flush();
  const conversations=orbit.requests.filter(r=>r.options.method==='PUT');
  assert.equal(conversations.length,2);
  assert(conversations.every(r=>r.url.includes('/orbit/records/conversation/')));
  const answer=await orbit.W.orbitReply('first');
  assert.equal(answer.messages[0].text,'Scoped reply');
  const execution=orbit.requests.find(r=>r.url.endsWith('/orbit/reply'));
  assert.equal(execution.options.headers['X-Alaada-Workspace'],'personal');
  assert.deepEqual(JSON.parse(execution.options.body),{conversation:'saved',version:1});
  assert.equal(orbit.W.read('conversation','first').messages[0].text,'Scoped reply');
  await orbit.W.save('conversation','first',{...answer,title:'Renamed'},'Renamed');
  assert.equal(JSON.parse(orbit.requests.filter(r=>r.options.method==='PUT').at(-1).options.body).version,2);
  const switchTest=await boot('sheets');
  switchTest.W.beforeSwitch(async()=>{throw Error('Workbook save failed');});
  const selector=switchTest.document.body.children[0].children[1];
  selector.value='company';
  await selector.onchange();
  assert.equal(switchTest.navigation.length,0);
  assert.equal(switchTest.W.active.id,'personal');
  assert.equal(switchTest.W.databaseName('history'),'alaada:alice:personal:history');
  const accounts=await boot('accounts');
  await accounts.W.productFetch('https://accounts-0o52.onrender.com/companies/company-id/ledgers',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'untrusted-token'},body:JSON.stringify({name:'Cash'})});
  const forwarded=accounts.requests.find(r=>r.url.includes('/accounts/companies/'));
  assert.equal(forwarded.url,'/api/workspaces/personal/accounts/companies/company-id/ledgers');
  assert.equal(forwarded.options.headers.Authorization,'Bearer verified-token');
  assert.equal(forwarded.options.headers['X-Alaada-Workspace'],'personal');
  assert.equal(forwarded.options.body,JSON.stringify({name:'Cash'}));
  assert(!accounts.requests.some(r=>r.url.startsWith('https://accounts-0o52.onrender.com')));
  assert.match(forwarded.options.headers['Idempotency-Key'],/^[A-Za-z0-9_.:-]{16,180}$/);
  const accountOptions={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Private business'})};
  const accountAttempts=env=>env.requests.filter(r=>r.url.endsWith('/accounts/companies'));
  accounts.setAccountReply(()=>new Response('{}',{status:503}));
  await accounts.W.productFetch('/companies',accountOptions);
  const uncertainKey=accountAttempts(accounts).at(-1).options.headers['Idempotency-Key'];
  await accounts.W.productFetch('/companies',accountOptions);
  assert.equal(accountAttempts(accounts).at(-1).options.headers['Idempotency-Key'],uncertainKey);
  const accountsReloaded=await boot('accounts','',[],accounts.operationStorage);
  await Promise.all([accountsReloaded.W.productFetch('/companies',accountOptions),accountsReloaded.W.productFetch('/companies',accountOptions)]);
  assert.equal(accountAttempts(accountsReloaded).length,1);
  assert.equal(accountAttempts(accountsReloaded)[0].options.headers['Idempotency-Key'],uncertainKey);
  await accountsReloaded.W.productFetch('/companies',accountOptions);
  assert.notEqual(accountAttempts(accountsReloaded).at(-1).options.headers['Idempotency-Key'],uncertainKey);
  assert(!JSON.stringify([...accounts.operationStorage]).includes('Private business'));
  const supplied='voucher-post:company-id:voucher-id';
  await accountsReloaded.W.productFetch('/companies/company-id/vouchers/voucher-id/post',{
    method:'POST',headers:{'Idempotency-Key':supplied,'X-Idempotency-Key':supplied,Authorization:'attacker'}});
  assert.equal(accountsReloaded.requests.filter(r=>r.url.endsWith('/post')).at(-1).options.headers['Idempotency-Key'],supplied);
  await assert.rejects(accountsReloaded.W.productFetch('/companies',{
    method:'POST',headers:{'Idempotency-Key':supplied,'X-Idempotency-Key':'different-request-key'}}),/Conflicting/);
  const analyser=await boot('analyser','?workspace=company');
  await analyser.W.productFetch('https://legacy-analyser.example/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://example.com'})});
  const analysis=analyser.requests.find(r=>r.url.endsWith('/analyser/analyze'));
  assert.equal(analysis.url,'/api/workspaces/company/analyser/analyze');
  assert.equal(analysis.options.headers['X-Alaada-Workspace'],'company');
  assert.equal(analysis.options.headers.Authorization,'Bearer verified-token');
  assert(!analyser.requests.some(r=>r.url.startsWith('https://legacy-analyser.example')));
  const sheets=await boot('sheets');
  await sheets.W.productFetch('https://legacy-sheets.example/api/formula/eval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formula:'=1+1',cells:{}})});
  const calculation=sheets.requests.find(r=>r.url.endsWith('/sheets/formula'));
  assert.equal(calculation.url,'/api/workspaces/personal/sheets/formula');
  assert.equal(calculation.options.headers['X-Alaada-Workspace'],'personal');
  assert.equal(calculation.options.headers.Authorization,'Bearer verified-token');
  assert(!sheets.requests.some(r=>r.url.startsWith('https://legacy-sheets.example')));
  const signIn=sheets.document.body.children[0].children[3];
  assert.equal(signIn.href,'/auth.html?next=%2Fsheets.html');
  const chatOptions={method:'POST',headers:{'Content-Type':'application/json',Authorization:'attacker','X-Alaada-Workspace':'wrong'},body:JSON.stringify({messages:[{role:'user',content:'sum'}]})};
  sheets.setOperationReply(()=>new Response(JSON.stringify({state:'unknown'}),{status:502}));
  const attempts=()=>sheets.requests.filter(r=>r.url.includes('/sheets/execute/'));
  await sheets.W.productFetch('/api/ai/chat',chatOptions);
  await sheets.W.productFetch('/api/ai/chat',chatOptions);
  assert.equal(attempts().length,2);
  assert.equal(attempts()[0].options.headers['X-Alaada-Operation'],attempts()[1].options.headers['X-Alaada-Operation']);
  assert.equal(attempts()[0].options.headers.Authorization,'Bearer verified-token');
  assert.equal(attempts()[0].options.headers['X-Alaada-Workspace'],'personal');
  const reloaded=await boot('sheets','',[],sheets.operationStorage);
  const concurrent=await Promise.all([reloaded.W.productFetch('/api/ai/chat',chatOptions),reloaded.W.productFetch('/api/ai/chat',chatOptions)]);
  assert.equal(concurrent.length,2);
  const reloadedAttempts=()=>reloaded.requests.filter(r=>r.url.includes('/sheets/execute/'));
  assert.equal(reloadedAttempts().length,1);
  assert.equal(reloadedAttempts()[0].options.headers['X-Alaada-Operation'],attempts()[0].options.headers['X-Alaada-Operation']);
  await reloaded.W.productFetch('/api/ai/chat',chatOptions);
  assert.notEqual(reloadedAttempts()[1].options.headers['X-Alaada-Operation'],reloadedAttempts()[0].options.headers['X-Alaada-Operation']);
  reloaded.setOperationReply(()=>{reloaded.setUser('bob');return new Response(JSON.stringify({private:'result'}));});
  await assert.rejects(reloaded.W.productFetch('/api/ai/chat',chatOptions),/account changed during/);
  assert.equal(reloaded.document.body.children.at(-1).hidden,false);
  await analyser.W.save('monitor','target',{url:'https://example.com',intervalHours:24,scheduling:'manual'},'Target');
  assert.equal(analyser.W.list('monitor').length,1);
  await analyser.W.remove('monitor','target');
  assert.equal(analyser.W.list('monitor').length,0);
  const deletion=analyser.requests.find(r=>r.options.method==='DELETE');
  assert.equal(deletion.options.headers['X-Alaada-Workspace'],'company');
  assert.equal(JSON.parse(deletion.options.body).version,1);
  // Actual browser Responses exercise empty bodies, proxy HTML and streaming
  // failures; JSON-only doubles previously concealed the startup crash.
  const targetCalls=(env,suffix)=>env.requests.filter(r=>r.url.endsWith(suffix));
  let cold=0;
  const recovered=await boot('accounts','',[],new Map(),{fetch:url=>{
    if(String(url).startsWith('/api/workspaces/bootstrap')&&++cold===1)return new Response('');
  }});
  assert.equal(cold,2);
  assert.equal(recovered.W.active.id,'personal');
  assert.equal(recovered.document.body.children.at(-1).hidden,true);
  for(const [body,status,code] of [['',200,'EMPTY_RESPONSE'],['<html>Proxy unavailable</html>',502,'HTTP_502'],['{',200,'MALFORMED_RESPONSE']]){
    const unavailable=await boot('accounts','',[],new Map(),{failure:error=>error.code===code,fetch:url=>String(url).startsWith('/api/workspaces/bootstrap')?new Response(body,{status}):undefined});
    assert.equal(targetCalls(unavailable,'/api/workspaces/bootstrap').length,3);
    const gate=unavailable.document.body.children.at(-1);
    assert.equal(gate.hidden,false);
    assert.equal(unavailable.document.body.children[1].inert,true);
    assert.doesNotMatch(gate.textContent,/Unexpected end|execute 'json'|expired/);
    assert.match(gate.children.at(-2).textContent,/sign-in has not been cleared/);
    assert.equal(gate.children.at(-1).textContent,'Retry connection');
    assert.equal(targetCalls(unavailable,'/resources').length,0);
  }
  for(const status of [401,403]){
    const denied=await boot('accounts','',[],new Map(),{failure:error=>error.status===status,fetch:url=>String(url).startsWith('/api/workspaces/bootstrap')?new Response('',{status}):undefined});
    assert.equal(targetCalls(denied,'/api/workspaces/bootstrap').length,1);
    assert.match(denied.document.body.children.at(-1).textContent,status===401?/sign-in has expired/:/Access.*denied/);
  }
  const emptyIdentity=await boot('orbit','',[],new Map(),{failure:/Appwrite returned an empty response/,fetch:url=>url.endsWith('/account')?new Response(''):undefined});
  assert.equal(targetCalls(emptyIdentity,'/account').length,3);
  assert.equal(targetCalls(emptyIdentity,'/api/workspaces/bootstrap').length,0);
  const jwtFailure=await boot('sheets','',[],new Map(),{failure:/Appwrite returned an empty response/,fetch:url=>url.endsWith('/account/jwts')?new Response(''):undefined});
  assert.equal(targetCalls(jwtFailure,'/account/jwts').length,1,'POSTs are not retried automatically');
  assert.equal(targetCalls(jwtFailure,'/api/workspaces/bootstrap').length,0);
  await boot('accounts','',[],new Map(),{failure:/unreadable response/,fetch:url=>url.endsWith('/account/jwts')?json({}):undefined});
  await boot('accounts','',[],new Map(),{failure:/unreadable response/,fetch:url=>String(url).startsWith('/api/workspaces/bootstrap')?json({user:'someone-else',workspaces:[]}):undefined});
  await boot('accounts','',[],new Map(),{failure:/unreadable response/,fetch:url=>String(url).startsWith('/api/workspaces/bootstrap')?json({user:'alice',workspaces:[{id:'personal',name:'Personal',kind:'personal'}],active:'personal',resources:{}}):url.endsWith('/resources')?json({}):undefined});
  const timeout=await boot('accounts','',[],new Map(),{timeoutMs:5,failure:error=>error.code==='REQUEST_TIMEOUT',fetch:(url,options)=>{
    if(String(url).startsWith('/api/workspaces/bootstrap'))return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});
  assert.equal(targetCalls(timeout,'/api/workspaces/bootstrap').length,3);
  const network=await boot('accounts','',[],new Map(),{failure:error=>error.code==='NETWORK_ERROR',fetch:url=>{
    if(String(url).startsWith('/api/workspaces/bootstrap'))throw new TypeError('Failed to fetch');
  }});
  assert.equal(targetCalls(network,'/api/workspaces/bootstrap').length,3);
  const uncertain=await boot('accounts');
  uncertain.setAccountReply(()=>new Response(''));
  const malformedWrite=await uncertain.W.productFetch('/companies',accountOptions);
  assert.equal(malformedWrite.status,502);
  assert.equal((await malformedWrite.json()).code,'EMPTY_RESPONSE');
  assert.equal(accountAttempts(uncertain).length,1);
  const retainedKey=accountAttempts(uncertain)[0].options.headers['Idempotency-Key'];
  uncertain.setAccountReply(()=>json({id:'saved-company'}));
  await uncertain.W.productFetch('/companies',accountOptions);
  assert.equal(accountAttempts(uncertain).at(-1).options.headers['Idempotency-Key'],retainedKey);
  uncertain.setAccountReply(()=>new Response(JSON.stringify({detail:{code:'INTEGRATION_UNAVAILABLE',message:'Not connected'}}),{status:503}));
  assert.equal((await (await uncertain.W.productFetch('/health')).json()).detail.code,'INTEGRATION_UNAVAILABLE');
  uncertain.setAccountReply(()=>new Response('a,b\n1,2',{headers:{'Content-Type':'text/csv','Content-Disposition':'attachment; filename=report.csv'}}));
  assert.equal(await (await uncertain.W.productFetch('/companies/id/report')).text(),'a,b\n1,2');
  uncertain.setAccountReply(()=>new Response(null,{status:204}));
  assert.equal((await uncertain.W.productFetch('/companies/id',{method:'DELETE'})).status,204);
  const cancelled=new AbortController();cancelled.abort();
  const beforeCancel=accountAttempts(uncertain).length;
  await assert.rejects(uncertain.W.productFetch('/companies',{...accountOptions,signal:cancelled.signal}),error=>error.name==='AbortError');
  assert.equal(accountAttempts(uncertain).length,beforeCancel);
  const uncertainSheets=await boot('sheets');
  uncertainSheets.setOperationReply(()=>new Response(''));
  assert.equal((await uncertainSheets.W.productFetch('/api/ai/chat',chatOptions)).status,502);
  await uncertainSheets.W.productFetch('/api/ai/chat',chatOptions);
  const sheetAttempts=targetCalls(uncertainSheets,'/sheets/execute/ai-chat');
  assert.equal(sheetAttempts.length,2);
  assert.equal(sheetAttempts[0].options.headers['X-Alaada-Operation'],sheetAttempts[1].options.headers['X-Alaada-Operation']);
  const timers=[],delivery=await boot('accounts','',[],new Map(),{timers});
  await delivery.W.productFetch('/companies/company-id/automation/notifications/deliver-pending',{method:'POST',body:'{"limit":10}'});
  assert.ok(timers.includes(35000),'Notification delivery waits for the bounded gateway response');
  const reportSeed=[
    {id:'report-1',product:'analyser',kind:'report',payload:{native_key:'report-1',data:{result:{summary:{}}}}},
    {id:'monitor-1',product:'analyser',kind:'monitor',payload:{native_key:'monitor-1',data:{}}},
    {id:'other',product:'sheets',kind:'workbook',payload:{native_key:'other',data:{}}}
  ];
  const fresh=await boot('analyser','?workspace=company',reportSeed);
  const reportRows=await fresh.W.resources('analyser','report');
  assert.deepEqual(Array.from(reportRows,row=>row.id),['report-1']);
  assert.equal(targetCalls(fresh,'/api/workspaces/company/resources').length,1,'Saved reports use a fresh authorized listing');
  assert.equal(fresh.W.list('monitor').length,1,'Fresh reads do not erase cached product records');
  fresh.setUser('bob');await assert.rejects(fresh.W.resources('analyser','report'),/account changed/);
  assert.equal(targetCalls(fresh,'/api/workspaces/company/resources').length,1);
  for(const [product,path,budget] of [
    ['analyser','/analyze',210000],['sheets','/api/ai/chat',150000],['sheets','/api/formula/eval',90000]
  ]){
    const deadlines=[],env=await boot(product,'',[],new Map(),{timers:deadlines});
    const response=await env.W.productFetch(path,{method:'POST',body:'{}'});
    assert.equal(response.status,200);assert.ok(deadlines.includes(budget),path+' includes gateway readiness and execution');
  }
  const orbitDeadlines=[],slowOrbit=await boot('orbit','',[],new Map(),{timers:orbitDeadlines});
  await slowOrbit.W.save('conversation','first',{messages:[{role:'user',text:'Hi'}]},'First');
  await slowOrbit.W.orbitReply('first');
  assert.ok(orbitDeadlines.includes(120000));
  await slowOrbit.W.entitlements();assert.ok(orbitDeadlines.includes(90000));
  let started;const began=new Promise(resolve=>started=resolve);
  const stopped=await boot('analyser','',[],new Map(),{fetch:(url,options)=>{
    if(url.endsWith('/analyser/analyze')){started();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
  }});
  const cancelAnalysis=new AbortController(),cancelledAnalysis=stopped.W.productFetch('/analyze',{method:'POST',body:'{}',signal:cancelAnalysis.signal});
  await began;cancelAnalysis.abort();
  await assert.rejects(cancelledAnalysis,error=>error.name==='AbortError');
  assert.equal(targetCalls(stopped,'/analyser/analyze').length,1,'Cancellation never replays an analysis');
  // Analyser keeps the same opaque receipt after empty/malformed/lost responses,
  // including reloads; simultaneous clicks share one request.
  const analyserOptions={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://example.com/private-path'})};
  for(const malformed of ['', '{}', '<html>Proxy failed</html>']){
    const env=await boot('analyser','',[],new Map(),{fetch:url=>url.endsWith('/analyser/analyze')?new Response(malformed):undefined});
    const responses=await Promise.all([env.W.productFetch('/analyze',analyserOptions),env.W.productFetch('/analyze',analyserOptions)]);
    assert(responses.every(r=>r.status===502));assert.equal(targetCalls(env,'/analyser/analyze').length,1);
    const receipt=targetCalls(env,'/analyser/analyze')[0].options.headers['X-Alaada-Operation'];
    assert.match(receipt,/^[A-Za-z0-9_-]{16,128}$/);
    assert(!JSON.stringify([...env.operationStorage]).includes('private-path'));
    const reloaded=await boot('analyser','',[],env.operationStorage);
    assert.equal((await reloaded.W.productFetch('/analyze',analyserOptions)).status,200);
    assert.equal(targetCalls(reloaded,'/analyser/analyze')[0].options.headers['X-Alaada-Operation'],receipt);
    await reloaded.W.productFetch('/analyze',analyserOptions);
    assert.notEqual(targetCalls(reloaded,'/analyser/analyze')[1].options.headers['X-Alaada-Operation'],receipt);
  }
  for(const product of ['orbit','analyser']){
    const legacy=await boot(product,'',[],new Map(),{fetch:url=>url.endsWith('/entitlements')?json({products:{[product]:{capabilities:{}}}}):undefined});
    if(product==='orbit'){
      await legacy.W.save('conversation','first',{messages:[{role:'user',text:'Hi'}]},'First');
      await assert.rejects(legacy.W.orbitReply('first'),/updated workspace backend/);
    }else await assert.rejects(legacy.W.productFetch('/analyze',analyserOptions),/updated workspace backend/);
    assert.equal(targetCalls(legacy,product==='orbit'?'/orbit/reply':'/analyser/analyze').length,0);
  }
  for(const response of [new Response(''),json({}),new Response(JSON.stringify({detail:'Pending execution',state:'pending'}),{status:409})]){
    let uncertain=true;
    const env=await boot('orbit','',[],new Map(),{fetch:url=>url.endsWith('/orbit/reply')&&uncertain?response:undefined});
    await env.W.save('conversation','first',{id:'first',messages:[{role:'user',text:'Hi'}]},'First');
    const first=await Promise.allSettled([env.W.orbitReply('first'),env.W.orbitReply('first')]);
    assert(first.every(r=>r.status==='rejected'));assert.equal(targetCalls(env,'/orbit/reply').length,1);
    assert.equal(env.W.read('conversation','first').messages[0].text,'Hi');
    assert.equal(env.document.body.children[1].inert,false,'An uncertain reply does not freeze saved drafts');
    uncertain=false;const recovered=await env.W.orbitReply('first');
    assert.equal(recovered.messages[0].text,'Scoped reply');
    assert.deepEqual(JSON.parse(targetCalls(env,'/orbit/reply')[0].options.body),JSON.parse(targetCalls(env,'/orbit/reply')[1].options.body));
  }
  console.log('Product client behavior passed for Orbit, Sheets, Accounts and Analyser');
  console.log('Empty/malformed responses, cold-start retries, auth denial, cancellation, timeouts, downloads and uncertain-write receipts passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

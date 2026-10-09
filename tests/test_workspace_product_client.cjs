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
    setTimeout:(fn,ms)=>setTimeout(fn,ms===25000?(config.timeoutMs??ms):0),clearTimeout,
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
    assert.deepEqual(env.cookies,['orbit_name=; Max-Age=0; Path=/; SameSite=Lax','orbit_email=; Max-Age=0; Path=/; SameSite=Lax']);
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
    if(url==='/api/workspaces'&&++cold===1)return new Response('');
  }});
  assert.equal(cold,2);
  assert.equal(recovered.W.active.id,'personal');
  assert.equal(recovered.document.body.children.at(-1).hidden,true);
  for(const [body,status,code] of [['',200,'EMPTY_RESPONSE'],['<html>Proxy unavailable</html>',502,'HTTP_502'],['{',200,'MALFORMED_RESPONSE']]){
    const unavailable=await boot('accounts','',[],new Map(),{failure:error=>error.code===code,fetch:url=>url==='/api/workspaces'?new Response(body,{status}):undefined});
    assert.equal(targetCalls(unavailable,'/api/workspaces').length,3);
    const gate=unavailable.document.body.children.at(-1);
    assert.equal(gate.hidden,false);
    assert.equal(unavailable.document.body.children[1].inert,true);
    assert.doesNotMatch(gate.textContent,/Unexpected end|execute 'json'|expired/);
    assert.match(gate.children.at(-2).textContent,/sign-in has not been cleared/);
    assert.equal(gate.children.at(-1).textContent,'Retry connection');
    assert.equal(targetCalls(unavailable,'/resources').length,0);
  }
  for(const status of [401,403]){
    const denied=await boot('accounts','',[],new Map(),{failure:error=>error.status===status,fetch:url=>url==='/api/workspaces'?new Response('',{status}):undefined});
    assert.equal(targetCalls(denied,'/api/workspaces').length,1);
    assert.match(denied.document.body.children.at(-1).textContent,status===401?/sign-in has expired/:/Access.*denied/);
  }
  const emptyIdentity=await boot('orbit','',[],new Map(),{failure:/Appwrite returned an empty response/,fetch:url=>url.endsWith('/account')?new Response(''):undefined});
  assert.equal(targetCalls(emptyIdentity,'/account').length,3);
  assert.equal(targetCalls(emptyIdentity,'/api/workspaces').length,0);
  const jwtFailure=await boot('sheets','',[],new Map(),{failure:/Appwrite returned an empty response/,fetch:url=>url.endsWith('/account/jwts')?new Response(''):undefined});
  assert.equal(targetCalls(jwtFailure,'/account/jwts').length,1,'POSTs are not retried automatically');
  assert.equal(targetCalls(jwtFailure,'/api/workspaces').length,0);
  await boot('accounts','',[],new Map(),{failure:/unreadable response/,fetch:url=>url.endsWith('/account/jwts')?json({}):undefined});
  await boot('accounts','',[],new Map(),{failure:/unreadable response/,fetch:url=>url==='/api/workspaces'?json({user:'someone-else',workspaces:[]}):undefined});
  await boot('accounts','',[],new Map(),{failure:/unreadable response/,fetch:url=>url.endsWith('/resources')?json({}):undefined});
  const timeout=await boot('accounts','',[],new Map(),{timeoutMs:5,failure:error=>error.code==='REQUEST_TIMEOUT',fetch:(url,options)=>{
    if(url==='/api/workspaces')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});
  assert.equal(targetCalls(timeout,'/api/workspaces').length,3);
  const network=await boot('accounts','',[],new Map(),{failure:error=>error.code==='NETWORK_ERROR',fetch:url=>{
    if(url==='/api/workspaces')throw new TypeError('Failed to fetch');
  }});
  assert.equal(targetCalls(network,'/api/workspaces').length,3);
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
  console.log('Product client behavior passed for Orbit, Sheets, Accounts and Analyser');
  console.log('Empty/malformed responses, cold-start retries, auth denial, cancellation, timeouts, downloads and uncertain-write receipts passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

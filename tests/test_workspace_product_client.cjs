const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8').replaceAll('__ENDPOINT__','https://sfo.cloud.appwrite.io/v1').replaceAll('__PROJECT__','project');

async function boot(product, requested='', seed=[]) {
  const requests=[], navigation=[], events={},cookies=[]; let currentUser='alice', revoked=false;
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.style={};this.hidden=false;this.disabled=false;this.textContent='';this.value='';}
    append(...items){this.children.push(...items);for(const item of items)if(item.selected)this.value=item.value;}
    prepend(...items){this.children.unshift(...items);}
    setAttribute(){}
  }
  const document={readyState:'complete',currentScript:{dataset:{product}},body:new Element('body'),
    createElement:tag=>new Element(tag),addEventListener:(type,fn)=>events[type]=fn,hidden:false};
  Object.defineProperty(document,'cookie',{set:value=>cookies.push(value),get:()=>''});
  const location={href:'https://alaada.test/'+product+'.html'+requested,origin:'https://alaada.test',pathname:'/'+product+'.html',search:requested,assign:url=>navigation.push(url)};
  const state={user:'alice',workspaces:[{id:'personal',name:'Personal',kind:'personal'},{id:'company',name:'Company',kind:'organisation'}]};
  const fetch=async(url,options={})=>{
    requests.push({url:String(url),options});
    if(String(url).endsWith('/account'))return {ok:true,json:async()=>({$id:currentUser})};
    if(String(url).endsWith('/account/jwts'))return {ok:true,json:async()=>({jwt:'verified-token'})};
    if(url==='/api/workspaces')return {ok:true,json:async()=>({...state,workspaces:revoked?state.workspaces.slice(0,1):state.workspaces})};
    if(String(url).endsWith('/orbit/reply'))return {ok:true,json:async()=>({id:'saved',product:'orbit',kind:'conversation',version:2,payload:{native_key:'first',data:{id:'first',title:'First',messages:[{role:'assistant',text:'Scoped reply'}]}}})};
    if(options.method==='PUT'){
      const body=JSON.parse(options.body),parts=url.split('/');
      return {ok:true,json:async()=>({id:'saved',product:parts[5],kind:parts[7],version:body.version+1,payload:{native_key:decodeURIComponent(parts[8]),data:body.payload}})};
    }
    return {ok:true,json:async()=>seed};
  };
  const window={fetch,addEventListener:(type,fn)=>events[type]=fn};
  const context=vm.createContext({window,document,location,URL,Headers,Map,Set,Promise,Error,JSON,encodeURIComponent,confirm:()=>true,console,
    localStorage:{getItem(){throw Error('Legacy storage must never be read');}}});
  vm.runInContext(source,context);
  const W=window.AlaadaWorkspace;
  await W.ready;
  return {W,requests,navigation,document,events,cookies,setUser:u=>currentUser=u,revoke:()=>revoked=true};
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
  await analyser.W.save('monitor','target',{url:'https://example.com',intervalHours:24,scheduling:'manual'},'Target');
  assert.equal(analyser.W.list('monitor').length,1);
  await analyser.W.remove('monitor','target');
  assert.equal(analyser.W.list('monitor').length,0);
  const deletion=analyser.requests.find(r=>r.options.method==='DELETE');
  assert.equal(deletion.options.headers['X-Alaada-Workspace'],'company');
  assert.equal(JSON.parse(deletion.options.body).version,1);
  console.log('Product client behavior passed for Orbit, Sheets, Accounts and Analyser');
})().catch(error=>{console.error(error);process.exitCode=1;});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const script=name=>[...read(name).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc=/.test(m[1])).map(m=>m[2]).join('\n');
function helpers(file){
  const source=read(file),start=source.indexOf('async function readUMSResponse('),end=source.indexOf('\n    }',source.indexOf('function verifyAppwriteShape(',start));
  assert(start>=0&&end>start);
  return vm.runInNewContext(source.slice(start,end+6)+';({readUMSResponse,verifyAppwriteShape})');
}
for(const file of ['auth.html','onboarding.html','account.html','admin.html','accept-invitation.html']){
  test(file+' rejects empty/malformed success and preserves HTTP failures',async()=>{
    const {readUMSResponse:parse,verifyAppwriteShape:shape}=helpers(file);
    for(const body of ['','{','<html>bad gateway</html>','null','"success"']){
      await assert.rejects(parse(new Response(body),'Appwrite'),e=>e.status===502);
    }
    for(const status of [401,403,429,502,503])await assert.rejects(parse(new Response('',{status}),'Appwrite'),e=>e.status===status);
    await assert.rejects(parse(new Response(null,{status:204}),'Appwrite'),e=>e.status===502);
    assert.deepEqual(JSON.parse(JSON.stringify(await parse(new Response(null,{status:204}),'Appwrite',true))),{});
    for(const field of ['/account','/account/jwts'])for(const value of [{},[],{jwt:42,$id:42},{jwt:' ',$id:' '}])assert.throws(()=>shape(value,field),e=>e.status===502);
    assert.equal(shape({$id:'alice'},'/account').$id,'alice');
    assert.equal(shape({jwt:'token'},'/account/jwts').jwt,'token');
  });
}
function node(){
  const classes=new Set(['hidden']);
  return {value:'',textContent:'',innerHTML:'',children:[],disabled:false,hidden:false,style:{},options:[],
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,yes){if(yes)classes.add(x);else classes.delete(x)}},
    append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children},
    addEventListener(){},focus(){},blur(){},scrollIntoView(){}};
}
function dom(){
  const nodes=new Map();
  return {nodes,getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},
    createElement:()=>node(),querySelector:()=>node(),querySelectorAll:()=>[],addEventListener(){},hidden:false};
}
const json=data=>new Response(JSON.stringify(data));
function analyser(overrides={}){
  const document=dom(),requests=[];
  const W={active:{id:'one',name:'Personal'},ready:Promise.resolve(),verify:async()=>true,
    entitlements:async()=>({role:'owner',products:{analyser:{capabilities:{analysis:true}}}}),
    resources:async()=>[],productFetch:async(url,options)=>{requests.push({url,options});return json(report())},...overrides};
  const context=vm.createContext({window:{AlaadaWorkspace:W},document,URL,Map,Response,JSON,
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn()});
  vm.runInContext(script('website-analyzer.html'),context);
  return {W,document,requests,run:expression=>vm.runInContext(expression,context)};
}
function report(){
  return {summary:{title:'Example',url:'https://example.com',seo:{score:90,issues:[]},security:{score:80,issues:[]},
    accessibility:{score:70,issues:[]},dom:{cleanliness_score:60,repetition_warnings:[]},resources:{},tech_stack:{detected:[]}},ai_summary:'Test'};
}
test('Analyser only sends one request through the workspace gateway and keeps its URL',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve),requests=[];
  const env=analyser({productFetch:async(...args)=>{requests.push(args);return pending}});
  await env.run('initializeAnalyser()');
  env.document.getElementById('urlInput').value='https://example.com';
  const first=env.run('analyze()'),second=env.run('analyze()');
  await new Promise(setImmediate);assert.equal(requests.length,1);assert.equal(requests[0][0],'/analyze');
  finish(json(report()));await Promise.all([first,second]);
  assert.equal(env.document.getElementById('urlInput').value,'https://example.com');
  assert.match(env.document.getElementById('results').innerHTML,/Example/);
  assert.equal(env.document.getElementById('analyzeBtn').disabled,false);
  assert.doesNotMatch(script('website-analyzer.html'),/fetch\(['"]https:\/\/alaada-website-analyser/);
});
test('Read-only Analyser can list saved reports but cannot execute',async()=>{
  const env=analyser({entitlements:async()=>({role:'reader',products:{analyser:{capabilities:{analysis:true}}}})});
  await env.run('initializeAnalyser()');env.document.getElementById('urlInput').value='https://example.com';
  await env.run('analyze()');assert.equal(env.requests.length,0);assert.equal(env.document.getElementById('analyzeBtn').disabled,true);
  assert.equal(env.document.getElementById('saved-reports').hidden,false);
});
test('Analyser rejects unsupported URLs without clearing a draft',async()=>{
  const env=analyser();await env.run('initializeAnalyser()');
  for(const url of ['','javascript:alert(1)','file:///private','https://user:password@example.com']){
    env.document.getElementById('urlInput').value=url;await env.run('analyze()');
    assert.equal(env.document.getElementById('urlInput').value,url);
  }assert.equal(env.requests.length,0);
});
test('Analyser escapes every untrusted report surface and rejects malformed summaries',()=>{
  const env=analyser(),payload='<img src=x onerror=alert(1)>',data=report();
  data.ai_summary=payload;Object.assign(data.summary,{title:payload,url:payload,html_size_kb:payload,timings_ms:{total_ms:payload}});
  Object.assign(data.summary.seo,{score:payload,issues:[payload],meta_description:payload,canonical:payload,h1_count:payload});
  data.summary.security.issues=[payload];data.summary.accessibility.issues=[payload];data.summary.dom.repetition_warnings=[payload];
  data.summary.tech_stack.detected=[payload];
  for(const key of ['images_count','scripts_count','css_count','fonts_count','images_total_kb_est','script_third_party_count'])data.summary.resources[key]=payload;
  const html=env.run('renderResult('+JSON.stringify(data)+')');
  assert(!html.includes(payload));assert(html.includes('&lt;img'));assert(html.includes('Not available'));
  assert.throws(()=>env.run('renderResult({summary:{}})'),/missing/);
  assert.throws(()=>env.run('renderResult({summary:"bad"})'),/incomplete/);
});
test('Analyser handles empty and malicious error replies without raw JSON exceptions or markup',async()=>{
  for(const response of [new Response(''),new Response('<html>bad gateway</html>',{status:502}),json({error:'<img src=x onerror=alert(1)>'})]){
    const env=analyser({productFetch:async()=>response});await env.run('initializeAnalyser()');
    env.document.getElementById('urlInput').value='https://example.com';await env.run('analyze()');
    const html=env.document.getElementById('results').innerHTML;
    assert.doesNotMatch(html,/<img|Unexpected end|execute 'json'/);
    assert.match(html,/saved reports/);assert.equal(env.document.getElementById('analyzeBtn').disabled,false);
  }
});
test('Saved Analyser reports are refreshed and reverified without executing a scan',async()=>{
  let reads=0,verifications=0;
  const env=analyser({verify:async()=>{verifications++;return true},resources:async()=>{reads++;return [{id:'saved',title:'<script>title</script>',payload:{data:{result:report()}}}]}});
  await env.run('initializeAnalyser()');
  const select=env.document.getElementById('report-select');
  assert.equal(select.children[1].textContent,'<script>title</script>');assert.equal(select.children[1].innerHTML,'');
  select.value='saved';const before=verifications;await env.run('openSavedReport()');
  assert(verifications>before);assert.equal(reads,1);assert.equal(env.requests.length,0);
  assert.match(env.document.getElementById('results').innerHTML,/Example/);
});
test('Late Analyser responses cannot render after workspace replacement',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve);
  const env=analyser({productFetch:()=>pending});await env.run('initializeAnalyser()');
  env.document.getElementById('urlInput').value='https://example.com';
  const first=env.run('analyze()');await new Promise(setImmediate);env.W.active={id:'two',name:'Other'};
  finish(json(report()));await first;assert.equal(env.document.getElementById('results').innerHTML,'');
});
test('Onboarding cannot downgrade an unknown subscription to Free or mix identities',async()=>{
  const source=read('onboarding.html'),start=source.indexOf('async function workspaceContext('),end=source.indexOf('async function boot()',start),{readUMSResponse}=helpers('onboarding.html');
  let current='alice',sub=json({plan:'Free'});
  const context=vm.createContext({appwrite:async path=>path==='/account'?{$id:current}:{jwt:'jwt'},readUMSResponse,AbortSignal,
    fetch:async path=>path.endsWith('/subscription')?sub:json({user:current,workspaces:[{id:'one',kind:'personal'}]})});
  vm.runInContext(source.slice(start,end),context);
  const run=()=>vm.runInContext('workspaceContext("alice")',context);
  assert.equal((await run()).subscription.plan,'Free');
  sub=new Response('');await assert.rejects(run(),e=>e.status===502);
  sub=json({plan:'Unknown'});await assert.rejects(run(),/subscription could not be verified/);
  current='bob';await assert.rejects(run(),/account changed/);
});
test('Admin never claims verified access for an empty overview',async()=>{
  for(const body of ['', '{}']){
    const document=dom();
    vm.runInNewContext(script('admin.html'),{document,AbortSignal,fetch:async url=>url.endsWith('/account')?json({$id:'alice'}):url.endsWith('/account/jwts')?json({jwt:'jwt'}):new Response(body)});
    await new Promise(setImmediate);
    assert.doesNotMatch(document.getElementById('status').textContent,/Verified/);
    assert.equal(document.getElementById('status').className,'error');
    assert.equal(document.getElementById('metrics').children.length,0);
  }
});
function invitation(reply){
  const document=dom(),storage=new Map(),redirects=[],requests=[];
  const context=vm.createContext({document,URLSearchParams,AbortSignal,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    history:{replaceState(){}},location:{search:'?teamId=team&membershipId=member&userId=alice&secret=invite-secret',hash:'',pathname:'/accept-invitation.html',assign:url=>redirects.push(url)},
    fetch:async(url,options)=>{requests.push({url,options});return reply(url,options)}});
  vm.runInContext(script('accept-invitation.html'),context);
  return {document,storage,redirects,requests,context};
}
test('Invitation network errors do not pretend the user is signed out',async()=>{
  const env=invitation(()=>new Response('',{status:503}));await new Promise(setImmediate);
  assert.equal(env.document.getElementById('sign-in').classList.contains('hidden'),true);
  assert.match(env.document.getElementById('message').textContent,/503/);
  assert.equal(env.storage.size,1);
});
test('Invitation acceptance preserves its secret until the exact membership is confirmed',async()=>{
  let membership={};
  const env=invitation(url=>url.endsWith('/account')?json({$id:'alice'}):json(membership));
  await new Promise(setImmediate);await env.document.getElementById('accept').onclick();
  assert.equal(env.storage.size,1);assert.equal(env.redirects.length,0);
  assert.match(env.document.getElementById('message').textContent,/did not confirm/);
  membership={$id:'member',teamId:'team',userId:'alice',confirm:true};
  await env.document.getElementById('accept').onclick();
  assert.equal(env.storage.size,0);assert.deepEqual(env.redirects,['/account.html']);
});
test('Invitation switch-account does not redirect after failed sign-out',async()=>{
  const env=invitation((url,options)=>options.method==='DELETE'?new Response('',{status:503}):json({$id:'bob',email:'bob@example.com'}));
  await new Promise(setImmediate);await env.document.getElementById('switch-account').onclick();
  assert.equal(env.context.location.href,undefined);assert.match(env.document.getElementById('message').textContent,/Could not confirm sign-out/);
});

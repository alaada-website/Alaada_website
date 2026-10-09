const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(process.argv[2],'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
function boot(){
  let hidden=0,user='alice',reply=()=>new Response('{}'),requests=[];
  const json=data=>new Response(JSON.stringify(data));
  const context=vm.createContext({EP:'https://appwrite.test/v1',PID:'project',AbortSignal,
    state:{user:'alice'},active:{id:'personal'},hidePrivate:()=>hidden++,
    fetch:async(url,options)=>{requests.push({url,options});if(url.endsWith('/account'))return json({$id:user});
      if(url.endsWith('/account/jwts'))return json({jwt:'token'});return reply();}});
  vm.runInContext(between('async function readManagerResponse(', 'function hidePrivate(')+between('async function api(path,','function button('),context);
  return {run:expression=>vm.runInContext(expression,context),setReply:fn=>reply=fn,setUser:value=>user=value,get hidden(){return hidden},requests};
}
(async()=>{
  const env=boot();
  for(const body of ['', '{', '<html>Bad gateway</html>']){
    env.setReply(()=>new Response(body));
    await assert.rejects(env.run("api('/workspaces/personal/resources','POST',{})"),e=>e.status===502);
    assert.equal(env.hidden,0,'Transient failures retain unsaved state');
  }
  assert.equal(env.requests.filter(r=>r.options.method==='POST'&&r.url.startsWith('/api')).length,3,'No write is auto-retried');
  env.setReply(()=>new Response('',{status:503}));await assert.rejects(env.run("api('/shared')"),e=>e.status===503);assert.equal(env.hidden,0);
  env.setReply(()=>new Response(null,{status:204}));await assert.rejects(env.run("api('/shared')"),e=>e.status===502);
  assert.equal(JSON.stringify(await env.run("api('/resource','DELETE')")),'{}');
  env.setReply(()=>new Response('{}'));await assert.rejects(env.run("api('/workspaces')"),/could not be verified/);
  env.setReply(()=>{env.setUser('bob');return new Response('{"private":true}')});
  await assert.rejects(env.run("api('/shared')"),/account changed during/);assert.equal(env.hidden,1);
  const switched=boot();switched.setUser('bob');await assert.rejects(switched.run("api('/resource','PUT',{})"),/account changed/);
  assert(!switched.requests.some(r=>r.url.startsWith('/api')));
  for(const status of [401,403]){
    const denied=boot();denied.setReply(()=>new Response('',{status}));
    await assert.rejects(denied.run("api('/shared')"),e=>e.status===status);assert.equal(denied.hidden,1);
  }
  console.log('Workspace manager transport, identity checks, draft preservation and uncertain writes passed');
})().catch(error=>{console.error(error);process.exitCode=1});

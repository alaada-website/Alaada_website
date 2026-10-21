const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','workspace.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const json=value=>new Response(JSON.stringify(value));
const personal={id:'personal-alice',name:'Personal',kind:'personal'};
function setup(reply){
  const nodes=new Map(),requests=[];
  const node=()=>({children:[],textContent:'',hidden:false,style:{},events:{},
    append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},
    addEventListener(name,callback){this.events[name]=callback}});
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},
    createElement:node,createTextNode:text=>({textContent:text}),querySelectorAll:()=>[]};
  const context=vm.createContext({document,URL,AbortSignal,Set,console,
    location:{href:'https://www.alaada.com/workspaces',origin:'https://www.alaada.com',pathname:'/workspaces',search:''},
    history:{replaceState(){}},fetch:async(url,options)=>{
      requests.push({url,options});const overridden=await reply?.(url,options,requests);
      if(overridden!==undefined)return overridden;
      return json(url.endsWith('/account')?{$id:'alice'}:url.endsWith('/jwts')?{jwt:'fixture-token'}:{user:'alice',workspaces:[personal]});
    }});
  vm.runInContext(source.replace('retry.addEventListener(\'click\',load);load()','retry.addEventListener(\'click\',load);globalThis.boot=load()'),context);
  return {requests,boot:context.boot,$:id=>document.getElementById(id),retry:()=>document.getElementById('retry').events.click()};
}

for(const endpoint of ['/account','/jwts'])test('Paused '+endpoint+' blocks private data without a sign-in loop and supports explicit recovery',async()=>{
  let paused=true;
  const env=setup(url=>paused&&url.endsWith(endpoint)?new Response(JSON.stringify({type:'project_paused',message:'internal provider detail'}),{status:403}):undefined);
  await env.boot;
  assert.match(env.$('noticeText').textContent,/restored by its owner/);
  assert.equal(env.$('notice').className,'notice error');
  assert.equal(env.$('products').hidden,true);assert.equal(env.$('workspaceList').children.length,0);
  assert.equal(env.$('retry').hidden,false);
  assert.equal(env.requests.length,endpoint==='/account'?1:2);
  paused=false;await env.retry();
  assert.equal(env.$('products').hidden,false);assert.equal(env.$('workspaceList').children.length,1);
  assert.equal(env.requests.filter(r=>r.url.endsWith('/api/workspaces')).length,1);
  assert(env.requests.every(r=>r.options.signal instanceof AbortSignal&&r.options.redirect==='error'));
});

for(const endpoint of ['/account','/jwts','/api/workspaces'])test('Empty or malformed '+endpoint+' responses never produce raw JSON failures or product access',async()=>{
  for(const body of ['', '<html>Bad gateway</html>', '[]', '{}']){
    const env=setup(url=>url.endsWith(endpoint)?new Response(body):undefined);await env.boot;
    assert.equal(env.$('products').hidden,true);assert.equal(env.$('workspaceList').children.length,0);
    assert.equal(env.$('notice').className,'notice error');
    assert.doesNotMatch(env.$('noticeText').textContent,/Unexpected|execute 'json'/);
    assert(!env.requests.some(r=>r.options.headers.Authorization==='Bearer undefined'));
  }
});

test('A real revoked session still requires sign-in without requesting private data',async()=>{
  const env=setup(()=>new Response(JSON.stringify({type:'user_unauthorized'}),{status:401}));await env.boot;
  assert.equal(env.$('notice').className,'notice warn');assert.equal(env.requests.length,1);
  assert.equal(env.$('noticeText').children.at(-1).textContent,'Sign in');
  assert.equal(env.$('products').hidden,true);
});

test('Workspace identity, shape and final account checks fail closed',async()=>{
  for(const data of [{workspaces:[personal]},{user:'bob',workspaces:[personal]},
    {user:'alice',workspaces:[personal,personal]},{user:'alice',workspaces:[{id:'x'}]}]){
    const env=setup(url=>url.endsWith('/api/workspaces')?json(data):undefined);await env.boot;
    assert.equal(env.$('products').hidden,true);assert.equal(env.$('workspaceList').children.length,0);
  }
  let accounts=0;
  const switched=setup(url=>url.endsWith('/account')?json({$id:++accounts===1?'alice':'bob'}):undefined);await switched.boot;
  assert.equal(switched.$('products').hidden,true);assert.match(switched.$('noticeText').textContent,/verification changed/);
});

test('Retry cannot duplicate an in-flight directory load',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve);
  const env=setup(url=>url.endsWith('/account')?pending.then(response=>response.clone()):undefined);
  await env.retry();assert.equal(env.requests.length,1);
  finish(json({$id:'alice'}));await env.boot;
  assert.equal(env.requests.filter(r=>r.url.endsWith('/jwts')).length,1);
  assert.equal(env.$('products').hidden,false);
});

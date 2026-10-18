const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','workspace-product-client.js'),'utf8');
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const event=(id,action='orbit:reply',read_at=null)=>({id,action,resource:'private-resource',created:1792000000,read_at});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
async function boot(product='orbit',handler=()=>json({items:[],next_before:null})){
  let user='alice';const calls=[],events={},nodes=[];
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.style={};this.hidden=false;this.disabled=false;this.open=false;this.value='';this.textContent='';nodes.push(this);}
    append(...items){this.children.push(...items);for(const item of items)if(item.selected)this.value=item.value;}
    prepend(...items){this.children.unshift(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(k,v){this.attributes[k]=v;}
    getBoundingClientRect(){return {height:36};}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){document.activeElement=this;}
  }
  const document={readyState:'complete',currentScript:{dataset:{product}},body:new Element('body'),head:new Element('head'),
    documentElement:{dataset:{},style:{setProperty(){}}},createElement:tag=>new Element(tag),
    addEventListener:(name,fn)=>events[name]=fn,hidden:false,cookie:''};
  document.body.append(new Element('main'));
  const fetch=async(url,options={})=>{
    url=String(url);calls.push({url,options});
    if(url.endsWith('/account'))return json({$id:user});
    if(url.endsWith('/account/jwts'))return json({jwt:'synthetic-jwt'});
    if(url.includes('/notifications'))return handler(url,options);
    if(url.startsWith('/api/workspaces/bootstrap'))return json({user:'alice',active:'one',resources:[],workspaces:[{id:'one',name:'Personal',kind:'personal'},{id:'two',name:'Team',kind:'organisation'}]});
    if(url.endsWith('/access'))return json({user,workspace:'one',role:'owner'});
    return json({});
  };
  const window={fetch,addEventListener:(name,fn)=>events[name]=fn};
  const navigation=[];
  const location={href:'https://alaada.test/'+product+'.html',origin:'https://alaada.test',pathname:'/'+product+'.html',search:'',assign:url=>navigation.push(url)};
  const context=vm.createContext({window,document,location,URL,Headers,Response,AbortController,DOMException,TextEncoder,Uint8Array,
    crypto:require('node:crypto').webcrypto,console,confirm:()=>true,setTimeout,clearTimeout});
  vm.runInContext(source,context);await window.AlaadaWorkspace.ready;
  const byId=id=>nodes.find(node=>node.id===id);
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const button=text=>descendants(byId('alaada-inbox')).find(node=>node.tagName==='button'&&node.textContent===text);
  return {W:window.AlaadaWorkspace,calls,events,document,byId,button,navigation,
    open:()=>byId('alaada-inbox-button').onclick(),setUser:value=>user=value,
    message:()=>byId('alaada-inbox-message').textContent,
    inboxCalls:()=>calls.filter(call=>call.url.includes('/notifications')),
    rows:()=>descendants(byId('alaada-inbox')).filter(node=>node.tagName==='li')};
}
for(const product of ['orbit','sheets','accounts','analyser'])test(product+' inbox is lazy, private, keyboard closable and does not alter product records',async()=>{
  const env=await boot(product,()=>json({items:[event(2,'<img src=x onerror=alert(1)>'),event(1,'file:upload',1)],next_before:null}));
  assert.equal(env.inboxCalls().length,0);
  await env.open();assert.equal(env.inboxCalls().length,1);
  assert.equal(env.inboxCalls()[0].options.headers.Authorization,'Bearer synthetic-jwt');
  assert.equal(env.inboxCalls()[0].options.headers['X-Alaada-Workspace'],'one');
  assert.equal(env.rows().length,2);assert.equal(env.rows()[0].children[0].textContent,'Workspace activity · <img src=x onerror=alert(1)>');
  assert(env.message().includes('1 unread on this page'));assert(env.button('Older activity').disabled);
  const dialog=env.byId('alaada-inbox');let prevented=false;dialog.oncancel({preventDefault(){prevented=true;}});
  assert(prevented&&!dialog.open);assert.equal(env.rows().length,0);assert.equal(env.document.activeElement,env.byId('alaada-inbox-button'));
  assert.equal(env.calls.filter(call=>call.options.method==='PUT').length,0);
});
test('pagination is bounded to one page and read state changes only after confirmation',async()=>{
  const env=await boot('orbit',(url,options)=>{
    if(options.method==='POST')return json({read:true});
    if(url.includes('?before='))return json({items:[event(50)],next_before:null});
    return json({items:Array.from({length:50},(_,i)=>event(100-i)),next_before:51});
  });
  await env.open();assert.equal(env.rows().length,50);assert.equal(env.button('Older activity').disabled,false);
  await env.button('Older activity').onclick();assert.equal(env.rows().length,1);assert(env.inboxCalls().at(-1).url.endsWith('?before=51'));
  await env.button('Mark as read').onclick();assert(env.inboxCalls().at(-1).url.endsWith('/50/read'));assert(env.message().startsWith('Marked as read'));
  assert.equal(env.rows()[0].attributes['data-unread'],'false');
});
test('double opening or clicking read does not duplicate requests',async()=>{
  const pending=deferred();let marking=false;
  const env=await boot('accounts',(url,options)=>options.method==='POST'?(marking=true,pending.promise):json({items:[event(1)],next_before:null}));
  await env.open();await env.open();assert.equal(env.inboxCalls().length,1);
  const read=env.button('Mark as read'),one=read.onclick(),two=read.onclick();await new Promise(setImmediate);assert(marking);
  assert.equal(env.inboxCalls().filter(c=>c.options.method==='POST').length,1);
  pending.resolve(json({read:true}));await Promise.all([one,two]);
});
test('empty HTTP and malformed pages fail locally without blocking products or claiming a read',async()=>{
  for(const response of [new Response(''),json({}),json({items:[event(1),event(1)],next_before:null}),json({items:[event(1)],next_before:1}),json({items:[{...event(1),id:'1'}],next_before:null}),new Response('bad gateway',{status:503})]){
    const env=await boot('sheets',()=>response);await env.open();assert.match(env.message(),/Could not load/);assert.equal(env.rows().length,0);
    assert.equal(env.W.active.id,'one');assert.equal(env.document.body.children.find(n=>n.attributes.role==='status').hidden,true);
    assert.equal(env.document.body.children[0].children.at(-1).textContent,'');assert.equal(env.inboxCalls().length,1);
  }
  const env=await boot('orbit',(url,options)=>options.method==='POST'?json({}):json({items:[event(1)],next_before:null}));
  await env.open();await env.button('Mark as read').onclick();assert.match(env.message(),/not confirmed/);assert.equal(env.rows()[0].attributes['data-unread'],'true');
  assert.equal(env.inboxCalls().filter(c=>c.options.method==='POST').length,1);
});
test('closed or switched inbox ignores late data and reopening starts fresh',async()=>{
  for(const close of ['close','switch','hide']){
    const pending=deferred();const env=await boot('analyser',()=>pending.promise);const opening=env.open();await new Promise(setImmediate);
    if(close==='close')env.button('Close').onclick();
    if(close==='hide'){env.document.hidden=true;env.events.visibilitychange();}
    if(close==='switch'){const selector=env.document.body.children[0].children[1];selector.value='two';await selector.onchange();}
    pending.resolve(json({items:[event(1)],next_before:null}));await opening;
    assert.equal(env.rows().length,0);assert.equal(env.byId('alaada-inbox').open,false);assert.equal(env.message(),'');
  }
});
test('identity replacement or revoked workspace removes all private notification UI',async()=>{
  for(const scenario of ['identity','revoked']){
    const pending=deferred(),env=await boot('orbit',()=>pending.promise),opening=env.open();await new Promise(setImmediate);
    if(scenario==='identity')env.setUser('bob');
    pending.resolve(scenario==='identity'?json({items:[event(1)],next_before:null}):json({detail:'Access removed'},403));
    await opening;assert.equal(env.rows().length,0);assert.equal(env.byId('alaada-inbox').open,false);assert.equal(env.byId('alaada-inbox-button').disabled,true);
  }
});

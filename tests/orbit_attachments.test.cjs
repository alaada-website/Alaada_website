const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','Orbit.html'),'utf8');
const extract=(start,end='\n}')=>{const a=source.indexOf(start);assert(a>=0);return source.slice(a,source.indexOf(end,a)+end.length);};
function fixture(){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{},files:[],textContent:'',disabled:false});return nodes.get(id);};
  const thread={id:'one',messages:[]},workspace={id:'personal',name:'Personal'},toasts=[];
  const context=vm.createContext({busy:false,activeId:'one',fileId:null,filePreview:null,fileIsImage:false,
    orbitCapabilities:{text:true,files:true},composerDrafts:new Map(),composerAttachments:new Map(),
    document:{getElementById:node},window:{AlaadaWorkspace:{active:workspace}},
    activeThread:()=>thread,toast:m=>toasts.push(m),setStatus:()=>{},lockInput:()=>{},stopSpeaking:()=>{},
    saveThreads:()=>{},renderChat:()=>{},closeSidebar:()=>{},autoTitle:()=>{},updateUserMemory:()=>{},
    hidePreview:()=>{node('previewBar').style.display='none';}});
  vm.runInContext(extract('function clearPreview(','\nfunction showFilePreview') .split('\nfunction showFilePreview')[0]+ '\n'+
    extract('function showFilePreview(','\n\n').trim()+'\n'+extract('document.getElementById("fileInput").onchange=','\n};')+'\n'+extract('async function send()'),context);
  return {context,thread,workspace,node,toasts,api:context.window.AlaadaWorkspace};
}
test('Upload is single-flight, never uses legacy routes and preserves the message and previous attachment on failure',async()=>{
  const {context,node,api}=fixture();let calls=0,reject;
  context.fileId={id:'old',name:'old.csv'};node('inputTextarea').value='Keep this message';node('fileInput').files=[{name:'new.csv'}];
  api.uploadOrbitFile=()=>{calls++;return new Promise((_,r)=>reject=r);};
  const pending=node('fileInput').onchange();await node('fileInput').onchange();
  assert.equal(calls,1);assert.equal(context.busy,true);
  context.clearPreview();assert.equal(context.fileId.id,'old');
  reject(Error('lost response'));await pending;
  assert.equal(context.fileId.id,'old');assert.equal(node('inputTextarea').value,'Keep this message');assert.equal(context.busy,false);
});
test('Successful upload attaches only to its captured workspace and thread',async()=>{
  for(const change of [false,true]){
    const {context,node,api}=fixture();let resolve;
    node('fileInput').files=[{name:'private.csv'}];api.uploadOrbitFile=()=>new Promise(r=>resolve=r);
    const pending=node('fileInput').onchange();if(change)api.active={id:'other'};
    resolve({id:'saved',name:'private.csv'});await pending;
    assert.equal(context.fileId?.id,change?undefined:'saved');
    if(!change)assert.equal(node('prevName').textContent,'📎 private.csv');
  }
});
test('Failed chat retains attachment and one pending prompt; success clears only after confirmed reply',async()=>{
  const {context,node,api,thread}=fixture();context.fileId={id:'saved-file',name:'data.csv'};
  node('inputTextarea').value='Sum the values';api.flush=async()=>{};
  api.orbitReply=async()=>{throw Error('timeout');};
  await context.send();await context.send();
  assert.equal(thread.messages.length,1);assert.equal(thread.messages[0].attachments[0].id,'saved-file');
  assert.equal(context.fileId.id,'saved-file');assert.equal(node('inputTextarea').value,'Sum the values');
  api.orbitReply=async()=>({messages:[...thread.messages,{role:'assistant',text:'3'}]});
  await context.send();assert.equal(thread.messages.length,2);assert.equal(context.fileId,null);assert.equal(node('inputTextarea').value,'');
});
test('Attachment names are rendered as text, never injected markup',()=>{
  const createElement=()=>({style:{},children:[],appendChild(c){this.children.push(c);}});
  const make=vm.runInNewContext('('+extract('function makeBubble(msg)')+')',{
    document:{createElement},parseMathMarkdown:s=>s,applyDownloadLinks:()=>{},typesetMath:()=>{},buildActionsBar:createElement});
  const bubble=make({role:'user',text:'Hello',attachments:[{name:'<img src=x onerror=alert(1)>.csv'}]});
  assert.equal(bubble.children[0].children[0].textContent,'📎 <img src=x onerror=alert(1)>.csv');
  assert.equal(bubble.children[0].children[0].innerHTML,undefined);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','Spreadsheets.html'),'utf8');
function method(name){
  const match=new RegExp('^  (?:async )?'+name+'\\(','m').exec(source);
  if(!match)return '';
  const rest=source.slice(match.index),next=/\n  (?:async )?\w+\(/.exec(rest);
  return rest.slice(0,next?.index??rest.length).trim().replace(/,$/,'');
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
function fixture({noDb=false,abort=false}={}){
  const stores={workbooks:new Map(),versions:new Map()},writes=[],states=[],toasts=[],timers=new Map();let timerId=0,verifyCalls=0;
  const db={transaction(name){
    const tx={error:null};
    const request=result=>{const req={};setImmediate(()=>{req.result=result;req.onsuccess?.();setImmediate(()=>{if(abort){tx.error=Error('quota exceeded');tx.onabort?.();}else tx.oncomplete?.();});});return req;};
    tx.objectStore=()=>({put(value){if(!abort)stores[name].set(value.id,structuredClone(value));return request(value.id);},get:key=>request(stores[name].get(key)),getAll:()=>request([...stores[name].values()]),index:()=>({getAll:key=>request([...stores[name].values()].filter(v=>v.workbookId===key))}),delete:key=>stores[name].delete(key)});return tx;
  }};
  const W={ready:Promise.resolve(),verify:async()=>{verifyCalls++;},save:async(kind,id,data)=>{writes.push(structuredClone({kind,id,data}));},read:()=>null,storage:{setItem(){}}};
  const context=vm.createContext({window:{AlaadaWorkspace:W},navigator:{onLine:true},document:{getElementById:()=>({textContent:'Workbook'})},console:{warn(){}},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=> 'new-book'},confirm:()=>true,Date,Error,JSON,Map,Promise});
  const names=['_idbRequest','_idbTransaction','_scheduleAutosave','_hasUnsavedWorkbook','_saveSnapshot','_trimVersions','_saveBeforeWorkbookChange','openRecentWorkbook','restoreVersion','createVersion','_newWorkbookIdentity','undo','redo','newFile'];
  const G=vm.runInContext('({'+names.map(method).filter(Boolean).join(',\n')+'})',context);context.G=G;
  Object.assign(G,{_persist:{db:noDb?null:db,workbookId:'one',revision:0,lastVersionAt:0},_uiState:{},sheets:[{name:'Sheet1',cells:{A1:{value:'1',format:{bold:false}}}}],si:0,undoStack:[],redoStack:[],_calc:{},namedRanges:[],
    _openWorkbookDb:async()=>{await W.verify();return noDb?null:db;},
    _serializeWorkbook(){return{id:this._persist.workbookId,name:'Workbook',sheets:this.sheets};},
    _hydrateWorkbook(data){this.sheets=data.sheets;this._persist.workbookId=data.id;return true;},
    setSaveState(state,label){this._uiState.saveState=state;states.push([state,label]);},
    toast(...args){toasts.push(args);},pushUndo(){},_recordAction(){},recalc(){},render(){},renderTabs(){},renderCharts(){},moveTo(){}});
  // Exercise legacy UI wrappers too until production no longer needs them.
  for(const prefix of ['G._uiScheduleAutosave=','G._uiSaveSnapshot=']){const line=source.split('\n').find(s=>s.startsWith(prefix));if(line)vm.runInContext(line,context);}
  return{G,W,writes,states,toasts,timers,stores,get verifyCalls(){return verifyCalls;}};
}

test('Cloud persistence works when IndexedDB is unavailable',async()=>{
  const {G,writes}=fixture({noDb:true});assert.equal(await G._saveSnapshot(),true);assert.equal(writes.length,1);
});
test('A save captures detached data before asynchronous work and never borrows newer cell formats',async()=>{
  const {G,W,writes}=fixture(),pending=deferred();let seen;
  W.save=async(kind,id,data)=>{seen=data;await pending.promise;writes.push(structuredClone(data));};
  const save=G._saveSnapshot();G.sheets[0].cells.A1.format.bold=true;
  await tick();assert.equal(seen.sheets[0].cells.A1.format.bold,false);pending.resolve();await save;
});
test('An older completion does not mark newer edits saved',async()=>{
  const {G,W}=fixture(),pending=deferred();W.save=()=>pending.promise;
  const save=G._saveSnapshot();await tick();G.sheets[0].cells.A1.value='2';G._scheduleAutosave();pending.resolve();await save;
  assert.equal(G._uiState.saveState,'unsaved');
});
test('Saves run in order and duplicate in-flight snapshots share one cloud operation',async()=>{
  const {G,W}=fixture(),pending=deferred(),calls=[];
  W.save=async(kind,id,data)=>{calls.push(data.sheets[0].cells.A1.value);if(calls.length===1)await pending.promise;};
  const first=G._saveSnapshot('autosave'),duplicate=G._saveSnapshot('autosave');await tick();
  G.sheets[0].cells.A1.value='2';G._scheduleAutosave();const second=G._saveSnapshot('autosave');await tick();
  assert.deepEqual(calls,['1']);pending.resolve();await Promise.all([first,duplicate,second]);assert.deepEqual(calls,['1','2']);assert.equal(G._uiState.saveState,'saved');
});
test('Saving an already-open workbook does not add a redundant membership request',async()=>{
  const f=fixture();await f.G._saveSnapshot();assert.equal(f.verifyCalls,0);assert.equal(f.writes.length,1);
});
test('A denied cloud write never writes a local snapshot or reports success',async()=>{
  const {G,W,stores}=fixture();W.save=async()=>{throw Object.assign(Error('Access revoked'),{status:403});};
  assert.equal(await G._saveSnapshot(),false);assert.equal(stores.workbooks.size,0);assert.equal(G._uiState.saveState,'error');
});
test('An aborted IndexedDB transaction is not reported as a committed local version',async()=>{
  const {G,toasts}=fixture({abort:true});assert.equal(await G.createVersion('manual'),false);assert(!toasts.some(t=>t[0]==='Version saved'));
});
test('Opening another workbook stops when the current save fails',async()=>{
  const {G,W}=fixture();W.read=()=>({id:'two',sheets:[{cells:{A1:{value:'other'}}}]});G._saveSnapshot=async()=>false;
  assert.equal(await G.openRecentWorkbook('two'),false);assert.equal(G._persist.workbookId,'one');assert.equal(G.sheets[0].cells.A1.value,'1');
});
test('An edit during an asynchronous workbook switch is retained',async()=>{
  const {G,W}=fixture(),pending=deferred();W.read=()=>({id:'two',sheets:[{cells:{A1:{value:'other'}}}]});G._saveSnapshot=()=>pending.promise;
  const open=G.openRecentWorkbook('two');await tick();G.sheets[0].cells.A1.value='newer';G._scheduleAutosave();pending.resolve(true);
  assert.equal(await open,false);assert.equal(G.sheets[0].cells.A1.value,'newer');
});
test('Opening a saved workbook resets cross-workbook Undo history',async()=>{
  const {G,W}=fixture();W.read=()=>({id:'two',sheets:[{cells:{A1:{value:'other'}}}]});G.undoStack=['old'];G.redoStack=['old'];
  assert.equal(await G.openRecentWorkbook('two'),true);assert.equal(G._persist.workbookId,'two');assert.equal(G.undoStack.length,0);assert.equal(G.redoStack.length,0);
});
test('New workbook preserves the current one and refuses to discard unsaved changes after failure',async()=>{
  const {G}=fixture();G._saveSnapshot=async()=>false;assert.equal(await G.newFile(),false);assert.equal(G._persist.workbookId,'one');
});
test('Undo and Redo schedule the resulting workbook for autosave',()=>{
  const {G,timers}=fixture();G.undoStack.push(JSON.stringify({sheets:[{name:'Sheet1',cells:{A1:{value:'before'}}}]}));
  G.undo();assert.equal(G.sheets[0].cells.A1.value,'before');assert.equal(timers.size,1);timers.clear();G.redo();assert.equal(G.sheets[0].cells.A1.value,'1');assert.equal(timers.size,1);
});
test('Navigation warns only for an active editor, unsaved revision or unfinished save',async()=>{
  const {G}=fixture();assert.equal(G._hasUnsavedWorkbook(),false);G._scheduleAutosave();assert.equal(G._hasUnsavedWorkbook(),true);await G._saveSnapshot();assert.equal(G._hasUnsavedWorkbook(),false);G.editing=true;assert.equal(G._hasUnsavedWorkbook(),true);
});
test('A conflict is explicit and leaves the edited workbook in memory',async()=>{
  const {G,W}=fixture();W.save=async()=>{throw Object.assign(Error('Changed in another tab'),{status:409});};G._scheduleAutosave();assert.equal(await G._saveSnapshot(),false);assert.equal(G._uiState.saveState,'conflict');assert.equal(G._hasUnsavedWorkbook(),true);assert.equal(G.sheets[0].cells.A1.value,'1');
});
test('Restore never announces success when the restored version fails to save',async()=>{
  const {G,stores,toasts}=fixture();stores.versions.set('v1',{id:'v1',workbookId:'one',data:{id:'one',sheets:[{cells:{A1:{value:'restored'}}}]}});let saves=0;G._saveSnapshot=async()=>++saves===1;
  assert.equal(await G.restoreVersion('v1'),false);assert.equal(G.sheets[0].cells.A1.value,'restored');assert(!toasts.some(t=>t[0]==='Version restored'));assert.equal(G._hasUnsavedWorkbook(),true);
});
test('Unsaved cell-editor text is committed before saving for a workbook switch',async()=>{
  const {G,writes}=fixture();G.editing=true;G.closeEditor=()=>{G.sheets[0].cells.A1.value='typed';G.editing=false;G._scheduleAutosave();};assert.equal(await G._saveBeforeWorkbookChange(),true);assert.equal(writes[0].data.sheets[0].cells.A1.value,'typed');
});
test('Formula-bar Enter commits exactly one cell and never clears the next row',()=>{
  const input={value:'=SUM(1,2)'},writes=[],handlers=[],scr={focus(){}};
  const context=vm.createContext({document:{getElementById:id=>id==='fbarinput'?Object.assign(input,{addEventListener:(type,fn)=>handlers.push(fn)}):scr},scr});
  const G=vm.runInContext('({'+method('fbKey')+'})',context);context.G=G;
  Object.assign(G,{row:0,col:0,setCell(r,c,value){writes.push({r,c,value});},recalc(){},render(){},moveTo(r,c){this.row=r;this.col=c;input.value='';}});
  const duplicate=source.split('\n').find(line=>line.includes("document.getElementById('fbarinput').addEventListener('keydown'"));
  if(duplicate)vm.runInContext('(function(){'+duplicate+'}).call(G)',context);
  const event={key:'Enter',preventDefault(){},stopPropagation(){}};G.fbKey(event);for(const handler of handlers)handler(event);
  assert.deepEqual(writes,[{r:0,c:0,value:'=SUM(1,2)'}]);assert.equal(G.row,1);
});

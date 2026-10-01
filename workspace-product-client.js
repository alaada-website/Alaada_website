
/* Alaada Appwrite workspace integration. Source lives in the Python monolith. */
(() => {
  'use strict';
  const product = document.currentScript.dataset.product;
  // Legacy Orbit profile cookies were site-wide and crossed workspace boundaries.
  // Remove only these known profile copies; Appwrite session cookies are untouched.
  for(const name of ['orbit_name','orbit_email'])document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax';
  const endpoint = 'https://sfo.cloud.appwrite.io/v1', project = '6972444700208a437da1';
  const nativeFetch = window.fetch.bind(window);
  const values = new Map(), records = new Map(), requests = new Set();
  let user = null, workspace = null, workspaces = [], pending = 0, tail = Promise.resolve(), failed = null, serviceWarmupStarted = false;
  let bar, status, selector, gate, label, verified = false, surfaces=[], beforeSwitch=async()=>{};
  const readyDOM = document.readyState === 'loading' ? new Promise(r => document.addEventListener('DOMContentLoaded',r,{once:true})) : Promise.resolve();
  const keyOf = (p,k,key) => JSON.stringify([p,k,key]);
  function show(message) { if(status)status.textContent=message; }
  function freeze(message) {
    verified=false; failed=Error(message); values.clear(); records.clear();
    for(const surface of surfaces)surface.inert=true;
    if(label)label.textContent='No verified workspace';
    if(gate){gate.hidden=false;gate.textContent=message+' Reload or sign in to continue.';}
    if(selector)selector.disabled=true;
    show(message);
  }
  async function appwrite(path, method='GET') {
    const r=await nativeFetch(endpoint+path,{method,credentials:'include',cache:'no-store',headers:{'X-Appwrite-Project':project,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
    if(!r.ok){freeze('Appwrite sign-in required');throw Error('Appwrite sign-in required');}
    return r.json();
  }
  async function api(path, method='GET', body, rawOptions=null) {
    try {
      const account=await appwrite('/account');
      if(path==='/workspaces'&&!serviceWarmupStarted){serviceWarmupStarted=true;nativeFetch('https://alaada-workspaces.onrender.com/health',{mode:'no-cors',cache:'no-store'}).catch(()=>{serviceWarmupStarted=false})}
      if(user && user!==account.$id) {freeze('The signed-in account changed.');throw failed;}
      const jwt=await appwrite('/account/jwts','POST');
      const contentType=rawOptions?new Headers(rawOptions.headers||{}).get('Content-Type'):'application/json';
      const response=await nativeFetch('/api'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+jwt.jwt,'X-Alaada-Workspace':workspace?.id||'',...(contentType?{'Content-Type':contentType}:{})},...(rawOptions?{body:rawOptions.body,signal:rawOptions.signal}:(body===undefined?{}:{body:JSON.stringify(body)}))});
      if(rawOptions){if([401,403].includes(response.status))freeze('Product access was denied. Reopen a verified workspace.');return response;}
      const data=await response.json();
      if(!response.ok){if([401,403].includes(response.status))freeze('Workspace permission expired or was revoked.');throw Error(data.detail||'Workspace request failed');}
      return data;
    } catch(error) { show(error.message); throw error; }
  }
  function enqueue(fn) {
    if(!verified)throw Error('A verified workspace is required.');
    if(failed)throw failed;
    pending++;if(selector)selector.disabled=true;show('Saving in '+workspace.name+'…');
    const task=tail.then(()=>{if(failed)throw failed;return fn();});
    tail=task.catch(error=>{failed=error;show('Not saved: '+error.message+' Reload after exporting your changes.');}).finally(()=>{pending--;if(selector)selector.disabled=!!pending||!!failed||!!requests.size;if(!pending&&!failed)show('Saved in '+workspace.name);});
    return task;
  }
  async function put(p,kind,key,data,title) {
    const mapKey=keyOf(p,kind,key), previous=records.get(mapKey);
    if(previous && JSON.stringify(previous.payload.data)===JSON.stringify(data))return previous;
    const row=await api('/workspaces/'+workspace.id+'/products/'+p+'/records/'+kind+'/'+encodeURIComponent(key),'PUT',{version:previous?.version||0,title:String(title||key).slice(0,200),payload:data});
    records.set(mapKey,row);return row;
  }
  function setting(key) {
    if(product==='orbit' && key==='orbit_memory')return ['orbit','memory','memory'];
    return ['platform','settings',product+':'+key];
  }
  const storage={
    getItem(key){return values.get(String(key))??null;},
    setItem(key,value){
      key=String(key);value=String(value);
      if(!verified||failed)throw failed||Error('Workspace not ready');
      values.set(key,value);
      if(product==='orbit' && key==='orbit_threads') {
        const threads=JSON.parse(value);
        if(!Array.isArray(threads))throw Error('Invalid conversations');
        enqueue(async()=>{
          const keep=new Set(threads.map(t=>String(t.id)));
          for(const thread of threads)await put('orbit','conversation',String(thread.id),thread,thread.title||'Conversation');
          for(const [mapKey,row] of records)if(row.product==='orbit'&&row.kind==='conversation'&&!keep.has(row.payload.native_key)){
            await api('/workspaces/'+workspace.id+'/resources/'+row.id,'DELETE',{version:row.version});records.delete(mapKey);
          }
        }).catch(()=>{});
      } else {
        const [p,kind,nativeKey]=setting(key);
        enqueue(()=>put(p,kind,nativeKey,value,key)).catch(()=>{});
      }
    },
    removeItem(key){key=String(key);const [p,kind,nativeKey]=setting(key);const row=records.get(keyOf(p,kind,nativeKey));values.delete(key);if(row)enqueue(async()=>{await api('/workspaces/'+workspace.id+'/resources/'+row.id,'DELETE',{version:row.version});records.delete(keyOf(p,kind,nativeKey));}).catch(()=>{});},
    key(index){return [...values.keys()][index]??null;},get length(){return values.size;}
  };
  const W=window.AlaadaWorkspace={storage,
    get active(){return workspace;},get user(){return user;},
    async flush(){await Promise.all([...requests]);await tail;if(failed)throw failed;},
    beforeSwitch(callback){beforeSwitch=callback;},
    async verify(){const data=await api('/workspaces');if(!data.workspaces.some(w=>w.id===workspace.id)){freeze('Workspace membership was removed.');throw failed;}return true;},
    async entitlements(){await W.ready;return api('/workspaces/'+workspace.id+'/entitlements');},
    async orbitReply(key){
      await W.ready;if(product!=='orbit')throw Error('Orbit page required');
      for(const surface of surfaces)surface.inert=true;
      try{return await enqueue(async()=>{
        const mapKey=keyOf('orbit','conversation',String(key)),previous=records.get(mapKey);
        if(!previous)throw Error('Save the conversation first');
        const row=await api('/workspaces/'+workspace.id+'/orbit/reply','POST',{conversation:previous.id,version:previous.version});
        records.set(mapKey,row);
        values.set('orbit_threads',JSON.stringify([...records.values()].filter(r=>r.product==='orbit'&&r.kind==='conversation').map(r=>r.payload.data)));
        return row.payload.data;
      });}finally{if(verified&&!failed)for(const surface of surfaces)surface.inert=false;}
    },
    async save(kind,key,data,title){await W.ready;return enqueue(()=>put(product,kind,String(key),data,title));},
    async remove(kind,key){await W.ready;return enqueue(async()=>{const mapKey=keyOf(product,kind,String(key)),row=records.get(mapKey);if(!row)throw Error('Saved resource unavailable');await api('/workspaces/'+workspace.id+'/resources/'+row.id,'DELETE',{version:row.version});records.delete(mapKey);});},
    read(kind,key){return records.get(keyOf(product,kind,String(key)))?.payload.data??null;},
    list(kind){return [...records.values()].filter(r=>r.product===product&&r.kind===kind).map(r=>({id:r.payload.native_key,data:r.payload.data}));},
    databaseName(name){if(!verified)throw Error('Workspace not ready');return 'alaada:'+encodeURIComponent(user)+':'+encodeURIComponent(workspace.id)+':'+name;},
    async productFetch(url,options={}) {
      const target=new URL(typeof url==='string'?url:url.url,location.href);
      if(target.origin===new URL(endpoint).origin && ['/v1/account','/v1/account/jwts'].includes(target.pathname))return nativeFetch(url,options);
      await W.ready;
      if(product==='sheets' && target.pathname==='/api/formula/eval' && (options.method||'GET').toUpperCase()==='POST'){
        const operation=api('/workspaces/'+workspace.id+'/sheets/formula','POST',undefined,options);
        requests.add(operation);selector.disabled=true;
        try{return await operation;}finally{requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
      }
      if(product==='analyser' && target.pathname==='/analyze' && (options.method||'GET').toUpperCase()==='POST'){
        const operation=api('/workspaces/'+workspace.id+'/analyser/analyze','POST',undefined,options);
        requests.add(operation);selector.disabled=true;
        try{return await operation;}finally{requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
      }
      if(product==='accounts' && (target.pathname==='/health'||target.pathname==='/companies'||target.pathname.startsWith('/companies/'))){
        const operation=api('/workspaces/'+workspace.id+'/accounts'+target.pathname+target.search,options.method||'GET',undefined,options);
        requests.add(operation);selector.disabled=true;
        try{return await operation;}finally{requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
      }
      throw Error('This product backend is not connected to the active workspace. No request was sent.');
    }
  };
  W.ready=(async()=>{
    await readyDOM;
    surfaces=[...document.body.children];for(const surface of surfaces)surface.inert=true;
    bar=document.createElement('aside');bar.id='alaada-workspace-bar';
    bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#11243a;color:#fff;padding:9px 16px;display:flex;gap:12px;align-items:center;font:14px system-ui;min-height:46px';
    label=document.createElement('strong');label.textContent='Verifying workspace…';
    selector=document.createElement('select');selector.setAttribute('aria-label','Active workspace');selector.disabled=true;
    const manage=document.createElement('a');manage.href='/workspaces';manage.textContent='Manage workspaces';manage.style.color='#90e3da';
    const signin=document.createElement('a');const back=location.origin+location.pathname+location.search;
    signin.href=endpoint+'/account/sessions/oauth2/google?project='+project+'&success='+encodeURIComponent(back)+'&failure='+encodeURIComponent(back);signin.textContent='Sign in';signin.style.color='#fff';
    status=document.createElement('span');status.setAttribute('role','status');
    bar.append(label,selector,manage,signin,status);document.body.prepend(bar);
    gate=document.createElement('div');gate.style.cssText='position:fixed;inset:46px 0 0;z-index:2147483646;background:#0e1423;color:#fff;padding:10vh 10vw;font:20px system-ui';gate.textContent='Verifying your private workspace…';document.body.append(gate);
    document.body.style.paddingTop='46px';
    try {
      const session=await api('/workspaces');user=session.user;workspaces=session.workspaces;
      const requested=new URL(location.href).searchParams.get('workspace');
      workspace=requested?workspaces.find(w=>w.id===requested):workspaces.find(w=>w.kind==='personal');
      if(!workspace)throw Error('The requested workspace is not authorised. Open Manage workspaces.');
      const data=await api('/workspaces/'+workspace.id+'/resources');
      for(const row of data)if(row.payload&&typeof row.payload.native_key==='string'){
        const key=keyOf(row.product,row.kind,row.payload.native_key);
        if(records.has(key))throw Error('Duplicate imported record keys require resolution in Manage workspaces.');
        records.set(key,row);
        if(row.product==='platform'&&row.kind==='settings'&&row.payload.native_key.startsWith(product+':'))values.set(row.payload.native_key.slice(product.length+1),row.payload.data);
        if(product==='orbit'&&row.product==='orbit'&&row.kind==='memory'&&row.payload.native_key==='memory')values.set('orbit_memory',row.payload.data);
      }
      if(product==='orbit')values.set('orbit_threads',JSON.stringify(W.list('conversation').map(x=>x.data)));
      for(const w of workspaces){const option=document.createElement('option');option.value=w.id;option.textContent=w.name+' · '+w.kind;option.selected=w.id===workspace.id;selector.append(option);}
      label.textContent='Active: '+workspace.name+' · '+workspace.kind;
      selector.onchange=async()=>{const next=selector.value;selector.value=workspace.id;if(!confirm('Switch workspace? Current workbook changes will be saved; other unsaved form input will be discarded. The product will reload in the destination workspace.'))return;try{selector.disabled=true;await beforeSwitch();await W.flush();const url=new URL(location.href);url.searchParams.set('workspace',next);location.assign(url.href);}catch(error){show(error.message);selector.disabled=!!failed;}};
      verified=true;selector.disabled=false;gate.hidden=true;signin.hidden=true;for(const surface of surfaces)surface.inert=false;show('Private workspace verified');
      return W;
    }catch(error){freeze(error.message);throw error;}
  })();
  W.ready.catch(()=>{});
  window.addEventListener('beforeunload',event=>{if(pending||failed&&verified){event.preventDefault();event.returnValue='Workspace changes have not been saved.';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(gate)gate.hidden=false;for(const surface of surfaces)surface.inert=true;}else if(verified){W.verify().then(()=>{if(verified){gate.hidden=true;for(const surface of surfaces)surface.inert=false;}}).catch(error=>freeze(error.message));}});
  window.AlaadaProduct={product,ready:()=>W.ready.then(()=>true)};
})();

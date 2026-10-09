
/* Alaada Appwrite workspace integration. Source lives in the Python monolith. */
(() => {
  'use strict';
  const product = document.currentScript.dataset.product;
  // Legacy Orbit profile cookies were site-wide and crossed workspace boundaries.
  // Remove only these known profile copies; Appwrite session cookies are untouched.
  for(const name of ['orbit_name','orbit_email'])document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax';
  const endpoint = 'https://sfo.cloud.appwrite.io/v1', project = '6972444700208a437da1';
  const nativeFetch = window.fetch.bind(window);
  const values = new Map(), records = new Map(), requests = new Set(), sheetFlights = new Map(), accountFlights = new Map(), analyserFlights = new Map(), orbitFlights = new Map();
  const ACTIVE_WORKSPACE_COOKIE = 'alaada_active_workspace';
  const WORKSPACE_HINT_COOKIE = 'alaada_workspace_hint';
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
  let accountFlight = null, jwtFlight = null, cachedJwt = null, cachedJwtExpiresAt = 0;
  const sheetRoutes = {'/api/ai/command':'ai-command','/api/ai/chat':'ai-chat','/api/ai/analyze':'ai-analyze',
    '/api/ai/anomalies':'anomalies','/api/ai/translate-batch':'translate','/api/analytics/run':'analytics','/api/analytics/predict':'predict'};
  let user = null, workspace = null, workspaces = [], pending = 0, tail = Promise.resolve(), failed = null;
  let bar, status, selector, gate, label, signin, verified = false, surfaces=[], beforeSwitch=async()=>{};
  const readyDOM = document.readyState === 'loading' ? new Promise(r => document.addEventListener('DOMContentLoaded',r,{once:true})) : Promise.resolve();
  const keyOf = (p,k,key) => JSON.stringify([p,k,key]);
  const cookieGet = name => {try{const item=document.cookie.split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='));return item?decodeURIComponent(item.slice(name.length+1)):'';}catch{return ''}};
  const cookieSet = (name,value,maxAge=COOKIE_MAX_AGE) => {try{document.cookie=name+'='+encodeURIComponent(String(value))+'; Max-Age='+maxAge+'; Path=/; SameSite=Lax; Secure';}catch{}};
  const readWorkspaceHint = () => {
    try {
      const hint = JSON.parse(cookieGet(WORKSPACE_HINT_COOKIE) || 'null');
      if(!hint || typeof hint.id !== 'string' || !hint.id || typeof hint.name !== 'string' || !hint.name)return null;
      return {id:hint.id.slice(0,128),name:hint.name.slice(0,200),kind:hint.kind==='organisation'?'organisation':'personal'};
    } catch { return null; }
  };
  const saveWorkspaceHint = value => {
    if(!value?.id || !value?.name)return;
    cookieSet(WORKSPACE_HINT_COOKIE,JSON.stringify({id:String(value.id),name:String(value.name),kind:value.kind==='organisation'?'organisation':'personal'}));
  };
  if(document.documentElement && document.documentElement.dataset)document.documentElement.dataset.alaadaFast='1';
  if(document.head && document.createElement){const style=document.createElement('style');style.textContent='html[data-alaada-fast],html[data-alaada-fast] *{scroll-behavior:auto!important;transition:none!important;animation:none!important}html[data-alaada-fast] .spin,html[data-alaada-fast] .spinner,html[data-alaada-fast] [class*="spinner"],html[data-alaada-fast] [class*="loading"]{animation-duration:.7s!important;animation-iteration-count:infinite!important}html[data-alaada-fast] .reveal,html[data-alaada-fast] [data-reveal]{opacity:1!important;transform:none!important;transition:none!important}';document.head.append(style)}
  function show(message) { if(status)status.textContent=message; }
  function freeze(error) {
    clearAuthCache();
    failed=error instanceof Error?error:Error(String(error));
    const message=failed.message;
    verified=false; values.clear(); records.clear();
    for(const surface of surfaces)surface.inert=true;
    if(label)label.textContent='No verified workspace';
    if(gate){
      gate.hidden=false;gate.textContent=message;
      const help=document.createElement('p');
      help.textContent=failed.status===401?'Sign in to continue.':failed.status===403?'Check your access in Manage workspaces.':'Reload to retry the connection. Your sign-in has not been cleared.';
      const retry=document.createElement('button');retry.type='button';retry.textContent='Retry connection';retry.onclick=()=>location.reload();
      gate.append(help,retry);
    }
    if(signin&&failed.status===401)signin.hidden=false;
    if(selector)selector.disabled=true;
    show(message);
  }
  function connectionError(service, status=0, code='NETWORK_ERROR', detail='') {
    const messages={
      EMPTY_RESPONSE:service+' returned an empty response. It may still be starting.',
      MALFORMED_RESPONSE:service+' returned an unreadable response. It may still be starting.',
      REQUEST_TIMEOUT:service+' took too long to respond. It may still be starting.',
      NETWORK_ERROR:service+' could not be reached. Check your connection and retry.'
    };
    const message=status===401?'Your Appwrite sign-in has expired.':status===403?'Access to this workspace was denied.':
      detail||messages[code]||service+' request failed (HTTP '+status+').';
    const error=Error(message);error.status=status;error.code=code;
    error.retryable=![401,403].includes(status)&&(status===0||status===408||status===429||status>=500||['EMPTY_RESPONSE','MALFORMED_RESPONSE'].includes(code));
    return error;
  }
  function clearAuthCache(){accountFlight=null;jwtFlight=null;cachedJwt=null;cachedJwtExpiresAt=0;}
  function jwtExpiry(token){
    try{const part=String(token).split('.')[1];if(typeof atob==='function'&&part){const payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));if(Number.isFinite(payload.exp))return Math.max(Date.now()+15000,Number(payload.exp)*1000-30000);}}catch{}
    return Date.now()+5*60*1000;
  }
  async function readJSON(response, service, allowHttpError=false) {
    const text=await response.text();
    let data;
    try{data=text.trim()?JSON.parse(text):null;}catch{}
    if(!response.ok&&!allowHttpError){
      const detail=typeof data?.detail==='string'?data.detail:typeof data?.message==='string'?data.message:'';
      throw connectionError(service,response.status,'HTTP_'+response.status,detail.slice(0,300));
    }
    if(!text.trim())throw connectionError(service,response.status,'EMPTY_RESPONSE');
    if(!data||typeof data!=='object')throw connectionError(service,response.status,'MALFORMED_RESPONSE');
    return data;
  }
  async function request(url, options, service, raw=false, timeoutMs=25000) {
    // Only safe reads retry automatically. An uncertain write keeps its receipt
    // and is never repeated here (including Appwrite JWT creation).
    const attempts=!raw&&(options.method||'GET')==='GET'?3:1;
    for(let attempt=0;attempt<attempts;attempt++){
      const controller=new AbortController(), external=options.signal;
      const abort=()=>controller.abort(external.reason);
      if(external?.aborted)throw external.reason||new DOMException('Request cancelled','AbortError');
      external?.addEventListener('abort',abort,{once:true});
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
      try{
        const response=await nativeFetch(url,{...options,signal:controller.signal});
        if(!raw)return await readJSON(response,service);
        // Downloads and deliberate 204/HEAD replies must keep their original body.
        const type=(response.headers.get('Content-Type')||'').toLowerCase();
        if(response.ok&&(response.status===204||options.method==='HEAD'||
          response.headers.has('Content-Disposition')||/^(application\/(pdf|octet-stream|zip|vnd\.)|text\/csv|image\/)/.test(type)))return response;
        try{await readJSON(response.clone(),service,true);return response;}
        catch(error){
          if(typeof error.code!=='string')throw error;
          // Never treat an empty 2xx write as a confirmed save: callers retain
          // their idempotency key and display a retryable error instead.
          return new Response(JSON.stringify({detail:error.message,code:error.code}),{status:response.ok?502:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
        }
      }catch(cause){
        if(external?.aborted)throw external.reason||new DOMException('Request cancelled','AbortError');
        const error=timedOut?connectionError(service,0,'REQUEST_TIMEOUT'):cause.code?cause:connectionError(service);
        if(!error.retryable||attempt===attempts-1)throw error;
        show(service+' is taking longer to respond. Retrying '+(attempt+2)+' of '+attempts+'…');
        await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
      }finally{clearTimeout(timer);external?.removeEventListener('abort',abort);}
    }
  }
  async function appwrite(path, method='GET', fresh=false) {
    try{
      const accountRequest=path==='/account'&&method==='GET';
      const jwtRequest=path==='/account/jwts'&&method==='POST';
      if(accountRequest&&!fresh&&accountFlight)return await accountFlight;
      if(jwtRequest&&!fresh&&cachedJwt&&cachedJwtExpiresAt>Date.now())return cachedJwt;
      if(jwtRequest&&!fresh&&jwtFlight)return await jwtFlight;
      const flight=request(endpoint+path,{method,credentials:'include',cache:'no-store',headers:{'X-Appwrite-Project':project,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})},'Appwrite');
      if(accountRequest)accountFlight=flight;
      if(jwtRequest)jwtFlight=flight;
      const data=await flight;
      if(typeof data[path==='/account'?'$id':'jwt']!=='string'||!data[path==='/account'?'$id':'jwt'])throw connectionError('Appwrite',200,'MALFORMED_RESPONSE');
      if(jwtRequest){cachedJwt=data;cachedJwtExpiresAt=jwtExpiry(data.jwt);}
      return data;
    }catch(error){clearAuthCache();if([401,403].includes(error.status))freeze(error);throw error;}
    finally{if(path==='/account'&&method==='GET')accountFlight=null;if(path==='/account/jwts'&&method==='POST')jwtFlight=null;}
  }
  async function api(path, method='GET', body, rawOptions=null) {
    try {
      const account=await appwrite('/account');
      if(user && user!==account.$id) {freeze('The signed-in account changed.');throw failed;}
      const jwt=await appwrite('/account/jwts','POST');
      const contentType=rawOptions?new Headers(rawOptions.headers||{}).get('Content-Type'):'application/json';
      const operationId=rawOptions?new Headers(rawOptions.headers||{}).get('X-Alaada-Operation'):null;
      const idempotencyKey=rawOptions?new Headers(rawOptions.headers||{}).get('Idempotency-Key'):null;
      // Product execution can outlive a short identity/read request. Leave time
      // for the bounded gateway call and persistence; caller cancellation wins.
      const timeoutMs=method==='POST'&&/\/analyser\/analyze$/.test(path)?210000:
        method==='POST'&&/\/orbit\/reply$/.test(path)?120000:
        method==='POST'&&/\/sheets\/execute\//.test(path)?150000:
        (method==='POST'&&/\/sheets\/formula$/.test(path)||method==='GET'&&/\/entitlements$/.test(path))?90000:
        method==='POST'&&/\/accounts\/companies\/[^/]+\/automation\/notifications\//.test(path)?35000:25000;
      const response=await request('/api'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+jwt.jwt,'X-Alaada-Workspace':workspace?.id||'',...(contentType?{'Content-Type':contentType}:{}),...(operationId?{'X-Alaada-Operation':operationId}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(rawOptions?{body:rawOptions.body,signal:rawOptions.signal}:(body===undefined?{}:{body:JSON.stringify(body)}))},'Alaada workspace service',!!rawOptions,timeoutMs);
      // Reads already start with a fresh Appwrite identity check. Recheck writes
      // after the gateway call because they can change private state while the
      // browser is waiting for a cold Render service or a product provider.
      if(rawOptions||method!=='GET'){
        const latest=await appwrite('/account','GET',true);
        if(latest.$id!==account.$id){freeze('The signed-in account changed during the request.');throw failed;}
      }
      if(rawOptions){if([401,403].includes(response.status))freeze(connectionError('Alaada workspace service',response.status));return response;}
      if((path==='/workspaces'||path.startsWith('/workspaces/bootstrap'))&&(response.user!==account.$id||!Array.isArray(response.workspaces)||response.workspaces.some(w=>!w||typeof w.id!=='string'||!w.id)))throw connectionError('Alaada workspace service',200,'MALFORMED_RESPONSE');
      if(path.endsWith('/resources')&&method==='GET'&&!Array.isArray(response))throw connectionError('Alaada workspace service',200,'MALFORMED_RESPONSE');
      return response;
    } catch(error) { if(error.status===401)clearAuthCache();if([401,403].includes(error.status))freeze(error);show(error.message); throw error; }
  }
  function enqueue(fn, freezeOnError=true) {
    if(!verified)throw Error('A verified workspace is required.');
    if(failed)throw failed;
    pending++;if(selector)selector.disabled=true;show('Saving in '+workspace.name+'…');
    const task=tail.then(()=>{if(failed)throw failed;return fn();});
    let taskFailed=false;
    tail=task.catch(error=>{taskFailed=true;if(freezeOnError)failed=error;show(freezeOnError?'Not saved: '+error.message+' Reload after exporting your changes.':error.message);}).finally(()=>{pending--;if(selector)selector.disabled=!!pending||!!failed||!!requests.size;if(!pending&&!failed&&!taskFailed)show('Saved in '+workspace.name);});
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
    async resources(p=product,kind){
      await W.ready;if(!verified||failed)throw failed||Error('A verified workspace is required.');
      const active=workspace;
      const operation=api('/workspaces/'+active.id+'/resources');
      requests.add(operation);selector.disabled=true;
      try{
        const rows=await operation;
        if(workspace!==active)throw Error('The workspace changed. Reload the saved reports.');
        // A fresh listing must not overwrite unsaved product state in records.
        return rows.filter(row=>row.product===p&&(!kind||row.kind===kind));
      }finally{requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
    },
    async orbitReply(key){
      await W.ready;if(product!=='orbit')throw Error('Orbit page required');
      const flightKey=JSON.stringify([workspace.id,String(key)]);
      if(orbitFlights.has(flightKey))return orbitFlights.get(flightKey);
      for(const surface of surfaces)surface.inert=true;
      const operation=enqueue(async()=>{
        const policy=await W.entitlements();
        if(policy.products?.orbit?.capabilities?.execution_receipts!==true)throw Error('Orbit needs the updated workspace backend before a reply can be sent safely. Your draft is saved.');
        const mapKey=keyOf('orbit','conversation',String(key)),previous=records.get(mapKey);
        if(!previous)throw Error('Save the conversation first');
        const row=await api('/workspaces/'+workspace.id+'/orbit/reply','POST',{conversation:previous.id,version:previous.version});
        if(row.id!==previous.id||row.product!=='orbit'||row.kind!=='conversation'||!Number.isInteger(row.version)||row.version<=previous.version||row.payload?.native_key!==String(key)||!Array.isArray(row.payload?.data?.messages))throw connectionError('Orbit',200,'MALFORMED_RESPONSE');
        records.set(mapKey,row);
        values.set('orbit_threads',JSON.stringify([...records.values()].filter(r=>r.product==='orbit'&&r.kind==='conversation').map(r=>r.payload.data)));
        return row.payload.data;
      },false);
      orbitFlights.set(flightKey,operation);
      try{return await operation;}finally{orbitFlights.delete(flightKey);if(verified&&!failed)for(const surface of surfaces)surface.inert=false;}
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
      if(product==='sheets' && sheetRoutes[target.pathname] && (options.method||'GET').toUpperCase()==='POST'){
        if(!verified||failed)throw failed||Error('A verified workspace is required.');
        if(typeof options.body!=='string')throw Error('Workbook operations require a JSON request.');
        const scope=JSON.stringify([user,workspace.id,target.pathname,options.body]);
        if(sheetFlights.has(scope))return (await sheetFlights.get(scope)).clone();
        const operation=(async()=>{
          const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope)))].map(x=>x.toString(16).padStart(2,'0')).join('');
          // Persist only opaque operation IDs and hashes, never workbook contents
          // or authority. An uncertain retry after reload keeps the same receipt.
          const storageKey='alaada:sheets:operations:'+encodeURIComponent(user)+':'+encodeURIComponent(workspace.id);
          let saved;
          try{saved=JSON.parse(window.sessionStorage.getItem(storageKey)||'{}');}
          catch{throw Error('Enable session storage before running a workbook operation so retries remain safe.');}
          if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('The operation retry cache is invalid.');
          if(!saved[digest]){
            if(Object.keys(saved).length>=100)throw Error('Too many unresolved workbook operations. Resolve them before starting more.');
            saved[digest]=crypto.randomUUID();
          }
          window.sessionStorage.setItem(storageKey,JSON.stringify(saved));
          const headers=new Headers(options.headers||{});headers.set('X-Alaada-Operation',saved[digest]);
          const response=await api('/workspaces/'+workspace.id+'/sheets/execute/'+sheetRoutes[target.pathname],'POST',undefined,{...options,headers});
          const result=await response.clone().json().catch(()=>null);
          if((response.ok&&result&&result.success!==false)||result?.state==='rejected'){
            const current=JSON.parse(window.sessionStorage.getItem(storageKey)||'{}');
            if(current[digest]===saved[digest]){delete current[digest];window.sessionStorage.setItem(storageKey,JSON.stringify(current));}
          }
          return response;
        })();
        sheetFlights.set(scope,operation);requests.add(operation);selector.disabled=true;
        try{return (await operation).clone();}finally{sheetFlights.delete(scope);requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
      }
      if(product==='sheets' && target.pathname==='/api/formula/eval' && (options.method||'GET').toUpperCase()==='POST'){
        const operation=api('/workspaces/'+workspace.id+'/sheets/formula','POST',undefined,options);
        requests.add(operation);selector.disabled=true;
        try{return await operation;}finally{requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
      }
      if(product==='analyser' && target.pathname==='/analyze' && (options.method||'GET').toUpperCase()==='POST'){
        if(!verified||failed)throw failed||Error('A verified workspace is required.');
        if(typeof options.body!=='string')throw Error('Analysis requires a JSON request.');
        const scope=JSON.stringify([user,workspace.id,target.pathname,options.body]);
        if(analyserFlights.has(scope))return (await analyserFlights.get(scope)).clone();
        const operation=(async()=>{
          const policy=await W.entitlements();
          if(policy.products?.analyser?.capabilities?.execution_receipts!==true)throw Error('Web Analyser needs the updated workspace backend before a scan can be sent safely.');
          const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope)))].map(x=>x.toString(16).padStart(2,'0')).join('');
          const storageKey='alaada:analyser:operations:'+encodeURIComponent(user)+':'+encodeURIComponent(workspace.id);
          let saved;
          try{saved=JSON.parse(window.sessionStorage.getItem(storageKey)||'{}');}
          catch{throw Error('Enable session storage before analysing so retries remain safe.');}
          if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('The analysis retry cache is invalid.');
          if(!saved[digest]){
            if(Object.keys(saved).length>=100)throw Error('Resolve pending analyses before starting more.');
            saved[digest]=crypto.randomUUID();
          }
          const operationId=saved[digest];
          if(!/^[A-Za-z0-9_-]{16,128}$/.test(operationId))throw Error('The analysis retry cache contains an invalid key.');
          // Keep only opaque hashes and receipt IDs, never scanned URLs or data.
          window.sessionStorage.setItem(storageKey,JSON.stringify(saved));
          const headers=new Headers(options.headers||{});headers.set('X-Alaada-Operation',operationId);
          const response=await api('/workspaces/'+workspace.id+'/analyser/analyze','POST',undefined,{...options,headers});
          const result=await response.clone().json().catch(()=>null), summary=result?.summary;
          const confirmed=response.ok&&response.headers.get('X-Alaada-Execution')==='succeeded'&&summary&&['seo','security','accessibility','dom','resources'].every(k=>summary[k]&&typeof summary[k]==='object'&&!Array.isArray(summary[k]));
          if(confirmed){
            const current=JSON.parse(window.sessionStorage.getItem(storageKey)||'{}');
            if(current[digest]===operationId){delete current[digest];window.sessionStorage.setItem(storageKey,JSON.stringify(current));}
          }
          if(response.ok&&!confirmed)return new Response(JSON.stringify({detail:'Analysis completion was not confirmed. Your retry reference has been kept.',state:'unknown'}),{status:502,headers:{'Content-Type':'application/json'}});
          return response;
        })();
        analyserFlights.set(scope,operation);requests.add(operation);selector.disabled=true;
        try{return (await operation).clone();}finally{analyserFlights.delete(scope);requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
      }
      if(product==='accounts' && (target.pathname==='/health'||target.pathname==='/companies'||target.pathname.startsWith('/companies/'))){
        if(!verified||failed)throw failed||Error('A verified workspace is required.');
        const method=(options.method||'GET').toUpperCase(), write=!['GET','HEAD'].includes(method);
        const headers=new Headers(options.headers||{});
        const explicit=headers.get('Idempotency-Key')||headers.get('X-Idempotency-Key');
        if(headers.has('Idempotency-Key')&&headers.has('X-Idempotency-Key')&&headers.get('Idempotency-Key')!==headers.get('X-Idempotency-Key'))throw Error('Conflicting Accounts retry keys.');
        if(explicit&&!/^[A-Za-z0-9_.:-]{16,180}$/.test(explicit))throw Error('Invalid Accounts retry key.');
        if(write&&!explicit&&options.body!=null&&typeof options.body!=='string')throw Error('This upload needs an explicit retry key before it can be sent safely.');
        const scope=write?JSON.stringify([user,workspace.id,method,target.pathname,target.search,explicit||'',typeof options.body==='string'?options.body:null]):null;
        if(scope&&accountFlights.has(scope))return (await accountFlights.get(scope)).clone();
        const operation=(async()=>{
          let storageKey, digest, operationKey=explicit;
          if(write&&!operationKey){
            digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope)))].map(x=>x.toString(16).padStart(2,'0')).join('');
            storageKey='alaada:accounts:operations:'+encodeURIComponent(user)+':'+encodeURIComponent(workspace.id);
            let saved;
            try{saved=JSON.parse(window.sessionStorage.getItem(storageKey)||'{}');}
            catch{throw Error('Enable session storage before saving Accounts changes so retries remain safe.');}
            if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('The Accounts retry cache is invalid.');
            if(!saved[digest]){
              if(Object.keys(saved).length>=100)throw Error('Resolve pending Accounts operations before starting more.');
              saved[digest]=crypto.randomUUID();
            }
            operationKey=saved[digest];
            if(!/^[A-Za-z0-9_.:-]{16,180}$/.test(operationKey))throw Error('The Accounts retry cache contains an invalid key.');
            // Only opaque hashes/keys are stored, never financial data or tokens.
            window.sessionStorage.setItem(storageKey,JSON.stringify(saved));
          }
          if(write)headers.set('Idempotency-Key',operationKey);
          else headers.delete('Idempotency-Key');
          const response=await api('/workspaces/'+workspace.id+'/accounts'+target.pathname+target.search,method,undefined,{...options,headers});
          // Keep uncertain/conflicting outcomes retryable after reload. A fresh
          // successful user action receives a fresh key, even with identical data.
          if(storageKey&&(response.ok||[400,403,404,405,413,415,422].includes(response.status))){
            const current=JSON.parse(window.sessionStorage.getItem(storageKey)||'{}');
            if(current[digest]===operationKey){delete current[digest];window.sessionStorage.setItem(storageKey,JSON.stringify(current));}
          }
          return response;
        })();
        if(scope)accountFlights.set(scope,operation);
        requests.add(operation);selector.disabled=true;
        try{return (await operation).clone();}finally{if(scope)accountFlights.delete(scope);requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
      }
      throw Error('This product backend is not connected to the active workspace. No request was sent.');
    }
  };
  W.ready=(async()=>{
    await readyDOM;
    surfaces=[...document.body.children];
    bar=document.createElement('aside');bar.id='alaada-workspace-bar';
    bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#11243a;color:#fff;padding:6px 14px;display:flex;gap:10px;align-items:center;font:13px system-ui;min-height:36px';
    const cachedHint=readWorkspaceHint();
    workspace=cachedHint;
    label=document.createElement('strong');label.textContent=cachedHint?'Active: '+cachedHint.name+' · checking…':'Checking workspace…';
    selector=document.createElement('select');selector.setAttribute('aria-label','Active workspace');selector.disabled=true;
    const manage=document.createElement('a');manage.href='/workspaces';manage.textContent='Manage workspaces';manage.style.color='#90e3da';
    signin=document.createElement('a');
    signin.href='/auth.html?next='+encodeURIComponent(location.pathname+location.search);signin.textContent='Sign in';signin.style.color='#fff';
    status=document.createElement('span');status.setAttribute('role','status');
    bar.append(label,selector,manage,signin,status);document.body.prepend(bar);
    gate=document.createElement('div');gate.setAttribute('role','status');gate.setAttribute('aria-live','polite');gate.hidden=true;gate.style.cssText='position:fixed;inset:36px 0 0;z-index:2147483646;background:rgba(14,20,35,.94);color:#fff;padding:10vh 10vw;font:20px system-ui;transition:none';gate.textContent='Verifying your private workspace…';document.body.append(gate);
    document.body.style.paddingTop='36px';
    if(document.head&&document.createElement){for(const href of [new URL(endpoint).origin,'https://alaada-workspaces.onrender.com']){const link=document.createElement('link');link.rel='preconnect';link.href=href;link.crossOrigin='anonymous';document.head.append(link)}}
    // Warm the known Free service without credentials while Appwrite verifies
    // the session. This is a best-effort public health read, never authority.
    const wake=new AbortController(),wakeTimer=setTimeout(()=>wake.abort(),10000);
    nativeFetch('https://alaada-workspaces.onrender.com/health',{mode:'no-cors',cache:'no-store',signal:wake.signal}).catch(()=>{}).finally(()=>clearTimeout(wakeTimer));
    try {
      const requested=new URL(location.href).searchParams.get('workspace');
      const hinted=!requested?cookieGet(ACTIVE_WORKSPACE_COOKIE):'';
      const bootstrapTarget=requested||hinted;
      const bootstrapPath='/workspaces/bootstrap'+(bootstrapTarget?'?workspace='+encodeURIComponent(bootstrapTarget):'');
      const session=await api(bootstrapPath);user=session.user;workspaces=session.workspaces;
      workspace=workspaces.find(w=>w.id===session.active)||workspaces.find(w=>w.id===bootstrapTarget)||workspaces.find(w=>w.kind==='personal');
      if(requested&&(!workspace||workspace.id!==requested))workspace=null;
      if(!workspace)throw Error('The requested workspace is not authorised. Open Manage workspaces.');
      const data=Array.isArray(session.resources)?session.resources:await api('/workspaces/'+workspace.id+'/resources');
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
      selector.onchange=async()=>{const next=selector.value;selector.value=workspace.id;if(!confirm('Switch workspace? Current workbook changes will be saved; other unsaved form input will be discarded. The product will reload in the destination workspace.'))return;try{selector.disabled=true;await beforeSwitch();await W.flush();cookieSet(ACTIVE_WORKSPACE_COOKIE,next);const url=new URL(location.href);url.searchParams.set('workspace',next);location.assign(url.href);}catch(error){show(error.message);selector.disabled=!!failed;}};
      verified=true;selector.disabled=false;gate.hidden=true;signin.hidden=true;for(const surface of surfaces)surface.inert=false;show('Private workspace verified');
      saveWorkspaceHint(workspace);
      cookieSet(ACTIVE_WORKSPACE_COOKIE,workspace.id);
      return W;
    }catch(error){freeze(error);throw error;}
  })();
  W.ready.catch(()=>{});
  window.addEventListener('beforeunload',event=>{if(pending||failed&&verified){event.preventDefault();event.returnValue='Workspace changes have not been saved.';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden||!verified)return;W.verify().catch(error=>freeze(error));});
  window.AlaadaProduct={product,ready:()=>W.ready.then(()=>true)};
})();

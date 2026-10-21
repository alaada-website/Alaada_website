
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
  const WORKSPACE_LAYOUT = `
    :root{--alaada-workspace-bar-height:36px}
    #alaada-workspace-bar{gap:4px 8px!important;min-height:36px;height:auto!important;flex-wrap:wrap;overflow:visible!important}
    #alaada-workspace-bar strong{min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis}
    #alaada-workspace-bar select{min-width:0!important;flex:0 1 190px;max-width:30vw!important}
    #alaada-workspace-bar a{flex-shrink:0}
    #alaada-workspace-bar [role=status]{min-width:0;flex:1 0 100%;white-space:normal;overflow-wrap:anywhere;font-size:12px;line-height:1.4;padding:2px 0}
    #alaada-workspace-bar [role=status]:empty{display:none}
    #alaada-inbox-button{border:1px solid #526781;border-radius:6px;background:#1d324b;color:#fff;padding:4px 8px;font:inherit;cursor:pointer;min-height:28px}
    #alaada-inbox-button:disabled{opacity:.6;cursor:default}
    #alaada-inbox{position:fixed;inset:12px 12px auto auto;margin:0;width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 24px);box-sizing:border-box;padding:0;border:1px solid #ccd5df;border-radius:14px;background:#fff;color:#17243a;font:14px/1.5 system-ui;box-shadow:0 12px 40px #11243a30;overflow:auto;overscroll-behavior:contain;text-align:left}
    #alaada-inbox::backdrop{background:#11243a55;backdrop-filter:none}
    #alaada-inbox header,#alaada-inbox footer{padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    #alaada-inbox h2{margin:0;font:700 18px/1.3 system-ui;color:#17243a}
    #alaada-inbox p{margin:0;overflow-wrap:anywhere}
    #alaada-inbox-scope{font-size:12px;color:#526176;max-width:290px}
    #alaada-inbox-message{padding:0 16px 12px;white-space:normal}
    #alaada-inbox ol{list-style:none;margin:0;padding:0 16px}
    #alaada-inbox li{border-top:1px solid #e1e7ee;padding:14px 0;display:grid;gap:8px}
    #alaada-inbox li[data-unread=true]{border-left:3px solid #165dfb;padding-left:12px}
    #alaada-inbox time{font-size:12px;color:#526176}
    #alaada-inbox button{width:auto;min-height:36px;padding:6px 12px;border:1px solid #bcc8d7;border-radius:8px;background:#f5f7fb;color:#17243a;font:600 13px/1.4 system-ui;cursor:pointer;justify-self:start}
    #alaada-inbox button:disabled{opacity:.55;cursor:default}
    #alaada-inbox button:focus-visible,#alaada-inbox a:focus-visible{outline:3px solid #165dfb;outline-offset:2px}
    #alaada-inbox a{color:#164eb8;text-decoration:underline;font-size:13px}
    body[data-alaada-product=orbit] #app,body[data-alaada-product=sheets] #app{
      height:calc(100vh - var(--alaada-workspace-bar-height));
      height:calc(100dvh - var(--alaada-workspace-bar-height));min-height:0;max-width:100%}
    body[data-alaada-product=orbit] .main,body[data-alaada-product=orbit] .chat{min-height:0}
    body[data-alaada-product=sheets] #chatPanel{top:var(--alaada-workspace-bar-height);height:calc(100dvh - var(--alaada-workspace-bar-height))}
    body[data-alaada-product=accounts] #app{min-height:calc(100dvh - var(--alaada-workspace-bar-height))}
    body[data-alaada-product=accounts] #topbar{top:var(--alaada-workspace-bar-height)}
    body[data-alaada-product=accounts] #sidebar,body[data-alaada-product=accounts] #sidebar-backdrop{top:calc(var(--topbar-h) + var(--alaada-workspace-bar-height))}
    body[data-alaada-product=analyser] nav{top:var(--alaada-workspace-bar-height)}
    @media(max-width:600px){#alaada-workspace-bar{padding-inline:8px!important;font-size:11px!important}
      #alaada-workspace-bar strong{max-width:85px}#alaada-workspace-bar select{flex:1 1 90px}}
  `;
  let accountFlight = null, jwtFlight = null, cachedJwt = null, cachedJwtExpiresAt = 0, verifyFlight = null, entitlementFlight = null;
  const sheetRoutes = {'/api/ai/command':'ai-command','/api/ai/chat':'ai-chat','/api/ai/analyze':'ai-analyze',
    '/api/ai/anomalies':'anomalies','/api/ai/translate-batch':'translate','/api/analytics/run':'analytics','/api/analytics/predict':'predict'};
  let user = null, workspace = null, workspaces = [], pending = 0, tail = Promise.resolve(), failed = null;
  let bar, status, selector, gate, label, signin, verified = false, surfaces=[], beforeSwitch=async()=>{};
  let inboxButton, inboxDialog, inboxList, inboxMessage, inboxScope, inboxRefresh, inboxOlder;
  let inboxSession=null;
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
  function fitWorkspaceBar() {
    const height=Math.max(36,Math.ceil(bar?.getBoundingClientRect?.().height||36));
    document.documentElement?.style?.setProperty('--alaada-workspace-bar-height',height+'px');
  }
  function show(message) { if(status)status.textContent=message;fitWorkspaceBar(); }
  function freeze(error) {
    clearAuthCache();
    closeInbox(false);
    if(inboxButton)inboxButton.disabled=true;
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
      if(service==='Appwrite'&&[401,403].includes(response.status)&&data?.type==='project_paused'){
        const error=connectionError(service,503,'APPWRITE_PROJECT_PAUSED',
          'Alaada sign-in is temporarily unavailable. The Appwrite project must be restored by its owner. Your sign-in has not been cleared.');
        error.retryable=false; // Requires operator action, not repeated browser requests.
        throw error;
      }
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
        method==='POST'&&/\/orbit\/reply$/.test(path)?210000:
        method==='POST'&&/\/sheets\/execute\//.test(path)?150000:
        method==='POST'&&/\/accounts\/companies\/[^/]+\/automation\/notifications\//.test(path)?35000:
        /\/accounts\//.test(path)?90000:
        (method==='POST'&&/\/sheets\/formula$/.test(path)||method==='GET'&&/\/entitlements(?:\?|$)/.test(path))?90000:
        25000;
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
    } catch(error) { if(error.status===401)clearAuthCache();if([401,403].includes(error.status))freeze(error);if(!rawOptions?.quiet)show(error.message); throw error; }
  }
  function closeInbox(restoreFocus=true) {
    const session=inboxSession;inboxSession=null;
    session?.controller.abort();
    if(inboxDialog?.open)inboxDialog.close();
    if(inboxList)inboxList.replaceChildren();
    if(inboxMessage)inboxMessage.textContent='';
    if(inboxScope)inboxScope.textContent='';
    if(inboxButton){inboxButton.setAttribute('aria-expanded','false');if(restoreFocus&&verified&&!failed)inboxButton.focus();}
  }
  function currentInbox(session) {
    return inboxSession===session&&verified&&!failed&&session.user===user&&session.workspace===workspace?.id&&!session.controller.signal.aborted;
  }
  function notificationLabel(action) {
    const labels={'file:upload':'File uploaded','accounts:create':'Company created','orbit:reply':'Orbit reply saved',
      'analyser:complete':'Website report saved','share:read':'Read access shared','share:write':'Edit access shared',
      'share:revoke':'Sharing access removed','move:out':'Resource moved out','move:in':'Resource moved in',
      'copy:out':'Resource copied out','copy:in':'Resource copied in'};
    if(labels[action])return labels[action];
    if(action.startsWith('subscription:'))return 'Subscription update · '+action.slice(13).replaceAll(':',' · ');
    return 'Workspace activity · '+action;
  }
  function validateInbox(data, before) {
    if(!data||!Array.isArray(data.items)||data.items.length>50||!(data.next_before===null||Number.isSafeInteger(data.next_before)&&data.next_before>0))throw Error('Notifications returned an incomplete page. Refresh to retry.');
    let previous=before||Number.MAX_SAFE_INTEGER;
    for(const row of data.items){
      if(!row||!Number.isSafeInteger(row.id)||row.id<=0||row.id>=previous||typeof row.action!=='string'||!row.action||row.action.length>200
        ||!Number.isSafeInteger(row.created)||row.created<0||row.created>8640000000000
        ||!(row.read_at===null||Number.isSafeInteger(row.read_at)&&row.read_at>=0))throw Error('Notifications returned invalid activity. Refresh to retry.');
      previous=row.id;
    }
    if(data.next_before!==null&&(data.items.length!==50||data.next_before!==data.items.at(-1)?.id))throw Error('Notifications returned an invalid page cursor. Refresh to retry.');
    return data;
  }
  function renderInbox(session) {
    if(!currentInbox(session))return;
    inboxList.replaceChildren();
    for(const row of session.items){
      const item=document.createElement('li');item.setAttribute('data-unread',String(row.read_at===null));
      const title=document.createElement('p');title.textContent=notificationLabel(row.action);
      const time=document.createElement('time');time.dateTime=new Date(row.created*1000).toISOString();time.textContent=new Date(row.created*1000).toLocaleString();
      item.append(title,time);
      const read=document.createElement(row.read_at===null?'button':'span');
      read.textContent=row.read_at===null?'Mark as read':'Read';
      if(row.read_at===null){read.type='button';read.disabled=session.busy;read.onclick=()=>markInboxRead(session,row);}
      item.append(read);inboxList.append(item);
    }
    inboxRefresh.disabled=session.busy;inboxOlder.disabled=session.busy||session.next===null;
  }
  async function inboxRequest(session, path, method='GET') {
    const response=await api('/workspaces/'+encodeURIComponent(session.workspace)+'/notifications'+path,method,undefined,
      {signal:session.controller.signal,quiet:true,...(method==='POST'?{body:'{}',headers:{'Content-Type':'application/json'}}:{})});
    if(!currentInbox(session))return null;
    return readJSON(response,'Notifications');
  }
  async function loadInbox(older=false) {
    const session=inboxSession;if(!session||session.busy||!currentInbox(session))return;
    const before=older?session.next:null;if(older&&before===null)return;
    session.busy=true;renderInbox(session);inboxMessage.textContent='Loading notifications…';
    try{
      const result=await inboxRequest(session,before?'?before='+before:'');
      if(!currentInbox(session))return;
      const page=validateInbox(result,before);
      session.items=page.items;session.next=page.next_before;
      const unread=session.items.filter(row=>row.read_at===null).length;
      inboxMessage.textContent=session.items.length?unread+' unread on this page. '+(older?'Showing older activity.':'Latest activity.'):'No notifications in this workspace.';
    }catch(error){if(currentInbox(session))inboxMessage.textContent='Could not load notifications. '+error.message;}
    finally{if(currentInbox(session)){session.busy=false;renderInbox(session);}}
  }
  async function markInboxRead(session,row) {
    if(!currentInbox(session)||session.busy||row.read_at!==null)return;
    session.busy=true;renderInbox(session);inboxMessage.textContent='Updating notification…';
    try{
      const result=await inboxRequest(session,'/'+row.id+'/read','POST');
      if(!currentInbox(session))return;
      if(result?.read!==true)throw Error('The read state was not confirmed. Refresh before retrying.');
      row.read_at=Math.floor(Date.now()/1000);
      inboxMessage.textContent='Marked as read. '+session.items.filter(item=>item.read_at===null).length+' unread on this page.';
    }catch(error){if(currentInbox(session))inboxMessage.textContent='Read state not confirmed. Refresh to check it. '+error.message;}
    finally{if(currentInbox(session)){session.busy=false;renderInbox(session);}}
  }
  async function openInbox() {
    if(!verified||failed)return;
    if(inboxSession){inboxDialog.focus();return;}
    if(!inboxDialog){
      inboxDialog=document.createElement('dialog');inboxDialog.id='alaada-inbox';
      inboxDialog.setAttribute('aria-labelledby','alaada-inbox-title');inboxDialog.setAttribute('aria-describedby','alaada-inbox-scope');
      const header=document.createElement('header'),heading=document.createElement('div'),title=document.createElement('h2');
      title.id='alaada-inbox-title';title.textContent='Notifications';
      inboxScope=document.createElement('p');inboxScope.id='alaada-inbox-scope';heading.append(title,inboxScope);
      const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>closeInbox();
      header.append(heading,close);
      inboxMessage=document.createElement('p');inboxMessage.id='alaada-inbox-message';inboxMessage.setAttribute('role','status');inboxMessage.setAttribute('aria-live','polite');
      inboxList=document.createElement('ol');inboxList.setAttribute('aria-label','Workspace activity');
      const footer=document.createElement('footer');
      inboxRefresh=document.createElement('button');inboxRefresh.type='button';inboxRefresh.textContent='Refresh latest';inboxRefresh.onclick=()=>loadInbox();
      inboxOlder=document.createElement('button');inboxOlder.type='button';inboxOlder.textContent='Older activity';inboxOlder.onclick=()=>loadInbox(true);
      const preferences=document.createElement('a');preferences.href='/account.html#preferences';preferences.textContent='Notification preferences';
      footer.append(inboxRefresh,inboxOlder,preferences);inboxDialog.append(header,inboxMessage,inboxList,footer);
      inboxDialog.oncancel=event=>{event.preventDefault();closeInbox();};
      inboxDialog.onclick=event=>{if(event.target===inboxDialog)closeInbox();};
      document.body.append(inboxDialog);
    }
    inboxSession={user,workspace:workspace.id,items:[],next:null,busy:false,controller:new AbortController()};
    inboxScope.textContent=workspace.name+' · Private to your account';
    inboxButton.setAttribute('aria-expanded','true');inboxDialog.showModal();
    await loadInbox();
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
    async verify(){
      await W.ready;
      if(!verifyFlight)verifyFlight=(async()=>{
        const data=await api('/workspaces/'+workspace.id+'/access');
        if(data.user!==user||data.workspace!==workspace.id||!['owner','admin','editor','reader'].includes(data.role)){
          freeze('Workspace membership was removed.');throw failed;
        }
        return true;
      })().finally(()=>{verifyFlight=null;});
      return verifyFlight;
    },
    async entitlements(){
      await W.ready;
      if(!entitlementFlight)entitlementFlight=api('/workspaces/'+workspace.id+'/entitlements?product='+encodeURIComponent(product)).finally(()=>{entitlementFlight=null;});
      return entitlementFlight;
    },
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
    async uploadOrbitFile(file){
      await W.ready;
      if(product!=='orbit'||!verified||failed)throw failed||Error('A verified Orbit workspace is required.');
      if(!file||!Number.isInteger(file.size)||file.size<1||file.size>65536||
        typeof file.name!=='string'||file.name.length>200||/[\x00-\x1f\x7f/\\]/.test(file.name)||
        !/\.(txt|csv|tsv|md|json)$/i.test(file.name))throw Error('Choose a UTF-8 TXT, CSV, TSV, Markdown or JSON file, up to 64 KiB.');
      const active=workspace;
      const operation=(async()=>{
        const policy=await W.entitlements();
        if(policy.role==='reader'||policy.products?.orbit?.capabilities?.files!==true)throw Error('File analysis is not available in this workspace.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        if(bytes.length!==file.size)throw Error('The selected file changed. Select it again.');
        let decoded;
        try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('This file is not UTF-8 text. Binary documents are not supported yet.');}
        if(!decoded.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded))throw Error('The file is empty or contains binary data.');
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
        if(workspace!==active||failed)throw failed||Error('Workspace changed. Select the file again.');
        const saved=await api('/workspaces/'+active.id+'/files','POST',{name:file.name,content:btoa(binary)});
        if(workspace!==active||saved.workspace!==active.id||typeof saved.id!=='string'||!/^[a-f0-9]{32}$/.test(saved.id)||
          saved.name!==file.name||saved.size!==file.size||saved.sha256!==digest)throw Error('File upload could not be confirmed. Check workspace Files before uploading again.');
        return {id:saved.id,name:saved.name};
      })();
      requests.add(operation);selector.disabled=true;
      try{return await operation;}finally{requests.delete(operation);selector.disabled=!!pending||!!failed||!!requests.size;}
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
        let row;
        try{
          row=await api('/workspaces/'+workspace.id+'/orbit/reply','POST',{conversation:previous.id,version:previous.version});
        }catch(error){
          if(!error.retryable||failed)throw error;
          // A proxy can lose the response after Orbit committed its answer.
          // Reconcile with one read, never a second inference or a new prompt.
          show('Checking whether Orbit saved the reply…');
          try{
            const saved=await api('/workspaces/'+workspace.id+'/resources/'+previous.id);
            const before=previous.payload?.data?.messages,after=saved.payload?.data?.messages;
            if(saved.version!==previous.version+1||!Array.isArray(before)||!Array.isArray(after)||
              after.length!==before.length+1||after.at(-1)?.role!=='assistant'||typeof after.at(-1)?.text!=='string'||
              !after.at(-1).text.trim()||JSON.stringify(after.slice(0,-1))!==JSON.stringify(before))throw error;
            row=saved;
          }catch(recoveryError){throw failed||([401,403].includes(recoveryError.status)?recoveryError:error);}
        }
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
          if(write&&response.ok&&!(method==='DELETE'&&response.status===204)){
            const confirmation=await response.clone().json().catch(()=>null);
            if(!confirmation||typeof confirmation!=='object'||(method==='POST'&&target.pathname==='/companies'&&typeof confirmation.id!=='string')){
              return new Response(JSON.stringify({detail:'Accounts did not confirm the save. Keep the same form values and retry; the original retry reference has been preserved.',state:'unknown'}),{status:502,headers:{'Content-Type':'application/json'}});
            }
          }
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
    bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;box-sizing:border-box;height:36px;background:#11243a;color:#fff;border-bottom:1px solid #31455e;padding:4px 12px;display:flex;gap:12px;align-items:center;font:12px system-ui;overflow-x:auto;white-space:nowrap';
    const cachedHint=readWorkspaceHint();
    label=document.createElement('strong');label.textContent=cachedHint?'Active: '+cachedHint.name+' · checking…':'Checking workspace…';
    selector=document.createElement('select');selector.setAttribute('aria-label','Active workspace');selector.disabled=true;selector.hidden=true;
    selector.style.cssText='min-width:110px;max-width:220px;border:1px solid #526781;border-radius:5px;background:#1d324b;color:#fff;padding:3px 5px;font:inherit';
    const manage=document.createElement('a');manage.href='/workspaces';manage.textContent='Workspaces';manage.style.color='#90e3da';
    signin=document.createElement('a');
    signin.href='/auth.html?next='+encodeURIComponent(location.pathname+location.search);signin.textContent='Sign in';signin.style.color='#fff';signin.hidden=true;
    status=document.createElement('span');status.setAttribute('role','status');
    inboxButton=document.createElement('button');inboxButton.id='alaada-inbox-button';inboxButton.type='button';inboxButton.textContent='Notifications';inboxButton.disabled=true;
    inboxButton.setAttribute('aria-haspopup','dialog');inboxButton.setAttribute('aria-controls','alaada-inbox');inboxButton.setAttribute('aria-expanded','false');inboxButton.onclick=openInbox;
    bar.append(label,selector,manage,signin,inboxButton,status);document.body.prepend(bar);
    gate=document.createElement('div');gate.setAttribute('role','status');gate.setAttribute('aria-live','polite');gate.hidden=true;gate.style.cssText='position:fixed;inset:var(--alaada-workspace-bar-height,36px) 0 0;z-index:2147483646;overflow:auto;background:#f7f8fa;color:#17243a;padding:8vh max(24px,8vw);font:18px/1.6 system-ui;transition:none';gate.textContent='Connecting to your private workspace…';document.body.append(gate);
    document.body.style.paddingTop='var(--alaada-workspace-bar-height,36px)';
    if(document.head){const layout=document.createElement('style');layout.textContent=WORKSPACE_LAYOUT;document.head.append(layout)}
    if(window.ResizeObserver)new window.ResizeObserver(fitWorkspaceBar).observe(bar);
    fitWorkspaceBar();
    if(document.head&&document.createElement){for(const href of [new URL(endpoint).origin,'https://alaada-workspaces.onrender.com']){const link=document.createElement('link');link.rel='preconnect';link.href=href;link.crossOrigin='anonymous';document.head.append(link)}}
    // Warm the known Free service without credentials while Appwrite verifies
    // the session. This is a best-effort public health read, never authority.
    const productHealth={accounts:'https://accounts-0o52.onrender.com/health',orbit:'https://orbitapi2.onrender.com/health',sheets:'https://spreadsheets-q70y.onrender.com/health'};
    for(const url of ['https://alaada-workspaces.onrender.com/health',productHealth[product]].filter(Boolean)){
      const wake=new AbortController(),wakeTimer=setTimeout(()=>wake.abort(),65000);
      nativeFetch(url,{mode:'no-cors',cache:'no-store',signal:wake.signal}).catch(()=>{}).finally(()=>clearTimeout(wakeTimer));
    }
    try {
      const requested=new URL(location.href).searchParams.get('workspace');
      const hinted=!requested?cookieGet(ACTIVE_WORKSPACE_COOKIE):'';
      const bootstrapTarget=requested||hinted;
      const bootstrapPath='/workspaces/bootstrap?product='+encodeURIComponent(product)+(bootstrapTarget?'&workspace='+encodeURIComponent(bootstrapTarget):'');
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
      label.textContent=product==='sheets'?'Alaada Sheets':product==='orbit'?'Orbit AI':product==='accounts'?'Alaada Accounts':'Web Analyser';
      selector.hidden=false;
      selector.onchange=async()=>{const next=selector.value;selector.value=workspace.id;if(!confirm('Switch workspace? Current workbook changes will be saved; other unsaved form input will be discarded. The product will reload in the destination workspace.'))return;closeInbox(false);try{selector.disabled=true;await beforeSwitch();await W.flush();cookieSet(ACTIVE_WORKSPACE_COOKIE,next);const url=new URL(location.href);url.searchParams.set('workspace',next);location.assign(url.href);}catch(error){show(error.message);selector.disabled=!!failed;}};
      verified=true;selector.disabled=false;inboxButton.disabled=false;gate.hidden=true;signin.hidden=true;for(const surface of surfaces)surface.inert=false;show('');
      saveWorkspaceHint(workspace);
      cookieSet(ACTIVE_WORKSPACE_COOKIE,workspace.id);
      return W;
    }catch(error){freeze(error);throw error;}
  })();
  W.ready.catch(()=>{});
  window.addEventListener('beforeunload',event=>{if(pending||failed&&verified){event.preventDefault();event.returnValue='Workspace changes have not been saved.';}});
  window.addEventListener('pagehide',()=>closeInbox(false));
  document.addEventListener('visibilitychange',()=>{if(document.hidden){closeInbox(false);return;}if(!verified)return;W.verify().catch(error=>freeze(error));});
  window.AlaadaProduct={product,ready:()=>W.ready.then(()=>true)};
})();
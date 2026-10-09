const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.argv[2] || require('node:path').join(__dirname,'..','Accounts.html'),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert(a>=0&&b>a);return html.slice(a,b);}
const notificationSource=section('let notificationView =','/* ============================================================\n   AUTOMATION');
const helpers=section('function bindCompanyForm(','async function refreshCompanyAfterSave(');
const pagination=section('async function apiAllItems(','const BACKUP_DB =');
const notice=(id,status='PENDING',extra={})=>({id,title:'Alert '+id,message:'Check accounts',status,channel:'EMAIL',severity:'WARNING',created_at:'2026-10-03T00:00:00Z',...extra});
const rule={id:'rule1',name:'Low cash',rule_type:'LOW_CASH',channel:'IN_APP',severity:'WARNING',threshold_amount:'20.00',status:'ACTIVE',version:3};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function setup(){
  const state={companyId:'company-a',companyGeneration:1,currentView:'notifications',company:{base_currency:'INR'}};
  const body={innerHTML:'Loading'},controls=[{disabled:true,dataset:{notificationWrite:'manage'}},{disabled:true,dataset:{notificationWrite:'write'}}];
  const nodes={'notifications-body':body},calls=[],messages=[],errors=[];
  let modal=null,opened=false,intercept=null;
  const data={rules:[{...rule}],all:[notice('one')],attempts:[],access:{role:'owner',can_manage:true,can_write:true}};
  const api=async(path,options={})=>{
    calls.push({path,options});
    const overridden=await intercept?.(path,options);
    if(overridden!==undefined)return overridden;
    if(options.method==='POST'||options.method==='PATCH')return path.endsWith('/deliver')||path.endsWith('/deliver-pending')?[{status:'SENT'}]:path.endsWith('/run-due')?[]:{};
    if(path.endsWith('/members/me'))return {...data.access};
    const rows=path.endsWith('/notification-rules')?data.rules:path.endsWith('/notification-delivery-attempts')?data.attempts:data.all;
    const page=options.qs?.page || 1;
    return {items:rows.slice((page-1)*100,page*100),meta:{total:rows.length}};
  };
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context=vm.createContext({STATE:state,VIEW_RENDERERS:{},DEVELOPER_MODE:false,api,requireCompany:()=>!!state.companyId,
    document:{getElementById:id=>nodes[id],querySelectorAll:()=>controls},
    sameCompanyGeneration:(id,generation)=>state.companyId===id&&state.companyGeneration===generation,
    view:()=>({innerHTML:''}),viewHead:()=>'',emptyState:(symbol,title,message,buttons='')=>title+message+buttons,
    money:value=>String(value),esc,todayStr:()=> '2026-10-09',Date,Map,Set,Promise,JSON,Error,console,
    modalBackdrop:{classList:{contains:()=>opened}},
    openModal:config=>{modal=config;opened=true;for(const match of (config.bodyHtml+config.footHtml).matchAll(/id="([^"]+)"/g))nodes[match[1]]={value:'',disabled:false};config.onMount?.();},
    closeModal:()=>{opened=false;},toast:(message,type)=>messages.push({message,type}),errToast:error=>errors.push(error.message)});
  vm.runInContext(helpers+pagination+notificationSource,context);
  return {context,state,body,controls,nodes,calls,messages,errors,data,intercept:fn=>intercept=fn,modal:()=>modal,
    writes:()=>calls.filter(call=>['POST','PATCH'].includes(call.options.method))};
}

test('Notification lists paginate completely and escape untrusted labels',async()=>{
  const env=setup();env.data.all=Array.from({length:201},(_,i)=>notice('n'+i));
  env.data.rules[0].name='<img src=x onerror=alert(1)>';
  await env.context.loadNotifications();
  assert.equal(env.calls.filter(call=>call.path.endsWith('/notifications')).length,3);
  assert.match(env.body.innerHTML,/Alert n200/);
  assert.match(env.body.innerHTML,/&lt;img/);
  assert.doesNotMatch(env.body.innerHTML,/<img/);
  assert.equal(env.controls[0].disabled,false);
});

test('A late notification load cannot show the previous company or overwrite a newer refresh',async()=>{
  const env=setup(),pending=deferred();let first=true;
  env.intercept(path=>{if(first&&path.endsWith('/notification-rules')){first=false;return pending.promise;}});
  const old=env.context.loadNotifications();
  env.data.rules=[{...rule,name:'New refreshed rule'}];
  await env.context.loadNotifications();
  const fresh=env.body.innerHTML;
  pending.reject(Error('Old connection failed'));await old;
  assert.equal(env.body.innerHTML,fresh);
  const wait=deferred();env.intercept(path=>path.endsWith('/notification-rules')?wait.promise:undefined);
  const stale=env.context.loadNotifications();env.state.companyId='company-b';env.state.companyGeneration++;
  wait.resolve({items:[{...rule,name:'PRIVATE OLD COMPANY'}],meta:{total:1}});await stale;
  assert.equal(env.body.innerHTML,fresh);
  assert.doesNotMatch(env.body.innerHTML,/PRIVATE OLD COMPANY/);
});

test('Unknown and in-progress deliveries stay visible without send buttons; failed backoff is respected',async()=>{
  const env=setup();
  env.data.all=[notice('unknown','UNKNOWN',{delivery_state:{a:{status:'UNKNOWN'}}}),
    notice('sending','SENDING',{delivery_state:{a:{status:'SENDING'}}}),
    notice('wait','FAILED',{delivery_state:{a:{status:'FAILED',next_at:Date.now()/1000+3600}}}),
    notice('retry','FAILED',{delivery_state:{a:{status:'FAILED',next_at:0}}}),
    notice('read','READ')];
  await env.context.loadNotifications();
  assert.match(env.body.innerHTML,/provider outcome is unknown/);
  assert.match(env.body.innerHTML,/Delivery is in progress/);
  for(const i of [0,1,2])assert.ok(!env.body.innerHTML.includes(`deliverNotification(${i})`));
  for(const i of [3,4])assert.ok(env.body.innerHTML.includes(`deliverNotification(${i})`));
  await env.context.deliverNotification(0);
  assert.equal(env.writes().length,0);
});

test('Read-only roles cannot send or edit; editors can mark the shared inbox but cannot send',async()=>{
  const env=setup();env.data.access={role:'viewer',can_manage:false,can_write:false};
  await env.context.loadNotifications();
  env.context.openNotificationRuleForm();await env.context.deliverPendingNotifications();await env.context.markNotificationRead(0);
  assert.equal(env.modal(),null);assert.equal(env.writes().length,0);assert(env.controls.every(button=>button.disabled));
  env.data.access={role:'editor',can_manage:false,can_write:true};await env.context.loadNotifications();
  await env.context.deliverPendingNotifications();assert.equal(env.writes().length,0);
  await env.context.markNotificationRead(0);assert.equal(env.writes().length,1);
  assert.equal(env.writes()[0].path,'/companies/company-a/automation/notifications/one/read');
});

test('Concurrent notification actions send once and old-company completion never changes the new view',async()=>{
  const env=setup();await env.context.loadNotifications();
  const pending=deferred();env.intercept((path,options)=>options.method==='POST'?pending.promise:undefined);
  const first=env.context.deliverNotification(0),second=env.context.deliverNotification(0);
  assert.equal(env.writes().length,1);assert.equal(env.controls[0].disabled,true);
  assert.equal(env.writes()[0].options.timeoutMs,40000);
  env.state.companyId='company-b';env.state.companyGeneration++;
  pending.resolve([{status:'SENT'}]);await Promise.all([first,second]);
  assert.equal(env.messages.length,0);
  assert.equal(env.calls.filter(call=>call.path.includes('company-b')).length,0);
});

test('Rule edits include version, omit immutable fields, and reject fractional cents',async()=>{
  const env=setup();await env.context.loadNotifications();env.context.openNotificationRuleForm(0);
  assert.equal(env.nodes['notif-rule-name'].value,'Low cash');
  env.nodes['notif-rule-threshold'].value='0.001';await env.nodes['notif-rule-save'].onclick();
  assert.equal(env.writes().length,0);assert.match(env.errors.at(-1),/Threshold/);
  env.nodes['notif-rule-threshold'].value='12.34';env.nodes['notif-rule-status'].value='INACTIVE';
  await env.nodes['notif-rule-save'].onclick();
  assert.equal(env.writes().length,1);
  const {path,options}=env.writes()[0];assert.equal(path,'/companies/company-a/automation/notification-rules/rule1');
  assert.equal(options.method,'PATCH');assert.equal(options.body.version,3);assert.equal(options.body.status,'INACTIVE');
  assert.equal(options.body.threshold_amount,'12.34');assert.ok(!('name' in options.body));assert.ok(!('rule_type' in options.body));
});

test('Notification forms reject stale company or refreshed snapshot and suppress duplicate submissions',async()=>{
  const env=setup();await env.context.loadNotifications();env.context.openNotificationRuleForm();
  env.nodes['notif-rule-name'].value='New rule';const oldButton=env.nodes['notif-rule-save'];
  env.state.companyId='company-b';env.state.companyGeneration++;await oldButton.onclick();assert.equal(env.writes().length,0);
  await env.context.loadNotifications();env.context.openNotificationRuleForm();env.nodes['notif-rule-name'].value='New rule';
  await env.context.loadNotifications();await env.nodes['notif-rule-save'].onclick();assert.equal(env.writes().length,0);
  assert.match(env.errors.at(-1),/rules changed/);
  env.context.openNotificationRuleForm();env.nodes['notif-rule-name'].value='New rule';
  const pending=deferred();env.intercept((path,options)=>options.method==='POST'?pending.promise:undefined);
  const save=env.nodes['notif-rule-save'],a=save.onclick(),b=save.onclick();
  assert.equal(env.writes().length,1);pending.resolve({id:'new-rule'});await Promise.all([a,b]);
});

test('Uncertain deliveries are not reported as successful sends',async()=>{
  const env=setup();await env.context.loadNotifications();
  env.intercept((path,options)=>options.method==='POST'?[{status:'UNKNOWN'}]:undefined);
  await env.context.deliverPendingNotifications();
  assert.equal(env.messages[0].type,'err');assert.match(env.messages[0].message,/0 accepted; 0 failed; 1 uncertain/);
});

test('Business-mode delivery diagnostics show a reference without provider internals',async()=>{
  const env=setup();env.data.attempts=[{id:'delivery-reference',status:'UNKNOWN',channel:'EMAIL',provider:'internal-provider-name',
    error_message:'Internal failure <script>unsafe</script>',attempted_at:'2026-10-03T00:00:00Z'}];
  await env.context.loadNotifications();
  assert.match(env.body.innerHTML,/delivery-reference/);
  assert.doesNotMatch(env.body.innerHTML,/internal-provider-name|Internal failure|Developer diagnostics/);
  env.context.DEVELOPER_MODE=true;await env.context.loadNotifications();
  assert.match(env.body.innerHTML,/Developer diagnostics/);
  assert.match(env.body.innerHTML,/internal-provider-name/);
  assert.doesNotMatch(env.body.innerHTML,/<script>/);
});

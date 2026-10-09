const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.argv[2] || require('node:path').join(__dirname,'..','Accounts.html'),'utf8').replace(/\r\n/g,'\n');
const start=html.indexOf('let companyAccessView ='),end=html.indexOf('async function renderApprovals()',start);
const bindStart=html.indexOf('function bindCompanyForm('),bindEnd=html.indexOf('function inventoryDecimal(',bindStart);
assert(start>0 && end>start && bindStart>0);
let slots={},isOpen=false,fetcher,modal;
const state={companyId:'a',companyGeneration:1,currentView:'company-access'},view={innerHTML:''},calls=[],messages=[];
const access={user_id:'alice',role:'owner',can_manage:true,collaboration_available:true};
const members=[{id:'alice',user_id:'alice',role:'owner',status:'ACTIVE',version:1},
  {id:'former',user_id:'former',role:'editor',status:'ACTIVE',version:3}];
const candidates=[{user_id:'alice',name:'Alice',workspace_role:'editor'},
  {user_id:'bob',name:'Bob <script>',workspace_role:'editor'}, {user_id:'reader',name:'Reader',workspace_role:'reader'}];
function openModal(config){
  modal=config;isOpen=true;slots={};
  for(const match of (config.bodyHtml+config.footHtml).matchAll(/id="([^"]+)"/g)) slots[match[1]]={value:'',disabled:false};
  config.onMount?.();
}
const normal=async path=>path.endsWith('/members/me')?access:path.endsWith('/member-candidates')?{items:candidates}:{};
fetcher=normal;
const ctx=vm.createContext({STATE:state,VIEW_RENDERERS:{},requireCompany:()=>true,
  crypto:require('node:crypto').webcrypto,money:value=>String(value),
  sameCompanyGeneration:(id,g)=>state.companyId===id&&state.companyGeneration===g,
  document:{getElementById:id=>slots[id]},modalBackdrop:{classList:{contains:()=>isOpen}},openModal,closeModal:()=>{isOpen=false;},
  view:()=>view,viewHead:(title,sub,buttons='')=>title+sub+buttons,emptyState:(icon,title,body,actions='')=>title+body+actions,
  esc:value=>String(value??'').replace(/</g,'&lt;').replace(/>/g,'&gt;'),toast:m=>messages.push(m),errToast:e=>messages.push(e.message),
  apiAllItems:async()=>members,loadCompanies:async()=>{},
  api:async(path,options={})=>{calls.push({path,options});return fetcher(path,options);},console});
vm.runInContext(html.slice(bindStart,bindEnd)+html.slice(start,end),ctx);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
  await ctx.renderCompanyAccess();
  assert.match(view.innerHTML,/Company access/);assert.match(view.innerHTML,/Edit access/);
  ctx.openCompanyMemberForm();
  assert.match(modal.bodyHtml,/Bob &lt;script&gt;/);assert.doesNotMatch(modal.bodyHtml,/<script>/);
  slots['member-user'].value='reader';slots['member-role'].value='admin';
  const writes=()=>calls.filter(c=>c.options.method==='POST'||c.options.method==='PATCH');
  await slots['member-save'].onclick();assert.equal(writes().length,0);assert.match(messages.at(-1),/read-only/);
  slots['member-user'].value='bob';slots['member-role'].value='admin';
  let pending=deferred();fetcher=async(path,options)=>options.method?pending.promise:normal(path);
  const saving=slots['member-save'].onclick();await slots['member-save'].onclick();
  assert.equal(writes().length,1);assert.equal(writes()[0].path,'/companies/a/members');
  assert.deepEqual(JSON.parse(JSON.stringify(writes()[0].options.body)),{user_id:'bob',role:'admin'});
  pending.resolve({});await saving;
  fetcher=normal;await ctx.renderCompanyAccess();ctx.openCompanyMemberForm(1);
  slots['member-status'].value='INACTIVE';await slots['member-save'].onclick();
  assert.equal(writes().at(-1).options.body.version,3);assert.equal(writes().at(-1).options.body.status,'INACTIVE');
  await ctx.renderCompanyAccess();ctx.openCompanyMemberForm();const old=slots['member-save'];
  slots['member-user'].value='bob';state.companyId='b';state.companyGeneration++;
  const before=writes().length;await old.onclick();assert.equal(writes().length,before);
  state.companyId='a';pending=deferred();fetcher=()=>pending.promise;
  const loading=ctx.renderCompanyAccess();state.companyId='b';state.companyGeneration++;view.innerHTML='New company';
  pending.resolve(access);await loading;assert.equal(view.innerHTML,'New company');
  fetcher=async()=>({...access,can_manage:false,role:'viewer'});
  await ctx.renderCompanyAccess();assert.match(view.innerHTML,/Managed by your company owner/);assert.doesNotMatch(view.innerHTML,/Edit access/);
  fetcher=async()=>({...access,collaboration_available:false});
  await ctx.renderCompanyAccess();assert.match(view.innerHTML,/Personal company/);
  fetcher=async path=>{if(path.endsWith('member-candidates'))throw new Error('Directory offline');return normal(path);};
  await ctx.renderCompanyAccess();assert.match(view.innerHTML,/Directory offline/);assert.match(view.innerHTML,/still revoke/);
  ctx.openCompanyMemberForm(1);slots['member-status'].value='ACTIVE';await slots['member-save'].onclick();
  assert.match(messages.at(-1),/Refresh the organisation directory/);
  slots['member-status'].value='INACTIVE';await slots['member-save'].onclick();assert.equal(writes().at(-1).options.body.status,'INACTIVE');
  const approvalStart=html.indexOf('let approvalLoadSequence ='),approvalEnd=html.indexOf("VIEW_RENDERERS['approvals']",approvalStart);
  assert(approvalStart>0 && approvalEnd>approvalStart);
  vm.runInContext(html.slice(approvalStart,approvalEnd),ctx);
  state.currentView='approvals';state.company={base_currency:'INR'};
  const approvalBody={innerHTML:'loading'};slots['approvals-body']=approvalBody;
  pending=deferred();ctx.apiAllItems=()=>pending.promise;
  const approvalLoading=ctx.loadApprovals();state.companyId='c';state.companyGeneration++;
  approvalBody.innerHTML='Different company';pending.resolve([]);await approvalLoading;
  assert.equal(approvalBody.innerHTML,'Different company');
  ctx.apiAllItems=async()=>[];await ctx.loadApprovals();assert.match(approvalBody.innerHTML,/No pending approvals/);
  ctx.decideApproval('request1','approve');assert.match(modal.bodyHtml,/signed-in Appwrite account/);
  slots['approval-decision-note'].value='Reviewed';
  fetcher=async()=>{throw new Error('Uncertain outcome');};
  await slots['approval-decision-save'].onclick();const firstDecision=writes().at(-1);
  await slots['approval-decision-save'].onclick();const retryDecision=writes().at(-1);
  assert.equal(firstDecision.options.headers['Idempotency-Key'],retryDecision.options.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(JSON.stringify(firstDecision.options.body)),{note:'Reviewed'});
  const oldDecision=slots['approval-decision-save'];state.companyId='d';state.companyGeneration++;
  const count=writes().length;await oldDecision.onclick();assert.equal(writes().length,count);
  ctx.openApprovalRuleForm();slots['appr-rule-name'].value='Review';slots['appr-rule-count'].value='1.5';
  await slots['appr-rule-save'].onclick();assert.equal(writes().length,count);assert.match(messages.at(-1),/whole number/);
  slots['appr-rule-count'].value='2';
  await slots['appr-rule-save'].onclick();const firstRule=writes().at(-1);
  await slots['appr-rule-save'].onclick();const retryRule=writes().at(-1);
  assert.equal(firstRule.path,'/companies/d/automation/approval-rules');
  assert.equal(firstRule.options.headers['Idempotency-Key'],retryRule.options.headers['Idempotency-Key']);
  const oldRule=slots['appr-rule-save'];state.companyId='e';state.companyGeneration++;
  const ruleCount=writes().length;await oldRule.onclick();assert.equal(writes().length,ruleCount);
  const editRule={id:'rule1',name:'Existing',entity_type:'VOUCHER',min_amount:'12.34',required_approvals:1,version:3,status:'ACTIVE'};
  ctx.apiAllItems=async path=>path.endsWith('approval-rules')?[editRule]:[];
  slots['approvals-body']=approvalBody;await ctx.loadApprovals();assert.match(approvalBody.innerHTML,/Edit rule/);
  ctx.openApprovalRuleForm(0);assert.equal(modal.title,'Edit approval rule');assert.equal(slots['appr-rule-name'].disabled,true);
  slots['appr-rule-status'].value='INACTIVE';await slots['appr-rule-save'].onclick();const edit=writes().at(-1);
  assert.equal(edit.path,'/companies/e/automation/approval-rules/rule1');assert.equal(edit.options.method,'PATCH');
  assert.equal(edit.options.body.version,3);assert.equal(edit.options.body.status,'INACTIVE');assert.equal(edit.options.body.name,undefined);
  ctx.openApprovalSubmitForm({entityId:'voucher1'});assert.doesNotMatch(modal.bodyHtml,/appr-submit-by/);
  slots['appr-submit-id'].value='voucher1';slots['appr-submit-note'].value='Review this';
  pending=deferred();fetcher=()=>pending.promise;
  const submitting=slots['appr-submit-save'].onclick();const submitCount=writes().length;
  await slots['appr-submit-save'].onclick();assert.equal(writes().length,submitCount);
  const submission=writes().at(-1);assert.equal(submission.options.body.requested_by,undefined);
  assert.equal(submission.path,'/companies/e/automation/approval-requests');
  const oldSubmit=slots['appr-submit-save'];state.companyId='f';state.companyGeneration++;
  ctx.decideApproval('another','approve');const nextModal=modal;
  pending.resolve({});await submitting;assert.equal(modal,nextModal);assert.equal(isOpen,true);
  await oldSubmit.onclick();assert.equal(writes().length,submitCount);
  console.log('Company access and approvals: authority, escaping, stale company, revocation and retry checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

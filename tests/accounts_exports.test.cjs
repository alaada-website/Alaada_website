const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','Accounts.html'),'utf8');
function source(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert(a>0&&b>a);return html.slice(a,b);}
const state={companyId:'a',companyGeneration:1,company:{id:'a',name:'Company A'},capabilities:{company_export:true,company_restore:false}};
let scope='alice/workspace-a',fetcher,save,download,cleared=[],messages=[],calls=[];
const sections=['account_groups','ledgers','voucher_types','financial_years','vouchers','journal_entries',
  'customers','suppliers','payment_transactions','item_categories','units_of_measure','warehouses',
  'stock_items','stock_ledger_entries','gst_tax_rates','tax_classifications','sales_invoices','purchase_bills',
  'accounting_dimensions','budgets','approval_rules','approval_requests','audit_logs'];
const payload=()=>({export_format:'alaada.accounts.appwrite.v1',company:{id:'a',name:'Company A'},
  ...Object.fromEntries(sections.map(key=>[key,[]])),
  manifest:{scope:'company-business-records',restore_supported:false,excluded:['access_memberships'],
    counts:Object.fromEntries(sections.map(key=>[key,0]))}});
const ctx=vm.createContext({STATE:state,BACKUP_DB:'backup',window:{AlaadaWorkspace:{databaseName:()=>scope}},
  api:async(p,o)=>{calls.push({p,o});return fetcher(p,o);},
  sameCompanyGeneration:(id,g)=>state.companyId===id&&state.companyGeneration===g,
  putLocalBackup:async(record,db)=>{save={record,db};},clearBackupNeeded:id=>cleared.push(id),
  saveBackupFile:async(p,f)=>{download={p,f};},toast:m=>messages.push(m),getLocalBackup:async()=>null,
  loadCompanies:async()=>{},selectCompany:async()=>{},console});
vm.runInContext(source('function backupFileName(','function openBackupDb(')+
  source('async function saveLocalCompanyBackup(','function arrayBufferToBase64(')+
  source('async function restoreLocalBackupToCloud(','/* ============================================================\n   TOASTS'),ctx);
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
  fetcher=async()=>payload();
  await ctx.saveLocalCompanyBackup({download:true});
  assert.equal(save.db,'alice/workspace-a');assert.equal(save.record.companyId,'a');assert.equal(download.p.company.id,'a');
  assert.deepEqual(cleared,['a']);assert.match(messages.at(-1),/Local data copy saved/);
  for(const switchScope of ['company','workspace']){
    const pending=defer();save=null;fetcher=()=>pending.promise;
    const saving=ctx.saveLocalCompanyBackup();
    if(switchScope==='company'){state.companyId='b';state.companyGeneration++;}else scope='bob/workspace-b';
    pending.resolve(payload());await assert.rejects(saving,/changed during export/);assert.equal(save,null);
    state.companyId='a';scope='alice/workspace-a';
  }
  fetcher=async()=>({...payload(),company:{id:'b'}});
  await assert.rejects(ctx.saveLocalCompanyBackup(),/different company/);assert.equal(save,null);
  fetcher=async()=>{const p=payload();p.manifest.counts.vouchers=1;return p;};
  await assert.rejects(ctx.saveLocalCompanyBackup(),/counts do not match/);assert.equal(save,null);
  fetcher=async()=>{const p=payload();delete p.manifest.counts.journal_entries;return p;};
  await assert.rejects(ctx.saveLocalCompanyBackup(),/manifest is incomplete/);assert.equal(save,null);
  const before=calls.length;
  await assert.rejects(ctx.restoreLocalBackupToCloud({payload:payload()}),/Cloud restore is not available/);
  assert.equal(calls.length,before);
  state.capabilities.company_export=false;await ctx.ensureLocalBackupForSelectedCompany();assert.equal(calls.length,before);
  state.capabilities.company_export=true;
  const existing=defer();ctx.getLocalBackup=()=>existing.promise;
  const checking=ctx.ensureLocalBackupForSelectedCompany();state.companyId='b';state.companyGeneration++;
  existing.resolve(null);await checking;assert.equal(calls.length,before);
  state.companyId='a';state.capabilities={};
  const legacy={...payload(),export_format:'alaada.company.v1'};delete legacy.manifest;
  assert.equal(ctx.validateBackupPayload(legacy).export_format,'alaada.company.v1');
  fetcher=async()=>({id:'a',name:'Restored'});ctx.saveLocalCompanyBackup=async()=>null;
  await ctx.restoreLocalBackupToCloud({payload:legacy});assert.equal(calls.at(-1).p,'/companies/import/json');
  console.log('Accounts exports: scoped persistence, stale responses, manifest checks and safe restore gating passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

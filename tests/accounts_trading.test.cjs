const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'..','Accounts.html'),'utf8').replace(/\r\n/g,'\n');
function section(a,b){const start=html.indexOf(a),end=html.indexOf(b,start);assert(start>=0&&end>start);return html.slice(start,end);}
const source=section('const tradingForms =','async function renderSalesReturns(')
  +section('async function renderPurchaseBills(','/* ============================================================\n   PURCHASE RETURNS')
  +section('function inventoryDecimal(','async function refreshCompanyAfterSave(')
  +section('function updateDocTotal(','function collectDocLines(')
  +section('async function apiAllItems(','const BACKUP_DB =');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const line=(quantity='1.005',price='1.00')=>{const values={'.dl-item':{value:'item'},'.dl-desc':{value:''},'.dl-qty':{value:quantity},'.dl-price':{value:price}};return {querySelector:key=>values[key]};};
const doc=(prefix,id='doc')=>({id,status:'DRAFT',invoice_number:'SI-'+id,bill_number:'PB-'+id,invoice_date:'2026-10-02',bill_date:'2026-10-02',customer_id:'party',supplier_id:'party',warehouse_id:'warehouse',total_amount:'3.02',lines:[]});
function setup(prefix='si'){
  const state={companyId:'a',companyGeneration:1,currentView:prefix==='si'?'sales-invoices':'purchase-bills',company:{base_currency:'INR'},
    stockItems:[{id:'item',uom_id:'uom',status:'ACTIVE'}],uoms:[{id:'uom',precision:6}],warehouses:[{id:'warehouse',status:'ACTIVE',name:'Warehouse'}],
    customers:[{id:'party',status:'ACTIVE',name:'Customer'}],suppliers:[{id:'party',status:'ACTIVE',name:'Supplier'}],ledgers:[{id:'ledger',status:'ACTIVE'}],
    loadStates:Object.fromEntries(['customers','suppliers','ledgers','stockItems','warehouses','uoms'].map(key=>[key,{status:'loaded'}]))};
  const nodes={},rows={},calls=[],messages=[],errors=[],lists={si:[doc('si')],pb:[doc('pb')]};
  let open=false,modal,modalIds=[],intercept;
  for(const p of ['si','pb']){nodes[p+'-table']={innerHTML:''};nodes[p+'-filter-status']={value:''};}
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ctx=vm.createContext({STATE:state,VIEW_RENDERERS:{},document:{getElementById:id=>nodes[id],querySelectorAll:selector=>rows[selector.split(' ')[0].slice(1)]||[]},
    sameCompanyGeneration:(id,g)=>id===state.companyId&&g===state.companyGeneration,requireCompany:()=>!!state.companyId,
    modalBackdrop:{classList:{contains:()=>open}},openModal:config=>{
      for(const id of modalIds)delete nodes[id];modalIds=[];open=true;modal=config;
      for(const match of (config.bodyHtml+config.footHtml).matchAll(/id="([^"]+)"/g)){modalIds.push(match[1]);nodes[match[1]]={value:'',innerHTML:'',textContent:'',disabled:false};}
      nodes['modal-title']={textContent:''};nodes['modal-foot']={innerHTML:''};config.onMount?.();
    },closeModal:()=>{open=false;},confirm:()=>true,toast:(m,t)=>messages.push(m),errToast:e=>errors.push(e.message),
    api:async(path,options={})=>{
      calls.push({path,options});const overridden=await intercept?.(path,options);if(overridden!==undefined)return overridden;
      const p=path.includes('/sales/')?'si':'pb';
      if(options.method==='POST')return doc(p);
      if(path.endsWith('/e-invoice'))throw Error('Not enabled');
      if(path.endsWith('/invoices')||path.endsWith('/bills')){const page=options.qs?.page||1;return {items:lists[p].slice((page-1)*100,page*100),meta:{total:lists[p].length}};}
      return doc(p,path.split('/').at(-1));
    },esc,money:String,fmtDate:String,customerName:()=>'<Customer>',supplierName:()=>'<Supplier>',warehouseName:()=>'<Warehouse>',itemName:()=>'<Item>',
    ledgerOptionsHtml:()=>'',docLinesTableHtml:id=>`<tbody id="${id}"></tbody>`,todayStr:()=> '2026-10-09',
    addDocLine:id=>{(rows[id]??=[]).push(line('',''));},refreshBalanceBeam:()=>{},view:()=>({innerHTML:''}),viewHead:()=>'',
    emptyState:(icon,title,message,button='')=>title+message+button,console,BigInt,Promise,Error,
  });
  vm.runInContext(source,ctx);
  const form=()=>{
    rows[prefix+'-lines-body']=[];
    ctx[prefix==='si'?'openSalesInvoiceForm':'openPurchaseBillForm']();
    rows[prefix+'-lines-body']=[line()];
    for(const field of ['date','customer','supplier','custledger','salesledger','supledger','purledger','wh','narr'])if(nodes[prefix+'-'+field])nodes[prefix+'-'+field].value=field==='date'?'2026-10-02':field==='narr'?'':field;
  };
  return {ctx,state,nodes,rows,calls,messages,errors,lists,form,modal:()=>modal,intercept:fn=>intercept=fn,
    writes:()=>calls.filter(call=>call.options.method==='POST'),close:()=>{open=false;}};
}
test('Trading quantities/prices stay exact, use unit precision and round each line HALF_EVEN',()=>{
  const e=setup();e.rows['si-lines-body']=[line('1.005','1.00'),line('2.015','1.00')];e.nodes['si-total']={};
  assert.equal(e.ctx.updateDocTotal('si-lines-body','si-total'),'3.02');
  e.rows['si-lines-body']=[line('1','90071992547409.93')];
  assert.equal(e.ctx.collectTradingLines('si-lines-body','unit_price')[0].unit_price,'90071992547409.93');
  assert.equal(e.ctx.updateDocTotal('si-lines-body','si-total'),'90071992547409.93');
  for(const [q,p] of [['0','1'],['-1','1'],['1.0000001','1'],['1','1.001'],['1e3','1'],['1',''],['1','NaN']]){
    e.rows['si-lines-body']=[line(q,p)];assert.throws(()=>e.ctx.collectTradingLines('si-lines-body','unit_price'));
  }
  e.rows['si-lines-body']=[line('1.0000000','2.0100')];assert.equal(e.ctx.updateDocTotal('si-lines-body','si-total'),'2.01');
  e.rows['si-lines-body']=[line('2','9999999999999999.99')];assert.throws(()=>e.ctx.collectTradingLines('si-lines-body','unit_price'),/exceeds/);
  e.rows['si-lines-body']=Array.from({length:41},()=>line());assert.throws(()=>e.ctx.collectTradingLines('si-lines-body','unit_price'),/40/);
  e.state.uoms[0].precision=0;e.rows['si-lines-body']=[line('1.5','1')];assert.throws(()=>e.ctx.collectTradingLines('si-lines-body','unit_price'),/precision/);
});
for(const prefix of ['si','pb']){
  const submit=prefix==='si'?'submitSalesInvoiceForm':'submitPurchaseBillForm';
  const load=prefix==='si'?'loadSalesInvoiceTable':'loadPurchaseBillTable';
  const detail=prefix==='si'?'openSalesInvoiceDetail':'openPurchaseBillDetail';
  const post=prefix==='si'?'postSalesInvoiceAction':'postPurchaseBillAction';
  test(prefix+' save is single-flight and does not overwrite a new company/modal',async()=>{
    const e=setup(prefix);e.form();const pending=deferred();e.intercept((path,o)=>o.method?pending.promise:undefined);
    const saving=e.ctx[submit]();await e.ctx[submit]();assert.equal(e.writes().length,1);
    assert.equal(typeof e.writes()[0].options.body.lines[0].quantity,'string');
    e.state.companyId='b';e.state.companyGeneration++;pending.resolve(doc(prefix));await saving;
    assert.equal(e.messages.length,0);await e.ctx[submit]();assert.equal(e.writes().length,1);
    const again=setup(prefix);again.form();const blocked=deferred();again.intercept((path,o)=>o.method?blocked.promise:undefined);
    const old=again.ctx[submit]();again.form();const newButton=again.nodes[prefix+'-save'];blocked.reject(Error('old request failed'));await old;
    assert.equal(newButton.disabled,false);assert.equal(again.errors.length,0);
  });
  test(prefix+' list paginates and ignores superseded or cross-company responses',async()=>{
    const e=setup(prefix);e.lists[prefix]=Array.from({length:201},(_,i)=>({...doc(prefix,'n'+i),invoice_number:'<x>'+i,bill_number:'<x>'+i}));
    await e.ctx[load]();assert.match(e.nodes[prefix+'-table'].innerHTML,/n200/);assert.match(e.nodes[prefix+'-table'].innerHTML,/&lt;x&gt;/);
    const pending=deferred();let first=true;e.intercept(()=>{if(first){first=false;return pending.promise;}});
    const old=e.ctx[load]();await e.ctx[load]();const fresh=e.nodes[prefix+'-table'].innerHTML;
    pending.reject(Error('old failure'));await old;assert.equal(e.nodes[prefix+'-table'].innerHTML,fresh);
    const wait=deferred();e.intercept(()=>wait.promise);const stale=e.ctx[load]();e.state.companyId='b';e.state.companyGeneration++;
    wait.resolve({items:[doc(prefix,'PRIVATE')],meta:{total:1}});await stale;assert.doesNotMatch(e.nodes[prefix+'-table'].innerHTML,/PRIVATE/);
  });
  test(prefix+' detail and post keep their original company and retry key',async()=>{
    const e=setup(prefix);await e.ctx[detail]('doc');assert.match(e.nodes['modal-foot'].innerHTML,/Request approval/);
    const pending=deferred();e.intercept((path,o)=>o.method?pending.promise:undefined);
    const posting=e.ctx[post]('doc');await e.ctx[post]('doc');assert.equal(e.writes().length,1);
    pending.reject(Error('Connection failed'));await posting;const first=e.writes()[0].options.headers['Idempotency-Key'];
    e.intercept((path,o)=>o.method?Promise.reject(Error('Connection failed')):undefined);
    await e.ctx[post]('doc');assert.equal(e.writes()[1].options.headers['Idempotency-Key'],first);
    e.state.companyId='b';e.state.companyGeneration++;await e.ctx[post]('doc');assert.equal(e.writes().length,2);
    const later=setup(prefix),wait=deferred();later.intercept(()=>wait.promise);const opening=later.ctx[detail]('old');
    later.form();const title=later.nodes['modal-title'].textContent;wait.resolve(doc(prefix,'PRIVATE'));await opening;
    assert.equal(later.nodes['modal-title'].textContent,title);assert.equal(later.errors.length,0);
  });
  test(prefix+' partial invalid rows block writes instead of being silently dropped',async()=>{
    const e=setup(prefix);e.form();e.rows[prefix+'-lines-body']=[line(),line('0','1')];await e.ctx[submit]();
    assert.equal(e.writes().length,0);assert.equal(e.errors.length,1);
    e.state.loadStates.uoms.status='failed';e.close();e.form();assert.match(e.messages.at(-1),/Load the company masters/);
  });
}

/* Missing financial-report access and compliance-state clarity. */
(() => {
  "use strict";
  const A = window.AccountsEnterprise;

  A.addGroup("Advanced Reports", [
    {view:"report-general-ledger", label:"General Ledger", path:"M5 5h14v14H5zM8 9h8M8 13h8M8 17h5"},
    {view:"report-cash-flow", label:"Cash Flow", path:"M4 18h16M7 15l3-4 3 2 4-6"},
  ], "Enterprise");
  A.register("report-general-ledger", renderGeneralLedger);
  A.register("report-cash-flow", renderCashFlow);

  async function renderGeneralLedger() {
    if (!A.requireCompany()) return;
    await A.ensureLedgers();
    view().innerHTML = viewHead("General Ledger", "Opening balance, posted journal movement, running balance, and voucher drill-down.") +
      `<section class="enterprise-panel"><div class="enterprise-fields">
        <div class="form-row"><label>Ledger</label><select id="gl-ledger">${A.ledgerOptions()}</select></div>
        <div class="form-row"><label>From</label><input type="date" id="gl-from" value="${new Date().getFullYear()}-01-01"></div>
        <div class="form-row"><label>To</label><input type="date" id="gl-to" value="${todayStr()}"></div>
        <div class="enterprise-actions"><button class="btn btn-blue" onclick="AccountsReports.loadGeneralLedger()" ${STATE.ledgers.length?"":"disabled"}>Run report</button></div>
      </div></section><div id="gl-body"><div class="enterprise-empty">${STATE.ledgers.length?"Choose a ledger and run the report.":"Create a ledger before running the general ledger report."}</div></div>`;
  }

  async function loadGeneralLedger() {
    const ledgerId=A.formValue("gl-ledger");
    if(!ledgerId)return toast("Create or select a ledger first","err");
    const root=document.getElementById("gl-body");root.innerHTML=A.panel("Calculating",'<span class="spin"></span> Loading ledger entries…');
    try{
      const report=await api(`/companies/${STATE.companyId}/reports/general-ledger/${ledgerId}`,{qs:{date_from:A.formValue("gl-from"),date_to:A.formValue("gl-to")}});
      root.innerHTML=`<div class="enterprise-grid">${A.metric("Ledger",report.ledger_name)}${A.metric("Opening",money(report.opening_balance,STATE.company.base_currency))}${A.metric("Closing",money(report.closing_balance,STATE.company.base_currency))}${A.metric("Entries",report.entries.length)}</div>${A.panel("Posted movements",A.rows(report.entries,[
        {label:"Date",render:row=>fmtDate(row.date||row.entry_date)},{label:"Voucher",render:row=>`<span class="enterprise-code">${esc(row.voucher_number||row.voucher_id||"Journal")}</span>`},
        {label:"Narration",key:"narration"},{label:"Debit",num:true,render:row=>money(row.debit,STATE.company.base_currency)},{label:"Credit",num:true,render:row=>money(row.credit,STATE.company.base_currency)},{label:"Balance",num:true,render:row=>`<b>${money(row.running_balance,STATE.company.base_currency)}</b>`}
      ],"No posted movements in this period."))}`;
    }catch(error){root.innerHTML=emptyState("⚠","Could not run general ledger",esc(error.message))}
  }

  function renderCashFlow() {
    if (!A.requireCompany()) return;
    view().innerHTML=viewHead("Cash Flow","Operating, investing, and financing cash movement reconciled to cash and bank ledgers.")+
      `<section class="enterprise-panel"><div class="enterprise-fields">
        <div class="form-row"><label>From</label><input type="date" id="cf-from" value="${new Date().getFullYear()}-01-01"></div>
        <div class="form-row"><label>To</label><input type="date" id="cf-to" value="${todayStr()}"></div>
        <div class="enterprise-actions"><button class="btn btn-blue" onclick="AccountsReports.loadCashFlow()">Run report</button></div>
      </div></section><div id="cf-body"><div class="enterprise-empty">Choose a period and run the report.</div></div>`;
  }

  async function loadCashFlow() {
    const root=document.getElementById("cf-body");root.innerHTML=A.panel("Calculating",'<span class="spin"></span> Classifying cash movement…');
    try{
      const report=await api(`/companies/${STATE.companyId}/reports/cash-flow`,{qs:{date_from:A.formValue("cf-from"),date_to:A.formValue("cf-to")}});
      root.innerHTML=`<div class="enterprise-grid">${A.metric("Opening cash",money(report.opening_cash,STATE.company.base_currency))}${A.metric("Net change",money(report.net_cash_change,STATE.company.base_currency))}${A.metric("Closing cash",money(report.closing_cash,STATE.company.base_currency))}${A.metric("Reconciled",report.is_reconciled?"Yes":"No")}</div>
      ${A.panel("Cash-flow sections",`<div class="enterprise-grid" style="margin:0;">${A.metric("Operating",money(report.sections.OPERATING,STATE.company.base_currency))}${A.metric("Investing",money(report.sections.INVESTING,STATE.company.base_currency))}${A.metric("Financing",money(report.sections.FINANCING,STATE.company.base_currency))}</div>`)}
      ${A.panel("Movement detail",A.rows(report.rows,[
        {label:"Date",render:row=>fmtDate(row.date)},{label:"Section",render:row=>A.status(row.section)},{label:"Narration",key:"narration"},{label:"Cash movement",num:true,render:row=>money(row.net_cash_movement,STATE.company.base_currency)}
      ],"No cash movement in this period."))}
      ${report.is_reconciled?"":'<div class="enterprise-notice danger"><b>Reconciliation warning:</b> opening cash plus classified movement does not equal closing cash. Review cash/bank ledger mappings.</div>'}`;
    }catch(error){root.innerHTML=emptyState("⚠","Could not run cash flow",esc(error.message))}
  }

  const originalCompliance=VIEW_RENDERERS["gst-compliance"];
  if(originalCompliance){
    VIEW_RENDERERS["gst-compliance"]=async function(){
      await originalCompliance();
      const root=view();
      root.insertAdjacentHTML("afterbegin",`<div class="enterprise-notice info"><b>Compliance record status:</b> reports, validations, e-invoices, and e-way bills shown here are Alaada internal records unless a configured provider returns a government acknowledgement. “Generated” never means “filed”. Provider submission errors and cancellations remain visible in record status.</div>`);
    };
  }

  window.AccountsReports={loadGeneralLedger,loadCashFlow};
})();

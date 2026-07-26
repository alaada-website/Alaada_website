/* Banking, credit-control, and inventory-operation interfaces. */
(() => {
  "use strict";
  const A = window.AccountsEnterprise;

  A.addGroup("Banking & Control", [
    {view:"banking", label:"Bank Reconciliation", path:"M5 8h14M7 8v9m5-9v9m5-9v9M4 20h16"},
    {view:"receivables", label:"Receivables", path:"M8 12h8m-4-4v8"},
    {view:"payables", label:"Payables", path:"M8 12h8"},
  ], "Reports");
  A.addGroup("Inventory Control", [
    {view:"inventory-operations", label:"Stock Operations", path:"M4 7l8-4 8 4-8 4-8-4m0 0v10l8 4 8-4V7"},
  ], "GST");

  A.register("banking", renderBanking);
  A.register("receivables", () => renderCreditControl("customer"));
  A.register("payables", () => renderCreditControl("supplier"));
  A.register("inventory-operations", renderInventoryOperations);

  async function renderBanking() {
    if (!A.requireCompany()) return;
    view().innerHTML = viewHead("Bank Reconciliation", "Import statements, review every line, match vouchers, post controlled adjustments, and reconcile.") +
      `<div id="banking-body">${A.panel("Loading", '<span class="spin"></span> Loading banking workspace…')}</div>`;
    try {
      await A.ensureLedgers();
      const statements = A.page(await api(`/companies/${STATE.companyId}/bank-statements`, {qs:{page_size:100}}));
      const banks = STATE.ledgers.filter(item => item.cash_bank_type === "BANK");
      const imported = statements.filter(item => item.status === "IMPORTED").length;
      const reconciled = statements.filter(item => item.status === "RECONCILED").length;
      document.getElementById("banking-body").innerHTML =
        `<div class="enterprise-grid">${A.metric("Bank accounts", banks.length)}${A.metric("Statements", statements.length)}${A.metric("Awaiting reconciliation", imported)}${A.metric("Reconciled", reconciled)}</div>
        ${A.panel("Statement register",
          A.rows(statements, [
            {label:"Statement", render:item=>`<button class="row-link" onclick="AccountsBanking.openStatement('${esc(item.id)}')">${esc(item.statement_number)}</button>`},
            {label:"Account", render:item=>esc(STATE.ledgers.find(ledger=>ledger.id===item.bank_ledger_id)?.name || "Bank ledger")},
            {label:"Period", render:item=>`${fmtDate(item.period_start)} – ${fmtDate(item.period_end)}`},
            {label:"Closing", num:true, render:item=>money(item.closing_balance, STATE.company.base_currency)},
            {label:"Status", render:item=>A.status(item.status)},
            {label:"", render:item=>`<div class="enterprise-row-actions"><button class="btn btn-ghost btn-sm" onclick="AccountsBanking.openStatement('${esc(item.id)}')">Review</button><button class="btn btn-teal btn-sm" onclick="AccountsBanking.autoMatch('${esc(item.id)}')">Auto-match</button></div>`},
          ], "No statements have been imported."),
          `<button class="btn btn-blue btn-sm" onclick="AccountsBanking.openImport()">Import CSV</button>`)}
        <div class="enterprise-notice info"><b>Safe reconciliation:</b> imported lines never change accounting entries by themselves. Manual matches select an existing voucher; bank-charge and interest adjustments create auditable vouchers only after confirmation.</div>`;
    } catch (error) {
      document.getElementById("banking-body").innerHTML = emptyState("⚠", "Could not load banking", esc(error.message), `<button class="btn btn-ghost" onclick="navigate('banking')">Retry</button>`);
    }
  }

  async function openStatement(statementId) {
    openModal({title:"Statement review", wide:true, bodyHtml:`<div id="statement-review"><span class="spin"></span> Loading…</div>`, footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`});
    try {
      const [statement, summary, matches] = await Promise.all([
        api(`/companies/${STATE.companyId}/bank-statements/${statementId}`),
        api(`/companies/${STATE.companyId}/bank-statements/${statementId}/summary`),
        api(`/companies/${STATE.companyId}/bank-statements/${statementId}/matches`),
      ]);
      const matchByLine = new Map(matches.map(match => [match.statement_line_id, match]));
      document.getElementById("statement-review").innerHTML =
        `<div class="enterprise-grid">${A.metric("Opening", money(statement.opening_balance, STATE.company.base_currency))}${A.metric("Closing", money(statement.closing_balance, STATE.company.base_currency))}${A.metric("Matched", summary.matched_lines ?? matches.length)}${A.metric("Unmatched", summary.unmatched_lines ?? statement.lines.filter(line=>line.status==="UNMATCHED").length)}</div>
        <div class="enterprise-notice">${esc(statement.source_file_name || "Manually entered statement")} · ${fmtDate(statement.period_start)} – ${fmtDate(statement.period_end)} · ${A.status(statement.status)}</div>
        ${A.rows(statement.lines, [
          {label:"Date", render:line=>fmtDate(line.transaction_date)},
          {label:"Description", render:line=>`<b>${esc(line.description)}</b><div class="enterprise-code">${esc(line.reference_number || "")}</div>`},
          {label:"Amount", num:true, render:line=>money(line.amount, STATE.company.base_currency)},
          {label:"Status", render:line=>A.status(line.status)},
          {label:"Match", render:line=>matchByLine.has(line.id) ? `<span class="enterprise-code">${esc(matchByLine.get(line.id).match_type)}</span>` : `<div class="enterprise-row-actions"><button class="btn btn-ghost btn-sm" onclick="AccountsBanking.openManualMatch('${esc(statement.id)}','${esc(line.id)}')">Match</button><button class="btn btn-ghost btn-sm" onclick="AccountsBanking.openAdjustment('${esc(statement.id)}','${esc(line.id)}')">Adjust</button></div>`},
        ])}`;
    } catch (error) {
      document.getElementById("statement-review").innerHTML = emptyState("⚠", "Could not load statement", esc(error.message));
    }
  }

  async function autoMatch(statementId) {
    if (!await A.confirm({title:"Run automatic matching?", message:"Alaada will compare unmatched statement lines with posted vouchers within a three-day tolerance. No new accounting entry is created.", confirmLabel:"Run auto-match"})) return;
    try {
      const matches = await api(`/companies/${STATE.companyId}/bank-statements/${statementId}/auto-match`, {method:"POST", qs:{date_tolerance_days:3}});
      toast(`${matches.length} statement line${matches.length===1?"":"s"} matched`, "ok");
      await openStatement(statementId);
    } catch (error) { errToast(error); }
  }

  async function openManualMatch(statementId, lineId) {
    let vouchers = [];
    try { vouchers = A.page(await api(`/companies/${STATE.companyId}/vouchers`, {qs:{status:"POSTED", page_size:100}})); }
    catch (error) { return errToast(error); }
    openModal({
      title:"Match statement line",
      bodyHtml:`<div class="enterprise-notice info">Select one existing posted voucher. This does not create or edit a voucher.</div>
        <div class="form-row"><label>Posted voucher</label><select id="bank-match-voucher">${vouchers.map(item=>`<option value="${esc(item.id)}">${esc(item.voucher_number)} · ${fmtDate(item.date)} · ${money(item.total_debit || item.total_amount || 0, STATE.company.base_currency)}</option>`).join("")}</select></div>
        <div class="form-row"><label>Review note</label><textarea id="bank-match-note" rows="3"></textarea></div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="bank-match-save" ${vouchers.length?"":"disabled"}>Confirm match</button>`,
      onMount:() => document.getElementById("bank-match-save").onclick = async () => {
        try {
          await api(`/companies/${STATE.companyId}/bank-statements/${statementId}/lines/${lineId}/match`, {method:"POST", body:{voucher_id:A.formValue("bank-match-voucher"), notes:A.formValue("bank-match-note") || null}});
          closeModal(); toast("Statement line matched", "ok"); await openStatement(statementId);
        } catch (error) { errToast(error); }
      }
    });
  }

  async function openAdjustment(statementId, lineId) {
    await A.ensureLedgers();
    openModal({
      title:"Create bank adjustment",
      bodyHtml:`<div class="enterprise-notice danger"><b>Accounting action.</b> This creates and posts an auditable adjustment voucher after confirmation.</div>
        <div class="form-row"><label>Adjustment type</label><select id="bank-adjust-type"><option value="BANK_CHARGE">Bank charge</option><option value="INTEREST_INCOME">Interest income</option></select></div>
        <div class="form-row"><label>Counterparty ledger</label><select id="bank-adjust-ledger">${A.ledgerOptions(ledger=>ledger.status==="ACTIVE")}</select></div>
        <div class="form-row"><label>Notes</label><textarea id="bank-adjust-note" rows="3"></textarea></div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-red" id="bank-adjust-save">Review and post</button>`,
      onMount:() => document.getElementById("bank-adjust-save").onclick = async () => {
        if (!await A.confirm({title:"Post bank adjustment?", message:"A voucher will be posted for this statement amount and linked to the selected line.", confirmLabel:"Post adjustment", danger:true})) return;
        try {
          await api(`/companies/${STATE.companyId}/bank-statements/${statementId}/adjustments`, {method:"POST", body:{statement_line_id:lineId, adjustment_type:A.formValue("bank-adjust-type"), counterparty_ledger_id:A.formValue("bank-adjust-ledger"), notes:A.formValue("bank-adjust-note") || null}});
          closeModal(); toast("Adjustment posted and statement line reconciled", "ok"); await openStatement(statementId);
        } catch (error) { errToast(error); }
      }
    });
  }

  async function openImport() {
    await A.ensureLedgers();
    const banks = STATE.ledgers.filter(ledger => ledger.cash_bank_type === "BANK" && ledger.status === "ACTIVE");
    openModal({
      title:"Import bank statement CSV", wide:true,
      bodyHtml:`<div class="enterprise-notice info">Preview the selected file details below. Import creates statement lines only; it does not post accounting entries.</div>
        <div class="enterprise-fields">
          <div class="form-row"><label>Bank account</label><select id="bank-import-ledger">${banks.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select></div>
          <div class="form-row"><label>Statement number</label><input id="bank-import-number" placeholder="JUL-2026"></div>
          <div class="form-row"><label>Period start</label><input type="date" id="bank-import-start"></div>
          <div class="form-row"><label>Period end</label><input type="date" id="bank-import-end" value="${todayStr()}"></div>
          <div class="form-row"><label>Opening balance</label><input type="number" step="0.01" id="bank-import-opening" value="0"></div>
          <div class="form-row"><label>Closing balance</label><input type="number" step="0.01" id="bank-import-closing" value="0"></div>
          <div class="form-row full"><label>CSV file</label><input type="file" id="bank-import-file" accept=".csv,text/csv"><small>Columns: date, description, amount — or debit and credit. Optional: reference, balance.</small></div>
        </div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="bank-import-save" ${banks.length?"":"disabled"}>Import statement</button>`,
      onMount:() => document.getElementById("bank-import-save").onclick = submitImport
    });
  }

  async function submitImport() {
    const file = document.getElementById("bank-import-file").files[0];
    if (!file || !A.formValue("bank-import-number") || !A.formValue("bank-import-start")) return toast("Choose a CSV and complete the statement details", "err");
    const formData = new FormData(); formData.append("file", file);
    try {
      await api(`/companies/${STATE.companyId}/bank-statements/import-csv`, {method:"POST", formData, qs:{
        bank_ledger_id:A.formValue("bank-import-ledger"), statement_number:A.formValue("bank-import-number"),
        period_start:A.formValue("bank-import-start"), period_end:A.formValue("bank-import-end"),
        opening_balance:A.numberValue("bank-import-opening"), closing_balance:A.numberValue("bank-import-closing"),
      }});
      closeModal(); toast("Bank statement imported for review", "ok"); navigate("banking");
    } catch (error) { errToast(error); }
  }

  async function renderCreditControl(kind) {
    if (!A.requireCompany()) return;
    const customer = kind === "customer";
    const title = customer ? "Receivables & Collections" : "Payables & Supplier Aging";
    view().innerHTML = viewHead(title, customer ? "Aging, overdue invoices, credit limits, reminders, and collection activity." : "Supplier aging, open payables, credits, and settlement visibility.") +
      `<div id="credit-body">${A.panel("Loading", '<span class="spin"></span> Loading balances…')}</div>`;
    try {
      const calls = customer ? [
        api(`/companies/${STATE.companyId}/credit-control/customer-ageing`),
        api(`/companies/${STATE.companyId}/credit-control/overdue-invoices`),
        api(`/companies/${STATE.companyId}/credit-control/credit-limits`),
        api(`/companies/${STATE.companyId}/credit-control/reminders`, {qs:{page_size:100}}),
        api(`/companies/${STATE.companyId}/credit-control/collections`, {qs:{page_size:100}}),
      ] : [
        api(`/companies/${STATE.companyId}/credit-control/supplier-ageing`),
        Promise.resolve([]), Promise.resolve([]), Promise.resolve({items:[]}),
        api(`/companies/${STATE.companyId}/credit-control/settlements`, {qs:{settlement_kind:"PAYABLE", page_size:100}}),
      ];
      const [aging, overdue, limits, reminders, activity] = await Promise.all(calls);
      const total = aging.reduce((sum,row)=>sum+Number(row.total_outstanding||0),0);
      const over90 = aging.reduce((sum,row)=>sum+Number(row.days_over_90||0),0);
      document.getElementById("credit-body").innerHTML =
        `<div class="enterprise-grid">${A.metric("Outstanding", money(total, STATE.company.base_currency))}${A.metric("Over 90 days", money(over90, STATE.company.base_currency))}${A.metric(customer?"Overdue documents":"Suppliers", customer?overdue.length:aging.length)}${A.metric(customer?"Open collection actions":"Settlement records", A.page(activity).length)}</div>
        ${A.panel("Aging by party", A.rows(aging, [
          {label:customer?"Customer":"Supplier", render:row=>`<b>${esc(row.party_name)}</b>`},
          {label:"Current", num:true, render:row=>money(row.current, STATE.company.base_currency)},
          {label:"1–30", num:true, render:row=>money(row.days_1_30, STATE.company.base_currency)},
          {label:"31–60", num:true, render:row=>money(row.days_31_60, STATE.company.base_currency)},
          {label:"61–90", num:true, render:row=>money(row.days_61_90, STATE.company.base_currency)},
          {label:"90+", num:true, render:row=>money(row.days_over_90, STATE.company.base_currency)},
          {label:"Total", num:true, render:row=>`<b>${money(row.total_outstanding, STATE.company.base_currency)}</b>`},
        ]))}
        ${customer ? A.panel("Overdue documents", A.rows(overdue, [
          {label:"Document", render:row=>`<b>${esc(row.document_number)}</b><div class="enterprise-code">${esc(row.document_type)}</div>`},
          {label:"Customer", key:"party_name"}, {label:"Due", render:row=>fmtDate(row.due_date)},
          {label:"Days", num:true, key:"days_overdue"}, {label:"Outstanding", num:true, render:row=>money(row.outstanding_amount, STATE.company.base_currency)},
          {label:"Reminder", render:row=>A.status(row.reminder_status || "NOT_SET")},
        ]), `<button class="btn btn-blue btn-sm" onclick="AccountsBanking.openReminder()">New reminder</button><button class="btn btn-ghost btn-sm" onclick="AccountsBanking.openCollection()">Log collection</button>`) : ""}
        ${customer ? A.panel("Credit limits", A.rows(limits, [
          {label:"Customer", key:"customer_name"}, {label:"Limit", num:true, render:row=>money(row.credit_limit,STATE.company.base_currency)},
          {label:"Used", num:true, render:row=>`${Number(row.credit_used_percent||0).toFixed(1)}%`}, {label:"Available", num:true, render:row=>money(row.available_credit,STATE.company.base_currency)}, {label:"Status", render:row=>A.status(row.status)}
        ])) : A.panel("Settlement history", A.rows(A.page(activity), [
          {label:"Type", key:"target_document_type"}, {label:"Amount", num:true, render:row=>money(row.amount,STATE.company.base_currency)}, {label:"Created", render:row=>fmtDate(row.created_at)}
        ]))}`;
    } catch (error) {
      document.getElementById("credit-body").innerHTML = emptyState("⚠", "Could not load credit control", esc(error.message));
    }
  }

  async function openReminder() {
    const overdue = await api(`/companies/${STATE.companyId}/credit-control/overdue-invoices`);
    openModal({
      title:"Create payment reminder",
      bodyHtml:`<div class="form-row"><label>Overdue document</label><select id="reminder-document">${overdue.map(row=>`<option value="${esc(row.document_id)}" data-customer="${esc(row.party_id)}" data-type="${esc(row.document_type)}">${esc(row.document_number)} · ${esc(row.party_name)} · ${money(row.outstanding_amount,STATE.company.base_currency)}</option>`).join("")}</select></div>
      <div class="form-row"><label>Next follow-up</label><input type="date" id="reminder-date"></div><div class="form-row"><label>Internal note</label><textarea id="reminder-note"></textarea></div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="reminder-save" ${overdue.length?"":"disabled"}>Create reminder</button>`,
      onMount:()=>document.getElementById("reminder-save").onclick=async()=>{
        const option=document.getElementById("reminder-document").selectedOptions[0];
        try{await api(`/companies/${STATE.companyId}/credit-control/reminders`,{method:"POST",body:{customer_id:option.dataset.customer,document_type:option.dataset.type,document_id:option.value,status:"READY",next_follow_up_date:A.formValue("reminder-date")||null,note:A.formValue("reminder-note")||null}});closeModal();toast("Payment reminder created","ok");navigate("receivables")}catch(error){errToast(error)}
      }
    });
  }

  async function openCollection() {
    if (!STATE.customers?.length) STATE.customers=A.page(await api(`/companies/${STATE.companyId}/customers`,{qs:{page_size:200}}));
    openModal({
      title:"Log collection activity",
      bodyHtml:`<div class="form-row"><label>Customer</label><select id="collection-customer">${STATE.customers.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("")}</select></div>
      <div class="form-row"><label>Activity</label><select id="collection-type"><option value="CALL">Call</option><option value="EMAIL">Email</option><option value="MEETING">Meeting</option><option value="PROMISE_TO_PAY">Promise to pay</option></select></div>
      <div class="form-grid"><div class="form-row"><label>Date</label><input type="date" id="collection-date" value="${todayStr()}"></div><div class="form-row"><label>Amount discussed</label><input type="number" step="0.01" id="collection-amount"></div></div>
      <div class="form-row"><label>Notes</label><textarea id="collection-notes"></textarea></div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="collection-save">Save activity</button>`,
      onMount:()=>document.getElementById("collection-save").onclick=async()=>{
        try{await api(`/companies/${STATE.companyId}/credit-control/collections`,{method:"POST",body:{customer_id:A.formValue("collection-customer"),activity_type:A.formValue("collection-type"),activity_date:A.formValue("collection-date"),amount:A.formValue("collection-amount")?A.numberValue("collection-amount"):null,status:"OPEN",notes:A.formValue("collection-notes")||null}});closeModal();toast("Collection activity logged","ok");navigate("receivables")}catch(error){errToast(error)}
      }
    });
  }

  async function renderInventoryOperations() {
    if (!A.requireCompany()) return;
    view().innerHTML = viewHead("Stock Operations", "Warehouse-wise stock, valuation indicators, reorder exposure, and item movement history.") +
      `<div id="inventory-ops-body">${A.panel("Loading", '<span class="spin"></span> Loading stock…')}</div>`;
    try {
      if (!STATE.stockItems?.length) STATE.stockItems=A.page(await api(`/companies/${STATE.companyId}/inventory/items`,{qs:{page_size:200}}));
      const stock = await api(`/companies/${STATE.companyId}/inventory/current-stock`);
      const totalQty=stock.reduce((sum,row)=>sum+Number(row.quantity||0),0);
      const low=stock.filter(row=>row.is_low_stock);
      const warehouses=new Set(stock.map(row=>row.warehouse_id)).size;
      document.getElementById("inventory-ops-body").innerHTML =
        `<div class="enterprise-grid">${A.metric("Stock positions",stock.length)}${A.metric("Warehouses",warehouses)}${A.metric("Total units",totalQty.toLocaleString("en-IN"))}${A.metric("Below reorder",low.length)}</div>
        ${A.panel("Warehouse-wise stock",A.rows(stock,[
          {label:"Item",render:row=>`<b>${esc(row.item_name)}</b><div class="enterprise-code">${esc(row.sku||"")}</div>`},
          {label:"Warehouse",key:"warehouse_name"},{label:"Quantity",num:true,key:"quantity"},{label:"Reorder",num:true,key:"reorder_level"},
          {label:"Health",render:row=>A.status(row.is_low_stock?"REORDER":"HEALTHY")},
          {label:"",render:row=>`<button class="btn btn-ghost btn-sm" onclick="AccountsBanking.openStockHistory('${esc(row.item_id)}','${esc(row.item_name)}')">Movement history</button>`}
        ],"No stock positions exist."),`<button class="btn btn-blue btn-sm" onclick="navigate('inventory-items')">Record movement</button>`)}
        <div class="enterprise-notice info">Stock valuation is driven by the item valuation method and posted movements. Opening stock and adjustments are available from each item’s detail page; trade-document posting writes stock and accounting records together.</div>`;
    } catch(error){document.getElementById("inventory-ops-body").innerHTML=emptyState("⚠","Could not load stock operations",esc(error.message))}
  }

  async function openStockHistory(itemId,itemName){
    openModal({title:`Movement history · ${itemName}`,wide:true,bodyHtml:`<div id="stock-history"><span class="spin"></span> Loading…</div>`,footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`});
    try{const rows=await api(`/companies/${STATE.companyId}/inventory/items/${itemId}/stock-ledger`);document.getElementById("stock-history").innerHTML=A.rows(rows,[
      {label:"Date",render:row=>fmtDate(row.movement_date||row.date)},{label:"Type",render:row=>A.status(row.movement_type)},{label:"Warehouse",key:"warehouse_name"},
      {label:"In",num:true,key:"quantity_in"},{label:"Out",num:true,key:"quantity_out"},{label:"Balance",num:true,key:"balance_quantity"},{label:"Reference",key:"reference_number"}
    ],"No movements for this item.")}catch(error){document.getElementById("stock-history").innerHTML=emptyState("⚠","Could not load movements",esc(error.message))}
  }

  window.AccountsBanking = {openStatement,autoMatch,openManualMatch,openAdjustment,openImport,openReminder,openCollection,openStockHistory};
})();

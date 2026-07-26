/* Budgets, control modes, close checklist, period lock, and recurring links. */
(() => {
  "use strict";
  const A = window.AccountsEnterprise;

  A.addGroup("Planning & Close", [
    {view:"budgets-close", label:"Budgets & Close", path:"M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"},
  ], "Reports");
  A.register("budgets-close", renderBudgetsClose);

  async function renderBudgetsClose() {
    if (!A.requireCompany()) return;
    view().innerHTML = viewHead("Budgets & Financial Close", "Budget control, actual-versus-budget, close checklist, period locking, audited reopen, and recurring accounting.",
      `<button class="btn btn-ghost btn-sm" onclick="navigate('automation')">Recurring history</button><button class="btn btn-blue btn-sm" onclick="AccountsClose.openBudgetForm()">New budget</button>`) +
      `<div id="close-body">${A.panel("Loading", '<span class="spin"></span> Loading planning controls…')}</div>`;
    try {
      await A.ensureLedgers();
      const [budgets, years, tasks] = await Promise.all([
        api(`/companies/${STATE.companyId}/accounting/budgets`),
        api(`/companies/${STATE.companyId}/financial-years`),
        api(`/companies/${STATE.companyId}/close/tasks`),
      ]);
      STATE.financialYears = years;
      const openTasks=tasks.filter(task=>task.status==="OPEN");
      const activeBudgets=budgets.filter(item=>item.status==="ACTIVE");
      document.getElementById("close-body").innerHTML =
        `<div class="enterprise-grid">${A.metric("Budgets",budgets.length)}${A.metric("Active controls",activeBudgets.length)}${A.metric("Open close tasks",openTasks.length)}${A.metric("Locked years",years.filter(year=>year.is_closed).length)}</div>
        ${A.panel("Budgets",A.rows(budgets,[
          {label:"Budget",render:item=>`<button class="row-link" onclick="AccountsClose.openVariance('${esc(item.id)}')"><b>${esc(item.name)}</b></button><div class="enterprise-code">${esc(item.budget_code)}</div>`},
          {label:"Period",render:item=>`${fmtDate(item.period_start)} – ${fmtDate(item.period_end)}`},
          {label:"Lines",num:true,render:item=>item.lines?.length||0},
          {label:"Control",render:item=>A.status(item.control_mode)},
          {label:"Status",render:item=>A.status(item.status)},
          {label:"",render:item=>`<div class="enterprise-row-actions"><button class="btn btn-ghost btn-sm" onclick="AccountsClose.openVariance('${esc(item.id)}')">Variance</button>${item.status==="DRAFT"?`<button class="btn btn-teal btn-sm" onclick="AccountsClose.setBudget('${esc(item.id)}','ACTIVE')">Activate</button>`:""}</div>`},
        ],"No budgets have been created."))}
        <div class="enterprise-split">
          ${A.panel("Close checklist",A.rows(tasks,[
            {label:"Task",render:task=>`<b>${esc(task.title)}</b><div class="enterprise-code">${esc(task.task_code)}</div>`},
            {label:"Owner",key:"owner"},{label:"Due",render:task=>fmtDate(task.due_date)},{label:"Status",render:task=>A.status(task.status)},
            {label:"",render:task=>task.status==="OPEN"?`<div class="enterprise-row-actions"><button class="btn btn-teal btn-sm" onclick="AccountsClose.finishTask('${esc(task.id)}','complete')">Complete</button><button class="btn btn-ghost btn-sm" onclick="AccountsClose.finishTask('${esc(task.id)}','waive')">Waive</button></div>`:""}
          ],"No close tasks."),`<button class="btn btn-blue btn-sm" onclick="AccountsClose.openTaskForm()">New task</button>`)}
          ${A.panel("Financial years",A.rows(years,[
            {label:"Period",render:year=>`${fmtDate(year.start_date)} – ${fmtDate(year.end_date)}`},
            {label:"Lock",render:year=>A.status(year.is_closed?"LOCKED":"OPEN")},
            {label:"",render:year=>year.is_closed?`<button class="btn btn-ghost btn-sm" onclick="AccountsClose.changeYear('${esc(year.id)}','reopen')">Reopen</button>`:`<button class="btn btn-red btn-sm" onclick="AccountsClose.changeYear('${esc(year.id)}','close')">Lock period</button>`}
          ],"No financial years."),`<button class="btn btn-ghost btn-sm" onclick="AccountsClose.openYearForm()">New year</button>`)}
        </div>
        <div class="enterprise-notice danger"><b>Period locks are enforced by the backend.</b> Posting into a closed financial year is rejected. Reopening is an audited action and requires explicit confirmation.</div>`;
    } catch(error) {
      document.getElementById("close-body").innerHTML=emptyState("⚠","Could not load planning and close",esc(error.message));
    }
  }

  async function openBudgetForm() {
    await A.ensureLedgers();
    const expenseLedgers=STATE.ledgers.filter(ledger=>ledger.status==="ACTIVE");
    if(!expenseLedgers.length)return toast("Create an active ledger before creating a budget","err");
    openModal({
      title:"Create budget",wide:true,
      bodyHtml:`<div class="enterprise-fields">
        <div class="form-row"><label>Budget code</label><input id="budget-code"></div>
        <div class="form-row"><label>Name</label><input id="budget-name"></div>
        <div class="form-row"><label>Period start</label><input type="date" id="budget-start"></div>
        <div class="form-row"><label>Period end</label><input type="date" id="budget-end"></div>
        <div class="form-row"><label>Control mode</label><select id="budget-control"><option value="NONE">Track only</option><option value="WARN">Warn</option><option value="BLOCK">Block over-budget posting</option></select></div>
        <div class="form-row"><label>Status</label><select id="budget-status"><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option></select></div>
        <div class="form-row"><label>Ledger</label><select id="budget-ledger">${expenseLedgers.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select></div>
        <div class="form-row"><label>Amount</label><input type="number" step="0.01" id="budget-amount"></div>
        <div class="form-row full"><label>Notes</label><textarea id="budget-notes"></textarea></div>
      </div><div class="enterprise-notice info">Start with one budget line; additional lines remain editable through the API workbench until the multi-line editor is expanded.</div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="budget-save">Create budget</button>`,
      onMount:()=>document.getElementById("budget-save").onclick=async()=>{
        if(!A.formValue("budget-code")||!A.formValue("budget-name")||!A.formValue("budget-start")||!A.formValue("budget-end")||!A.numberValue("budget-amount"))return toast("Complete all required budget fields","err");
        try{await api(`/companies/${STATE.companyId}/accounting/budgets`,{method:"POST",body:{budget_code:A.formValue("budget-code"),name:A.formValue("budget-name"),period_start:A.formValue("budget-start"),period_end:A.formValue("budget-end"),status:A.formValue("budget-status"),control_mode:A.formValue("budget-control"),notes:A.formValue("budget-notes")||null,lines:[{ledger_id:A.formValue("budget-ledger"),amount:A.numberValue("budget-amount")}]}});closeModal();toast("Budget created","ok");navigate("budgets-close")}catch(error){errToast(error)}
      }
    });
  }

  async function openVariance(budgetId) {
    openModal({title:"Actual versus budget",wide:true,bodyHtml:`<div id="budget-variance"><span class="spin"></span> Calculating…</div>`,footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`});
    try{const report=await api(`/companies/${STATE.companyId}/accounting/budgets/${budgetId}/variance`);document.getElementById("budget-variance").innerHTML=`<div class="enterprise-grid">${A.metric("Budget",money(report.total_budget,STATE.company.base_currency))}${A.metric("Actual",money(report.total_actual,STATE.company.base_currency))}${A.metric("Variance",money(report.total_variance,STATE.company.base_currency))}${A.metric("Lines",report.rows.length)}</div>${A.rows(report.rows,[
      {label:"Ledger",render:row=>`<b>${esc(row.ledger_name)}</b>${row.dimension_name?`<div class="enterprise-code">${esc(row.dimension_name)}</div>`:""}`},
      {label:"Budget",num:true,render:row=>money(row.budget_amount,STATE.company.base_currency)},{label:"Actual",num:true,render:row=>money(row.actual_amount,STATE.company.base_currency)},
      {label:"Variance",num:true,render:row=>money(row.variance_amount,STATE.company.base_currency)},{label:"%",num:true,render:row=>row.variance_percent==null?"—":`${Number(row.variance_percent).toFixed(1)}%`}
    ])}`}catch(error){document.getElementById("budget-variance").innerHTML=emptyState("⚠","Could not calculate variance",esc(error.message))}
  }

  async function setBudget(budgetId,status){
    if(!await A.confirm({title:"Activate budget control?",message:"The selected budget and its warn/block policy will apply to posting validation.",confirmLabel:"Activate"}))return;
    try{await api(`/companies/${STATE.companyId}/accounting/budgets/${budgetId}`,{method:"PATCH",body:{status}});toast("Budget activated","ok");navigate("budgets-close")}catch(error){errToast(error)}
  }

  function openTaskForm(){
    const years=STATE.financialYears||[];
    openModal({title:"New close task",bodyHtml:`<div class="form-row"><label>Financial year</label><select id="close-task-year"><option value="">Company-wide</option>${years.map(year=>`<option value="${esc(year.id)}">${fmtDate(year.start_date)} – ${fmtDate(year.end_date)}</option>`).join("")}</select></div><div class="form-row"><label>Task code</label><input id="close-task-code"></div><div class="form-row"><label>Title</label><input id="close-task-title"></div><div class="form-grid"><div class="form-row"><label>Owner</label><input id="close-task-owner"></div><div class="form-row"><label>Due</label><input type="date" id="close-task-due"></div></div><div class="form-row"><label>Description</label><textarea id="close-task-description"></textarea></div>`,footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="close-task-save">Create task</button>`,onMount:()=>document.getElementById("close-task-save").onclick=async()=>{
      if(!A.formValue("close-task-code")||!A.formValue("close-task-title"))return toast("Task code and title are required","err");
      try{await api(`/companies/${STATE.companyId}/close/tasks`,{method:"POST",body:{financial_year_id:A.formValue("close-task-year")||null,task_code:A.formValue("close-task-code"),title:A.formValue("close-task-title"),description:A.formValue("close-task-description")||null,due_date:A.formValue("close-task-due")||null,owner:A.formValue("close-task-owner")||null}});closeModal();toast("Close task created","ok");navigate("budgets-close")}catch(error){errToast(error)}
    }});
  }

  async function finishTask(taskId,action){
    if(!await A.confirm({title:`${action==="complete"?"Complete":"Waive"} close task?`,message:action==="complete"?"Mark this checklist item complete.":"Waive this checklist item with an audit record.",confirmLabel:action==="complete"?"Complete":"Waive",danger:action==="waive"}))return;
    try{await api(`/companies/${STATE.companyId}/close/tasks/${taskId}/${action}`,{method:"POST",body:{completed_by:"Accounts UI",notes:null}});toast(`Close task ${action==="complete"?"completed":"waived"}`,"ok");navigate("budgets-close")}catch(error){errToast(error)}
  }

  async function changeYear(yearId,action){
    const closing=action==="close";
    if(!await A.confirm({title:closing?"Lock financial year?":"Reopen financial year?",message:closing?"Future posting in this period will be rejected. Existing posted vouchers remain immutable.":"Posting will be allowed again. This action is written to the audit log.",confirmLabel:closing?"Lock period":"Reopen",danger:true}))return;
    try{await api(`/companies/${STATE.companyId}/financial-years/${yearId}/${action}`,{method:"POST"});toast(closing?"Financial year locked":"Financial year reopened","ok");navigate("budgets-close")}catch(error){errToast(error)}
  }

  function openYearForm(){
    openModal({title:"New financial year",bodyHtml:`<div class="form-grid"><div class="form-row"><label>Start</label><input type="date" id="fy-new-start"></div><div class="form-row"><label>End</label><input type="date" id="fy-new-end"></div></div>`,footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="fy-new-save">Create year</button>`,onMount:()=>document.getElementById("fy-new-save").onclick=async()=>{
      try{await api(`/companies/${STATE.companyId}/financial-years`,{method:"POST",body:{start_date:A.formValue("fy-new-start"),end_date:A.formValue("fy-new-end")}});closeModal();toast("Financial year created","ok");navigate("budgets-close")}catch(error){errToast(error)}
    }});
  }

  window.AccountsClose={openBudgetForm,openVariance,setBudget,openTaskForm,finishTask,changeYear,openYearForm};
})();

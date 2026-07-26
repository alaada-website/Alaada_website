/* Dedicated fixed-asset register and lifecycle workflows. */
(() => {
  "use strict";
  const A = window.AccountsEnterprise;
  let categories = [];

  A.addGroup("Assets", [
    {view:"fixed-assets", label:"Fixed Assets", path:"M4 20h16M6 20V8l6-4 6 4v12M9 12h6"},
  ], "Reports");
  A.register("fixed-assets", renderFixedAssets);

  async function renderFixedAssets() {
    if (!A.requireCompany()) return;
    view().innerHTML = viewHead("Fixed Assets", "Register, capitalisation, depreciation, transfer, allocation, maintenance, warranty, identifiers, and disposal.",
      `<button class="btn btn-ghost btn-sm" onclick="AccountsAssets.openCategoryForm()">New category</button><button class="btn btn-blue btn-sm" onclick="AccountsAssets.openAssetForm()">New asset</button>`) +
      `<div id="assets-body">${A.panel("Loading", '<span class="spin"></span> Loading asset register…')}</div>`;
    try {
      await A.ensureLedgers();
      const [summary, assetsPage, register, categoryRows, allocations, maintenance, warranties] = await Promise.all([
        api(`/companies/${STATE.companyId}/fixed-assets/management/summary`),
        api(`/companies/${STATE.companyId}/fixed-assets`, {qs:{page_size:100}}),
        api(`/companies/${STATE.companyId}/fixed-assets/register`),
        api(`/companies/${STATE.companyId}/fixed-assets/categories`),
        api(`/companies/${STATE.companyId}/fixed-assets/management/allocations`, {qs:{page_size:100}}),
        api(`/companies/${STATE.companyId}/fixed-assets/management/maintenance`, {qs:{page_size:100}}),
        api(`/companies/${STATE.companyId}/fixed-assets/management/warranties`, {qs:{active_only:true}}),
      ]);
      categories = categoryRows;
      const assets = A.page(assetsPage);
      const currency = STATE.company.base_currency;
      document.getElementById("assets-body").innerHTML =
        `<div class="enterprise-grid">${A.metric("Assets", summary.total_assets ?? assets.length)}${A.metric("Gross cost", money(summary.total_cost ?? register.reduce((sum,row)=>sum+Number(row.purchase_cost||row.cost||0),0),currency))}${A.metric("Book value", money(summary.total_book_value ?? register.reduce((sum,row)=>sum+Number(row.book_value||0),0),currency))}${A.metric("Maintenance due", summary.maintenance_due ?? A.page(maintenance).filter(row=>row.status==="SCHEDULED").length)}</div>
        ${A.panel("Asset register", A.rows(assets, [
          {label:"Asset", render:item=>`<button class="row-link" onclick="AccountsAssets.openDetail('${esc(item.id)}')"><b>${esc(item.name)}</b></button><div class="enterprise-code">${esc(item.asset_code)}</div>`},
          {label:"Category", render:item=>esc(categories.find(row=>row.id===item.category_id)?.name || "—")},
          {label:"Location", key:"location"},
          {label:"Cost", num:true, render:item=>money(item.purchase_cost,currency)},
          {label:"Status", render:item=>A.status(item.status)},
          {label:"", render:item=>`<button class="btn btn-ghost btn-sm" onclick="AccountsAssets.openDetail('${esc(item.id)}')">Manage</button>`},
        ], "No fixed assets are registered."))}
        <div class="enterprise-split">
          ${A.panel("Active allocations", A.rows(A.page(allocations).slice(0,8), [
            {label:"Asset", render:row=>esc(assets.find(asset=>asset.id===row.asset_id)?.name || row.asset_id)},
            {label:"Allocated to", key:"allocated_to"}, {label:"Date", render:row=>fmtDate(row.allocated_date)}, {label:"Status", render:row=>A.status(row.status)}
          ], "No active allocations."))}
          ${A.panel("Control overview", `<div class="kv"><span class="k">Categories</span><span class="v">${categories.length}</span></div><div class="kv"><span class="k">Active warranties</span><span class="v">${warranties.length}</span></div><div class="kv"><span class="k">Maintenance records</span><span class="v">${A.page(maintenance).length}</span></div><div class="kv"><span class="k">Disposed assets</span><span class="v">${assets.filter(item=>item.status==="DISPOSED").length}</span></div>`)}
        </div>`;
    } catch (error) {
      document.getElementById("assets-body").innerHTML = emptyState("⚠", "Could not load fixed assets", esc(error.message), `<button class="btn btn-ghost" onclick="navigate('fixed-assets')">Retry</button>`);
    }
  }

  async function openCategoryForm() {
    await A.ensureLedgers();
    if(!STATE.ledgers.length)return toast("Create the asset, accumulated depreciation, and expense ledgers first","err");
    openModal({
      title:"New asset category", wide:true,
      bodyHtml:`<div class="enterprise-fields">
        <div class="form-row"><label>Name</label><input id="asset-cat-name"></div>
        <div class="form-row"><label>Useful life (months)</label><input type="number" id="asset-cat-life" value="60" min="1"></div>
        <div class="form-row"><label>Asset ledger</label><select id="asset-cat-ledger">${A.ledgerOptions()}</select></div>
        <div class="form-row"><label>Accumulated depreciation ledger</label><select id="asset-cat-accum">${A.ledgerOptions()}</select></div>
        <div class="form-row"><label>Depreciation expense ledger</label><select id="asset-cat-expense">${A.ledgerOptions()}</select></div>
        <div class="form-row"><label>Method</label><select id="asset-cat-method"><option value="STRAIGHT_LINE">Straight line</option><option value="WRITTEN_DOWN_VALUE">Written-down value</option></select></div>
        <div class="form-row"><label>Residual value (%)</label><input type="number" id="asset-cat-residual" value="0" min="0" max="100" step="0.01"></div>
        <div class="form-row full"><label>Description</label><textarea id="asset-cat-description"></textarea></div>
      </div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" id="asset-cat-save">Create category</button>`,
      onMount:()=>document.getElementById("asset-cat-save").onclick=async()=>{
        if(!A.formValue("asset-cat-name"))return toast("Category name is required","err");
        try{await api(`/companies/${STATE.companyId}/fixed-assets/categories`,{method:"POST",body:{
          name:A.formValue("asset-cat-name"),asset_ledger_id:A.formValue("asset-cat-ledger"),accumulated_depreciation_ledger_id:A.formValue("asset-cat-accum"),depreciation_expense_ledger_id:A.formValue("asset-cat-expense"),
          default_depreciation_method:A.formValue("asset-cat-method"),default_useful_life_months:A.numberValue("asset-cat-life",60),default_residual_value_percent:A.numberValue("asset-cat-residual"),description:A.formValue("asset-cat-description")||null
        }});closeModal();toast("Asset category created","ok");navigate("fixed-assets")}catch(error){errToast(error)}
      }
    });
  }

  async function openAssetForm() {
    if(!categories.length)categories=await api(`/companies/${STATE.companyId}/fixed-assets/categories`);
    if(!categories.length){toast("Create an asset category first","err");return openCategoryForm()}
    openModal({
      title:"Register fixed asset", wide:true,
      bodyHtml:`<div class="enterprise-notice info">Registering an asset does not create a journal entry. Capitalisation is a separate reviewed action.</div><div class="enterprise-fields">
        <div class="form-row"><label>Category</label><select id="asset-new-category">${categories.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("")}</select></div>
        <div class="form-row"><label>Asset code</label><input id="asset-new-code"></div>
        <div class="form-row full"><label>Name</label><input id="asset-new-name"></div>
        <div class="form-row"><label>Purchase date</label><input type="date" id="asset-new-date" value="${todayStr()}"></div>
        <div class="form-row"><label>Purchase cost</label><input type="number" step="0.01" id="asset-new-cost"></div>
        <div class="form-row"><label>Residual value</label><input type="number" step="0.01" id="asset-new-residual" value="0"></div>
        <div class="form-row"><label>Useful life (months)</label><input type="number" id="asset-new-life"></div>
        <div class="form-row"><label>Location</label><input id="asset-new-location"></div>
        <div class="form-row"><label>Custodian</label><input id="asset-new-custodian"></div>
        <div class="form-row full"><label>Notes</label><textarea id="asset-new-notes"></textarea></div>
      </div>`,
      footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-blue" onclick="AccountsAssets.submitAsset()">Register asset</button>`
    });
  }

  async function submitAsset(){
    if(!A.formValue("asset-new-code")||!A.formValue("asset-new-name")||!A.numberValue("asset-new-cost"))return toast("Code, name, and purchase cost are required","err");
    try{await api(`/companies/${STATE.companyId}/fixed-assets`,{method:"POST",body:{
      category_id:A.formValue("asset-new-category"),asset_code:A.formValue("asset-new-code"),name:A.formValue("asset-new-name"),purchase_date:A.formValue("asset-new-date"),purchase_cost:A.numberValue("asset-new-cost"),
      residual_value:A.numberValue("asset-new-residual"),useful_life_months:A.formValue("asset-new-life")?A.numberValue("asset-new-life"):null,location:A.formValue("asset-new-location")||null,custodian:A.formValue("asset-new-custodian")||null,notes:A.formValue("asset-new-notes")||null
    }});closeModal();toast("Asset registered","ok");navigate("fixed-assets")}catch(error){errToast(error)}
  }

  async function openDetail(assetId) {
    openModal({title:"Asset lifecycle",wide:true,bodyHtml:`<div id="asset-detail"><span class="spin"></span> Loading…</div>`,footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`});
    try{
      const [asset,transactions,allocations,maintenance,warranties,identifiers]=await Promise.all([
        api(`/companies/${STATE.companyId}/fixed-assets/${assetId}`),
        api(`/companies/${STATE.companyId}/fixed-assets/${assetId}/transactions`),
        api(`/companies/${STATE.companyId}/fixed-assets/management/allocations`,{qs:{asset_id:assetId,page_size:100}}),
        api(`/companies/${STATE.companyId}/fixed-assets/management/maintenance`,{qs:{asset_id:assetId,page_size:100}}),
        api(`/companies/${STATE.companyId}/fixed-assets/management/warranties`,{qs:{asset_id:assetId}}),
        api(`/companies/${STATE.companyId}/fixed-assets/management/identifiers`,{qs:{asset_id:assetId}}),
      ]);
      document.getElementById("asset-detail").innerHTML=`<div class="enterprise-grid">${A.metric("Status",asset.status)}${A.metric("Purchase cost",money(asset.purchase_cost,STATE.company.base_currency))}${A.metric("Accumulated depreciation",money(asset.accumulated_depreciation||0,STATE.company.base_currency))}${A.metric("Book value",money(asset.book_value??(Number(asset.purchase_cost)-Number(asset.accumulated_depreciation||0)),STATE.company.base_currency))}</div>
      <div class="enterprise-notice"><b>${esc(asset.asset_code)} · ${esc(asset.name)}</b><br>${esc(asset.location||"No location")} · ${esc(asset.custodian||"No custodian")} · purchased ${fmtDate(asset.purchase_date)}</div>
      <div class="enterprise-actions" style="margin-bottom:14px;">
        ${asset.status==="DRAFT"||asset.status==="REGISTERED"?`<button class="btn btn-blue btn-sm" onclick="AccountsAssets.openAction('${assetId}','capitalize')">Capitalise</button>`:""}
        ${asset.status==="ACTIVE"?`<button class="btn btn-teal btn-sm" onclick="AccountsAssets.openAction('${assetId}','depreciate')">Run depreciation</button><button class="btn btn-ghost btn-sm" onclick="AccountsAssets.openAction('${assetId}','transfer')">Transfer</button><button class="btn btn-ghost btn-sm" onclick="AccountsAssets.openAction('${assetId}','allocate')">Allocate</button><button class="btn btn-ghost btn-sm" onclick="AccountsAssets.openAction('${assetId}','maintenance')">Maintenance</button><button class="btn btn-ghost btn-sm" onclick="AccountsAssets.openAction('${assetId}','warranty')">Warranty</button><button class="btn btn-ghost btn-sm" onclick="AccountsAssets.openAction('${assetId}','identifier')">Identifier</button><button class="btn btn-red btn-sm" onclick="AccountsAssets.openAction('${assetId}','dispose')">Dispose</button>`:""}
      </div>
      ${A.panel("Transactions",A.rows(transactions,[{label:"Date",render:row=>fmtDate(row.transaction_date)},{label:"Type",render:row=>A.status(row.transaction_type)},{label:"Amount",num:true,render:row=>money(row.amount,STATE.company.base_currency)},{label:"Location",key:"to_location"}],"No lifecycle transactions."))}
      <div class="enterprise-split">${A.panel("Allocations",A.rows(A.page(allocations),[{label:"Allocated to",key:"allocated_to"},{label:"Date",render:row=>fmtDate(row.allocated_date)},{label:"Status",render:row=>A.status(row.status)}],"No allocations."))}${A.panel("Coverage & identifiers",`<div class="kv"><span class="k">Warranties</span><span class="v">${warranties.length}</span></div><div class="kv"><span class="k">Identifiers</span><span class="v">${identifiers.length}</span></div><div class="kv"><span class="k">Maintenance records</span><span class="v">${A.page(maintenance).length}</span></div>`)}</div>`;
    }catch(error){document.getElementById("asset-detail").innerHTML=emptyState("⚠","Could not load asset",esc(error.message))}
  }

  async function openAction(assetId, action) {
    await A.ensureLedgers();
    const configs={
      capitalize:{title:"Capitalise asset",danger:true,fields:`<div class="form-row"><label>Capitalisation date</label><input type="date" id="aa-date" value="${todayStr()}"></div><div class="form-row"><label>Credit ledger</label><select id="aa-ledger">${A.ledgerOptions()}</select></div>`,path:"capitalize",body:()=>({capitalization_date:A.formValue("aa-date"),credit_ledger_id:A.formValue("aa-ledger"),notes:A.formValue("aa-notes")||null})},
      depreciate:{title:"Run depreciation",danger:true,fields:`<div class="form-row"><label>Depreciation date</label><input type="date" id="aa-date" value="${todayStr()}"></div><div class="form-row"><label>Amount (blank = calculated)</label><input type="number" step="0.01" id="aa-amount"></div>`,path:"depreciate",body:()=>({depreciation_date:A.formValue("aa-date"),amount:A.formValue("aa-amount")?A.numberValue("aa-amount"):null,notes:A.formValue("aa-notes")||null})},
      transfer:{title:"Transfer asset",fields:`<div class="form-row"><label>Transfer date</label><input type="date" id="aa-date" value="${todayStr()}"></div><div class="form-row"><label>New location</label><input id="aa-location"></div>`,path:"transfer",body:()=>({transfer_date:A.formValue("aa-date"),to_location:A.formValue("aa-location"),notes:A.formValue("aa-notes")||null})},
      allocate:{title:"Allocate asset",fields:`<div class="form-row"><label>Allocated to</label><input id="aa-to"></div><div class="form-row"><label>Department</label><input id="aa-department"></div><div class="form-row"><label>Location</label><input id="aa-location"></div><div class="form-row"><label>Allocation date</label><input type="date" id="aa-date" value="${todayStr()}"></div>`,path:"allocations",body:()=>({allocated_to:A.formValue("aa-to"),department:A.formValue("aa-department")||null,location:A.formValue("aa-location")||null,allocated_date:A.formValue("aa-date"),notes:A.formValue("aa-notes")||null})},
      maintenance:{title:"Schedule maintenance",fields:`<div class="form-row"><label>Type</label><select id="aa-type"><option value="PREVENTIVE">Preventive</option><option value="CORRECTIVE">Corrective</option><option value="INSPECTION">Inspection</option></select></div><div class="form-row"><label>Scheduled date</label><input type="date" id="aa-date" value="${todayStr()}"></div><div class="form-row"><label>Vendor</label><input id="aa-vendor"></div><div class="form-row"><label>Estimated cost</label><input type="number" id="aa-amount" value="0"></div>`,path:"maintenance",body:()=>({maintenance_type:A.formValue("aa-type"),scheduled_date:A.formValue("aa-date"),vendor_name:A.formValue("aa-vendor")||null,cost:A.numberValue("aa-amount"),notes:A.formValue("aa-notes")||null})},
      warranty:{title:"Add warranty",fields:`<div class="form-row"><label>Provider</label><input id="aa-provider"></div><div class="form-row"><label>Warranty number</label><input id="aa-number"></div><div class="form-row"><label>Start</label><input type="date" id="aa-start" value="${todayStr()}"></div><div class="form-row"><label>End</label><input type="date" id="aa-end"></div>`,path:"warranties",body:()=>({provider_name:A.formValue("aa-provider"),warranty_number:A.formValue("aa-number")||null,start_date:A.formValue("aa-start"),end_date:A.formValue("aa-end"),coverage_details:A.formValue("aa-notes")||null,is_active:true})},
      identifier:{title:"Add identifier",fields:`<div class="form-row"><label>Type</label><select id="aa-type"><option value="QR_CODE">QR code</option><option value="BARCODE">Barcode</option><option value="RFID">RFID</option><option value="SERIAL">Serial number</option></select></div><div class="form-row"><label>Value</label><input id="aa-value"></div>`,path:"identifiers",body:()=>({identifier_type:A.formValue("aa-type"),identifier_value:A.formValue("aa-value"),is_primary:true,notes:A.formValue("aa-notes")||null})},
      dispose:{title:"Dispose asset",danger:true,fields:`<div class="form-row"><label>Disposal date</label><input type="date" id="aa-date" value="${todayStr()}"></div><div class="form-row"><label>Proceeds</label><input type="number" step="0.01" id="aa-amount" value="0"></div><div class="form-row"><label>Proceeds ledger</label><select id="aa-ledger">${A.ledgerOptions()}</select></div><div class="form-row"><label>Gain/loss ledger</label><select id="aa-gain">${A.ledgerOptions()}</select></div>`,path:"dispose",body:()=>({disposal_date:A.formValue("aa-date"),proceeds_amount:A.numberValue("aa-amount"),proceeds_ledger_id:A.formValue("aa-ledger"),gain_loss_ledger_id:A.formValue("aa-gain"),notes:A.formValue("aa-notes")||null})},
    };
    const config=configs[action];
    openModal({title:config.title,wide:true,bodyHtml:`${config.danger?'<div class="enterprise-notice danger"><b>Accounting action.</b> Review all fields. This will create auditable records and may post a voucher.</div>':""}<div class="enterprise-fields">${config.fields}<div class="form-row full"><label>Notes</label><textarea id="aa-notes"></textarea></div></div>`,footHtml:`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn ${config.danger?"btn-red":"btn-blue"}" id="aa-save">Review and apply</button>`,onMount:()=>document.getElementById("aa-save").onclick=async()=>{
      if(!await A.confirm({title:`Confirm ${config.title.toLowerCase()}?`,message:`Apply this ${config.title.toLowerCase()} operation to the selected fixed asset.`,confirmLabel:"Apply",danger:config.danger}))return;
      try{await api(`/companies/${STATE.companyId}/fixed-assets/${assetId}/${config.path}`,{method:"POST",body:config.body()});closeModal();toast(`${config.title} completed`,"ok");navigate("fixed-assets")}catch(error){errToast(error)}
    }});
  }

  window.AccountsAssets={openCategoryForm,openAssetForm,submitAsset,openDetail,openAction};
})();

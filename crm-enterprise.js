(function () {
  "use strict";

  const API_DEFAULT = "https://accounts-0o52.onrender.com";
  const STAGES = ["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
  const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];
  const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "NOTE"];
  const state = {
    apiBase: localStorage.getItem("alaada_acc_api") || API_DEFAULT,
    apiKey: localStorage.getItem("alaada_acc_api_key") || "",
    companyId: localStorage.getItem("alaada_acc_company") || "",
    companies: [],
    view: "dashboard",
    leadView: "list",
    calendarDate: new Date(),
    search: "",
    selected: new Set(),
    data: {},
    ready: false,
  };

  const h = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const money = (value) => new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(Number(value || 0));
  const pretty = (value) => String(value || "—").replaceAll("_", " ").toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const dateText = (value) => value ? new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(String(value).slice(0, 10) + "T00:00:00")) : "—";
  const today = () => new Date().toISOString().slice(0, 10);
  const pageItems = (value) => Array.isArray(value) ? value : (value?.items || []);

  async function api(path, options = {}) {
    const method = options.method || "GET";
    let url = state.apiBase.replace(/\/$/, "") + path;
    if (options.qs) {
      const qs = new URLSearchParams();
      Object.entries(options.qs).forEach(([key, value]) => {
        if (value !== "" && value !== null && value !== undefined) qs.set(key, value);
      });
      if (qs.size) url += `?${qs}`;
    }
    const headers = { ...(options.headers || {}) };
    if (state.apiKey) headers["X-Alaada-API-Key"] = state.apiKey;
    const request = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(url, request);
    } catch (_) {
      throw new Error("Could not reach the Accounts API. Check the CRM connection.");
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    if (!response.ok) {
      throw new Error(data?.error?.message || data?.detail || `Request failed (${response.status})`);
    }
    return data;
  }

  function toast(message, error = false) {
    document.querySelector(".crm-toast")?.remove();
    const element = document.createElement("div");
    element.className = `crm-toast${error ? " error" : ""}`;
    element.textContent = message;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 3200);
  }

  function button(label, action, variant = "") {
    return `<button class="crm-button ${variant}" data-action="${h(action)}">${h(label)}</button>`;
  }

  function badge(value) {
    return `<span class="crm-badge ${h(value)}">${h(pretty(value))}</span>`;
  }

  function empty(title, copy, action = "", label = "") {
    return `<div class="crm-empty"><strong>${h(title)}</strong>${h(copy)}
      ${action ? `<div style="margin-top:14px">${button(label, action)}</div>` : ""}</div>`;
  }

  async function boot() {
    const page = document.getElementById("page-crm");
    if (!page || page.dataset.enterpriseReady) return;
    page.dataset.enterpriseReady = "true";
    page.classList.add("crm-enterprise-page");
    page.innerHTML = `<div class="crm-app">
      <header class="crm-topbar">
        <div class="crm-heading"><h1>Alaada CRM</h1><p>Pipeline, relationships, activities and customer context.</p></div>
        <select id="crm-company" class="crm-company-select" aria-label="CRM company"></select>
        <button class="crm-button ghost" data-action="settings">Connection</button>
        <button class="crm-button" data-action="quick-add">+ Create</button>
      </header>
      <nav class="crm-tabs" aria-label="CRM sections"></nav>
      <section class="crm-body" aria-live="polite"></section>
    </div>`;
    page.addEventListener("click", handleAction);
    page.addEventListener("change", handleChange);
    page.addEventListener("input", handleInput);
    document.getElementById("crm-company").addEventListener("change", async (event) => {
      state.companyId = event.target.value;
      localStorage.setItem("alaada_acc_company", state.companyId);
      state.data = {};
      await render();
    });
    await loadCompanies();
    state.ready = true;
    await render();
  }

  async function loadCompanies() {
    try {
      state.companies = pageItems(await api("/companies", { qs: { page_size: 200 } }));
      if (!state.companies.some((company) => company.id === state.companyId)) {
        state.companyId = state.companies[0]?.id || "";
        if (state.companyId) localStorage.setItem("alaada_acc_company", state.companyId);
      }
    } catch (error) {
      state.companies = [];
      toast(error.message, true);
    }
    const select = document.getElementById("crm-company");
    select.innerHTML = state.companies.length
      ? state.companies.map((company) => `<option value="${h(company.id)}" ${company.id === state.companyId ? "selected" : ""}>${h(company.name)}</option>`).join("")
      : `<option value="">No company</option>`;
  }

  function renderTabs() {
    const tabs = [
      ["dashboard", "Overview"], ["leads", "Leads"], ["pipeline", "Pipeline"],
      ["contacts", "Contacts"], ["accounts", "Companies"], ["activities", "Tasks & activity"],
      ["calendar", "Calendar"], ["campaigns", "Campaigns"], ["email", "Email"],
    ];
    document.querySelector(".crm-tabs").innerHTML = tabs.map(([id, label]) =>
      `<button class="crm-tab ${state.view === id ? "active" : ""}" data-action="view" data-view="${id}">${label}</button>`
    ).join("");
  }

  async function render() {
    renderTabs();
    const body = document.querySelector(".crm-body");
    if (!state.companyId) {
      body.innerHTML = empty("Connect a company", "Create or select an Accounts company to start using CRM.", "settings", "Set connection");
      return;
    }
    body.innerHTML = `<div class="crm-empty"><strong>Loading ${h(pretty(state.view))}</strong>Syncing authorised company data…</div>`;
    try {
      const renderers = {
        dashboard: renderDashboard, leads: renderLeads, pipeline: renderPipeline,
        contacts: renderContacts, accounts: renderAccounts, activities: renderActivities,
        calendar: renderCalendar, campaigns: renderCampaigns, email: renderEmail,
      };
      await renderers[state.view]();
    } catch (error) {
      body.innerHTML = empty("This view could not load", error.message, "refresh", "Try again");
    }
  }

  async function allCoreData() {
    const base = `/companies/${state.companyId}`;
    const [leads, opportunities, contacts, activities, forecast, campaigns, customers] = await Promise.all([
      api(`${base}/crm/leads`, { qs: { page_size: 500 } }),
      api(`${base}/crm/opportunities`, { qs: { page_size: 500 } }),
      api(`${base}/crm/contacts`, { qs: { page_size: 500 } }),
      api(`${base}/crm/activities`, { qs: { page_size: 500 } }),
      api(`${base}/crm/opportunities/forecast`),
      api(`${base}/crm/campaigns`, { qs: { page_size: 500 } }),
      api(`${base}/customers`, { qs: { page_size: 500 } }),
    ]);
    return {
      leads: pageItems(leads), opportunities: pageItems(opportunities),
      contacts: pageItems(contacts), activities: pageItems(activities),
      forecast, campaigns: pageItems(campaigns), customers: pageItems(customers),
    };
  }

  async function renderDashboard() {
    const data = await allCoreData();
    state.data = { ...state.data, ...data };
    const overdue = data.activities.filter((item) => item.status === "OPEN" && item.due_date && item.due_date < today());
    const dueSoon = data.opportunities
      .filter((item) => !["WON", "LOST"].includes(item.stage))
      .sort((a, b) => String(a.expected_close_date || "9999").localeCompare(String(b.expected_close_date || "9999")))
      .slice(0, 6);
    const recent = [...data.activities].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 7);
    document.querySelector(".crm-body").innerHTML = `
      <div class="crm-kpis">
        <div class="crm-kpi"><div class="crm-kpi-label">Open pipeline</div><div class="crm-kpi-value">${money(data.forecast.total_pipeline)}</div><div class="crm-kpi-foot">${data.opportunities.filter((o) => !["WON", "LOST"].includes(o.stage)).length} active opportunities</div></div>
        <div class="crm-kpi"><div class="crm-kpi-label">Weighted forecast</div><div class="crm-kpi-value">${money(data.forecast.weighted_pipeline)}</div><div class="crm-kpi-foot">Probability-adjusted value</div></div>
        <div class="crm-kpi"><div class="crm-kpi-label">Qualified leads</div><div class="crm-kpi-value">${data.leads.filter((lead) => lead.status === "QUALIFIED").length}</div><div class="crm-kpi-foot">${data.leads.length} leads total</div></div>
        <div class="crm-kpi"><div class="crm-kpi-label">Overdue tasks</div><div class="crm-kpi-value">${overdue.length}</div><div class="crm-kpi-foot">${data.activities.filter((a) => a.status === "OPEN").length} open activities</div></div>
      </div>
      <div class="crm-grid-2">
        <section class="crm-panel"><div class="crm-panel-title">Deals needing attention ${button("Open pipeline", "pipeline-view", "secondary")}</div>
          ${dueSoon.length ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Opportunity</th><th>Stage</th><th>Value</th><th>Close</th><th>Next action</th></tr></thead><tbody>
            ${dueSoon.map((item) => `<tr><td><span class="crm-link" data-action="opportunity-detail" data-id="${item.id}">${h(item.title)}</span></td><td>${badge(item.stage)}</td><td class="crm-money">${money(item.amount)}</td><td>${dateText(item.expected_close_date)}</td><td>${h(item.next_action || "Not set")}</td></tr>`).join("")}
          </tbody></table></div>` : empty("No active opportunities", "Add an opportunity to begin forecasting.", "add-opportunity", "Add opportunity")}
        </section>
        <section class="crm-panel"><div class="crm-panel-title">Recent activity</div>
          ${recent.length ? `<div class="crm-timeline">${recent.map((item) => `<div class="crm-timeline-item"><div class="crm-timeline-title">${h(item.subject)}</div><div class="crm-timeline-meta">${pretty(item.activity_type)} · ${dateText(item.activity_date)} · ${pretty(item.status)}</div></div>`).join("")}</div>` : empty("No activity yet", "Calls, meetings and follow-ups will appear here.")}
        </section>
      </div>`;
  }

  async function renderLeads() {
    const base = `/companies/${state.companyId}/crm`;
    const [leadPage, scores] = await Promise.all([
      api(`${base}/leads`, { qs: { page_size: 500 } }),
      api(`${base}/lead-scores`),
    ]);
    const leads = pageItems(leadPage);
    const latestScores = new Map();
    scores.forEach((score) => { if (!latestScores.has(score.lead_id)) latestScores.set(score.lead_id, score); });
    state.data.leads = leads;
    const query = state.search.toLowerCase();
    const filtered = leads.filter((lead) => [lead.name, lead.company_name, lead.email, lead.owner, lead.tags].some((value) => String(value || "").toLowerCase().includes(query)));
    const toolbar = `<div class="crm-toolbar">
      <input class="crm-input" data-role="search" value="${h(state.search)}" placeholder="Search leads, tags or owner">
      ${button("+ Lead", "add-lead")} ${button("Import CSV", "import-leads", "ghost")} ${button("Export CSV", "export-leads", "ghost")}
      ${button("Duplicates", "duplicates", "ghost")} ${button("Assign selected", "bulk-assign", "secondary")}
      <button class="crm-button ${state.leadView === "list" ? "" : "ghost"}" data-action="lead-view" data-mode="list">List</button>
      <button class="crm-button ${state.leadView === "kanban" ? "" : "ghost"}" data-action="lead-view" data-mode="kanban">Kanban</button>
    </div>`;
    let content;
    if (state.leadView === "kanban") {
      content = `<div class="crm-kanban leads">${LEAD_STATUSES.map((status) => {
        const rows = filtered.filter((lead) => lead.status === status);
        return `<section class="crm-kanban-col"><div class="crm-kanban-head"><span>${pretty(status)}</span><span>${rows.length}</span></div>
          ${rows.map((lead) => leadCard(lead, latestScores.get(lead.id))).join("") || `<div class="crm-muted" style="padding:8px;font-size:.7rem">No leads</div>`}</section>`;
      }).join("")}</div>`;
    } else {
      content = filtered.length ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th><input class="crm-checkbox" type="checkbox" data-action="select-all-leads"></th><th>Lead</th><th>Status</th><th>Score</th><th>Owner</th><th>Value</th><th>Close</th></tr></thead><tbody>
        ${filtered.map((lead) => { const score = latestScores.get(lead.id); return `<tr>
          <td><input class="crm-checkbox" type="checkbox" data-select-lead="${lead.id}" ${state.selected.has(lead.id) ? "checked" : ""}></td>
          <td><span class="crm-link" data-action="lead-detail" data-id="${lead.id}">${h(lead.name)}</span><div class="crm-muted">${h(lead.company_name || lead.email || "No company")}</div></td>
          <td>${badge(lead.status)}</td><td>${score ? `${score.score} · ${badge(score.score_band)}` : "—"}</td><td>${h(lead.owner || "Unassigned")}</td><td class="crm-money">${money(lead.expected_value)}</td><td>${dateText(lead.expected_close_date)}</td>
        </tr>`; }).join("")}
      </tbody></table></div>` : empty("No leads found", query ? "Try another search." : "Capture your first lead.", "add-lead", "Add lead");
    }
    document.querySelector(".crm-body").innerHTML = toolbar + content;
  }

  function leadCard(lead, score) {
    return `<article class="crm-card" data-action="lead-detail" data-id="${lead.id}">
      <div class="crm-card-title">${h(lead.name)}</div><div class="crm-card-sub">${h(lead.company_name || lead.email || "No company")}</div>
      <div class="crm-card-meta"><span class="crm-money">${money(lead.expected_value)}</span><span>${score ? `${score.score} ${pretty(score.score_band)}` : h(lead.owner || "Unassigned")}</span></div>
    </article>`;
  }

  async function renderPipeline() {
    const base = `/companies/${state.companyId}/crm`;
    const [page, forecast] = await Promise.all([
      api(`${base}/opportunities`, { qs: { page_size: 500 } }),
      api(`${base}/opportunities/forecast`),
    ]);
    const opportunities = pageItems(page);
    state.data.opportunities = opportunities;
    state.data.forecast = forecast;
    document.querySelector(".crm-body").innerHTML = `
      <div class="crm-kpis">
        <div class="crm-kpi"><div class="crm-kpi-label">Pipeline</div><div class="crm-kpi-value">${money(forecast.total_pipeline)}</div></div>
        <div class="crm-kpi"><div class="crm-kpi-label">Weighted</div><div class="crm-kpi-value">${money(forecast.weighted_pipeline)}</div></div>
        <div class="crm-kpi"><div class="crm-kpi-label">Won</div><div class="crm-kpi-value">${money(forecast.won_value)}</div></div>
        <div class="crm-kpi"><div class="crm-kpi-label">Lost</div><div class="crm-kpi-value">${money(forecast.lost_value)}</div></div>
      </div>
      <div class="crm-toolbar"><div style="flex:1"></div>${button("+ Opportunity", "add-opportunity")}</div>
      <div class="crm-kanban">${STAGES.map((stage) => {
        const rows = opportunities.filter((item) => item.stage === stage);
        return `<section class="crm-kanban-col"><div class="crm-kanban-head"><span>${pretty(stage)}</span><span>${rows.length} · ${money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</span></div>
          ${rows.map((item) => `<article class="crm-card" data-action="opportunity-detail" data-id="${item.id}">
            <div class="crm-card-title">${h(item.title)}</div><div class="crm-card-sub">${h(item.owner || "Unassigned")} · ${Number(item.probability_percent || 0)}%</div>
            <div class="crm-card-meta"><span class="crm-money">${money(item.amount)}</span><span>${dateText(item.expected_close_date)}</span></div>
          </article>`).join("") || `<div class="crm-muted" style="padding:8px;font-size:.7rem">No opportunities</div>`}</section>`;
      }).join("")}</div>`;
  }

  async function renderContacts() {
    const base = `/companies/${state.companyId}`;
    const [contactsPage, customersPage, opportunitiesPage] = await Promise.all([
      api(`${base}/crm/contacts`, { qs: { page_size: 500 } }),
      api(`${base}/customers`, { qs: { page_size: 500 } }),
      api(`${base}/crm/opportunities`, { qs: { page_size: 500 } }),
    ]);
    const contacts = pageItems(contactsPage);
    const customers = pageItems(customersPage);
    const opportunities = pageItems(opportunitiesPage);
    state.data = { ...state.data, contacts, customers, opportunities };
    const customerMap = new Map(customers.map((item) => [item.id, item]));
    document.querySelector(".crm-body").innerHTML = `<div class="crm-toolbar"><input class="crm-input" data-role="search" value="${h(state.search)}" placeholder="Search contacts">${button("+ Contact", "add-contact")}</div>
      ${contacts.length ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Contact</th><th>Company</th><th>Role</th><th>Preference / notes</th><th>Open deals</th><th>Primary</th></tr></thead><tbody>
        ${contacts.filter((item) => [item.name, item.email, item.phone].some((v) => String(v || "").toLowerCase().includes(state.search.toLowerCase()))).map((item) => `<tr>
          <td><span class="crm-link" data-action="contact-detail" data-id="${item.id}">${h(item.name)}</span><div class="crm-muted">${h(item.email || item.phone || "No contact channel")}</div></td>
          <td>${h(customerMap.get(item.customer_id)?.name || "Unlinked")}</td><td>${h(item.designation || "—")}</td><td>${h(item.notes || "—")}</td>
          <td>${opportunities.filter((deal) => deal.customer_id === item.customer_id && !["WON", "LOST"].includes(deal.stage)).length}</td><td>${item.is_primary ? badge("ACTIVE") : "—"}</td>
        </tr>`).join("")}
      </tbody></table></div>` : empty("No contacts", "Add people and relate them to CRM companies.", "add-contact", "Add contact")}`;
  }

  async function renderAccounts() {
    const base = `/companies/${state.companyId}`;
    const [customersPage, contactsPage, opportunitiesPage] = await Promise.all([
      api(`${base}/customers`, { qs: { page_size: 500 } }),
      api(`${base}/crm/contacts`, { qs: { page_size: 500 } }),
      api(`${base}/crm/opportunities`, { qs: { page_size: 500 } }),
    ]);
    const customers = pageItems(customersPage), contacts = pageItems(contactsPage), opportunities = pageItems(opportunitiesPage);
    state.data = { ...state.data, customers, contacts, opportunities };
    document.querySelector(".crm-body").innerHTML = `<div class="crm-notice info">CRM companies use the authorised Accounts customer adapter. Billing, invoices and payments stay owned by Accounts; CRM reads them only through company-scoped APIs.</div>
      <div class="crm-toolbar"><input class="crm-input" data-role="search" value="${h(state.search)}" placeholder="Search companies"></div>
      ${customers.length ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Company / account</th><th>Status</th><th>Contacts</th><th>Open opportunities</th><th>Pipeline value</th><th>Credit limit</th></tr></thead><tbody>
        ${customers.filter((item) => [item.name, item.email, item.contact_person].some((v) => String(v || "").toLowerCase().includes(state.search.toLowerCase()))).map((item) => {
          const deals = opportunities.filter((deal) => deal.customer_id === item.id && !["WON", "LOST"].includes(deal.stage));
          return `<tr><td><span class="crm-link" data-action="account-detail" data-id="${item.id}">${h(item.name)}</span><div class="crm-muted">${h(item.contact_person || item.email || "—")}</div></td><td>${badge(item.status)}</td>
            <td>${contacts.filter((contact) => contact.customer_id === item.id).length}</td><td>${deals.length}</td><td class="crm-money">${money(deals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0))}</td><td class="crm-money">${money(item.credit_limit)}</td></tr>`;
        }).join("")}
      </tbody></table></div>` : empty("No CRM companies", "Create customers in Alaada Accounts, then relate contacts and opportunities.")}`;
  }

  async function renderActivities() {
    const page = await api(`/companies/${state.companyId}/crm/activities`, { qs: { page_size: 500 } });
    const activities = pageItems(page);
    state.data.activities = activities;
    const open = activities.filter((item) => item.status === "OPEN");
    document.querySelector(".crm-body").innerHTML = `<div class="crm-toolbar"><input class="crm-input" data-role="search" value="${h(state.search)}" placeholder="Search tasks and activities">${button("+ Activity", "add-activity")}</div>
      ${activities.length ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Activity</th><th>Type</th><th>Owner</th><th>Activity date</th><th>Due</th><th>Priority / outcome</th><th>Status</th><th></th></tr></thead><tbody>
        ${activities.filter((item) => item.subject.toLowerCase().includes(state.search.toLowerCase())).sort((a, b) => String(a.due_date || a.activity_date).localeCompare(String(b.due_date || b.activity_date))).map((item) => `<tr>
          <td>${h(item.subject)}</td><td>${badge(item.activity_type)}</td><td>${h(item.owner || "Unassigned")}</td><td>${dateText(item.activity_date)}</td><td>${dateText(item.due_date)}</td><td>${h(item.outcome || "—")}</td><td>${badge(item.status)}</td>
          <td>${item.status === "OPEN" ? `<button class="crm-button secondary" data-action="complete-activity" data-id="${item.id}">Complete</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : empty("No tasks or activities", "Track calls, meetings, follow-ups and completed outcomes.", "add-activity", "Add activity")}
      ${open.some((item) => item.due_date && item.due_date < today()) ? `<div class="crm-notice danger" style="margin-top:14px">${open.filter((item) => item.due_date && item.due_date < today()).length} open task(s) are overdue.</div>` : ""}`;
  }

  async function renderCalendar() {
    const activities = pageItems(await api(`/companies/${state.companyId}/crm/activities`, { qs: { page_size: 500 } }));
    state.data.activities = activities;
    const cursor = state.calendarDate;
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const days = Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
    document.querySelector(".crm-body").innerHTML = `<div class="crm-toolbar">
      ${button("←", "calendar-prev", "ghost")}<strong style="font:800 1rem Syne,sans-serif">${cursor.toLocaleString("en-IN", { month: "long", year: "numeric" })}</strong>${button("→", "calendar-next", "ghost")}
      <div style="flex:1"></div>${button("+ Activity", "add-activity")}
    </div><div style="overflow:auto"><div class="crm-calendar">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="crm-calendar-head">${day}</div>`).join("")}
      ${days.map((day) => {
        const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        const events = activities.filter((item) => item.activity_date === key || item.due_date === key);
        return `<div class="crm-day ${day.getMonth() === month ? "" : "outside"}"><div class="crm-day-num">${day.getDate()}</div>
          ${events.map((event) => `<div class="crm-event" title="${h(event.subject)}">${h(event.subject)} · ${pretty(event.activity_type)}</div>`).join("")}</div>`;
      }).join("")}
    </div></div>`;
  }

  async function renderCampaigns() {
    const base = `/companies/${state.companyId}/crm`;
    const [campaignPage, summary] = await Promise.all([
      api(`${base}/campaigns`, { qs: { page_size: 500 } }),
      api(`${base}/marketing/summary`),
    ]);
    const campaigns = pageItems(campaignPage);
    state.data.campaigns = campaigns;
    document.querySelector(".crm-body").innerHTML = `<div class="crm-kpis">
      <div class="crm-kpi"><div class="crm-kpi-label">Campaigns</div><div class="crm-kpi-value">${summary.total_campaigns}</div></div>
      <div class="crm-kpi"><div class="crm-kpi-label">Active</div><div class="crm-kpi-value">${summary.active_campaigns}</div></div>
      <div class="crm-kpi"><div class="crm-kpi-label">Budget</div><div class="crm-kpi-value">${money(summary.total_budget)}</div></div>
      <div class="crm-kpi"><div class="crm-kpi-label">Expected revenue</div><div class="crm-kpi-value">${money(summary.total_expected_revenue)}</div></div>
      </div><div class="crm-toolbar"><div style="flex:1"></div>${button("+ Campaign", "add-campaign")}</div>
      ${campaigns.length ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Dates</th><th>Budget / actual</th><th>Leads</th><th>Opportunities</th></tr></thead><tbody>
        ${campaigns.map((item) => `<tr><td><strong>${h(item.name)}</strong><div class="crm-muted">${h(item.campaign_code)}</div></td><td>${badge(item.channel)}</td><td>${badge(item.status)}</td><td>${dateText(item.start_date)} – ${dateText(item.end_date)}</td><td class="crm-money">${money(item.budget_amount)} / ${money(item.actual_cost)}</td><td>${item.leads_generated}</td><td>${item.opportunities_generated}</td></tr>`).join("")}
      </tbody></table></div>` : empty("No campaigns", "Create a campaign with a channel, budget and expected outcomes.", "add-campaign", "Add campaign")}`;
  }

  async function renderEmail() {
    const base = `/companies/${state.companyId}/crm/email`;
    const [messagePage, templates, suppressions] = await Promise.all([
      api(`${base}/messages`, { qs: { page_size: 100 } }),
      api(`${base}/templates`),
      api(`${base}/suppressions`),
    ]);
    const messages = pageItems(messagePage);
    state.data = { ...state.data, messages, templates, suppressions };
    document.querySelector(".crm-body").innerHTML = `<div class="crm-notice">Email is sent only by the backend through Resend—never SMTP. Marketing sends are blocked for unsubscribed or bounced recipients. Open/click events are displayed only when Resend tracking is enabled under an appropriate legal basis.</div>
      <div class="crm-toolbar">${button("Compose email", "compose-email")} ${button("+ Template", "add-email-template", "secondary")} ${button("Unsubscribe", "add-suppression", "ghost")}<div style="flex:1"></div><span class="crm-muted">${templates.length} templates · ${suppressions.length} suppressed recipients</span></div>
      ${messages.length ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Recipient</th><th>Subject</th><th>Classification</th><th>Status</th><th>Scheduled / sent</th><th>Delivery events</th></tr></thead><tbody>
        ${messages.map((item) => `<tr><td>${h(item.to_email)}</td><td>${h(item.subject)}</td><td>${badge(item.classification)}</td><td>${badge(item.status)}${item.provider_error ? `<div class="crm-muted">${h(item.provider_error)}</div>` : ""}</td><td>${dateText(item.sent_at || item.scheduled_at || item.created_at)}</td><td>${item.delivered_at ? "Delivered " : ""}${item.opened_at ? "· Opened " : ""}${item.clicked_at ? "· Clicked" : "—"}</td></tr>`).join("")}
      </tbody></table></div>` : empty("No email history", "Preview and confirm a one-to-one or scheduled follow-up.", "compose-email", "Compose email")}`;
  }

  function openModal(title, body, footer = "") {
    closeModal();
    const shell = document.createElement("div");
    shell.className = "crm-modal-shell";
    shell.innerHTML = `<div class="crm-modal" role="dialog" aria-modal="true" aria-labelledby="crm-modal-title">
      <div class="crm-modal-head"><div class="crm-modal-title" id="crm-modal-title">${h(title)}</div><button class="crm-modal-close" data-action="close-modal" aria-label="Close">×</button></div>
      <div class="crm-modal-body">${body}</div><div class="crm-modal-foot">${footer || button("Close", "close-modal", "ghost")}</div>
    </div>`;
    document.body.appendChild(shell);
    shell.addEventListener("click", handleAction);
    shell.addEventListener("submit", handleSubmit);
    shell.addEventListener("keydown", trapModal);
    setTimeout(() => shell.querySelector("input,select,textarea,button")?.focus(), 0);
  }

  function closeModal() { document.querySelector(".crm-modal-shell")?.remove(); }
  function trapModal(event) {
    if (event.key === "Escape") { closeModal(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll("button,input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter((item) => !item.disabled);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const field = (label, name, type = "text", value = "", extra = "", full = false) =>
    `<div class="crm-field ${full ? "full" : ""}"><label for="crm-${name}">${h(label)}</label><input class="crm-input" id="crm-${name}" name="${h(name)}" type="${h(type)}" value="${h(value)}" ${extra}></div>`;
  const selectField = (label, name, options, value = "", full = false) =>
    `<div class="crm-field ${full ? "full" : ""}"><label for="crm-${name}">${h(label)}</label><select class="crm-select" id="crm-${name}" name="${h(name)}">${options.map((option) => `<option value="${h(option)}" ${option === value ? "selected" : ""}>${h(pretty(option))}</option>`).join("")}</select></div>`;
  const textarea = (label, name, value = "", full = true) =>
    `<div class="crm-field ${full ? "full" : ""}"><label for="crm-${name}">${h(label)}</label><textarea class="crm-textarea" id="crm-${name}" name="${h(name)}">${h(value)}</textarea></div>`;
  const formFooter = (label) => `${button("Cancel", "close-modal", "ghost")}<button class="crm-button" type="submit">${h(label)}</button>`;

  function formData(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    Object.keys(data).forEach((key) => { if (data[key] === "") data[key] = null; });
    return data;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submit = form.closest(".crm-modal")?.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;
    try {
      const data = formData(form);
      const base = `/companies/${state.companyId}`;
      if (form.dataset.form === "lead") {
        await api(`${base}/crm/leads`, { method: "POST", body: data });
      } else if (form.dataset.form === "opportunity") {
        await api(`${base}/crm/opportunities`, { method: "POST", body: data });
      } else if (form.dataset.form === "contact") {
        data.is_primary = form.elements.is_primary.checked;
        await api(`${base}/crm/contacts`, { method: "POST", body: data });
      } else if (form.dataset.form === "activity") {
        await api(`${base}/crm/activities`, { method: "POST", body: data });
      } else if (form.dataset.form === "campaign") {
        await api(`${base}/crm/campaigns`, { method: "POST", body: data });
      } else if (form.dataset.form === "template") {
        await api(`${base}/crm/email/templates`, { method: "POST", body: data });
      } else if (form.dataset.form === "suppression") {
        await api(`${base}/crm/email/suppressions`, { method: "POST", body: data });
      } else if (form.dataset.form === "settings") {
        state.apiBase = String(data.api_url).replace(/\/$/, "");
        state.apiKey = data.api_key || "";
        localStorage.setItem("alaada_acc_api", state.apiBase);
        localStorage.setItem("alaada_acc_api_key", state.apiKey);
        await loadCompanies();
      } else if (form.dataset.form === "bulk-assign") {
        await api(`${base}/crm/leads/bulk-assign`, { method: "POST", body: { lead_ids: [...state.selected], owner: data.owner } });
        state.selected.clear();
      } else if (form.dataset.form === "score") {
        await api(`${base}/crm/leads/${form.dataset.id}/score`, { method: "POST", body: { score: data.score ? Number(data.score) : null, recommended_action: data.recommended_action, scored_by: data.scored_by } });
      } else if (form.dataset.form === "compose") {
        data.idempotency_key = crypto.randomUUID();
        data.scheduled_at = data.scheduled_at ? new Date(data.scheduled_at).toISOString() : null;
        const preview = await api(`${base}/crm/email/preview`, { method: "POST", body: data });
        showEmailPreview(data, preview);
        return;
      }
      closeModal();
      toast("CRM record saved.");
      state.data = {};
      await render();
    } catch (error) {
      toast(error.message, true);
      if (submit) submit.disabled = false;
    }
  }

  async function handleAction(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "view") { state.view = target.dataset.view; state.search = ""; await render(); }
    else if (action === "refresh") await render();
    else if (action === "close-modal") closeModal();
    else if (action === "quick-add") showQuickAdd();
    else if (action === "settings") showSettings();
    else if (action === "add-lead") showLeadForm();
    else if (action === "add-opportunity") await showOpportunityForm();
    else if (action === "add-contact") await showContactForm();
    else if (action === "add-activity") await showActivityForm();
    else if (action === "add-campaign") showCampaignForm();
    else if (action === "add-email-template") showTemplateForm();
    else if (action === "add-suppression") showSuppressionForm();
    else if (action === "compose-email") await showComposeForm();
    else if (action === "lead-view") { state.leadView = target.dataset.mode; await renderLeads(); }
    else if (action === "lead-detail") await showLeadDetail(target.dataset.id);
    else if (action === "opportunity-detail") await showOpportunityDetail(target.dataset.id);
    else if (action === "contact-detail") await showContactDetail(target.dataset.id);
    else if (action === "account-detail") await showAccountDetail(target.dataset.id);
    else if (action === "pipeline-view") { state.view = "pipeline"; await render(); }
    else if (action === "complete-activity") await completeActivity(target.dataset.id);
    else if (action === "calendar-prev" || action === "calendar-next") { state.calendarDate.setMonth(state.calendarDate.getMonth() + (action.endsWith("next") ? 1 : -1)); await renderCalendar(); }
    else if (action === "bulk-assign") showBulkAssign();
    else if (action === "duplicates") await showDuplicates();
    else if (action === "export-leads") exportLeads();
    else if (action === "import-leads") importLeads();
    else if (action === "confirm-convert") await convertLead(target.dataset.id);
    else if (action === "convert-lead") confirmLeadConversion(target.dataset.id);
    else if (action === "score-lead") showScoreForm(target.dataset.id);
    else if (action === "move-opportunity") await moveOpportunity(target.dataset.id, target.dataset.stage);
    else if (action === "confirm-email") await confirmEmail(target);
    else if (action === "select-all-leads") {
      const checked = target.checked;
      document.querySelectorAll("[data-select-lead]").forEach((input) => { input.checked = checked; checked ? state.selected.add(input.dataset.selectLead) : state.selected.delete(input.dataset.selectLead); });
    }
  }

  function handleChange(event) {
    if (event.target.matches("[data-select-lead]")) {
      event.target.checked ? state.selected.add(event.target.dataset.selectLead) : state.selected.delete(event.target.dataset.selectLead);
    }
  }
  let searchTimer;
  function handleInput(event) {
    if (!event.target.matches("[data-role='search']")) return;
    state.search = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (state.view === "leads") renderLeads();
      else if (state.view === "contacts") renderContacts();
      else if (state.view === "accounts") renderAccounts();
      else if (state.view === "activities") renderActivities();
    }, 180);
  }

  function showQuickAdd() {
    openModal("Create CRM record", `<div class="crm-form-grid">
      ${button("Lead", "add-lead", "secondary")}${button("Opportunity", "add-opportunity", "secondary")}
      ${button("Contact", "add-contact", "secondary")}${button("Task or activity", "add-activity", "secondary")}
      ${button("Campaign", "add-campaign", "secondary")}${button("Email", "compose-email", "secondary")}
    </div>`);
  }
  function showSettings() {
    openModal("CRM connection", `<form data-form="settings"><div class="crm-notice info">CRM shares the Accounts API URL, API key and selected company. Secrets stay in browser storage only for this client.</div><div class="crm-form-grid">
      ${field("Accounts API URL", "api_url", "url", state.apiBase, "required", true)}
      ${field("API key", "api_key", "password", state.apiKey, "", true)}
    </div></form>`, formFooter("Save & reconnect"));
  }
  function showLeadForm() {
    openModal("Add lead", `<form data-form="lead"><div class="crm-form-grid">
      ${field("Lead name", "name", "text", "", "required")}${field("Company", "company_name")}
      ${field("Email", "email", "email")}${field("Phone", "phone", "tel")}
      ${field("Source", "source")}${field("Owner", "owner")}
      ${selectField("Status", "status", LEAD_STATUSES, "NEW")}${field("Expected value", "expected_value", "number", "0", "min='0' step='0.01'")}
      ${field("Expected close", "expected_close_date", "date")}${field("Tags (comma-separated)", "tags")}
      ${textarea("Qualification", "qualification")}${textarea("Notes", "notes")}
    </div></form>`, formFooter("Create lead"));
  }
  async function showOpportunityForm() {
    const [customers, leads] = await Promise.all([
      api(`/companies/${state.companyId}/customers`, { qs: { page_size: 500 } }),
      api(`/companies/${state.companyId}/crm/leads`, { qs: { page_size: 500 } }),
    ]);
    const customerOptions = [`<option value="">No company</option>`, ...pageItems(customers).map((item) => `<option value="${item.id}">${h(item.name)}</option>`)].join("");
    const leadOptions = [`<option value="">No source lead</option>`, ...pageItems(leads).map((item) => `<option value="${item.id}">${h(item.name)}</option>`)].join("");
    openModal("Add opportunity", `<form data-form="opportunity"><div class="crm-form-grid">
      ${field("Opportunity title", "title", "text", "", "required")}${selectField("Stage", "stage", STAGES, "PROSPECTING")}
      <div class="crm-field"><label>CRM company</label><select class="crm-select" name="customer_id">${customerOptions}</select></div>
      <div class="crm-field"><label>Source lead</label><select class="crm-select" name="lead_id">${leadOptions}</select></div>
      ${field("Value", "amount", "number", "0", "min='0' step='0.01'")}${field("Probability %", "probability_percent", "number", "0", "min='0' max='100' step='0.01'")}
      ${field("Expected close", "expected_close_date", "date")}${field("Owner", "owner")}
      ${field("Products / services", "products_services")}${field("Competitor", "competitor")}
      ${textarea("Next action", "next_action")}${textarea("Notes", "notes")}
    </div></form>`, formFooter("Create opportunity"));
  }
  async function showContactForm() {
    const customers = pageItems(await api(`/companies/${state.companyId}/customers`, { qs: { page_size: 500 } }));
    openModal("Add contact", `<form data-form="contact"><div class="crm-form-grid">
      ${field("Contact name", "name", "text", "", "required")}${field("Role / title", "designation")}
      ${field("Email", "email", "email")}${field("Phone", "phone", "tel")}
      <div class="crm-field full"><label>CRM company</label><select class="crm-select" name="customer_id"><option value="">Unlinked</option>${customers.map((item) => `<option value="${item.id}">${h(item.name)}</option>`).join("")}</select></div>
      <label class="crm-field full" style="flex-direction:row;align-items:center"><input class="crm-checkbox" type="checkbox" name="is_primary"> Primary contact</label>
      ${textarea("Communication preferences / notes", "notes")}
    </div></form>`, formFooter("Create contact"));
  }
  async function showActivityForm() {
    const [leads, opportunities, contacts, customers] = await Promise.all([
      api(`/companies/${state.companyId}/crm/leads`, { qs: { page_size: 500 } }),
      api(`/companies/${state.companyId}/crm/opportunities`, { qs: { page_size: 500 } }),
      api(`/companies/${state.companyId}/crm/contacts`, { qs: { page_size: 500 } }),
      api(`/companies/${state.companyId}/customers`, { qs: { page_size: 500 } }),
    ]);
    const relation = (name, items, label) => `<div class="crm-field"><label>${label}</label><select class="crm-select" name="${name}"><option value="">None</option>${pageItems(items).map((item) => `<option value="${item.id}">${h(item.name || item.title)}</option>`).join("")}</select></div>`;
    openModal("Add task or activity", `<form data-form="activity"><div class="crm-form-grid">
      ${field("Subject", "subject", "text", "", "required")}${selectField("Type", "activity_type", ACTIVITY_TYPES, "FOLLOW_UP")}
      ${field("Activity date", "activity_date", "date", today(), "required")}${field("Due date", "due_date", "date")}
      ${field("Owner", "owner")}${selectField("Status", "status", ["OPEN", "DONE", "CANCELLED"], "OPEN")}
      ${relation("lead_id", leads, "Related lead")}${relation("opportunity_id", opportunities, "Related opportunity")}
      ${relation("contact_id", contacts, "Related contact")}${relation("customer_id", customers, "Related company")}
      ${textarea("Priority, reminder or outcome", "outcome")}
    </div></form>`, formFooter("Create activity"));
  }
  function showCampaignForm() {
    openModal("Add campaign", `<form data-form="campaign"><div class="crm-form-grid">
      ${field("Campaign code", "campaign_code", "text", "", "required")}${field("Name", "name", "text", "", "required")}
      ${selectField("Channel", "channel", ["EMAIL", "WHATSAPP", "SMS", "SOCIAL", "WEB", "EVENT", "PARTNER", "OTHER"], "EMAIL")}
      ${selectField("Status", "status", ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"], "DRAFT")}
      ${field("Start date", "start_date", "date", today(), "required")}${field("End date", "end_date", "date")}
      ${field("Budget", "budget_amount", "number", "0", "min='0' step='0.01'")}${field("Expected revenue", "expected_revenue", "number", "0", "min='0' step='0.01'")}
      ${textarea("Notes", "notes")}
    </div></form>`, formFooter("Create campaign"));
  }
  function showTemplateForm() {
    openModal("Create email template", `<form data-form="template"><div class="crm-form-grid">
      ${field("Template name", "name", "text", "", "required")}${selectField("Classification", "classification", ["TRANSACTIONAL", "MARKETING"], "TRANSACTIONAL")}
      ${field("Subject", "subject", "text", "", "required", true)}${textarea("HTML body", "html_body")}${textarea("Plain-text body", "text_body")}
    </div></form>`, formFooter("Create template"));
  }
  function showSuppressionForm() {
    openModal("Unsubscribe recipient", `<form data-form="suppression"><div class="crm-notice danger">This blocks future marketing email for the recipient. Transactional email remains possible when legally necessary.</div><div class="crm-form-grid">
      ${field("Email", "email", "email", "", "required", true)}${field("Source", "source", "text", "preference-centre", "", true)}
      <input type="hidden" name="reason" value="UNSUBSCRIBED">
    </div></form>`, formFooter("Confirm unsubscribe"));
  }
  async function showComposeForm() {
    const [contacts, leads, campaigns, templates] = await Promise.all([
      api(`/companies/${state.companyId}/crm/contacts`, { qs: { page_size: 500 } }),
      api(`/companies/${state.companyId}/crm/leads`, { qs: { page_size: 500 } }),
      api(`/companies/${state.companyId}/crm/campaigns`, { qs: { page_size: 500 } }),
      api(`/companies/${state.companyId}/crm/email/templates`),
    ]);
    const options = (items, label) => `<option value="">${label}</option>${pageItems(items).map((item) => `<option value="${item.id}">${h(item.name || item.campaign_code)}</option>`).join("")}`;
    openModal("Compose CRM email", `<form data-form="compose"><div class="crm-notice info">You will see a complete preview and suppression check before anything is sent or scheduled.</div><div class="crm-form-grid">
      ${field("From", "from_email", "email", "sales@alaada.com", "required")}${field("To", "to_email", "email", "", "required")}
      ${selectField("Classification", "classification", ["TRANSACTIONAL", "MARKETING"], "TRANSACTIONAL")}${field("Schedule (optional)", "scheduled_at", "datetime-local")}
      <div class="crm-field"><label>Contact</label><select class="crm-select" name="contact_id">${options(contacts, "No contact relation")}</select></div>
      <div class="crm-field"><label>Lead</label><select class="crm-select" name="lead_id">${options(leads, "No lead relation")}</select></div>
      <div class="crm-field"><label>Campaign</label><select class="crm-select" name="campaign_id">${options(campaigns, "No campaign")}</select></div>
      <div class="crm-field"><label>Template</label><select class="crm-select" name="template_id">${options(templates, "No template")}</select></div>
      ${field("Subject", "subject", "text", "", "required", true)}${textarea("HTML body", "html_body")}${textarea("Plain-text body", "text_body")}
      <input type="hidden" name="created_by" value="${h(document.getElementById("user-email-display")?.textContent || "")}">
    </div></form>`, formFooter("Preview email"));
  }

  function showEmailPreview(payload, preview) {
    const encoded = encodeURIComponent(JSON.stringify(payload));
    openModal("Review email", `<div class="${preview.blocked ? "crm-notice danger" : "crm-notice info"}">${preview.blocked ? `Blocked: ${h(preview.block_reason)}` : "Validation passed. Confirm the external action below."}</div>
      <div class="crm-detail-grid"><div class="crm-detail"><span>Recipient</span><strong>${h(payload.to_email)}</strong></div><div class="crm-detail"><span>Classification</span><strong>${h(pretty(payload.classification))}</strong></div>
      <div class="crm-detail"><span>Delivery</span><strong>${payload.scheduled_at ? h(new Date(payload.scheduled_at).toLocaleString()) : "Send now via Resend"}</strong></div><div class="crm-detail"><span>Subject</span><strong>${h(payload.subject)}</strong></div></div>
      <div class="crm-panel" style="margin-top:13px"><div class="crm-panel-title">Message preview</div>${payload.html_body}</div>`,
      `${button("Cancel", "close-modal", "ghost")}<button class="crm-button" data-action="confirm-email" data-payload="${h(encoded)}" ${preview.blocked ? "disabled" : ""}>Confirm ${payload.scheduled_at ? "schedule" : "send"}</button>`);
  }

  async function confirmEmail(target) {
    target.disabled = true;
    try {
      const payload = JSON.parse(decodeURIComponent(target.dataset.payload));
      const result = await api(`/companies/${state.companyId}/crm/email/send`, { method: "POST", body: payload });
      closeModal();
      toast(result.status === "FAILED" ? result.provider_error : `Email ${pretty(result.status).toLowerCase()}`, result.status === "FAILED");
      await renderEmail();
    } catch (error) { toast(error.message, true); target.disabled = false; }
  }

  async function showLeadDetail(id) {
    const lead = state.data.leads?.find((item) => item.id === id) || pageItems(await api(`/companies/${state.companyId}/crm/leads`, { qs: { page_size: 500 } })).find((item) => item.id === id);
    const [notes, scores] = await Promise.all([
      api(`/companies/${state.companyId}/crm/notes`, { qs: { entity_type: "LEAD", entity_id: id, page_size: 100 } }),
      api(`/companies/${state.companyId}/crm/lead-scores`, { qs: { lead_id: id } }),
    ]);
    openModal(lead.name, `<div class="crm-detail-grid">
      <div class="crm-detail"><span>Status</span><strong>${pretty(lead.status)}</strong></div><div class="crm-detail"><span>Owner</span><strong>${h(lead.owner || "Unassigned")}</strong></div>
      <div class="crm-detail"><span>Source</span><strong>${h(lead.source || "—")}</strong></div><div class="crm-detail"><span>Expected value</span><strong>${money(lead.expected_value)}</strong></div>
      <div class="crm-detail"><span>Contact</span><strong>${h(lead.email || lead.phone || "—")}</strong></div><div class="crm-detail"><span>Tags</span><strong>${h(lead.tags || "—")}</strong></div>
      <div class="crm-detail" style="grid-column:1/-1"><span>Qualification</span><strong>${h(lead.qualification || "Not recorded")}</strong></div></div>
      <div class="crm-panel" style="margin-top:13px"><div class="crm-panel-title">Lead score</div>${scores[0] ? `${scores[0].score} · ${badge(scores[0].score_band)} · ${h(scores[0].recommended_action || "")}` : "Not scored"}</div>
      <div class="crm-panel" style="margin-top:13px"><div class="crm-panel-title">Notes</div>${pageItems(notes).map((note) => `<p style="font-size:.76rem;margin-bottom:8px">${h(note.note)}</p>`).join("") || "No notes"}</div>`,
      `${button("Score", `score-lead`, "secondary").replace('data-action="score-lead"', `data-action="score-lead" data-id="${id}"`)}
       ${lead.status !== "CONVERTED" ? `<button class="crm-button" data-action="convert-lead" data-id="${id}">Convert lead</button>` : badge("CONVERTED")}
       ${button("Close", "close-modal", "ghost")}`);
  }
  function showScoreForm(id) {
    openModal("Score lead", `<form data-form="score" data-id="${id}"><div class="crm-form-grid">${field("Score (blank for automatic)", "score", "number", "", "min='0' max='100'")}
      ${field("Scored by", "scored_by")}${textarea("Recommended action", "recommended_action")}</div></form>`, formFooter("Save score"));
  }
  function confirmLeadConversion(id) {
    openModal("Convert lead", `<div class="crm-notice">Conversion creates or links a customer and may also create an opportunity. Review this change before applying.</div>
      <p style="font-size:.8rem;line-height:1.6">Create a customer from this lead and open an opportunity using the lead’s expected value?</p>`,
      `${button("Cancel", "close-modal", "ghost")}<button class="crm-button" data-action="confirm-convert" data-id="${id}">Convert & create opportunity</button>`);
  }
  async function convertLead(id) {
    await api(`/companies/${state.companyId}/crm/leads/${id}/convert`, { method: "POST", body: { create_opportunity: true } });
    closeModal(); toast("Lead converted."); await render();
  }
  async function showOpportunityDetail(id) {
    const item = state.data.opportunities?.find((row) => row.id === id) || pageItems(await api(`/companies/${state.companyId}/crm/opportunities`, { qs: { page_size: 500 } })).find((row) => row.id === id);
    openModal(item.title, `<div class="crm-detail-grid">
      <div class="crm-detail"><span>Stage</span><strong>${pretty(item.stage)}</strong></div><div class="crm-detail"><span>Forecast</span><strong>${money(Number(item.amount) * Number(item.probability_percent) / 100)}</strong></div>
      <div class="crm-detail"><span>Value / probability</span><strong>${money(item.amount)} · ${item.probability_percent}%</strong></div><div class="crm-detail"><span>Expected close</span><strong>${dateText(item.expected_close_date)}</strong></div>
      <div class="crm-detail"><span>Products / services</span><strong>${h(item.products_services || "—")}</strong></div><div class="crm-detail"><span>Competitor</span><strong>${h(item.competitor || "—")}</strong></div>
      <div class="crm-detail" style="grid-column:1/-1"><span>Next action</span><strong>${h(item.next_action || "Not set")}</strong></div></div>
      <div class="crm-field" style="margin-top:14px"><label>Move stage</label><select class="crm-select" data-action="move-opportunity" data-id="${item.id}" onchange="this.dataset.stage=this.value;this.click()">${STAGES.map((stage) => `<option value="${stage}" ${stage === item.stage ? "selected" : ""}>${pretty(stage)}</option>`).join("")}</select></div>`);
  }
  async function moveOpportunity(id, stage) {
    if (!stage) return;
    await api(`/companies/${state.companyId}/crm/opportunities/${id}`, { method: "PATCH", body: { stage } });
    closeModal(); toast("Opportunity stage updated."); await renderPipeline();
  }
  async function showContactDetail(id) {
    const contact = state.data.contacts.find((item) => item.id === id);
    const activities = pageItems(await api(`/companies/${state.companyId}/crm/activities`, { qs: { page_size: 500 } })).filter((item) => item.contact_id === id);
    const deals = (state.data.opportunities || []).filter((item) => item.customer_id && item.customer_id === contact.customer_id);
    openModal(contact.name, `<div class="crm-detail-grid">
      <div class="crm-detail"><span>Role</span><strong>${h(contact.designation || "—")}</strong></div><div class="crm-detail"><span>Contact</span><strong>${h(contact.email || contact.phone || "—")}</strong></div>
      <div class="crm-detail" style="grid-column:1/-1"><span>Communication preferences</span><strong>${h(contact.notes || "Not recorded")}</strong></div></div>
      <div class="crm-panel" style="margin-top:13px"><div class="crm-panel-title">Linked opportunities</div>${deals.map((deal) => `<p style="font-size:.76rem;margin-bottom:7px">${h(deal.title)} · ${pretty(deal.stage)} · ${money(deal.amount)}</p>`).join("") || "No linked opportunities"}</div>
      <div class="crm-panel" style="margin-top:13px"><div class="crm-panel-title">Activity history</div>${activities.map((item) => `<p style="font-size:.76rem;margin-bottom:7px">${dateText(item.activity_date)} · ${h(item.subject)}</p>`).join("") || "No activity"}</div>`);
  }
  async function showAccountDetail(id) {
    const customer = state.data.customers.find((item) => item.id === id);
    const [timeline, invoices, payments] = await Promise.all([
      api(`/companies/${state.companyId}/crm/customers/${id}/timeline`),
      api(`/companies/${state.companyId}/sales/invoices`, { qs: { page_size: 100, customer_id: id } }).catch(() => ({ items: [] })),
      api(`/companies/${state.companyId}/payments`, { qs: { page_size: 100, customer_id: id } }).catch(() => ({ items: [] })),
    ]);
    openModal(customer.name, `<div class="crm-notice info">Financial history is read from Accounts under the current company permission context.</div>
      <div class="crm-detail-grid"><div class="crm-detail"><span>Status</span><strong>${pretty(customer.status)}</strong></div><div class="crm-detail"><span>Billing contact</span><strong>${h(customer.contact_person || customer.email || "—")}</strong></div>
      <div class="crm-detail"><span>Invoices</span><strong>${pageItems(invoices).length}</strong></div><div class="crm-detail"><span>Payments</span><strong>${pageItems(payments).length}</strong></div></div>
      <div class="crm-panel" style="margin-top:13px"><div class="crm-panel-title">Customer timeline</div><div class="crm-timeline">${timeline.map((item) => `<div class="crm-timeline-item"><div class="crm-timeline-title">${h(item.title)}</div><div class="crm-timeline-meta">${pretty(item.item_type)} · ${dateText(item.item_date)} ${item.amount ? `· ${money(item.amount)}` : ""}</div></div>`).join("") || "No timeline events"}</div></div>`);
  }
  async function completeActivity(id) {
    await api(`/companies/${state.companyId}/crm/activities/${id}`, { method: "PATCH", body: { status: "DONE" } });
    toast("Activity completed."); await renderActivities();
  }
  function showBulkAssign() {
    if (!state.selected.size) { toast("Select at least one lead first.", true); return; }
    openModal("Assign selected leads", `<form data-form="bulk-assign"><div class="crm-notice">${state.selected.size} lead(s) will be assigned. No other lead fields will change.</div>${field("Owner", "owner", "text", "", "required", true)}</form>`, formFooter("Apply assignment"));
  }
  async function showDuplicates() {
    const groups = await api(`/companies/${state.companyId}/crm/leads/duplicates`);
    openModal("Potential duplicate leads", groups.length ? groups.map((group) => `<div class="crm-panel" style="margin-bottom:10px"><div class="crm-panel-title">${h(group.reason)}: ${h(group.match_key)}</div>${group.leads.map((lead) => `<p style="font-size:.76rem;margin-bottom:6px">${h(lead.name)} · ${h(lead.company_name || "No company")}</p>`).join("")}</div>`).join("") : empty("No duplicates found", "Email and phone keys are unique across the current lead set."));
  }
  function exportLeads() {
    const rows = state.data.leads || [];
    const columns = ["name", "company_name", "email", "phone", "source", "status", "owner", "expected_value", "expected_close_date", "tags", "qualification", "notes"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\r\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = `alaada-crm-leads-${today()}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  function importLeads() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const text = await input.files[0].text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(",").map((item) => item.trim().replace(/^"|"$/g, ""));
      const rows = lines.map((line) => {
        const values = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((item) => item.replace(/,$/, "").replace(/^"|"$/g, "").replaceAll('""', '"')) || [];
        return Object.fromEntries(headers.map((key, index) => [key, values[index] || null]));
      });
      openModal("Preview lead import", `<div class="crm-notice">${rows.length} row(s) parsed. Import creates only the displayed lead records; existing leads are not changed.</div>
        <div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Status</th></tr></thead><tbody>${rows.slice(0, 50).map((row) => `<tr><td>${h(row.name)}</td><td>${h(row.company_name)}</td><td>${h(row.email)}</td><td>${h(row.status || "NEW")}</td></tr>`).join("")}</tbody></table></div>`,
        `${button("Cancel", "close-modal", "ghost")}<button class="crm-button" id="crm-confirm-import">Confirm import</button>`);
      document.getElementById("crm-confirm-import").onclick = async () => {
        const trigger = document.getElementById("crm-confirm-import"); trigger.disabled = true;
        try {
          for (const row of rows) {
            await api(`/companies/${state.companyId}/crm/leads`, { method: "POST", body: { ...row, status: row.status || "NEW", expected_value: row.expected_value || "0" } });
          }
          closeModal(); toast(`${rows.length} leads imported.`); await renderLeads();
        } catch (error) { toast(error.message, true); trigger.disabled = false; }
      };
    };
    input.click();
  }

  const originalShowPage = window.showPage;
  window.showPage = function (page) {
    originalShowPage?.(page);
    if (page === "crm") boot();
  };
  window.switchCRMView = function (view) {
    state.view = view === "contacts" ? "contacts" : "pipeline";
    render();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

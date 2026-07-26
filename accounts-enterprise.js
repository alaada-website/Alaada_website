/* Shared shell for dedicated Accounts modules. Plain JavaScript by design. */
(() => {
  "use strict";

  const A = window.AccountsEnterprise = {
    groups: [],
    renderers: {},
    register(viewName, renderer) {
      this.renderers[viewName] = renderer;
      VIEW_RENDERERS[viewName] = renderer;
    },
    addGroup(label, links, beforeLabel = "Reports") {
      this.groups.push({label, links, beforeLabel});
    },
    requireCompany() {
      if (STATE.companyId) return true;
      view().innerHTML = emptyState("◎", "Choose a company", "Select or create a company before opening this module.");
      return false;
    },
    status(value) {
      const text = String(value || "unknown");
      const css = text.toLowerCase().replaceAll("_", "-");
      return `<span class="enterprise-status ${esc(css)}">${esc(text.replaceAll("_", " "))}</span>`;
    },
    metric(label, value, hint = "") {
      return `<article class="enterprise-card"><div class="eyebrow">${esc(label)}</div><div class="metric">${esc(value ?? "—")}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</article>`;
    },
    panel(title, body, actions = "") {
      return `<section class="enterprise-panel"><div class="enterprise-panel-head"><h3>${esc(title)}</h3><div class="enterprise-actions">${actions}</div></div>${body}</section>`;
    },
    page(items) {
      return Array.isArray(items) ? items : (items?.items || []);
    },
    ledgerOptions(filter = () => true, selected = "") {
      return (STATE.ledgers || []).filter(filter).map(item =>
        `<option value="${esc(item.id)}" ${item.id === selected ? "selected" : ""}>${esc(item.name)}${item.code ? ` · ${esc(item.code)}` : ""}</option>`
      ).join("");
    },
    async ensureLedgers() {
      if (STATE.ledgers?.length) return STATE.ledgers;
      const data = await api(`/companies/${STATE.companyId}/ledgers`, {qs:{page_size:200}});
      STATE.ledgers = this.page(data);
      return STATE.ledgers;
    },
    async confirm({title, message, confirmLabel = "Confirm", danger = false}) {
      return new Promise(resolve => {
        openModal({
          title,
          bodyHtml:`<div class="enterprise-notice ${danger ? "danger" : "info"}">${esc(message)}</div><p style="color:var(--ink3);font-size:.78rem;">This action is recorded in the Accounts audit trail.</p>`,
          footHtml:`<button class="btn btn-ghost" id="enterprise-cancel">Cancel</button><button class="btn ${danger ? "btn-red" : "btn-blue"}" id="enterprise-confirm">${esc(confirmLabel)}</button>`,
          onMount:() => {
            document.getElementById("enterprise-cancel").onclick = () => { closeModal(); resolve(false); };
            document.getElementById("enterprise-confirm").onclick = () => { closeModal(); resolve(true); };
          }
        });
      });
    },
    formValue(id) {
      return document.getElementById(id)?.value?.trim() || "";
    },
    numberValue(id, fallback = 0) {
      const value = Number(document.getElementById(id)?.value);
      return Number.isFinite(value) ? value : fallback;
    },
    dateRange(prefix) {
      return {
        date_from: this.formValue(`${prefix}-from`) || `${new Date().getFullYear()}-01-01`,
        date_to: this.formValue(`${prefix}-to`) || todayStr(),
      };
    },
    rows(items, columns, empty = "No records found.") {
      if (!items?.length) return `<div class="enterprise-empty">${esc(empty)}</div>`;
      return `<div class="table-wrap"><table><thead><tr>${columns.map(column => `<th class="${column.num ? "num" : ""}">${esc(column.label)}</th>`).join("")}</tr></thead><tbody>${items.map(item =>
        `<tr>${columns.map(column => `<td class="${column.num ? "num" : ""}">${column.render ? column.render(item) : esc(item[column.key] ?? "—")}</td>`).join("")}</tr>`
      ).join("")}</tbody></table></div>`;
    },
  };

  function installNavigation() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar || sidebar.dataset.enterpriseReady) return;
    A.groups.forEach(group => {
      const target = [...sidebar.querySelectorAll(".side-label")].find(node => node.textContent.trim() === group.beforeLabel)?.parentElement;
      const section = document.createElement("div");
      section.className = "side-group enterprise-side-group";
      section.innerHTML = `<div class="side-label">${esc(group.label)}</div>${group.links.map(link =>
        `<div class="side-link" data-view="${esc(link.view)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="${link.path || "M8 12h8"}"/></svg>${esc(link.label)}</div>`
      ).join("")}`;
      sidebar.insertBefore(section, target || null);
    });
    sidebar.dataset.enterpriseReady = "true";
    renderSidebarRouting();
  }

  const baseOpenModal = openModal;
  openModal = function openAccessibleModal(options) {
    baseOpenModal(options);
    queueMicrotask(() => {
      const preferred = document.querySelector("#modal-body input, #modal-body select, #modal-body textarea, #modal-foot button");
      preferred?.focus();
    });
  };

  modalBackdrop.addEventListener("keydown", event => {
    if (!modalBackdrop.classList.contains("open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      const cancel = document.getElementById("enterprise-cancel");
      if (cancel) cancel.click();
      else closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...modalBackdrop.querySelectorAll("button,input,select,textarea,[tabindex]:not([tabindex='-1'])")]
      .filter(node => !node.disabled && node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("DOMContentLoaded", installNavigation);
})();

/* Product integration shim: UX guards only; Supabase/RLS remain authoritative. */
(function () {
  const product = document.body?.dataset?.alaadaProduct;
  if (!product || !window.AlaadaUMS) return;
  const publicProducts = new Set(['analyser']);
  window.AlaadaProduct = {
    product,
    async ready({ permission, feature, optional = false } = {}) {
      if (publicProducts.has(product) && optional) return true;
      await window.AlaadaUMS.refresh();
      if (!AlaadaUMS.user) { if (!optional) location.replace('/auth.html?next=' + encodeURIComponent(location.pathname)); return optional; }
      if (!AlaadaUMS.activeOrganizationId && !optional) { location.replace('/account.html'); return false; }
      if (permission && !(await AlaadaUMS.hasPermission(AlaadaUMS.activeOrganizationId, permission))) { if (!optional) document.dispatchEvent(new CustomEvent('alaada:access-denied', { detail: { product, permission } })); return optional; }
      if (feature) { const { data } = await AlaadaUMS.client.rpc('has_entitlement', { org: AlaadaUMS.activeOrganizationId, feature_key: feature }); if (data !== true) { if (!optional) document.dispatchEvent(new CustomEvent('alaada:feature-unavailable', { detail: { product, feature } })); return optional; } }
      return true;
    }
  };
  document.dispatchEvent(new CustomEvent('alaada:ums-ready', { detail: window.AlaadaProduct }));
  if (!publicProducts.has(product)) {
    const access = { orbit: { permission: 'orbit.use', feature: 'orbit.chat' }, sheets: { permission: 'sheets.read', feature: 'sheets.basic' }, accounts: { permission: 'accounts.read', feature: 'accounts.accounting' } }[product] || {};
    window.AlaadaProduct.ready(access).catch(() => document.dispatchEvent(new CustomEvent('alaada:access-denied', { detail: { product } })));
  }
})();

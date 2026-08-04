(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true} });
  let organizationId = null;
  let connection = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  async function ensureOrg(){
    if (organizationId) return organizationId;
    const { data } = await db.rpc('my_organizations');
    organizationId = data?.[0]?.organization_id || null;
    return organizationId;
  }

  function optionList(items, selected, label){
    return `<option value="">${label}</option>${(items || []).map(item => `<option value="${esc(item.id)}" ${item.id === selected || item.account_id === selected ? 'selected' : ''}>${esc(item.name || item.account_id || item.id)}</option>`).join('')}`;
  }

  async function loadConnection(){
    const org = await ensureOrg();
    if (!org) return;
    const { data, error } = await db.from('meta_connection_status').select('*').eq('organization_id', org).maybeSingle();
    if (error) {
      connection = null;
      render(error.message);
      return;
    }
    connection = data || null;
    render();
  }

  function ensurePanel(){
    const host = document.querySelector('#recruitingAds .ads-layout');
    if (!host || document.getElementById('metaConnectionPanel')) return null;
    const panel = document.createElement('section');
    panel.id = 'metaConnectionPanel';
    panel.className = 'meta-connection-panel';
    const hero = host.querySelector('.ads-hero');
    hero?.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function render(errorMessage=''){
    const panel = ensurePanel();
    if (!panel) return;
    if (errorMessage) {
      panel.innerHTML = `<div><h3>Meta-Verbindung</h3><p class="meta-error">${esc(errorMessage)}</p></div>`;
      return;
    }
    if (!connection) {
      panel.innerHTML = `<div><span class="meta-kicker">META BUSINESS</span><h3>Werbekonto verbinden</h3><p class="muted">Verbinde Meta, damit freigegebene Recruiting-Kampagnen später pausiert im Ads Manager angelegt werden können.</p></div><button id="connectMetaBtn" class="btn primary">Meta verbinden</button>`;
      document.getElementById('connectMetaBtn').onclick = connectMeta;
      return;
    }

    const pages = connection.pages || [];
    const selectedPage = pages.find(page => page.id === connection.selected_page_id);
    const instagramAccounts = selectedPage?.instagram_business_account ? [selectedPage.instagram_business_account] : [];
    panel.innerHTML = `
      <div class="meta-connection-head">
        <div><span class="meta-kicker">META BUSINESS</span><h3>${esc(connection.meta_user_name || 'Verbunden')}</h3><p class="muted">Status: ${esc(connection.status)}${connection.last_synced_at ? ` · synchronisiert ${new Date(connection.last_synced_at).toLocaleString('de-DE')}` : ''}</p></div>
        <span class="badge green">Verbunden</span>
      </div>
      <form id="metaAssetsForm" class="meta-assets-form">
        <div><label>Business</label><select name="business_id">${optionList(connection.businesses, connection.selected_business_id, 'Business auswählen')}</select></div>
        <div><label>Werbekonto</label><select name="ad_account_id">${optionList(connection.ad_accounts, connection.selected_ad_account_id, 'Werbekonto auswählen')}</select></div>
        <div><label>Facebook-Seite</label><select name="page_id">${optionList(pages, connection.selected_page_id, 'Seite auswählen')}</select></div>
        <div><label>Instagram-Konto</label><select name="instagram_account_id">${optionList(instagramAccounts, connection.selected_instagram_account_id, 'Optional')}</select></div>
        <div class="meta-assets-actions"><button class="btn primary" type="submit">Auswahl speichern</button><button id="reconnectMetaBtn" class="btn" type="button">Neu verbinden</button></div>
        <div id="metaConnectionMessage" class="message"></div>
      </form>`;
    document.getElementById('metaAssetsForm').onsubmit = saveAssets;
    document.getElementById('reconnectMetaBtn').onclick = connectMeta;
    document.querySelector('[name="page_id"]').onchange = () => {
      const page = pages.find(item => item.id === document.querySelector('[name="page_id"]').value);
      const instagram = document.querySelector('[name="instagram_account_id"]');
      instagram.innerHTML = optionList(page?.instagram_business_account ? [page.instagram_business_account] : [], null, 'Optional');
    };
  }

  async function connectMeta(){
    const org = await ensureOrg();
    const { data, error } = await db.functions.invoke('meta-oauth-start', { body:{ organization_id: org } });
    if (error || data?.error) return alert(error?.message || data.error);
    const popup = window.open(data.url, 'meta-oauth', 'width=720,height=760');
    const timer = setInterval(async () => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        await loadConnection();
      }
    }, 1000);
  }

  async function saveAssets(event){
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      organization_id: organizationId,
      business_id: form.get('business_id') || null,
      ad_account_id: form.get('ad_account_id') || null,
      page_id: form.get('page_id') || null,
      instagram_account_id: form.get('instagram_account_id') || null,
    };
    const message = document.getElementById('metaConnectionMessage');
    message.textContent = 'Auswahl wird gespeichert …';
    const { data, error } = await db.functions.invoke('meta-select-assets', { body: payload });
    if (error || data?.error) {
      message.textContent = error?.message || data.error;
      message.className = 'message error-text';
      return;
    }
    message.textContent = 'Meta-Ressourcen gespeichert.';
    message.className = 'message success-text';
    await loadConnection();
  }

  const observer = new MutationObserver(() => {
    if (document.getElementById('recruitingAds')?.classList.contains('active')) loadConnection();
  });
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
})();

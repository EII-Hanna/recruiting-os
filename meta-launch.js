(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let connection = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  async function loadConnection() {
    const { data } = await db.from('meta_connection_status').select('*').maybeSingle();
    connection = data || null;
  }

  function enhanceCards() {
    document.querySelectorAll('.campaign-card').forEach(card => {
      if (card.dataset.metaLaunchReady) return;
      const approveButton = card.querySelector('[data-approve]');
      const packageButton = card.querySelector('[data-view-package]');
      const sourceButton = approveButton || packageButton;
      const campaignId = sourceButton?.dataset.approve || sourceButton?.dataset.viewPackage;
      if (!campaignId) return;

      const statusText = card.textContent || '';
      const actions = card.querySelector('.campaign-actions');
      if (!actions) return;

      if (/Freigegeben/.test(statusText)) {
        const button = document.createElement('button');
        button.className = 'btn primary';
        button.textContent = 'Bei Meta anlegen';
        button.dataset.metaLaunch = campaignId;
        button.addEventListener('click', () => openLaunchModal(campaignId));
        actions.appendChild(button);
      }

      if (/Pausiert/.test(statusText)) {
        const badge = document.createElement('span');
        badge.className = 'badge green';
        badge.textContent = 'In Meta erstellt · PAUSED';
        actions.appendChild(badge);
      }
      card.dataset.metaLaunchReady = '1';
    });
  }

  function ensureModal() {
    if (document.getElementById('metaLaunchModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="metaLaunchModal" class="ads-modal">
        <div class="ads-modal-card meta-launch-card">
          <div class="section-head"><h2>Meta-Kampagne anlegen</h2><button class="btn" data-meta-launch-close>Schließen</button></div>
          <div id="metaLaunchContent"></div>
        </div>
      </div>`);
    document.querySelector('[data-meta-launch-close]').addEventListener('click', closeModal);
  }

  function closeModal() {
    document.getElementById('metaLaunchModal')?.classList.remove('open');
  }

  async function openLaunchModal(campaignId) {
    ensureModal();
    await loadConnection();
    const modal = document.getElementById('metaLaunchModal');
    const content = document.getElementById('metaLaunchContent');
    modal.classList.add('open');

    if (!connection?.selected_ad_account_id || !connection?.selected_page_id) {
      content.innerHTML = `
        <div class="notice error">Meta ist noch nicht vollständig eingerichtet. Verbinde zuerst ein Werbekonto und eine Facebook-Seite.</div>
        <p class="muted">Danach kann RecruitingOS die freigegebene Kampagne im Status PAUSED anlegen.</p>`;
      return;
    }

    content.innerHTML = `
      <div class="meta-launch-summary">
        <div><small>Werbekonto</small><strong>${esc(connection.selected_ad_account_id)}</strong></div>
        <div><small>Facebook-Seite</small><strong>${esc(connection.selected_page_id)}</strong></div>
        <div><small>Status</small><strong>PAUSED</strong></div>
      </div>
      <form id="metaLaunchForm" class="ads-form">
        <div class="full-span"><label>Zielseite der Bewerbung</label><input name="destination_url" type="url" required placeholder="https://kunde.de/karriere/bewerbung"></div>
        <div class="full-span"><label>Öffentliche Creative-Bild-URL</label><input name="image_url" type="url" required placeholder="https://cdn.kunde.de/recruiting-anzeige.jpg"></div>
        <div class="meta-launch-check full-span">
          <strong>Sicherheitscheck</strong>
          <p>Campaign, Ad Set, Creative und Ad werden ausschließlich im Status <b>PAUSED</b> angelegt. Es wird kein Werbebudget ausgegeben.</p>
        </div>
        <label class="meta-confirm full-span"><input name="confirmed" type="checkbox" required> Ich habe Zielseite, Bild, Budget und Anzeigentexte geprüft.</label>
        <div class="modal-actions full-span"><button type="button" class="btn" data-meta-launch-cancel>Abbrechen</button><button type="submit" class="btn primary">Pausiert bei Meta anlegen</button></div>
        <div id="metaLaunchMessage" class="message full-span"></div>
      </form>`;

    document.querySelector('[data-meta-launch-cancel]').addEventListener('click', closeModal);
    document.getElementById('metaLaunchForm').addEventListener('submit', event => launch(event, campaignId));
  }

  async function launch(event, campaignId) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = document.getElementById('metaLaunchMessage');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Wird bei Meta angelegt …';
    message.textContent = 'Campaign, Ad Set, Creative und Ad werden erstellt.';
    message.className = 'message';

    const { data, error } = await db.functions.invoke('create-meta-campaign', {
      body: {
        campaign_id: campaignId,
        destination_url: form.get('destination_url'),
        image_url: form.get('image_url')
      }
    });

    if (error || data?.error) {
      message.textContent = data?.error || error?.message || 'Meta-Kampagne konnte nicht erstellt werden.';
      message.className = 'message error-text';
      submit.disabled = false;
      submit.textContent = 'Erneut versuchen';
      return;
    }

    message.innerHTML = `Erfolgreich angelegt: Campaign <b>${esc(data.campaign_id)}</b>, Ad <b>${esc(data.ad_id)}</b>. Status: PAUSED.`;
    message.className = 'message success-text';
    setTimeout(() => {
      closeModal();
      document.getElementById('adsRefresh')?.click();
    }, 1400);
  }

  const observer = new MutationObserver(enhanceCards);
  observer.observe(document.body, { childList: true, subtree: true });
  enhanceCards();
})();

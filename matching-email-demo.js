(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  let injected = false;
  let demoContext = null;

  async function getContext() {
    const { data: orgs } = await db.rpc('my_organizations');
    const orgId = orgs?.[0]?.organization_id;
    if (!orgId) return null;

    const [candidateRes, companyRes, jobRes] = await Promise.all([
      db.from('candidates').select('*').eq('organization_id', orgId).ilike('first_name','William').ilike('last_name','Hanna').limit(1),
      db.from('companies').select('*').eq('organization_id', orgId).order('created_at',{ascending:true}).limit(1),
      db.from('jobs').select('*,company:companies(name)').eq('organization_id', orgId).order('created_at',{ascending:true}).limit(1)
    ]);

    const candidate = candidateRes.data?.[0];
    const company = companyRes.data?.[0];
    const job = jobRes.data?.[0] || null;
    if (!candidate || !company) return null;

    return { orgId, candidate, company, job };
  }

  function buildEmail(ctx) {
    const c = ctx.candidate;
    const companyName = ctx.company.name || 'Ihr Unternehmen';
    const role = ctx.job?.title || 'Ihre aktuelle Vakanz';
    const firstName = ctx.company.contact_name?.split(' ')?.[0] || 'Guten Tag';
    const skills = Array.isArray(c.skills) && c.skills.length ? c.skills.slice(0,4).join(', ') : 'Vertrieb, Beratung und digitale Prozesse';
    const experience = c.years_experience ? `${c.years_experience} Jahre Berufserfahrung` : 'mehrjährige relevante Berufserfahrung';
    const location = c.location || 'flexibler Standort';
    const availability = c.availability_date ? new Date(c.availability_date).toLocaleDateString('de-DE') : (c.notice_period || 'nach Absprache');

    return {
      subject: `Passendes Kandidatenprofil für ${role}`,
      body: `${firstName},\n\nfür Ihre Position „${role}“ habe ich ein Profil identifiziert, das fachlich und vom bisherigen Werdegang sehr gut zu ${companyName} passt.\n\nKurzprofil:\n• ${experience}\n• Schwerpunkte: ${skills}\n• Standort: ${location}\n• Verfügbarkeit: ${availability}\n\nIm Anhang erhalten Sie das anonymisierte Kandidatenprofil. Besonders relevant sind die Verbindung aus operativer Erfahrung, Vertriebsverständnis und digitaler Prozesskompetenz.\n\nWann passt Ihnen ein kurzer Austausch zum Profil?\n\nBeste Grüße\nRecruitingOS Demo`,
      role,
      skills,
      experience,
      location,
      availability
    };
  }

  async function injectDemo() {
    const matching = document.getElementById('matching');
    if (!matching || !matching.classList.contains('active') || injected) return;

    demoContext = await getContext();
    if (!demoContext) return;

    const mail = buildEmail(demoContext);
    const candidateName = `${demoContext.candidate.first_name || ''} ${demoContext.candidate.last_name || ''}`.trim();
    const companyName = demoContext.company.name || 'Unternehmen';
    const list = document.getElementById('matchingList');
    const anchor = list || matching;

    anchor.insertAdjacentHTML('afterbegin', `
      <article class="matching-demo-card" data-matching-demo>
        <div class="matching-demo-top">
          <div>
            <span class="matching-demo-kicker">LIVE-DEMO · KI-MATCHING</span>
            <h3>${esc(candidateName)} → ${esc(companyName)}</h3>
            <p>${esc(mail.role)} · anonymisierte Kundenpräsentation</p>
          </div>
          <div class="matching-demo-score"><span>Match</span><strong>89%</strong></div>
        </div>
        <div class="matching-demo-grid">
          <div><small>KANDIDAT</small><strong>${esc(candidateName)}</strong><span>${esc(demoContext.candidate.current_title || 'Kandidatenprofil')}</span></div>
          <div><small>UNTERNEHMEN</small><strong>${esc(companyName)}</strong><span>${esc(demoContext.company.industry || 'Zielunternehmen')}</span></div>
          <div><small>STATUS</small><strong>Versandbereit</strong><span>Profil anonymisiert</span></div>
        </div>
        <div class="matching-demo-actions">
          <button class="btn" data-demo-preview>Profil ansehen</button>
          <button class="btn primary" data-demo-email>E-Mail-Vorschau öffnen</button>
        </div>
      </article>`);

    injected = true;
    anchor.querySelector('[data-demo-preview]')?.addEventListener('click', openProfilePreview);
    anchor.querySelector('[data-demo-email]')?.addEventListener('click', openEmailPreview);
  }

  function openProfilePreview() {
    if (!demoContext) return;
    const c = demoContext.candidate;
    const mail = buildEmail(demoContext);
    showModal(`
      <div class="matching-demo-modal-head"><div><small>ANONYMISIERTES PROFIL</small><h2>${esc(c.current_title || 'Kandidatenprofil')}</h2><p>Interne Kontaktdaten werden nicht angezeigt.</p></div><button class="btn" data-demo-close>Schließen</button></div>
      <div class="matching-profile-hero"><div class="matching-profile-avatar">WH</div><div><span>KANDIDAT 24-0815</span><h3>${esc(c.current_title || 'Kandidatenprofil')}</h3><p>${esc(mail.location)} · ${esc(mail.experience)}</p></div><strong>89% Match</strong></div>
      <div class="matching-profile-grid">
        <article><small>PROFILZUSAMMENFASSUNG</small><p>${esc(c.professional_summary || 'Erfahrener Kandidat mit ausgeprägtem Vertriebsverständnis, operativer Beratungserfahrung und hoher Affinität zu digitalen Geschäftsprozessen.')}</p></article>
        <article><small>KERNKOMPETENZEN</small><p>${esc(mail.skills)}</p></article>
        <article><small>VERFÜGBARKEIT</small><p>${esc(mail.availability)}</p></article>
        <article><small>GEHALTSRAHMEN</small><p>${c.salary_expectation ? new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(c.salary_expectation) : 'Nach Absprache'}</p></article>
      </div>`);
  }

  function openEmailPreview() {
    if (!demoContext) return;
    const mail = buildEmail(demoContext);
    const company = demoContext.company;
    const email = company.email || company.contact_email || 'ansprechpartner@unternehmen.de';
    showModal(`
      <div class="matching-demo-modal-head"><div><small>KUNDENVORSTELLUNG</small><h2>E-Mail an ${esc(company.name || 'Kunden')}</h2><p>Demo-Versand · es wird keine echte E-Mail verschickt.</p></div><button class="btn" data-demo-close>Schließen</button></div>
      <div class="matching-email-meta">
        <label>An<input value="${esc(email)}" readonly></label>
        <label>Betreff<input value="${esc(mail.subject)}" readonly></label>
      </div>
      <div class="matching-email-body">${esc(mail.body).replace(/\n/g,'<br>')}</div>
      <div class="matching-email-attachment"><span>PDF</span><div><strong>Anonymisiertes_Kandidatenprofil_William_Hanna.pdf</strong><small>Kundenversion · personenbezogene Daten entfernt</small></div><b>bereit</b></div>
      <div class="matching-followup-plan"><span>Heute · E-Mail</span><span>+2 Tage · Follow-up</span><span>+4 Tage · Anruf</span></div>
      <div class="matching-demo-modal-actions"><button class="btn" data-demo-close>Abbrechen</button><button class="btn primary" data-demo-send>Demo-E-Mail senden</button></div>
      <div class="matching-demo-result" data-demo-result></div>`);

    document.querySelector('[data-demo-send]')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = 'Gesendet ✓';
      const result = document.querySelector('[data-demo-result]');
      if (result) result.innerHTML = '<strong>Demo abgeschlossen.</strong> Profilversand dokumentiert · Follow-up in 2 Tagen · Anruf-Aufgabe in 4 Tagen.';
    });
  }

  function showModal(content) {
    document.getElementById('matchingEmailDemoModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="matchingEmailDemoModal" class="matching-demo-modal open"><div class="matching-demo-backdrop" data-demo-close></div><section>${content}</section></div>`);
    document.querySelectorAll('[data-demo-close]').forEach(el => el.addEventListener('click', () => document.getElementById('matchingEmailDemoModal')?.remove()));
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById('matching')?.classList.contains('active')) {
      injected = false;
      document.querySelector('[data-matching-demo]')?.remove();
      return;
    }
    injectDemo();
  });
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-view="matching"]')) setTimeout(injectDemo, 120);
  }, true);
})();

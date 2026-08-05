(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let orgId = null;
  let candidateId = null;

  async function ensureOrg() {
    if (orgId) return orgId;
    const { data } = await db.rpc('my_organizations');
    orgId = data?.[0]?.organization_id || null;
    return orgId;
  }

  document.addEventListener('click', event => {
    const opener = event.target.closest('.detail-open[data-kind="candidate"]');
    if (opener) candidateId = opener.dataset.id;
    const prepare = event.target.closest('[data-prepare-submission]');
    if (prepare) openSubmissionModal(prepare.dataset.candidateId, prepare.dataset.jobId);
  }, true);

  const observer = new MutationObserver(() => {
    addCandidateTab();
    enhanceMatchingCards();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function addCandidateTab() {
    const tabs = document.querySelector('.drawer-tabs');
    if (!tabs || !candidateId || tabs.querySelector('[data-tab="submission"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tab = 'submission';
    button.textContent = 'Vorstellung';
    button.addEventListener('click', event => {
      event.stopImmediatePropagation();
      tabs.querySelectorAll('button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      renderCandidateCockpit();
    });
    tabs.appendChild(button);
  }

  function enhanceMatchingCards() {
    document.querySelectorAll('#matchingList .match-card').forEach(card => {
      if (card.dataset.submissionEnhanced) return;
      const existing = [...card.querySelectorAll('button')].find(btn => String(btn.getAttribute('onclick') || '').includes('createApplication'));
      const match = String(existing?.getAttribute('onclick') || '').match(/createApplication\('([^']+)'\s*,\s*'([^']+)'/);
      if (!match) return;
      const button = document.createElement('button');
      button.className = 'btn candidate-submit-btn';
      button.type = 'button';
      button.textContent = 'Vorstellung vorbereiten';
      button.dataset.prepareSubmission = '1';
      button.dataset.candidateId = match[1];
      button.dataset.jobId = match[2];
      existing.insertAdjacentElement('afterend', button);
      card.dataset.submissionEnhanced = '1';
    });
  }

  async function getCandidateContext(id) {
    const org = await ensureOrg();
    const [candidate, readiness, consent, documents, profile, submissions] = await Promise.all([
      db.from('candidates').select('*').eq('organization_id', org).eq('id', id).single(),
      db.from('candidate_readiness').select('*').eq('organization_id', org).eq('candidate_id', id).maybeSingle(),
      db.from('candidate_consents').select('*').eq('organization_id', org).eq('candidate_id', id).eq('consent_type','privacy').maybeSingle(),
      db.from('documents').select('id,document_type,file_name,created_at').eq('organization_id', org).eq('candidate_id', id),
      db.from('candidate_profiles').select('*').eq('organization_id', org).eq('candidate_id', id).eq('profile_type','anonymous').order('version',{ascending:false}).limit(1),
      db.from('candidate_submissions').select('*,company:companies(name),job:jobs(title)').eq('organization_id', org).eq('candidate_id', id).order('created_at',{ascending:false}).limit(20)
    ]);
    return {
      candidate: candidate.data,
      readiness: readiness.data || {},
      consent: consent.data,
      documents: documents.data || [],
      profile: profile.data?.[0] || null,
      submissions: submissions.data || []
    };
  }

  async function renderCandidateCockpit() {
    const content = document.getElementById('drawerContent');
    if (!content || !candidateId) return;
    content.innerHTML = '<div class="drawer-loading">Vorstellungsprozess wird geladen …</div>';
    try {
      const ctx = await getCandidateContext(candidateId);
      const cv = ctx.documents.some(item => item.document_type === 'cv');
      const references = ctx.documents.some(item => ['reference','certificate'].includes(item.document_type));
      const candidate = ctx.candidate || {};
      const checks = {
        discovery_completed: Boolean(ctx.readiness.discovery_completed),
        privacy_confirmed: Boolean(ctx.consent?.status === 'confirmed' || ctx.readiness.privacy_confirmed),
        cv_received: cv,
        references_received: references,
        salary_captured: Boolean(candidate.salary_expectation),
        availability_captured: Boolean(candidate.availability_date || candidate.notice_period)
      };
      const ready = Object.values(checks).every(Boolean);
      content.innerHTML = `
        <section class="candidate-submit-cockpit">
          <div class="candidate-submit-hero">
            <div><small>Matching & Kundenpräsentation</small><h2>${esc(`${candidate.first_name || ''} ${candidate.last_name || ''}`.trim())}</h2><p>${esc(candidate.current_title || 'Kandidatenprofil')}</p></div>
            <span class="candidate-ready-badge ${ready ? 'ready' : ''}">${ready ? 'Bereit fürs Matching' : 'Freigabe offen'}</span>
          </div>
          <div class="candidate-submit-grid">
            <article class="candidate-submit-card readiness-card"><header><div><small>Freigabe-Checkliste</small><h3>Matching Readiness</h3></div><strong>${Object.values(checks).filter(Boolean).length}/6</strong></header>
              ${checkRow('Erstgespräch durchgeführt','discovery_completed',checks.discovery_completed)}
              ${checkRow('Datenschutz bestätigt','privacy_confirmed',checks.privacy_confirmed)}
              ${checkRow('Lebenslauf vorhanden','cv_received',checks.cv_received,true)}
              ${checkRow('Zeugnisse vorhanden','references_received',checks.references_received,true)}
              ${checkRow('Gehaltsvorstellung erfasst','salary_captured',checks.salary_captured,true)}
              ${checkRow('Verfügbarkeit erfasst','availability_captured',checks.availability_captured,true)}
              <div class="candidate-card-actions"><button class="btn" data-confirm-consent ${checks.privacy_confirmed?'disabled':''}>Datenschutz im Call bestätigen</button><button class="btn primary" data-release-matching ${ready?'':'disabled'}>${ctx.readiness.matching_released?'Für Matching freigegeben':'Für Matching freigeben'}</button></div>
            </article>
            <article class="candidate-submit-card profile-card"><header><div><small>Kundenversion</small><h3>Anonymisiertes Profil</h3></div><span class="profile-state ${ctx.profile?.status==='approved'?'ready':''}">${ctx.profile ? (ctx.profile.status==='approved'?'Freigegeben':'Entwurf') : 'Nicht erstellt'}</span></header>
              <p>Name, Kontaktdaten, Foto, Adresse und Geburtsdaten werden nicht in die Kundenversion übernommen.</p>
              <div class="profile-facts"><span>${esc(candidate.current_title || 'Position offen')}</span><span>${Number(candidate.years_experience || 0)} Jahre Erfahrung</span><span>${esc(candidate.location || 'Standort offen')}</span></div>
              <div class="candidate-card-actions"><button class="btn primary" data-create-anonymous>${ctx.profile?'Profil aktualisieren':'Profil anonymisieren'}</button>${ctx.profile?'<button class="btn" data-approve-anonymous>Prüfen & freigeben</button>':''}</div>
            </article>
          </div>
          <article class="candidate-submit-card submissions-card"><header><div><small>Kundenvorstellungen</small><h3>Versand & Follow-up</h3></div><button class="btn primary" data-new-submission ${ctx.profile?.status==='approved'?'':'disabled'}>+ Kandidat vorstellen</button></header>
            <div class="submission-list">${ctx.submissions.length ? ctx.submissions.map(submissionRow).join('') : '<div class="empty">Noch keine Kundenpräsentation angelegt.</div>'}</div>
          </article>
        </section>`;
      bindCockpit(ctx, checks);
    } catch (error) {
      content.innerHTML = `<div class="notice error">${esc(error.message || error)}</div>`;
    }
  }

  function checkRow(label, key, checked, derived=false) {
    return `<label class="candidate-check ${checked?'done':''}"><span>${checked?'✓':'○'}</span><b>${label}</b>${derived?'<small>automatisch erkannt</small>':`<input type="checkbox" data-readiness="${key}" ${checked?'checked':''}>`}</label>`;
  }

  function submissionRow(item) {
    const next = item.call_follow_up_at || item.first_follow_up_at;
    return `<article><div><strong>${esc(item.company?.name || 'Unternehmen')}</strong><p>${esc(item.job?.title || 'Direktvorstellung')} · ${esc(item.contact_email || 'Empfänger offen')}</p></div><div><span class="badge ${item.status==='sent'?'green':'blue'}">${esc(item.status)}</span><small>${next ? `Follow-up ${new Date(next).toLocaleDateString('de-DE')}` : 'Noch nicht versendet'}</small></div><button class="btn" data-open-mail="${item.id}">E-Mail öffnen</button></article>`;
  }

  function bindCockpit(ctx, checks) {
    document.querySelectorAll('[data-readiness]').forEach(input => input.addEventListener('change', async () => {
      await saveReadiness({ [input.dataset.readiness]: input.checked });
      renderCandidateCockpit();
    }));
    document.querySelector('[data-confirm-consent]')?.addEventListener('click', confirmConsent);
    document.querySelector('[data-release-matching]')?.addEventListener('click', async () => {
      await saveReadiness({ matching_released:true, released_at:new Date().toISOString() });
      renderCandidateCockpit();
    });
    document.querySelector('[data-create-anonymous]')?.addEventListener('click', () => createAnonymousProfile(ctx.candidate));
    document.querySelector('[data-approve-anonymous]')?.addEventListener('click', approveAnonymousProfile);
    document.querySelector('[data-new-submission]')?.addEventListener('click', () => openSubmissionModal(candidateId));
    document.querySelectorAll('[data-open-mail]').forEach(button => button.addEventListener('click', () => openStoredMail(button.dataset.openMail)));
  }

  async function saveReadiness(values) {
    const org = await ensureOrg();
    const { data: { user } } = await db.auth.getUser();
    const payload = { organization_id:org,candidate_id:candidateId,updated_at:new Date().toISOString(),...values };
    if (values.matching_released) payload.released_by = user?.id || null;
    const { error } = await db.from('candidate_readiness').upsert(payload,{onConflict:'organization_id,candidate_id'});
    if (error) alert(error.message);
  }

  async function confirmConsent() {
    const org = await ensureOrg();
    const { data: { user } } = await db.auth.getUser();
    const now = new Date().toISOString();
    const { error } = await db.from('candidate_consents').upsert({organization_id:org,candidate_id:candidateId,consent_type:'privacy',status:'confirmed',confirmation_method:'call',confirmed_at:now,confirmed_by:user?.id||null,updated_at:now},{onConflict:'organization_id,candidate_id,consent_type'});
    if (error) return alert(error.message);
    await saveReadiness({privacy_confirmed:true});
    renderCandidateCockpit();
  }

  async function createAnonymousProfile(candidate) {
    const org = await ensureOrg();
    const data = {
      current_title:candidate.current_title,location:candidate.location,skills:candidate.skills||[],years_experience:candidate.years_experience,
      professional_summary:candidate.professional_summary,work_experience:candidate.work_experience||[],education:candidate.education||[],languages:candidate.languages||[],certifications:candidate.certifications||[],
      notice_period:candidate.notice_period,availability_date:candidate.availability_date,salary_expectation:candidate.salary_expectation
    };
    const { error } = await db.from('candidate_profiles').upsert({organization_id:org,candidate_id:candidateId,profile_type:'anonymous',version:1,title:candidate.current_title||'Anonymisiertes Kandidatenprofil',summary:candidate.professional_summary||null,profile_data:data,status:'draft',updated_at:new Date().toISOString()},{onConflict:'organization_id,candidate_id,profile_type,version'});
    if (error) return alert(error.message);
    renderCandidateCockpit();
  }

  async function approveAnonymousProfile() {
    const org = await ensureOrg();
    const { data: { user } } = await db.auth.getUser();
    const { error } = await db.from('candidate_profiles').update({status:'approved',approved_at:new Date().toISOString(),approved_by:user?.id||null,updated_at:new Date().toISOString()}).eq('organization_id',org).eq('candidate_id',candidateId).eq('profile_type','anonymous').eq('version',1);
    if (error) return alert(error.message);
    renderCandidateCockpit();
  }

  async function openSubmissionModal(cId, presetJobId='') {
    const org = await ensureOrg();
    const [candidate,companies,jobs,profile] = await Promise.all([
      db.from('candidates').select('*').eq('id',cId).single(),
      db.from('companies').select('id,name').eq('organization_id',org).order('name'),
      db.from('jobs').select('id,title,company_id,company:companies(name)').eq('organization_id',org).order('created_at',{ascending:false}),
      db.from('candidate_profiles').select('*').eq('organization_id',org).eq('candidate_id',cId).eq('profile_type','anonymous').eq('status','approved').order('version',{ascending:false}).limit(1)
    ]);
    if (!profile.data?.length) return alert('Bitte zuerst das anonymisierte Profil prüfen und freigeben.');
    const c = candidate.data || {};
    document.getElementById('candidateSubmissionModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="candidateSubmissionModal" class="candidate-submission-modal open"><div class="candidate-submission-backdrop" data-submission-close></div><section><header><div><small>Kandidatenvorstellung</small><h2>Profil an Kunden senden</h2><p>${esc(`${c.first_name||''} ${c.last_name||''}`.trim())} · anonymisierte Kundenversion</p></div><button class="btn" data-submission-close>Schließen</button></header><form id="candidateSubmissionForm">
      <input type="hidden" name="candidate_id" value="${cId}"><input type="hidden" name="profile_id" value="${profile.data[0].id}">
      <div><label>Unternehmen</label><select name="company_id" required><option value="">Auswählen</option>${(companies.data||[]).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
      <div><label>Vakanz</label><select name="job_id"><option value="">Direktvorstellung</option>${(jobs.data||[]).map(x=>`<option value="${x.id}" ${x.id===presetJobId?'selected':''}>${esc(x.title)} · ${esc(x.company?.name||'')}</option>`).join('')}</select></div>
      <div><label>Ansprechpartner</label><input name="contact_name" placeholder="Herr/Frau …"></div><div><label>E-Mail</label><input name="contact_email" type="email" required placeholder="kunde@unternehmen.de"></div>
      <div class="full-span"><label>Betreff</label><input name="subject" value="Passendes Kandidatenprofil für Ihre Vakanz"></div>
      <div class="full-span"><label>E-Mail</label><textarea name="email_body">Hallo,

ich habe ein Kandidatenprofil identifiziert, das fachlich und hinsichtlich Verfügbarkeit sehr gut zu Ihrer Position passt.

Im Anhang finden Sie das anonymisierte Profil. Besonders relevant sind die passende Berufserfahrung, die fachlichen Schwerpunkte und die zeitnahe Verfügbarkeit.

Wann passt Ihnen ein kurzer Austausch zum Profil?

Beste Grüße</textarea></div>
      <div class="submission-plan full-span"><span>Tag 0: Profilversand</span><span>Tag 2: E-Mail-Follow-up</span><span>Tag 4: Anruf-Aufgabe</span></div>
      <div class="candidate-modal-actions full-span"><button class="btn" type="button" data-submission-close>Abbrechen</button><button class="btn primary" type="submit">Vorstellung vorbereiten</button></div><div id="candidateSubmissionMessage" class="message full-span"></div>
    </form></section></div>`);
    document.querySelectorAll('[data-submission-close]').forEach(x=>x.addEventListener('click',()=>document.getElementById('candidateSubmissionModal')?.remove()));
    document.getElementById('candidateSubmissionForm').addEventListener('submit', saveSubmission);
  }

  async function saveSubmission(event) {
    event.preventDefault();
    const org = await ensureOrg();
    const form = new FormData(event.currentTarget);
    const { data:{user} } = await db.auth.getUser();
    const payload = Object.fromEntries([...form.entries()].map(([k,v])=>[k,String(v).trim()||null]));
    payload.organization_id=org;payload.status='prepared';payload.created_by=user?.id||null;
    const { data,error } = await db.from('candidate_submissions').insert(payload).select('*').single();
    const message=document.getElementById('candidateSubmissionMessage');
    if(error){message.textContent=error.message;message.className='message error-text full-span';return;}
    await db.from('submission_activities').insert({organization_id:org,submission_id:data.id,activity_type:'prepared',body:'Kandidatenvorstellung vorbereitet',created_by:user?.id||null});
    message.textContent='Vorstellung vorbereitet. E-Mail wird geöffnet …';message.className='message success-text full-span';
    await markSentAndOpenMail(data);
    setTimeout(()=>document.getElementById('candidateSubmissionModal')?.remove(),600);
  }

  async function markSentAndOpenMail(submission) {
    const sentAt=new Date();const first=new Date(sentAt.getTime()+2*86400000);const call=new Date(sentAt.getTime()+4*86400000);
    await db.from('candidate_submissions').update({status:'sent',sent_at:sentAt.toISOString(),last_contact_at:sentAt.toISOString(),first_follow_up_at:first.toISOString(),call_follow_up_at:call.toISOString(),updated_at:sentAt.toISOString()}).eq('id',submission.id);
    await db.from('submission_activities').insert({organization_id:submission.organization_id,submission_id:submission.id,activity_type:'email_sent',body:'E-Mail-Versand vorbereitet'});
    await db.from('tasks').insert([
      {organization_id:submission.organization_id,title:'Kundenfeedback zum Kandidatenprofil per E-Mail einholen',due_at:first.toISOString(),priority:'medium',status:'open'},
      {organization_id:submission.organization_id,title:'Kunden zum Kandidatenprofil anrufen',due_at:call.toISOString(),priority:'high',status:'open'}
    ]);
    const url=`mailto:${encodeURIComponent(submission.contact_email||'')}?subject=${encodeURIComponent(submission.subject||'Kandidatenprofil')}&body=${encodeURIComponent(submission.email_body||'')}`;
    window.location.href=url;
    document.getElementById('refreshBtn')?.click();
  }

  async function openStoredMail(id) {
    const {data,error}=await db.from('candidate_submissions').select('*').eq('id',id).single();
    if(error)return alert(error.message);
    window.location.href=`mailto:${encodeURIComponent(data.contact_email||'')}?subject=${encodeURIComponent(data.subject||'Kandidatenprofil')}&body=${encodeURIComponent(data.email_body||'')}`;
  }
})();

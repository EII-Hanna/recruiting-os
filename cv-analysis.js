(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  let candidateId = null;
  let activeAnalysis = null;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  document.addEventListener('click', event => {
    const opener = event.target.closest('.detail-open[data-kind="candidate"]');
    if (opener) candidateId = opener.dataset.id;
    const analyze = event.target.closest('[data-cv-analyze]');
    if (analyze) runAnalysis(analyze.dataset.cvAnalyze, analyze);
  }, true);

  const observer = new MutationObserver(() => {
    if (!candidateId) return;
    document.querySelectorAll('.document-card').forEach(card => {
      if (card.dataset.cvEnhanced || card.querySelector('.document-icon')?.textContent.trim() !== 'CV') return;
      const deleteButton = card.querySelector('[data-document-delete]');
      if (!deleteButton) return;
      const documentId = deleteButton.dataset.documentDelete;
      const actions = card.querySelector('.document-actions');
      actions?.insertAdjacentHTML('afterbegin', `<button class="btn primary" data-cv-analyze="${documentId}">Mit KI auswerten</button>`);
      card.dataset.cvEnhanced = '1';
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  async function runAnalysis(documentId, button) {
    if (!candidateId) return alert('Kandidat konnte nicht erkannt werden.');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'KI analysiert …';
    const { data, error } = await db.functions.invoke('analyze-cv', { body: { document_id: documentId, candidate_id: candidateId } });
    button.disabled = false;
    button.textContent = original;
    if (error || data?.error) return alert(data?.error || error.message);
    activeAnalysis = { id: data.analysis_id, candidateId, data: data.extracted_data };
    showReview(activeAnalysis.data);
  }

  function showReview(data) {
    document.getElementById('cvReviewModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cvReviewModal" class="cv-review-modal open">
        <div class="cv-review-backdrop" data-cv-close></div>
        <section class="cv-review-panel">
          <header><div><small>KI-CV-Auswertung</small><h2>Daten prüfen und übernehmen</h2><p class="muted">Die KI bereitet nur einen Vorschlag vor. Du entscheidest, was in die Kandidatenakte übernommen wird.</p></div><button class="btn" data-cv-close>Schließen</button></header>
          <form id="cvReviewForm" class="cv-review-form">
            <div><label>Vorname</label><input name="first_name" value="${esc(data.first_name)}"></div>
            <div><label>Nachname</label><input name="last_name" value="${esc(data.last_name)}"></div>
            <div><label>E-Mail</label><input name="email" type="email" value="${esc(data.email)}"></div>
            <div><label>Telefon</label><input name="phone" value="${esc(data.phone)}"></div>
            <div><label>Aktuelle Position</label><input name="current_title" value="${esc(data.current_title)}"></div>
            <div><label>Standort</label><input name="location" value="${esc(data.location)}"></div>
            <div><label>Berufserfahrung in Jahren</label><input name="years_experience" type="number" step="0.5" value="${esc(data.years_experience)}"></div>
            <div><label>Kündigungsfrist</label><input name="notice_period" value="${esc(data.notice_period)}"></div>
            <div class="full-span"><label>Skills</label><input name="skills" value="${esc((data.skills || []).join(', '))}"></div>
            <div class="full-span"><label>Profilzusammenfassung</label><textarea name="professional_summary">${esc(data.professional_summary)}</textarea></div>
            <div class="full-span cv-ai-preview"><h3>Berufserfahrung</h3>${renderExperience(data.work_experience)}</div>
            <div class="full-span cv-ai-preview"><h3>Ausbildung</h3>${renderEducation(data.education)}</div>
            ${(data.warnings || []).length ? `<div class="full-span cv-warning"><strong>Prüfhinweise</strong><ul>${data.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
            <div class="full-span cv-review-actions"><button class="btn" type="button" data-cv-close>Verwerfen</button><button class="btn primary" type="submit">Geprüfte Daten übernehmen</button></div>
          </form>
          <div id="cvReviewMessage" class="message"></div>
        </section>
      </div>`);
    document.querySelectorAll('[data-cv-close]').forEach(el => el.addEventListener('click', closeReview));
    document.getElementById('cvReviewForm').addEventListener('submit', approveAnalysis);
  }

  const renderExperience = items => (items || []).map(x => `<article><strong>${esc(x.title || 'Position')} · ${esc(x.company || 'Unternehmen')}</strong><p>${esc(x.start || '—')} – ${esc(x.end || 'heute')}</p><small>${esc(x.description || '')}</small></article>`).join('') || '<p class="muted">Keine eindeutige Berufserfahrung erkannt.</p>';
  const renderEducation = items => (items || []).map(x => `<article><strong>${esc(x.degree || x.field || 'Ausbildung')}</strong><p>${esc(x.institution || '')}</p><small>${esc(x.start || '—')} – ${esc(x.end || '—')}</small></article>`).join('') || '<p class="muted">Keine eindeutige Ausbildung erkannt.</p>';

  function closeReview() { document.getElementById('cvReviewModal')?.remove(); activeAnalysis = null; }

  async function approveAnalysis(event) {
    event.preventDefault();
    if (!activeAnalysis) return;
    const form = new FormData(event.currentTarget);
    const source = activeAnalysis.data;
    const payload = {
      first_name: form.get('first_name')?.trim() || null,
      last_name: form.get('last_name')?.trim() || null,
      email: form.get('email')?.trim() || null,
      phone: form.get('phone')?.trim() || null,
      current_title: form.get('current_title')?.trim() || null,
      location: form.get('location')?.trim() || null,
      years_experience: form.get('years_experience') ? Number(form.get('years_experience')) : null,
      notice_period: form.get('notice_period')?.trim() || null,
      skills: String(form.get('skills') || '').split(',').map(x => x.trim()).filter(Boolean),
      professional_summary: form.get('professional_summary')?.trim() || null,
      work_experience: source.work_experience || [], education: source.education || [],
      languages: source.languages || [], certifications: source.certifications || [],
      availability_date: /^\d{4}-\d{2}-\d{2}$/.test(source.availability_date || '') ? source.availability_date : null,
      cv_last_analyzed_at: new Date().toISOString()
    };
    const message = document.getElementById('cvReviewMessage');
    message.textContent = 'Daten werden übernommen …';
    const candidateResult = await db.from('candidates').update(payload).eq('id', activeAnalysis.candidateId);
    if (candidateResult.error) { message.textContent = candidateResult.error.message; message.className = 'message error-text'; return; }
    const { data: { user } } = await db.auth.getUser();
    const analysisResult = await db.from('cv_analyses').update({ status: 'approved', approved_by: user?.id || null, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', activeAnalysis.id);
    if (analysisResult.error) { message.textContent = analysisResult.error.message; message.className = 'message error-text'; return; }
    message.textContent = 'Kandidatenakte wurde aktualisiert.';
    message.className = 'message success-text';
    document.getElementById('refreshBtn')?.click();
    setTimeout(closeReview, 800);
  }
})();

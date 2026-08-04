(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true} });
  let currentCandidate = null;
  let organizationId = null;
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const split = v => String(v || '').split(',').map(x=>x.trim()).filter(Boolean);

  async function ensureOrg(){
    if(organizationId) return organizationId;
    const {data} = await db.rpc('my_organizations');
    organizationId = data?.[0]?.organization_id || null;
    return organizationId;
  }

  document.addEventListener('click', event => {
    const opener = event.target.closest('.detail-open');
    if(opener?.dataset.kind === 'candidate') currentCandidate = opener.dataset.id;
  }, true);

  const observer = new MutationObserver(() => {
    const tabs = document.querySelector('.drawer-tabs');
    if(!tabs || tabs.querySelector('[data-tab="qualification"]')) return;
    const btn = document.createElement('button');
    btn.type='button'; btn.dataset.tab='qualification'; btn.textContent='Qualifizierung';
    btn.addEventListener('click', event => {
      event.stopImmediatePropagation();
      document.querySelectorAll('.drawer-tabs button').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      renderQualification();
    });
    const documents = tabs.querySelector('[data-tab="documents"]');
    documents ? tabs.insertBefore(btn, documents) : tabs.appendChild(btn);
  });
  observer.observe(document.body,{childList:true,subtree:true});

  async function renderQualification(){
    const content = document.getElementById('drawerContent');
    if(!content || !currentCandidate) return;
    content.innerHTML='<div class="drawer-loading">Qualifizierung wird geladen …</div>';
    const org = await ensureOrg();
    const [{data:candidate,error:candidateError},{data:answers,error:answersError}] = await Promise.all([
      db.from('candidates').select('*').eq('organization_id',org).eq('id',currentCandidate).single(),
      db.from('candidate_qualification_answers').select('*').eq('organization_id',org).eq('candidate_id',currentCandidate)
    ]);
    if(candidateError || answersError){
      content.innerHTML=`<div class="notice error">${esc(candidateError?.message || answersError?.message)}</div>`; return;
    }
    const gaps = detectGaps(candidate);
    const progress = Math.round(((8-gaps.length)/8)*100);
    content.innerHTML=`
      <section class="qualification-cockpit">
        <div class="qualification-summary-card">
          <div><small>Vollständigkeit</small><strong>${Math.max(0,progress)}%</strong><p class="muted">${gaps.length ? `${gaps.length} Pflichtangaben fehlen` : 'Alle Kernangaben vollständig'}</p></div>
          <div class="qualification-progress"><span style="width:${Math.max(0,progress)}%"></span></div>
          <div class="gap-list">${gaps.map(g=>`<span class="badge yellow">${esc(g)}</span>`).join('') || '<span class="badge green">Bereit zur Freigabe</span>'}</div>
        </div>
        <form id="qualificationForm" class="qualification-form">
          <div><label>Wunschposition</label><input name="desired_title" value="${esc(candidate.desired_title)}"></div>
          <div><label>Gehaltsvorstellung</label><input name="salary_expectation" type="number" value="${esc(candidate.salary_expectation)}"></div>
          <div><label>Kündigungsfrist</label><input name="notice_period" value="${esc(candidate.notice_period)}"></div>
          <div><label>Verfügbarkeit ab</label><input name="availability_date" type="date" value="${esc(candidate.availability_date)}"></div>
          <div class="full-span"><label>Wunschregionen, durch Komma getrennt</label><input name="desired_locations" value="${esc((candidate.desired_locations||[]).join(', '))}"></div>
          <div><label>Remote-Präferenz</label><select name="remote_preference"><option value="">Bitte wählen</option>${['vor Ort','hybrid','remote'].map(v=>`<option ${candidate.remote_preference===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div><label>Qualifizierungsstatus</label><select name="qualification_status">${['open','in_progress','complete','approved'].map(v=>`<option value="${v}" ${candidate.qualification_status===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div class="full-span"><label>Wechselmotivation</label><textarea name="motivation">${esc(candidate.motivation)}</textarea></div>
          <div class="full-span"><label>Ausschlusskriterien, durch Komma getrennt</label><input name="exclusion_criteria" value="${esc((candidate.exclusion_criteria||[]).join(', '))}"></div>
          <div class="full-span"><label>Qualifizierungszusammenfassung</label><textarea name="qualification_summary">${esc(candidate.qualification_summary)}</textarea></div>
          <div class="qualification-questions full-span">
            <h3>Gesprächsfragen</h3>
            ${questionRows(candidate, answers || [])}
          </div>
          <div class="drawer-actions full-span"><button class="btn primary" type="submit">Qualifizierung speichern</button><button id="approveMatching" class="btn" type="button" ${gaps.length?'disabled':''}>Für Matching freigeben</button></div>
        </form><div id="qualificationMessage" class="message"></div>
      </section>`;
    document.getElementById('qualificationForm').addEventListener('submit', saveQualification);
    document.getElementById('approveMatching').addEventListener('click', approveMatching);
  }

  function detectGaps(c){
    const checks=[['Wunschposition',c.desired_title],['Gehaltsvorstellung',c.salary_expectation],['Kündigungsfrist',c.notice_period],['Verfügbarkeit',c.availability_date],['Wunschregion',c.desired_locations?.length],['Remote-Präferenz',c.remote_preference],['Wechselmotivation',c.motivation],['Skills',c.skills?.length]];
    return checks.filter(([,v])=>!v).map(([label])=>label);
  }

  function questionRows(c, answers){
    const questions=[
      ['motivation','Warum möchten Sie aktuell wechseln?',c.motivation],
      ['desired_role','Welche Position und Verantwortung suchen Sie?',c.desired_title],
      ['salary','Welche Gehaltsvorstellung haben Sie?',c.salary_expectation],
      ['notice','Wie lang ist Ihre Kündigungsfrist?',c.notice_period],
      ['availability','Ab wann sind Sie verfügbar?',c.availability_date],
      ['location','Welche Standorte kommen infrage?',(c.desired_locations||[]).join(', ')],
      ['remote','Wie sieht Ihre gewünschte Remote-Regelung aus?',c.remote_preference],
      ['exclusions','Welche Arbeitgeber oder Rahmenbedingungen schließen Sie aus?',(c.exclusion_criteria||[]).join(', ')]
    ];
    return questions.map(([key,label,fallback])=>{
      const a=answers.find(x=>x.question_key===key);
      return `<div class="qualification-question"><label>${esc(label)}</label><textarea data-question-key="${key}" data-question-label="${esc(label)}">${esc(a?.answer_text || fallback || '')}</textarea></div>`;
    }).join('');
  }

  async function saveQualification(event){
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload={
      desired_title:form.get('desired_title')?.trim()||null,
      salary_expectation:form.get('salary_expectation')?Number(form.get('salary_expectation')):null,
      notice_period:form.get('notice_period')?.trim()||null,
      availability_date:form.get('availability_date')||null,
      desired_locations:split(form.get('desired_locations')),
      remote_preference:form.get('remote_preference')||null,
      motivation:form.get('motivation')?.trim()||null,
      exclusion_criteria:split(form.get('exclusion_criteria')),
      qualification_summary:form.get('qualification_summary')?.trim()||null,
      qualification_status:form.get('qualification_status')
    };
    const {error}=await db.from('candidates').update(payload).eq('id',currentCandidate);
    if(error) return showMessage(error.message,true);
    const org=await ensureOrg();
    const rows=[...document.querySelectorAll('[data-question-key]')].map(el=>({organization_id:org,candidate_id:currentCandidate,question_key:el.dataset.questionKey,question_label:el.dataset.questionLabel,answer_text:el.value.trim()||null,is_required:true,completed:Boolean(el.value.trim()),source:'manual'}));
    const upsert=await db.from('candidate_qualification_answers').upsert(rows,{onConflict:'candidate_id,question_key'});
    if(upsert.error) return showMessage(upsert.error.message,true);
    showMessage('Qualifizierung gespeichert.');
    await renderQualification();
  }

  async function approveMatching(){
    const org=await ensureOrg();
    const {data:candidate,error}=await db.from('candidates').select('*').eq('organization_id',org).eq('id',currentCandidate).single();
    if(error) return showMessage(error.message,true);
    const gaps=detectGaps(candidate);
    if(gaps.length) return showMessage(`Freigabe nicht möglich. Es fehlen: ${gaps.join(', ')}`,true);
    const {data:{user}}=await db.auth.getUser();
    const result=await db.from('candidates').update({matching_approved:true,qualification_status:'approved',qualified_at:new Date().toISOString(),qualified_by:user?.id||null,status:'qualified'}).eq('id',currentCandidate);
    if(result.error) return showMessage(result.error.message,true);
    showMessage('Kandidat wurde für das Matching freigegeben.');
    document.getElementById('refreshBtn')?.click();
    await renderQualification();
  }

  function showMessage(text,error=false){
    const el=document.getElementById('qualificationMessage');
    if(!el) return alert(text);
    el.textContent=text; el.className=`message ${error?'error-text':'success-text'}`;
  }
})();

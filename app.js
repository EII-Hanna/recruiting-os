(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  const el = id => document.getElementById(id);
  const required = cfg.supabaseUrl && cfg.supabasePublishableKey && !cfg.supabaseUrl.includes('YOUR_');
  const sb = required ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  const state = { user:null, org:null, role:null, companies:[], jobs:[], candidates:[], applications:[], tasks:[], activities:[] };
  const stages = ['new','qualified','presented','interview','offer','placed'];
  const stageLabels = {new:'Neu',qualified:'Qualifiziert',presented:'Vorgestellt',interview:'Interview',offer:'Angebot',placed:'Placement',lost:'Verloren'};
  const statusLabels = {new:'Neu',contacted:'Kontaktiert',qualified:'Qualifiziert',presented:'Vorgestellt',interview:'Interview',offer:'Angebot',placed:'Placement',rejected:'Abgelehnt',talent_pool:'Talentpool',draft:'Entwurf',active:'Aktiv',paused:'Pausiert',filled:'Besetzt',cancelled:'Storniert',open:'Offen',done:'Erledigt'};
  const probabilityByStage = {new:10,qualified:30,presented:50,interview:70,offer:90,placed:100,lost:0};
  const money = n => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(n||0));
  const date = v => v ? new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)) : '—';
  const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const badge = s => { const label=statusLabels[s]||stageLabels[s]||s||'—'; const cls=['placed','done','active'].includes(s)?'green':['interview','offer'].includes(s)?'yellow':['new','draft','qualified','presented'].includes(s)?'blue':['lost','rejected','cancelled'].includes(s)?'red':''; return `<span class="badge ${cls}">${esc(label)}</span>`; };
  const show = id => el(id).classList.remove('hidden');
  const hide = id => el(id).classList.add('hidden');
  const loading = on => el('loading').classList.toggle('hidden', !on);
  const message = (id,text,isError=false) => { el(id).textContent=text||''; el(id).style.color=isError?'var(--red)':'var(--yellow)'; };

  function configGuard(){
    if(required) return true;
    hide('appScreen'); hide('onboardingScreen'); show('authScreen');
    el('authForm').classList.add('hidden'); el('authToggle').classList.add('hidden');
    message('authMessage','Supabase-Konfiguration fehlt.',true);
    return false;
  }

  let registerMode=false;
  el('authToggle').onclick=()=>{registerMode=!registerMode; el('authTitle').textContent=registerMode?'Konto erstellen':'Anmelden'; el('nameWrap').classList.toggle('hidden',!registerMode); el('authToggle').textContent=registerMode?'Bereits registriert? Anmelden':'Noch kein Konto? Registrieren'; message('authMessage','');};
  el('authForm').onsubmit=async e=>{
    e.preventDefault(); if(!configGuard()) return; loading(true); message('authMessage','');
    const email=el('email').value.trim(), password=el('password').value;
    const result=registerMode ? await sb.auth.signUp({email,password,options:{data:{full_name:el('fullName').value.trim()}}}) : await sb.auth.signInWithPassword({email,password});
    loading(false); if(result.error) return message('authMessage',result.error.message,true);
    if(registerMode && !result.data.session) return message('authMessage','Registrierung erfolgreich. Bitte bestätige die E-Mail und melde dich anschließend an.');
    await routeSession(result.data.session);
  };
  el('logoutBtn').onclick=async()=>{loading(true);await sb.auth.signOut();loading(false);state.user=null;hide('appScreen');hide('onboardingScreen');show('authScreen');};

  async function routeSession(session){
    if(!session){hide('appScreen');hide('onboardingScreen');show('authScreen');return;}
    state.user=session.user; el('userEmail').textContent=session.user.email;
    loading(true);
    const {data,error}=await sb.rpc('my_organizations');
    loading(false);
    if(error){message('authMessage',error.message,true);return;}
    hide('authScreen');
    if(!data?.length){show('onboardingScreen');hide('appScreen');return;}
    state.org={id:data[0].organization_id,name:data[0].organization_name,slug:data[0].organization_slug}; state.role=data[0].member_role;
    el('orgLabel').textContent=state.org.name; el('roleLabel').textContent=state.role;
    hide('onboardingScreen');show('appScreen');await loadAll();
  }

  el('orgName').addEventListener('input',()=>{if(!el('orgSlug').dataset.touched)el('orgSlug').value=el('orgName').value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');});
  el('orgSlug').addEventListener('input',()=>el('orgSlug').dataset.touched='1');
  el('orgForm').onsubmit=async e=>{e.preventDefault();loading(true);const {error}=await sb.rpc('bootstrap_organization',{org_name:el('orgName').value,org_slug:el('orgSlug').value});loading(false);if(error)return message('orgMessage',error.message,true);const {data:{session}}=await sb.auth.getSession();await routeSession(session);};

  async function loadAll(){
    loading(true);
    const org=state.org.id;
    const [companies,jobs,candidates,applications,tasks,activities]=await Promise.all([
      sb.from('companies').select('*').eq('organization_id',org).order('created_at',{ascending:false}),
      sb.from('jobs').select('*,company:companies(id,name)').eq('organization_id',org).order('created_at',{ascending:false}),
      sb.from('candidates').select('*').eq('organization_id',org).order('created_at',{ascending:false}),
      sb.from('applications').select('*,candidate:candidates(id,first_name,last_name,current_title),job:jobs(id,title,company:companies(id,name))').eq('organization_id',org).order('updated_at',{ascending:false}),
      sb.from('tasks').select('*').eq('organization_id',org).order('due_at',{ascending:true,nullsFirst:false}),
      sb.from('activities').select('*').eq('organization_id',org).order('occurred_at',{ascending:false}).limit(30)
    ]);
    const errors=[companies,jobs,candidates,applications,tasks,activities].filter(x=>x.error).map(x=>x.error.message);
    loading(false); if(errors.length){alert(errors.join('\n'));return;}
    Object.assign(state,{companies:companies.data||[],jobs:jobs.data||[],candidates:candidates.data||[],applications:applications.data||[],tasks:tasks.data||[],activities:activities.data||[]});renderAll();
  }
  el('refreshBtn').onclick=loadAll;

  function renderAll(){renderDashboard();renderPipeline();renderMatching();renderCandidates();renderJobs();renderCompanies();renderTasks();}
  function renderDashboard(){
    el('kpiJobs').textContent=state.jobs.filter(j=>j.status==='active').length;
    el('kpiCandidates').textContent=new Set(state.applications.filter(a=>!['placed','lost'].includes(a.stage)).map(a=>a.candidate_id)).size;
    el('kpiForecast').textContent=money(state.applications.reduce((s,a)=>s+Number(a.fee_amount||0)*Number(a.probability||0)/100,0));
    el('kpiPlacements').textContent=state.applications.filter(a=>a.stage==='placed').length;
    const open=state.tasks.filter(t=>t.status==='open').slice(0,8);
    el('dashboardTasks').innerHTML=open.map(t=>`<tr><td>${esc(t.title)}</td><td>${date(t.due_at)}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Keine offenen Aufgaben.</td></tr>';
    el('activitiesTable').innerHTML=state.activities.slice(0,10).map(a=>`<tr><td>${date(a.occurred_at)}</td><td>${esc(a.activity_type)}</td><td>${esc(a.subject)}</td><td>${esc(a.body)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Noch keine Aktivitäten.</td></tr>';
  }
  function renderPipeline(){
    el('kanban').innerHTML=stages.map(stage=>{const list=state.applications.filter(a=>a.stage===stage);return `<div class="column"><div class="column-head"><b>${stageLabels[stage]}</b><span class="muted">${list.length}</span></div>${list.map(a=>`<article class="deal"><h3>${esc(`${a.candidate?.first_name||''} ${a.candidate?.last_name||''}`)}</h3><p>${esc(a.job?.title)}</p><p>${esc(a.job?.company?.name)}</p><p><b>${money(a.fee_amount)}</b> · ${a.probability}%</p><div class="deal-actions"><button class="btn" onclick="window.recruitingOS.moveApplication('${a.id}',-1)">←</button><button class="btn primary" onclick="window.recruitingOS.moveApplication('${a.id}',1)">→</button></div></article>`).join('')||'<div class="empty">Leer</div>'}</div>`}).join('');
  }
  function normalizeList(v){return Array.isArray(v)?v.map(x=>String(x).toLowerCase()):[];}
  function scoreMatch(c,j){
    const cs=normalizeList(c.skills), req=normalizeList(j.requirements), must=normalizeList(j.must_haves); const all=[...new Set([...req,...must])];
    const skill=all.length?Math.round(all.filter(x=>cs.some(s=>s.includes(x)||x.includes(s))).length/all.length*100):50;
    const location=!j.location||!c.location?60:j.location.toLowerCase()===c.location.toLowerCase()?100:(String(c.remote_preference||'').toLowerCase().includes('remote')?80:45);
    let salary=70;if(j.salary_max&&c.salary_expectation)salary=c.salary_expectation<=j.salary_max?100:c.salary_expectation<=j.salary_max*1.1?65:25;
    return Math.round(skill*.7+location*.15+salary*.15);
  }
  function renderMatching(){
    const existing=new Set(state.applications.map(a=>`${a.candidate_id}:${a.job_id}`));
    const matches=[]; for(const c of state.candidates)for(const j of state.jobs.filter(x=>x.status==='active'))if(!existing.has(`${c.id}:${j.id}`))matches.push({c,j,score:scoreMatch(c,j)});
    matches.sort((a,b)=>b.score-a.score);
    el('matchingList').innerHTML=matches.slice(0,12).map(m=>`<div class="card match-card"><div><h3>${esc(m.c.first_name+' '+m.c.last_name)}</h3><p class="muted">${esc(m.c.current_title||'Kein Profil')} → ${esc(m.j.title)}</p><p class="muted">${esc(m.j.company?.name||'')}</p><button class="btn primary" onclick="window.recruitingOS.createApplication('${m.c.id}','${m.j.id}',${m.score})">In Pipeline übernehmen</button></div><div class="match-score">${m.score}%</div></div>`).join('')||'<div class="card empty">Keine neuen Matches verfügbar.</div>';
  }
  function filterRows(items,q,fields){q=q.toLowerCase();return items.filter(x=>fields.map(f=>f(x)||'').join(' ').toLowerCase().includes(q));}
  function renderCandidates(q=el('candidateSearch').value||''){const rows=filterRows(state.candidates,q,[x=>x.first_name,x=>x.last_name,x=>x.current_title,x=>x.location,x=>x.email]);el('candidatesTable').innerHTML=rows.map(c=>`<tr><td><span class="link">${esc(c.first_name+' '+c.last_name)}</span></td><td>${esc(c.current_title)}</td><td>${esc(c.location)}</td><td>${badge(c.status)}</td><td>${money(c.salary_expectation)}</td><td><button class="btn" onclick="window.recruitingOS.qualifyCandidate('${c.id}')">Qualifizieren</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">Keine Kandidaten.</td></tr>';}
  function renderJobs(q=el('jobSearch').value||''){const rows=filterRows(state.jobs,q,[x=>x.title,x=>x.location,x=>x.company?.name]);el('jobsTable').innerHTML=rows.map(j=>`<tr><td>${esc(j.title)}</td><td>${esc(j.company?.name)}</td><td>${esc(j.location)}</td><td>${money(j.fee_amount)}</td><td>${badge(j.status)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Keine Vakanzen.</td></tr>';}
  function renderCompanies(q=el('companySearch').value||''){const rows=filterRows(state.companies,q,[x=>x.name,x=>x.industry,x=>x.website]);el('companiesTable').innerHTML=rows.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.industry)}</td><td>${badge(c.status)}</td><td>${c.website?`<a class="link" href="${esc(c.website)}" target="_blank" rel="noreferrer">Öffnen</a>`:'—'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Keine Unternehmen.</td></tr>';}
  function renderTasks(){el('tasksTable').innerHTML=state.tasks.map(t=>`<tr><td>${esc(t.title)}</td><td>${date(t.due_at)}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td><button class="btn" onclick="window.recruitingOS.toggleTask('${t.id}','${t.status}')">${t.status==='done'?'Wieder öffnen':'Erledigen'}</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Keine Aufgaben.</td></tr>';}
  ['candidateSearch','jobSearch','companySearch'].forEach(id=>el(id).addEventListener('input',()=>({candidateSearch:renderCandidates,jobSearch:renderJobs,companySearch:renderCompanies}[id])()));

  async function moveApplication(id,dir){const a=state.applications.find(x=>x.id===id);if(!a)return;const i=Math.max(0,Math.min(stages.length-1,stages.indexOf(a.stage)+dir));const stage=stages[i];loading(true);const {error}=await sb.from('applications').update({stage,probability:probabilityByStage[stage],placed_at:stage==='placed'?new Date().toISOString():null}).eq('id',id);loading(false);if(error)return alert(error.message);await loadAll();}
  async function createApplication(candidateId,jobId,score){loading(true);const {error}=await sb.rpc('create_application',{p_organization_id:state.org.id,p_candidate_id:candidateId,p_job_id:jobId,p_match_score:score});loading(false);if(error)return alert(error.message);await loadAll();}
  async function qualifyCandidate(id){loading(true);const {error}=await sb.from('candidates').update({status:'qualified'}).eq('id',id);loading(false);if(error)return alert(error.message);await loadAll();}
  async function toggleTask(id,current){loading(true);const {error}=await sb.from('tasks').update({status:current==='done'?'open':'done'}).eq('id',id);loading(false);if(error)return alert(error.message);await loadAll();}

  const fields={
    candidate:`<div><label>Vorname</label><input name="first_name" required></div><div><label>Nachname</label><input name="last_name" required></div><div><label>E-Mail</label><input name="email" type="email"></div><div><label>Telefon</label><input name="phone"></div><div><label>Aktuelle Position</label><input name="current_title"></div><div><label>Standort</label><input name="location"></div><div><label>Gehaltsziel</label><input name="salary_expectation" type="number"></div><div><label>Skills, kommagetrennt</label><input name="skills"></div>`,
    company:`<div><label>Unternehmen</label><input name="name" required></div><div><label>Branche</label><input name="industry"></div><div><label>Website</label><input name="website" type="url"></div><div><label>Status</label><select name="status"><option value="prospect">Prospect</option><option value="active_client">Aktiver Kunde</option></select></div><div class="full-span"><label>Notizen</label><textarea name="notes"></textarea></div>`,
    job:`<div><label>Vakanz</label><input name="title" required></div><div><label>Unternehmen</label><select name="company_id" required>${state.companies.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div><label>Standort</label><input name="location"></div><div><label>Fee</label><input name="fee_amount" type="number"></div><div><label>Gehaltsminimum</label><input name="salary_min" type="number"></div><div><label>Gehaltsmaximum</label><input name="salary_max" type="number"></div><div class="full-span"><label>Anforderungen, kommagetrennt</label><input name="requirements"></div>`,
    task:`<div class="full-span"><label>Aufgabe</label><input name="title" required></div><div><label>Fällig</label><input name="due_at" type="datetime-local"></div><div><label>Priorität</label><select name="priority"><option value="low">Niedrig</option><option value="medium">Mittel</option><option value="high">Hoch</option></select></div>`
  };
  function renderForm(){el('dynamicFields').innerHTML=fields[el('recordType').value];}
  el('recordType').onchange=renderForm; el('newBtn').onclick=()=>{renderForm();el('recordModal').classList.add('open');}; document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>el('recordModal').classList.remove('open'));
  el('recordForm').onsubmit=async e=>{e.preventDefault();const type=el('recordType').value,fd=Object.fromEntries(new FormData(e.target));let table,payload={organization_id:state.org.id,owner_id:state.user.id};
    if(type==='candidate'){table='candidates';payload={...payload,...fd,status:'new',salary_expectation:fd.salary_expectation?Number(fd.salary_expectation):null,skills:fd.skills?fd.skills.split(',').map(x=>x.trim()).filter(Boolean):[]};delete payload.owner_id;if(state.user?.id)payload.owner_id=state.user.id;}
    if(type==='company'){table='companies';payload={...payload,...fd};}
    if(type==='job'){table='jobs';payload={...payload,...fd,status:'active',fee_amount:fd.fee_amount?Number(fd.fee_amount):null,salary_min:fd.salary_min?Number(fd.salary_min):null,salary_max:fd.salary_max?Number(fd.salary_max):null,requirements:fd.requirements?fd.requirements.split(',').map(x=>x.trim()).filter(Boolean):[]};}
    if(type==='task'){table='tasks';payload={organization_id:state.org.id,assigned_to:state.user.id,...fd,status:'open',due_at:fd.due_at?new Date(fd.due_at).toISOString():null};}
    loading(true);const {error}=await sb.from(table).insert(payload);loading(false);if(error)return message('recordMessage',error.message,true);message('recordMessage','');e.target.reset();el('recordModal').classList.remove('open');await loadAll();};

  document.querySelectorAll('.nav button').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));el(btn.dataset.view).classList.add('active');el('pageTitle').textContent=btn.textContent;});
  window.recruitingOS={moveApplication,createApplication,qualifyCandidate,toggleTask};

  async function init(){if(!configGuard())return;const {data:{session}}=await sb.auth.getSession();sb.auth.onAuthStateChange((_event,newSession)=>{if(!newSession&&state.user){state.user=null;hide('appScreen');show('authScreen');}});await routeSession(session);}
  init();
})();
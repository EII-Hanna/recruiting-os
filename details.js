(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let organizationId = null;
  let current = null;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const euro = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value || 0));
  const formatDate = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

  function injectDrawer() {
    if (document.getElementById('recordDrawer')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="recordDrawer" class="record-drawer" aria-hidden="true">
        <div class="drawer-backdrop" data-drawer-close></div>
        <aside class="drawer-panel">
          <header class="drawer-header">
            <div><small id="drawerEyebrow">Akte</small><h2 id="drawerTitle">Datensatz</h2><p id="drawerSubtitle" class="muted"></p></div>
            <button class="btn" type="button" data-drawer-close>Schließen</button>
          </header>
          <div class="drawer-tabs">
            <button class="active" data-tab="overview">Übersicht</button>
            <button data-tab="processes">Prozesse</button>
            <button data-tab="tasks">Aufgaben</button>
            <button data-tab="history">Historie</button>
          </div>
          <div id="drawerContent" class="drawer-content"></div>
        </aside>
      </div>`);

    document.querySelectorAll('[data-drawer-close]').forEach(button => button.addEventListener('click', closeDrawer));
    document.querySelectorAll('.drawer-tabs button').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('.drawer-tabs button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      renderTab(button.dataset.tab);
    }));
  }

  async function ensureOrganization() {
    if (organizationId) return organizationId;
    const { data } = await db.rpc('my_organizations');
    organizationId = data?.[0]?.organization_id || null;
    return organizationId;
  }

  async function addRecordButtons() {
    const org = await ensureOrganization();
    if (!org) return;

    const [candidateResult, jobResult] = await Promise.all([
      db.from('candidates').select('id,first_name,last_name,current_title,location').eq('organization_id', org),
      db.from('jobs').select('id,title,location,company:companies(name)').eq('organization_id', org)
    ]);

    const candidates = candidateResult.data || [];
    const jobs = jobResult.data || [];

    document.querySelectorAll('#candidatesTable tr').forEach(row => {
      if (row.dataset.detailReady) return;
      const cells = row.querySelectorAll('td');
      if (!cells.length) return;
      const name = cells[0].textContent.trim().toLowerCase();
      const candidate = candidates.find(item => `${item.first_name || ''} ${item.last_name || ''}`.trim().toLowerCase() === name);
      if (!candidate) return;
      const target = cells[cells.length - 1];
      target.insertAdjacentHTML('beforeend', ` <button class="btn detail-open" data-kind="candidate" data-id="${candidate.id}">Akte</button>`);
      row.dataset.detailReady = '1';
    });

    document.querySelectorAll('#jobsTable tr').forEach(row => {
      if (row.dataset.detailReady) return;
      const cells = row.querySelectorAll('td');
      if (!cells.length) return;
      const title = cells[0].textContent.trim().toLowerCase();
      const company = cells[1]?.textContent.trim().toLowerCase();
      const job = jobs.find(item => item.title?.trim().toLowerCase() === title && (item.company?.name || '').trim().toLowerCase() === company);
      if (!job) return;
      const target = cells[0];
      target.innerHTML = `<button class="record-link detail-open" data-kind="job" data-id="${job.id}">${escapeHtml(cells[0].textContent.trim())}</button>`;
      row.dataset.detailReady = '1';
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('.detail-open');
    if (!button) return;
    event.preventDefault();
    openRecord(button.dataset.kind, button.dataset.id);
  });

  async function openRecord(kind, id) {
    injectDrawer();
    const drawer = document.getElementById('recordDrawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('drawerContent').innerHTML = '<div class="drawer-loading">Akte wird geladen …</div>';
    document.querySelectorAll('.drawer-tabs button').forEach((item, index) => item.classList.toggle('active', index === 0));

    const org = await ensureOrganization();
    const table = kind === 'candidate' ? 'candidates' : 'jobs';
    const select = kind === 'candidate' ? '*' : '*,company:companies(id,name)';
    const { data, error } = await db.from(table).select(select).eq('organization_id', org).eq('id', id).single();
    if (error) {
      document.getElementById('drawerContent').innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
      return;
    }

    current = { kind, record: data };
    document.getElementById('drawerEyebrow').textContent = kind === 'candidate' ? 'Kandidatenakte' : 'Vakanzakte';
    document.getElementById('drawerTitle').textContent = kind === 'candidate' ? `${data.first_name || ''} ${data.last_name || ''}`.trim() : data.title;
    document.getElementById('drawerSubtitle').textContent = kind === 'candidate' ? (data.current_title || 'Kein aktuelles Profil') : (data.company?.name || 'Kein Unternehmen');
    renderTab('overview');
  }

  function closeDrawer() {
    const drawer = document.getElementById('recordDrawer');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    current = null;
  }

  async function renderTab(tab) {
    if (!current) return;
    if (tab === 'overview') return renderOverview();
    if (tab === 'processes') return renderProcesses();
    if (tab === 'tasks') return renderTasks();
    return renderHistory();
  }

  function renderOverview() {
    const record = current.record;
    const content = document.getElementById('drawerContent');
    if (current.kind === 'candidate') {
      content.innerHTML = `
        <form id="detailForm" class="detail-form">
          <div><label>Vorname</label><input name="first_name" value="${escapeHtml(record.first_name)}" required></div>
          <div><label>Nachname</label><input name="last_name" value="${escapeHtml(record.last_name)}" required></div>
          <div><label>E-Mail</label><input name="email" type="email" value="${escapeHtml(record.email)}"></div>
          <div><label>Telefon</label><input name="phone" value="${escapeHtml(record.phone)}"></div>
          <div><label>Aktuelle Position</label><input name="current_title" value="${escapeHtml(record.current_title)}"></div>
          <div><label>Standort</label><input name="location" value="${escapeHtml(record.location)}"></div>
          <div><label>Gehaltsziel</label><input name="salary_expectation" type="number" value="${escapeHtml(record.salary_expectation)}"></div>
          <div><label>Status</label><select name="status">${candidateStatuses(record.status)}</select></div>
          <div class="full-span"><label>Skills, durch Komma getrennt</label><input name="skills" value="${escapeHtml((record.skills || []).join(', '))}"></div>
          <div class="full-span"><label>Notizen</label><textarea name="notes">${escapeHtml(record.notes)}</textarea></div>
          <div class="drawer-actions full-span"><button class="btn primary" type="submit">Änderungen speichern</button><button id="archiveRecord" class="btn danger" type="button">Archivieren</button></div>
        </form><div id="detailMessage" class="message"></div>`;
    } else {
      content.innerHTML = `
        <form id="detailForm" class="detail-form">
          <div class="full-span"><label>Vakanz</label><input name="title" value="${escapeHtml(record.title)}" required></div>
          <div><label>Standort</label><input name="location" value="${escapeHtml(record.location)}"></div>
          <div><label>Status</label><select name="status">${jobStatuses(record.status)}</select></div>
          <div><label>Fee</label><input name="fee_amount" type="number" value="${escapeHtml(record.fee_amount)}"></div>
          <div><label>Gehaltsminimum</label><input name="salary_min" type="number" value="${escapeHtml(record.salary_min)}"></div>
          <div><label>Gehaltsmaximum</label><input name="salary_max" type="number" value="${escapeHtml(record.salary_max)}"></div>
          <div class="full-span"><label>Muss-Kriterien, durch Komma getrennt</label><input name="must_haves" value="${escapeHtml((record.must_haves || []).join(', '))}"></div>
          <div class="full-span"><label>Anforderungen, durch Komma getrennt</label><input name="requirements" value="${escapeHtml((record.requirements || []).join(', '))}"></div>
          <div class="full-span"><label>Beschreibung</label><textarea name="description">${escapeHtml(record.description)}</textarea></div>
          <div class="drawer-actions full-span"><button class="btn primary" type="submit">Änderungen speichern</button><button id="archiveRecord" class="btn danger" type="button">Archivieren</button></div>
        </form><div id="detailMessage" class="message"></div>`;
    }
    document.getElementById('detailForm').addEventListener('submit', saveRecord);
    document.getElementById('archiveRecord').addEventListener('click', archiveRecord);
  }

  function candidateStatuses(selected) {
    return ['new','contacted','qualified','presented','interview','offer','placed','talent_pool','rejected','archived'].map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`).join('');
  }

  function jobStatuses(selected) {
    return ['draft','active','paused','filled','cancelled','archived'].map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`).join('');
  }

  async function saveRecord(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let payload;
    if (current.kind === 'candidate') {
      payload = {
        first_name: form.get('first_name')?.trim(), last_name: form.get('last_name')?.trim(), email: form.get('email')?.trim() || null,
        phone: form.get('phone')?.trim() || null, current_title: form.get('current_title')?.trim() || null, location: form.get('location')?.trim() || null,
        salary_expectation: form.get('salary_expectation') ? Number(form.get('salary_expectation')) : null, status: form.get('status'),
        skills: splitList(form.get('skills')), notes: form.get('notes')?.trim() || null
      };
    } else {
      payload = {
        title: form.get('title')?.trim(), location: form.get('location')?.trim() || null, status: form.get('status'),
        fee_amount: form.get('fee_amount') ? Number(form.get('fee_amount')) : null,
        salary_min: form.get('salary_min') ? Number(form.get('salary_min')) : null, salary_max: form.get('salary_max') ? Number(form.get('salary_max')) : null,
        must_haves: splitList(form.get('must_haves')), requirements: splitList(form.get('requirements')), description: form.get('description')?.trim() || null
      };
    }
    const table = current.kind === 'candidate' ? 'candidates' : 'jobs';
    const { data, error } = await db.from(table).update(payload).eq('id', current.record.id).select(current.kind === 'job' ? '*,company:companies(id,name)' : '*').single();
    const message = document.getElementById('detailMessage');
    if (error) { message.textContent = error.message; message.className = 'message error-text'; return; }
    current.record = data;
    message.textContent = 'Änderungen gespeichert.';
    message.className = 'message success-text';
    document.getElementById('drawerTitle').textContent = current.kind === 'candidate' ? `${data.first_name} ${data.last_name}` : data.title;
    document.getElementById('refreshBtn')?.click();
  }

  async function archiveRecord() {
    if (!confirm('Diesen Datensatz wirklich archivieren?')) return;
    const table = current.kind === 'candidate' ? 'candidates' : 'jobs';
    const { error } = await db.from(table).update({ status: 'archived' }).eq('id', current.record.id);
    if (error) return alert(error.message);
    document.getElementById('refreshBtn')?.click();
    closeDrawer();
  }

  const splitList = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

  async function renderProcesses() {
    const content = document.getElementById('drawerContent');
    content.innerHTML = '<div class="drawer-loading">Prozesse werden geladen …</div>';
    let query = db.from('applications').select('*,candidate:candidates(first_name,last_name,current_title),job:jobs(title,company:companies(name))').eq('organization_id', organizationId).order('updated_at', { ascending: false });
    query = current.kind === 'candidate' ? query.eq('candidate_id', current.record.id) : query.eq('job_id', current.record.id);
    const { data, error } = await query;
    if (error) return content.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    content.innerHTML = `<div class="detail-list">${(data || []).map(item => `
      <article><div><strong>${current.kind === 'candidate' ? escapeHtml(item.job?.title) : escapeHtml(`${item.candidate?.first_name || ''} ${item.candidate?.last_name || ''}`)}</strong><p class="muted">${current.kind === 'candidate' ? escapeHtml(item.job?.company?.name) : escapeHtml(item.candidate?.current_title)}</p></div><div><span class="badge blue">${escapeHtml(item.stage)}</span><b>${euro(item.fee_amount)}</b></div></article>`).join('') || '<div class="empty">Noch keine Prozesse vorhanden.</div>'}</div>`;
  }

  async function renderTasks() {
    const content = document.getElementById('drawerContent');
    content.innerHTML = '<div class="drawer-loading">Aufgaben werden geladen …</div>';
    const entityColumn = current.kind === 'candidate' ? 'candidate_id' : 'job_id';
    const { data, error } = await db.from('tasks').select('*').eq('organization_id', organizationId).eq(entityColumn, current.record.id).order('due_at', { ascending: true });
    if (error) return content.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    content.innerHTML = `<form id="quickTaskForm" class="quick-task"><input name="title" placeholder="Neue Aufgabe" required><input name="due_at" type="datetime-local"><button class="btn primary">Hinzufügen</button></form><div class="detail-list">${(data || []).map(item => `<article><div><strong>${escapeHtml(item.title)}</strong><p class="muted">${formatDate(item.due_at)}</p></div><span class="badge">${escapeHtml(item.status)}</span></article>`).join('') || '<div class="empty">Keine verknüpften Aufgaben.</div>'}</div>`;
    document.getElementById('quickTaskForm').addEventListener('submit', createTask);
  }

  async function createTask(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { organization_id: organizationId, title: form.get('title')?.trim(), due_at: form.get('due_at') ? new Date(form.get('due_at')).toISOString() : null, priority: 'medium', status: 'open' };
    payload[current.kind === 'candidate' ? 'candidate_id' : 'job_id'] = current.record.id;
    const { error } = await db.from('tasks').insert(payload);
    if (error) return alert(error.message);
    renderTasks();
    document.getElementById('refreshBtn')?.click();
  }

  async function renderHistory() {
    const content = document.getElementById('drawerContent');
    content.innerHTML = '<div class="drawer-loading">Historie wird geladen …</div>';
    const entityColumn = current.kind === 'candidate' ? 'candidate_id' : 'job_id';
    const { data, error } = await db.from('activities').select('*').eq('organization_id', organizationId).eq(entityColumn, current.record.id).order('occurred_at', { ascending: false }).limit(50);
    if (error) return content.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    content.innerHTML = `<div class="timeline">${(data || []).map(item => `<article><span></span><div><small>${formatDate(item.occurred_at)} · ${escapeHtml(item.activity_type)}</small><strong>${escapeHtml(item.subject)}</strong><p>${escapeHtml(item.body)}</p></div></article>`).join('') || '<div class="empty">Noch keine Historie vorhanden.</div>'}</div>`;
  }

  injectDrawer();
  const observer = new MutationObserver(() => addRecordButtons().catch(() => {}));
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => addRecordButtons().catch(() => {}), 1200);
})();

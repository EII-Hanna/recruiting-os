(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let organizationId = null;
  let company = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(Number(value || 0));
  const fmt = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)) : '—';

  async function getOrg() {
    if (organizationId) return organizationId;
    const { data } = await db.rpc('my_organizations');
    organizationId = data?.[0]?.organization_id || null;
    return organizationId;
  }

  function injectDrawer() {
    if (document.getElementById('companyDrawer')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="companyDrawer" class="record-drawer" aria-hidden="true">
        <div class="drawer-backdrop" data-company-close></div>
        <aside class="drawer-panel company-panel">
          <header class="drawer-header">
            <div><small>Unternehmensakte</small><h2 id="companyDrawerTitle">Unternehmen</h2><p id="companyDrawerSubtitle" class="muted"></p></div>
            <button class="btn" data-company-close>Schließen</button>
          </header>
          <div class="drawer-tabs company-tabs">
            <button class="active" data-company-tab="overview">Übersicht</button>
            <button data-company-tab="contacts">Ansprechpartner</button>
            <button data-company-tab="jobs">Vakanzen</button>
            <button data-company-tab="processes">Prozesse</button>
            <button data-company-tab="tasks">Aufgaben</button>
            <button data-company-tab="history">Historie</button>
          </div>
          <div id="companyDrawerContent" class="drawer-content"></div>
        </aside>
      </div>`);
    document.querySelectorAll('[data-company-close]').forEach(x => x.addEventListener('click', close));
    document.querySelectorAll('[data-company-tab]').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('[data-company-tab]').forEach(x => x.classList.remove('active'));
      button.classList.add('active');
      renderTab(button.dataset.companyTab);
    }));
  }

  async function addButtons() {
    const org = await getOrg();
    if (!org) return;
    const { data } = await db.from('companies').select('id,name,industry').eq('organization_id', org);
    const companies = data || [];
    document.querySelectorAll('#companiesTable tr').forEach(row => {
      if (row.dataset.companyReady) return;
      const cells = row.querySelectorAll('td');
      if (!cells.length) return;
      const name = cells[0].textContent.trim().toLowerCase();
      const found = companies.find(item => (item.name || '').trim().toLowerCase() === name);
      if (!found) return;
      cells[0].innerHTML = `<button class="record-link company-open" data-id="${found.id}">${esc(cells[0].textContent.trim())}</button>`;
      row.dataset.companyReady = '1';
    });
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('.company-open');
    if (!trigger) return;
    event.preventDefault();
    open(trigger.dataset.id);
  });

  async function open(id) {
    injectDrawer();
    const drawer = document.getElementById('companyDrawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('companyDrawerContent').innerHTML = '<div class="drawer-loading">Unternehmensakte wird geladen …</div>';
    document.querySelectorAll('[data-company-tab]').forEach((x, index) => x.classList.toggle('active', index === 0));
    const org = await getOrg();
    const { data, error } = await db.from('companies').select('*').eq('organization_id', org).eq('id', id).single();
    if (error) return document.getElementById('companyDrawerContent').innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    company = data;
    document.getElementById('companyDrawerTitle').textContent = data.name || 'Unternehmen';
    document.getElementById('companyDrawerSubtitle').textContent = data.industry || 'Keine Branche hinterlegt';
    renderOverview();
  }

  function close() {
    document.getElementById('companyDrawer')?.classList.remove('open');
    company = null;
  }

  function renderTab(tab) {
    if (!company) return;
    if (tab === 'overview') return renderOverview();
    if (tab === 'contacts') return renderContacts();
    if (tab === 'jobs') return renderJobs();
    if (tab === 'processes') return renderProcesses();
    if (tab === 'tasks') return renderTasks();
    return renderHistory();
  }

  function renderOverview() {
    document.getElementById('companyDrawerContent').innerHTML = `
      <form id="companyForm" class="detail-form">
        <div class="full-span"><label>Unternehmen</label><input name="name" value="${esc(company.name)}" required></div>
        <div><label>Branche</label><input name="industry" value="${esc(company.industry)}"></div>
        <div><label>Kundenstatus</label><select name="customer_status">${options(['prospect','active_customer','former_customer','partner','archived'], company.customer_status)}</select></div>
        <div><label>Website</label><input name="website" value="${esc(company.website)}"></div>
        <div><label>Allgemeine E-Mail</label><input name="email" type="email" value="${esc(company.email)}"></div>
        <div><label>Telefon</label><input name="phone" value="${esc(company.phone)}"></div>
        <div><label>Umsatzpotenzial</label><input name="potential_value" type="number" value="${esc(company.potential_value)}"></div>
        <div class="full-span"><label>Adresse</label><input name="address" value="${esc(company.address)}"></div>
        <div><label>PLZ</label><input name="postal_code" value="${esc(company.postal_code)}"></div>
        <div><label>Ort</label><input name="city" value="${esc(company.city)}"></div>
        <div><label>Land</label><input name="country" value="${esc(company.country || 'Deutschland')}"></div>
        <div><label>CRM-Status</label><select name="status">${options(['new','contacted','qualified','active','inactive','archived'], company.status)}</select></div>
        <div class="full-span"><label>Notizen</label><textarea name="notes">${esc(company.notes)}</textarea></div>
        <div class="drawer-actions full-span"><button class="btn primary">Speichern</button><button id="archiveCompany" type="button" class="btn danger">Archivieren</button></div>
      </form><div id="companyMessage" class="message"></div>`;
    document.getElementById('companyForm').addEventListener('submit', saveCompany);
    document.getElementById('archiveCompany').addEventListener('click', archiveCompany);
  }

  const options = (values, selected) => values.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value.replaceAll('_',' ')}</option>`).join('');

  async function saveCompany(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get('name')?.trim(), industry: form.get('industry')?.trim() || null, website: form.get('website')?.trim() || null,
      email: form.get('email')?.trim() || null, phone: form.get('phone')?.trim() || null, address: form.get('address')?.trim() || null,
      postal_code: form.get('postal_code')?.trim() || null, city: form.get('city')?.trim() || null, country: form.get('country')?.trim() || null,
      customer_status: form.get('customer_status'), status: form.get('status'), notes: form.get('notes')?.trim() || null,
      potential_value: form.get('potential_value') ? Number(form.get('potential_value')) : null
    };
    const { data, error } = await db.from('companies').update(payload).eq('id', company.id).select('*').single();
    const message = document.getElementById('companyMessage');
    if (error) { message.textContent = error.message; message.className = 'message error-text'; return; }
    company = data;
    document.getElementById('companyDrawerTitle').textContent = data.name;
    message.textContent = 'Unternehmen gespeichert.';
    message.className = 'message success-text';
    document.getElementById('refreshBtn')?.click();
  }

  async function archiveCompany() {
    if (!confirm('Unternehmen wirklich archivieren?')) return;
    const { error } = await db.from('companies').update({ status:'archived', customer_status:'archived', archived_at:new Date().toISOString() }).eq('id', company.id);
    if (error) return alert(error.message);
    document.getElementById('refreshBtn')?.click();
    close();
  }

  async function renderContacts() {
    const content = document.getElementById('companyDrawerContent');
    content.innerHTML = '<div class="drawer-loading">Ansprechpartner werden geladen …</div>';
    const { data, error } = await db.from('company_contacts').select('*').eq('organization_id', organizationId).eq('company_id', company.id).order('is_primary', { ascending:false }).order('last_name');
    if (error) return content.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    content.innerHTML = `
      <form id="contactForm" class="detail-form compact-form">
        <input type="hidden" name="id">
        <div><label>Vorname</label><input name="first_name" required></div>
        <div><label>Nachname</label><input name="last_name" required></div>
        <div><label>Position</label><input name="job_title"></div>
        <div><label>E-Mail</label><input name="email" type="email"></div>
        <div><label>Telefon</label><input name="phone"></div>
        <div><label>LinkedIn</label><input name="linkedin_url"></div>
        <div class="full-span checkbox-line"><label><input name="is_primary" type="checkbox"> Hauptansprechpartner</label></div>
        <div class="full-span"><label>Notizen</label><textarea name="notes"></textarea></div>
        <div class="drawer-actions full-span"><button class="btn primary">Ansprechpartner speichern</button><button id="resetContact" type="button" class="btn">Leeren</button></div>
      </form>
      <div class="detail-list contact-list">${(data || []).map(contact => `
        <article>
          <div><strong>${esc(contact.first_name)} ${esc(contact.last_name)} ${contact.is_primary ? '<span class="badge green">Hauptkontakt</span>' : ''}</strong><p class="muted">${esc(contact.job_title || 'Keine Position')} · ${esc(contact.email || 'Keine E-Mail')} · ${esc(contact.phone || 'Kein Telefon')}</p></div>
          <div class="inline-actions"><button class="btn contact-edit" data-contact='${esc(JSON.stringify(contact))}'>Bearbeiten</button><button class="btn danger contact-delete" data-id="${contact.id}">Löschen</button></div>
        </article>`).join('') || '<div class="empty">Noch keine Ansprechpartner vorhanden.</div>'}</div>`;
    document.getElementById('contactForm').addEventListener('submit', saveContact);
    document.getElementById('resetContact').addEventListener('click', resetContactForm);
    document.querySelectorAll('.contact-edit').forEach(button => button.addEventListener('click', () => editContact(JSON.parse(button.dataset.contact))));
    document.querySelectorAll('.contact-delete').forEach(button => button.addEventListener('click', () => deleteContact(button.dataset.id)));
  }

  function editContact(contact) {
    const form = document.getElementById('contactForm');
    Object.entries(contact).forEach(([key,value]) => {
      const field = form.elements[key];
      if (!field) return;
      if (field.type === 'checkbox') field.checked = Boolean(value); else field.value = value ?? '';
    });
    form.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function resetContactForm() { document.getElementById('contactForm')?.reset(); document.querySelector('#contactForm [name="id"]').value = ''; }

  async function saveContact(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      organization_id: organizationId, company_id: company.id, first_name: form.get('first_name')?.trim(), last_name: form.get('last_name')?.trim(),
      job_title: form.get('job_title')?.trim() || null, email: form.get('email')?.trim() || null, phone: form.get('phone')?.trim() || null,
      linkedin_url: form.get('linkedin_url')?.trim() || null, is_primary: form.get('is_primary') === 'on', notes: form.get('notes')?.trim() || null,
      updated_at: new Date().toISOString()
    };
    const id = form.get('id');
    let result;
    if (payload.is_primary) await db.from('company_contacts').update({ is_primary:false }).eq('organization_id', organizationId).eq('company_id', company.id);
    result = id ? await db.from('company_contacts').update(payload).eq('id', id) : await db.from('company_contacts').insert(payload);
    if (result.error) return alert(result.error.message);
    renderContacts();
  }

  async function deleteContact(id) {
    if (!confirm('Ansprechpartner wirklich löschen?')) return;
    const { error } = await db.from('company_contacts').delete().eq('id', id);
    if (error) return alert(error.message);
    renderContacts();
  }

  async function renderJobs() {
    const content = document.getElementById('companyDrawerContent');
    const { data, error } = await db.from('jobs').select('*').eq('organization_id', organizationId).eq('company_id', company.id).order('created_at', { ascending:false });
    if (error) return content.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    content.innerHTML = `<div class="company-summary"><div><small>Offene Vakanzen</small><strong>${(data || []).filter(x => x.status === 'active').length}</strong></div><div><small>Gesamtpotenzial</small><strong>${money((data || []).reduce((sum,x) => sum + Number(x.fee_amount || 0),0))}</strong></div></div><div class="detail-list">${(data || []).map(job => `<article><div><strong>${esc(job.title)}</strong><p class="muted">${esc(job.location || 'Kein Standort')}</p></div><div><span class="badge blue">${esc(job.status)}</span><b>${money(job.fee_amount)}</b></div></article>`).join('') || '<div class="empty">Keine Vakanzen vorhanden.</div>'}</div>`;
  }

  async function renderProcesses() {
    const content = document.getElementById('companyDrawerContent');
    const { data, error } = await db.from('applications').select('*,candidate:candidates(first_name,last_name,current_title),job:jobs!inner(title,company_id)').eq('organization_id', organizationId).eq('job.company_id', company.id).order('updated_at', { ascending:false });
    if (error) return content.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    content.innerHTML = `<div class="detail-list">${(data || []).map(item => `<article><div><strong>${esc(item.candidate?.first_name)} ${esc(item.candidate?.last_name)}</strong><p class="muted">${esc(item.job?.title)} · ${esc(item.candidate?.current_title || '')}</p></div><div><span class="badge blue">${esc(item.stage)}</span><b>${money(item.fee_amount)}</b></div></article>`).join('') || '<div class="empty">Noch keine Kandidatenprozesse.</div>'}</div>`;
  }

  async function renderTasks() {
    const content = document.getElementById('companyDrawerContent');
    const { data, error } = await db.from('tasks').select('*').eq('organization_id', organizationId).eq('company_id', company.id).order('due_at', { ascending:true });
    if (error) return content.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    content.innerHTML = `<form id="companyTaskForm" class="quick-task"><input name="title" placeholder="Neue Aufgabe" required><input name="due_at" type="datetime-local"><button class="btn primary">Hinzufügen</button></form><div class="detail-list">${(data || []).map(item => `<article><div><strong>${esc(item.title)}</strong><p class="muted">${fmt(item.due_at)}</p></div><span class="badge">${esc(item.status)}</span></article>`).join('') || '<div class="empty">Keine Aufgaben vorhanden.</div>'}</div>`;
    document.getElementById('companyTaskForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const { error: insertError } = await db.from('tasks').insert({ organization_id:organizationId, company_id:company.id, title:form.get('title')?.trim(), due_at:form.get('due_at') ? new Date(form.get('due_at')).toISOString() : null, status:'open', priority:'medium' });
      if (insertError) return alert(insertError.message);
      document.getElementById('refreshBtn')?.click(); renderTasks();
    });
  }

  async function renderHistory() {
    const content = document.getElementById('companyDrawerContent');
    const { data, error } = await db.from('activities').select('*').eq('organization_id', organizationId).eq('company_id', company.id).order('occurred_at', { ascending:false }).limit(50);
    if (error) return content.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    content.innerHTML = `<div class="detail-list timeline">${(data || []).map(item => `<article><div><strong>${esc(item.subject || item.activity_type)}</strong><p class="muted">${esc(item.body || '')}</p></div><time>${fmt(item.occurred_at)}</time></article>`).join('') || '<div class="empty">Noch keine Unternehmensaktivitäten.</div>'}</div>`;
  }

  const observer = new MutationObserver(() => addButtons());
  observer.observe(document.body, { childList:true, subtree:true });
  window.addEventListener('load', () => { injectDrawer(); addButtons(); });
  setInterval(addButtons, 1800);
})();

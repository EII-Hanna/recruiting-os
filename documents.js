(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let currentEntity = null;
  let organizationId = null;
  const bucket = 'recruiting-documents';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const formatBytes = bytes => {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  };
  const labels = {cv:'Lebenslauf',job_description:'Stellenbeschreibung',contract:'Vertrag',certificate:'Zertifikat',reference:'Zeugnis',presentation:'Präsentation',other:'Sonstiges'};

  async function ensureOrg() {
    if (organizationId) return organizationId;
    const { data } = await db.rpc('my_organizations');
    organizationId = data?.[0]?.organization_id || null;
    return organizationId;
  }

  document.addEventListener('click', event => {
    const opener = event.target.closest('.detail-open');
    if (opener) currentEntity = { kind: opener.dataset.kind, id: opener.dataset.id };
  }, true);

  const observer = new MutationObserver(() => {
    const tabs = document.querySelector('.drawer-tabs');
    if (!tabs || tabs.querySelector('[data-tab="documents"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tab = 'documents';
    button.textContent = 'Dokumente';
    button.addEventListener('click', event => {
      event.stopImmediatePropagation();
      document.querySelectorAll('.drawer-tabs button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      renderDocuments();
    });
    tabs.appendChild(button);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  async function renderDocuments() {
    const content = document.getElementById('drawerContent');
    if (!content || !currentEntity) return;
    content.innerHTML = '<div class="drawer-loading">Dokumente werden geladen …</div>';
    const org = await ensureOrg();
    if (!org) return content.innerHTML = '<div class="notice error">Organisation konnte nicht geladen werden.</div>';
    const column = currentEntity.kind === 'candidate' ? 'candidate_id' : currentEntity.kind === 'job' ? 'job_id' : 'company_id';
    const { data, error } = await db.from('documents').select('*').eq('organization_id', org).eq(column, currentEntity.id).order('created_at', { ascending: false });
    if (error) return content.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;

    content.innerHTML = `
      <section class="document-cockpit">
        <form id="documentUploadForm" class="document-upload-card">
          <div class="document-upload-head"><div><h3>Dokument hochladen</h3><p class="muted">PDF, Word, PNG oder JPG · maximal 15 MB</p></div><span class="badge blue">Sicher gespeichert</span></div>
          <div class="document-upload-grid">
            <div><label>Dokumenttyp</label><select name="document_type">${Object.entries(labels).map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></div>
            <div><label>Datei</label><input name="file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" required></div>
            <div class="full-span"><label>Notiz</label><input name="notes" placeholder="Optional: kurze Einordnung"></div>
          </div>
          <div class="document-upload-actions"><button class="btn primary" type="submit">Hochladen</button></div>
          <div id="documentMessage" class="message"></div>
        </form>
        <div class="document-list">${(data || []).map(documentCard).join('') || '<div class="empty">Noch keine Dokumente vorhanden.</div>'}</div>
      </section>`;

    document.getElementById('documentUploadForm').addEventListener('submit', uploadDocument);
    content.querySelectorAll('[data-document-open]').forEach(button => button.addEventListener('click', () => openDocument(button.dataset.documentOpen)));
    content.querySelectorAll('[data-document-delete]').forEach(button => button.addEventListener('click', () => deleteDocument(button.dataset.documentDelete, button.dataset.path)));
  }

  function documentCard(item) {
    return `<article class="document-card">
      <div class="document-icon">${item.document_type === 'cv' ? 'CV' : 'DOC'}</div>
      <div class="document-info"><strong>${esc(item.file_name)}</strong><p>${esc(labels[item.document_type] || item.document_type)} · ${formatBytes(item.size_bytes)}</p><small>${new Date(item.created_at).toLocaleString('de-DE')}</small>${item.notes ? `<p class="document-note">${esc(item.notes)}</p>` : ''}</div>
      <div class="document-actions"><button class="btn" data-document-open="${item.id}">Öffnen</button><button class="btn danger" data-document-delete="${item.id}" data-path="${esc(item.storage_path)}">Löschen</button></div>
    </article>`;
  }

  async function uploadDocument(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    const message = document.getElementById('documentMessage');
    if (!(file instanceof File) || !file.size) return;
    if (file.size > 15 * 1024 * 1024) {
      message.textContent = 'Die Datei ist größer als 15 MB.';
      message.className = 'message error-text';
      return;
    }
    const org = await ensureOrg();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const path = `${org}/${currentEntity.kind}/${currentEntity.id}/${crypto.randomUUID()}-${safeName}`;
    message.textContent = 'Datei wird hochgeladen …';
    message.className = 'message';
    const upload = await db.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
    if (upload.error) {
      message.textContent = upload.error.message;
      message.className = 'message error-text';
      return;
    }
    const parent = currentEntity.kind === 'candidate' ? { candidate_id: currentEntity.id } : currentEntity.kind === 'job' ? { job_id: currentEntity.id } : { company_id: currentEntity.id };
    const { error } = await db.from('documents').insert({
      organization_id: org,
      ...parent,
      document_type: form.get('document_type'),
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      notes: form.get('notes')?.trim() || null
    });
    if (error) {
      await db.storage.from(bucket).remove([path]);
      message.textContent = error.message;
      message.className = 'message error-text';
      return;
    }
    message.textContent = 'Dokument erfolgreich hochgeladen.';
    message.className = 'message success-text';
    await renderDocuments();
  }

  async function openDocument(id) {
    const { data: item, error } = await db.from('documents').select('storage_path').eq('id', id).single();
    if (error) return alert(error.message);
    const signed = await db.storage.from(bucket).createSignedUrl(item.storage_path, 300);
    if (signed.error) return alert(signed.error.message);
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function deleteDocument(id, path) {
    if (!confirm('Dieses Dokument wirklich löschen?')) return;
    const storageResult = await db.storage.from(bucket).remove([path]);
    if (storageResult.error) return alert(storageResult.error.message);
    const { error } = await db.from('documents').delete().eq('id', id);
    if (error) return alert(error.message);
    await renderDocuments();
  }
})();

(() => {
  const cfg = window.RECRUITING_OS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true} });
  let organizationId = null;
  let campaigns = [];
  let submissions = [];
  let insights = [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const euro = value => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(Number(value||0));
  const number = value => new Intl.NumberFormat('de-DE').format(Number(value||0));
  const qualifiedStatuses = new Set(['qualified','presented','interview','offer','placed']);

  async function ensureOrg(){
    if (organizationId) return organizationId;
    const { data } = await db.rpc('my_organizations');
    organizationId = data?.[0]?.organization_id || null;
    return organizationId;
  }

  function inject(){
    const view = document.getElementById('recruitingAds');
    if (!view || document.getElementById('adsPerformanceShell')) return;
    const shell = document.createElement('section');
    shell.id = 'adsPerformanceShell';
    shell.className = 'performance-shell section';
    shell.innerHTML = `
      <div class="performance-head">
        <div><h2>Performance & Bewerber</h2><p class="muted">Von Werbeausgaben bis qualifizierter Bewerbung.</p></div>
        <div class="performance-actions"><span id="performanceSyncState" class="sync-state"></span><button id="syncAllInsights" class="btn">Meta-Daten synchronisieren</button><button id="refreshPerformance" class="btn">Aktualisieren</button></div>
      </div>
      <div class="performance-grid">
        <div class="performance-kpi"><small>Ausgaben</small><strong id="perfSpend">0 €</strong></div>
        <div class="performance-kpi"><small>Klicks</small><strong id="perfClicks">0</strong></div>
        <div class="performance-kpi"><small>Bewerbungen</small><strong id="perfLeads">0</strong></div>
        <div class="performance-kpi"><small>Kosten/Bewerbung</small><strong id="perfCpl">0 €</strong></div>
        <div class="performance-kpi"><small>Qualifiziert</small><strong id="perfQualified">0</strong></div>
        <div class="performance-kpi"><small>Kosten/qualifiziert</small><strong id="perfCpq">0 €</strong></div>
      </div>
      <div id="performanceCampaignTable" class="performance-table"></div>
      <div class="section"><div class="section-head"><h2>Neueste Bewerber</h2></div><div id="performanceApplicants" class="applicant-panel"></div></div>`;
    view.appendChild(shell);
    document.getElementById('refreshPerformance').onclick = load;
    document.getElementById('syncAllInsights').onclick = syncAll;
    const adsNav = document.querySelector('[data-view="recruitingAds"]');
    adsNav?.addEventListener('click', () => setTimeout(load, 120));
    load();
  }

  async function load(){
    const org = await ensureOrg();
    if (!org || !document.getElementById('adsPerformanceShell')) return;
    const [campaignResult, submissionResult, insightResult] = await Promise.all([
      db.from('recruiting_campaigns').select('id,name,status,meta_campaign_id,daily_budget,duration_days,job:jobs(title,company:companies(name))').eq('organization_id',org).order('created_at',{ascending:false}),
      db.from('funnel_submissions').select('id,campaign_id,candidate_id,first_name,last_name,email,phone,source,status,creative_name,created_at,candidate:candidates(status,current_title),job:jobs(title)').eq('organization_id',org).order('created_at',{ascending:false}).limit(100),
      db.from('campaign_insights').select('*').eq('organization_id',org).order('insight_date',{ascending:false})
    ]);
    campaigns = campaignResult.data || [];
    submissions = submissionResult.data || [];
    insights = insightResult.data || [];
    render();
  }

  function aggregateCampaign(campaign){
    const campaignInsights = insights.filter(item => item.campaign_id === campaign.id);
    const campaignSubmissions = submissions.filter(item => item.campaign_id === campaign.id);
    const spend = campaignInsights.reduce((sum,item)=>sum+Number(item.spend||0),0);
    const clicks = campaignInsights.reduce((sum,item)=>sum+Number(item.clicks||0),0);
    const impressions = campaignInsights.reduce((sum,item)=>sum+Number(item.impressions||0),0);
    const metaLeads = campaignInsights.reduce((sum,item)=>sum+Number(item.leads||0),0);
    const leads = Math.max(metaLeads, campaignSubmissions.length);
    const qualified = campaignSubmissions.filter(item => qualifiedStatuses.has(item.candidate?.status)).length;
    const interviews = campaignSubmissions.filter(item => ['interview','offer','placed'].includes(item.candidate?.status)).length;
    const hires = campaignSubmissions.filter(item => item.candidate?.status === 'placed').length;
    return { spend, clicks, impressions, leads, qualified, interviews, hires, cpl: leads ? spend/leads : 0, cpq: qualified ? spend/qualified : 0 };
  }

  function render(){
    const totals = campaigns.reduce((acc,campaign)=>{
      const item = aggregateCampaign(campaign);
      Object.keys(acc).forEach(key => acc[key] += Number(item[key] || 0));
      return acc;
    }, {spend:0,clicks:0,impressions:0,leads:0,qualified:0,interviews:0,hires:0});
    document.getElementById('perfSpend').textContent = euro(totals.spend);
    document.getElementById('perfClicks').textContent = number(totals.clicks);
    document.getElementById('perfLeads').textContent = number(totals.leads);
    document.getElementById('perfCpl').textContent = euro(totals.leads ? totals.spend/totals.leads : 0);
    document.getElementById('perfQualified').textContent = number(totals.qualified);
    document.getElementById('perfCpq').textContent = euro(totals.qualified ? totals.spend/totals.qualified : 0);

    document.getElementById('performanceCampaignTable').innerHTML = campaigns.length ? `<table><thead><tr><th>Kampagne</th><th>Ausgaben</th><th>Impressionen</th><th>Klicks</th><th>Bewerbungen</th><th>CPL</th><th>Qualifiziert</th><th>CPQ</th><th>Interviews</th><th>Einstellungen</th><th></th></tr></thead><tbody>${campaigns.map(campaign=>{
      const m = aggregateCampaign(campaign);
      return `<tr><td><span class="perf-campaign">${esc(campaign.name)}</span><span class="perf-sub">${esc(campaign.job?.title||'')} · ${esc(campaign.job?.company?.name||'')}</span></td><td>${euro(m.spend)}</td><td>${number(m.impressions)}</td><td>${number(m.clicks)}</td><td>${number(m.leads)}</td><td>${euro(m.cpl)}</td><td>${number(m.qualified)}</td><td>${euro(m.cpq)}</td><td>${number(m.interviews)}</td><td>${number(m.hires)}</td><td>${campaign.meta_campaign_id?`<button class="btn" data-sync-campaign="${campaign.id}">Sync</button>`:'<span class="muted">Nicht bei Meta</span>'}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="performance-empty">Noch keine Kampagnen vorhanden.</div>';

    document.querySelectorAll('[data-sync-campaign]').forEach(button => button.onclick = () => syncCampaign(button.dataset.syncCampaign, button));
    document.getElementById('performanceApplicants').innerHTML = submissions.length ? submissions.slice(0,20).map(item=>`<article class="applicant-row"><div><strong>${esc(item.first_name)} ${esc(item.last_name)}</strong><small>${esc(item.email)}${item.phone?` · ${esc(item.phone)}`:''}</small></div><div><span class="lead-source">${item.source==='meta_lead_form'?'Meta Lead Form':'Recruiting Funnel'}</span><small>${esc(item.creative_name||'Ohne Creative-Zuordnung')}</small></div><div><strong>${esc(item.job?.title||'Vakanz')}</strong><small>${new Date(item.created_at).toLocaleString('de-DE')}</small></div><span class="badge ${qualifiedStatuses.has(item.candidate?.status)?'green':'blue'}">${esc(item.candidate?.status||item.status)}</span></article>`).join('') : '<div class="performance-empty">Noch keine Bewerbungen eingegangen.</div>';
  }

  async function syncCampaign(id, button){
    const original = button?.textContent;
    if (button){ button.disabled = true; button.textContent = 'Sync …'; }
    const { data, error } = await db.functions.invoke('sync-meta-insights',{body:{campaign_id:id}});
    if (button){ button.disabled = false; button.textContent = original || 'Sync'; }
    if (error || data?.error) return alert(error?.message || data.error);
    await load();
  }

  async function syncAll(){
    const target = document.getElementById('performanceSyncState');
    const eligible = campaigns.filter(item => item.meta_campaign_id);
    if (!eligible.length){ target.textContent = 'Keine Meta-Kampagne zum Synchronisieren.'; return; }
    target.textContent = `0/${eligible.length} synchronisiert`;
    let done = 0;
    for (const campaign of eligible){
      await db.functions.invoke('sync-meta-insights',{body:{campaign_id:campaign.id}});
      done += 1;
      target.textContent = `${done}/${eligible.length} synchronisiert`;
    }
    await load();
    target.textContent = 'Synchronisierung abgeschlossen.';
  }

  const observer = new MutationObserver(inject);
  observer.observe(document.body,{childList:true,subtree:true});
  inject();
})();

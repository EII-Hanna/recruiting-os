import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || '';
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === verifyToken) return new Response(challenge || '', { status: 200 });
    return new Response('Verification failed', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);
  let payload: any;
  try { payload = await req.json(); } catch { return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders }); }

  const changes: any[] = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'leadgen' && change.value?.leadgen_id) changes.push(change.value);
    }
  }

  for (const leadEvent of changes) {
    const leadId = String(leadEvent.leadgen_id);
    const pageId = String(leadEvent.page_id || '');
    const adId = String(leadEvent.ad_id || '');
    const formId = String(leadEvent.form_id || '');

    const { data: connection } = await admin
      .from('meta_connections')
      .select('*')
      .eq('selected_page_id', pageId)
      .eq('status', 'connected')
      .maybeSingle();

    const eventInsert = await admin.from('meta_webhook_events').insert({
      organization_id: connection?.organization_id || null,
      event_type: 'leadgen',
      external_id: leadId,
      payload,
      status: connection ? 'received' : 'ignored',
    }).select('id').single();
    const eventId = eventInsert.data?.id;
    if (!connection) continue;

    try {
      const version = Deno.env.get('META_GRAPH_VERSION') || 'v23.0';
      const leadUrl = new URL(`https://graph.facebook.com/${version}/${leadId}`);
      leadUrl.searchParams.set('fields', 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id');
      leadUrl.searchParams.set('access_token', connection.access_token);
      const leadRes = await fetch(leadUrl);
      const lead = await leadRes.json();
      if (!leadRes.ok || lead.error) throw new Error(lead.error?.message || 'Meta Lead konnte nicht geladen werden.');

      const fields: Record<string,string> = {};
      for (const item of lead.field_data || []) fields[item.name] = Array.isArray(item.values) ? String(item.values[0] || '') : String(item.values || '');
      const fullName = fields.full_name || fields.name || '';
      const parts = fullName.trim().split(/\s+/);
      const firstName = fields.first_name || parts.shift() || 'Meta';
      const lastName = fields.last_name || parts.join(' ') || 'Lead';
      const email = (fields.email || '').trim().toLowerCase();
      const phone = fields.phone_number || fields.phone || null;
      if (!email) throw new Error('Meta Lead enthält keine E-Mail-Adresse.');

      const { data: campaign } = await admin
        .from('recruiting_campaigns')
        .select('id,job_id,organization_id,name')
        .eq('organization_id', connection.organization_id)
        .eq('meta_campaign_id', String(lead.campaign_id || leadEvent.campaign_id || ''))
        .maybeSingle();
      if (!campaign) throw new Error('Keine RecruitingOS-Kampagne zur Meta-Kampagne gefunden.');

      let { data: candidate } = await admin.from('candidates').select('id').eq('organization_id', campaign.organization_id).ilike('email', email).maybeSingle();
      if (!candidate) {
        const created = await admin.from('candidates').insert({
          organization_id: campaign.organization_id,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          status: 'new',
          notes: `Quelle: Meta Lead Ad · Kampagne: ${campaign.name}`,
        }).select('id').single();
        if (created.error) throw created.error;
        candidate = created.data;
      }

      const submission = await admin.from('funnel_submissions').insert({
        organization_id: campaign.organization_id,
        funnel_id: null,
        campaign_id: campaign.id,
        job_id: campaign.job_id,
        candidate_id: candidate.id,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        answers: fields,
        consent_given: true,
        consent_at: lead.created_time || new Date().toISOString(),
        source: 'meta_lead_form',
        status: 'processed',
        meta_lead_id: leadId,
        meta_form_id: String(lead.form_id || formId || ''),
        meta_ad_id: String(lead.ad_id || adId || ''),
        meta_adset_id: String(lead.adset_id || ''),
        meta_campaign_id: String(lead.campaign_id || ''),
        creative_name: lead.ad_name || null,
      }).select('id').single();
      if (submission.error && submission.error.code !== '23505') throw submission.error;

      await admin.from('applications').upsert({
        organization_id: campaign.organization_id,
        candidate_id: candidate.id,
        job_id: campaign.job_id,
        stage: 'new',
      }, { onConflict: 'candidate_id,job_id' });

      await admin.from('tasks').insert({
        organization_id: campaign.organization_id,
        candidate_id: candidate.id,
        job_id: campaign.job_id,
        title: `Meta-Bewerbung kontaktieren: ${firstName} ${lastName}`,
        priority: 'high',
        status: 'open',
        due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      if (eventId) await admin.from('meta_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', eventId);
    } catch (error) {
      if (eventId) await admin.from('meta_webhook_events').update({ status: 'failed', error_message: error instanceof Error ? error.message : String(error), processed_at: new Date().toISOString() }).eq('id', eventId);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
});

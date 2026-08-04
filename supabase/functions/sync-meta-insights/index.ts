import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userDb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: userError } = await userDb.auth.getUser();
    if (userError || !user) throw new Error('Nicht angemeldet.');

    const body = await req.json().catch(() => ({}));
    const campaignId = body.campaign_id;
    if (!campaignId) throw new Error('campaign_id fehlt.');

    const { data: campaign, error: campaignError } = await userDb
      .from('recruiting_campaigns')
      .select('id,organization_id,meta_campaign_id')
      .eq('id', campaignId)
      .single();
    if (campaignError || !campaign) throw new Error('Kampagne nicht gefunden.');
    if (!campaign.meta_campaign_id) throw new Error('Kampagne wurde noch nicht bei Meta angelegt.');

    const { data: connection, error: connectionError } = await admin
      .from('meta_connections')
      .select('access_token,status')
      .eq('organization_id', campaign.organization_id)
      .single();
    if (connectionError || !connection || connection.status !== 'connected') throw new Error('Keine aktive Meta-Verbindung.');

    const version = Deno.env.get('META_GRAPH_VERSION') || 'v23.0';
    const fields = 'date_start,date_stop,impressions,reach,clicks,spend,actions';
    const url = new URL(`https://graph.facebook.com/${version}/${campaign.meta_campaign_id}/insights`);
    url.searchParams.set('fields', fields);
    url.searchParams.set('time_increment', '1');
    url.searchParams.set('date_preset', body.date_preset || 'last_30d');
    url.searchParams.set('access_token', connection.access_token);

    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error?.message || 'Meta Insights konnten nicht geladen werden.');

    const rows = (payload.data || []).map((item: any) => {
      const actions = Object.fromEntries((item.actions || []).map((a: any) => [a.action_type, Number(a.value || 0)]));
      const leads = actions.lead || actions.onsite_conversion_lead_grouped || 0;
      return {
        organization_id: campaign.organization_id,
        campaign_id: campaign.id,
        insight_date: item.date_start,
        source: 'meta',
        impressions: Number(item.impressions || 0),
        reach: Number(item.reach || 0),
        clicks: Number(item.clicks || 0),
        spend: Number(item.spend || 0),
        leads,
        raw_data: item,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    if (rows.length) {
      const { error } = await admin.from('campaign_insights').upsert(rows, { onConflict: 'campaign_id,insight_date,source' });
      if (error) throw error;
    }

    await admin.from('meta_connections').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('organization_id', campaign.organization_id);
    return new Response(JSON.stringify({ ok: true, synced: rows.length }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});

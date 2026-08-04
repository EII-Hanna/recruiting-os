import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

async function graphPost(version: string, path: string, token: string, fields: Record<string, string>) {
  const body = new URLSearchParams({ ...fields, access_token: token });
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json();
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || `Meta API request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const graphVersion = Deno.env.get('META_GRAPH_VERSION') || 'v24.0';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server configuration incomplete' }, 500);

  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const campaignId = body?.campaign_id;
  const destinationUrl = String(body?.destination_url || '').trim();
  const imageUrl = String(body?.image_url || '').trim();
  if (!campaignId || !destinationUrl || !imageUrl) {
    return json({ error: 'campaign_id, destination_url and image_url are required' }, 400);
  }

  try {
    new URL(destinationUrl);
    new URL(imageUrl);
  } catch {
    return json({ error: 'Destination and image URLs must be valid HTTPS URLs' }, 400);
  }
  if (!destinationUrl.startsWith('https://') || !imageUrl.startsWith('https://')) {
    return json({ error: 'Only HTTPS URLs are allowed' }, 400);
  }

  const { data: memberships } = await admin
    .from('organization_members')
    .select('organization_id,role')
    .eq('user_id', userData.user.id)
    .eq('status', 'active');
  const orgIds = (memberships || []).map((m) => m.organization_id);
  if (!orgIds.length) return json({ error: 'No active organization membership' }, 403);

  const { data: campaign, error: campaignError } = await admin
    .from('recruiting_campaigns')
    .select('*,job:jobs(title,location,company:companies(name))')
    .eq('id', campaignId)
    .in('organization_id', orgIds)
    .single();
  if (campaignError || !campaign) return json({ error: 'Campaign not found' }, 404);
  if (campaign.status !== 'approved') return json({ error: 'Campaign must be approved before Meta creation' }, 409);
  if (!campaign.generated_package) return json({ error: 'Generate the AI campaign package first' }, 409);
  if (campaign.meta_launch_status === 'created' && campaign.meta_ad_id) {
    return json({ ok: true, already_created: true, meta_ad_id: campaign.meta_ad_id });
  }

  const { data: connection, error: connectionError } = await admin
    .from('meta_connections')
    .select('*')
    .eq('organization_id', campaign.organization_id)
    .eq('status', 'connected')
    .single();
  if (connectionError || !connection) return json({ error: 'Meta connection missing' }, 409);
  if (!connection.selected_ad_account_id || !connection.selected_page_id) {
    return json({ error: 'Select a Meta ad account and Facebook page first' }, 409);
  }

  const accountId = String(connection.selected_ad_account_id).replace(/^act_/, '');
  const actPath = `act_${accountId}`;
  const packageData = campaign.generated_package as Record<string, unknown>;
  const primaryTexts = Array.isArray(packageData.primary_texts) ? packageData.primary_texts : [];
  const headlines = Array.isArray(packageData.headlines) ? packageData.headlines : [];
  const descriptions = Array.isArray(packageData.descriptions) ? packageData.descriptions : [];
  const message = String(primaryTexts[0] || `Jetzt als ${campaign.job?.title || 'Fachkraft'} bewerben.`);
  const headline = String(headlines[0] || campaign.job?.title || campaign.name);
  const description = String(descriptions[0] || 'Schnell und unkompliziert bewerben.');
  const dailyBudgetCents = Math.max(100, Math.round(Number(campaign.daily_budget || 1) * 100));
  const startTime = new Date(Date.now() + 15 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + Number(campaign.duration_days || 30) * 86400000);

  const launchPayload = {
    destination_url: destinationUrl,
    image_url: imageUrl,
    daily_budget_cents: dailyBudgetCents,
    objective: 'OUTCOME_TRAFFIC',
    special_ad_categories: ['EMPLOYMENT'],
    status: 'PAUSED',
  };

  const { data: launch, error: launchError } = await admin.from('meta_campaign_launches').insert({
    organization_id: campaign.organization_id,
    campaign_id: campaign.id,
    requested_by: userData.user.id,
    status: 'processing',
    meta_ad_account_id: accountId,
    meta_page_id: connection.selected_page_id,
    meta_instagram_account_id: connection.selected_instagram_account_id,
    request_payload: launchPayload,
  }).select('*').single();
  if (launchError || !launch) return json({ error: launchError?.message || 'Could not create launch record' }, 500);

  await admin.from('recruiting_campaigns').update({
    destination_url: destinationUrl,
    creative_image_url: imageUrl,
    meta_launch_status: 'processing',
    meta_launch_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', campaign.id);

  const responsePayload: Record<string, unknown> = {};
  try {
    const metaCampaign = await graphPost(graphVersion, `${actPath}/campaigns`, connection.access_token, {
      name: `${campaign.name} | RecruitingOS`,
      objective: 'OUTCOME_TRAFFIC',
      buying_type: 'AUCTION',
      special_ad_categories: JSON.stringify(['EMPLOYMENT']),
      special_ad_category_country: JSON.stringify(['DE']),
      status: 'PAUSED',
    });
    responsePayload.campaign = metaCampaign;

    const targeting = {
      geo_locations: { countries: ['DE'] },
      age_min: 18,
      age_max: 65,
    };
    const metaAdSet = await graphPost(graphVersion, `${actPath}/adsets`, connection.access_token, {
      name: `${campaign.name} | Broad DE`,
      campaign_id: metaCampaign.id,
      daily_budget: String(dailyBudgetCents),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: JSON.stringify(targeting),
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      status: 'PAUSED',
    });
    responsePayload.adset = metaAdSet;

    const objectStorySpec: Record<string, unknown> = {
      page_id: connection.selected_page_id,
      link_data: {
        link: destinationUrl,
        picture: imageUrl,
        message,
        name: headline,
        description,
        call_to_action: { type: 'APPLY_NOW', value: { link: destinationUrl } },
      },
    };
    if (connection.selected_instagram_account_id) {
      objectStorySpec.instagram_actor_id = connection.selected_instagram_account_id;
    }

    const metaCreative = await graphPost(graphVersion, `${actPath}/adcreatives`, connection.access_token, {
      name: `${campaign.name} | Creative 1`,
      object_story_spec: JSON.stringify(objectStorySpec),
    });
    responsePayload.creative = metaCreative;

    const metaAd = await graphPost(graphVersion, `${actPath}/ads`, connection.access_token, {
      name: `${campaign.name} | Ad 1`,
      adset_id: metaAdSet.id,
      creative: JSON.stringify({ creative_id: metaCreative.id }),
      status: 'PAUSED',
    });
    responsePayload.ad = metaAd;

    const now = new Date().toISOString();
    await admin.from('meta_campaign_launches').update({
      status: 'created',
      meta_campaign_id: metaCampaign.id,
      meta_adset_id: metaAdSet.id,
      meta_creative_id: metaCreative.id,
      meta_ad_id: metaAd.id,
      response_payload: responsePayload,
      completed_at: now,
    }).eq('id', launch.id);

    await admin.from('recruiting_campaigns').update({
      status: 'paused',
      meta_launch_status: 'created',
      meta_campaign_id: metaCampaign.id,
      meta_adset_id: metaAdSet.id,
      meta_creative_id: metaCreative.id,
      meta_ad_id: metaAd.id,
      meta_launched_at: now,
      meta_launch_error: null,
      updated_at: now,
    }).eq('id', campaign.id);

    return json({
      ok: true,
      status: 'PAUSED',
      campaign_id: metaCampaign.id,
      adset_id: metaAdSet.id,
      creative_id: metaCreative.id,
      ad_id: metaAd.id,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    await admin.from('meta_campaign_launches').update({
      status: 'failed',
      response_payload: responsePayload,
      error_message: messageText,
      completed_at: now,
      meta_campaign_id: (responsePayload.campaign as { id?: string } | undefined)?.id || null,
      meta_adset_id: (responsePayload.adset as { id?: string } | undefined)?.id || null,
      meta_creative_id: (responsePayload.creative as { id?: string } | undefined)?.id || null,
      meta_ad_id: (responsePayload.ad as { id?: string } | undefined)?.id || null,
    }).eq('id', launch.id);
    await admin.from('recruiting_campaigns').update({
      meta_launch_status: 'failed',
      meta_launch_error: messageText,
      updated_at: now,
    }).eq('id', campaign.id);
    return json({ error: messageText, partial: responsePayload }, 502);
  }
});

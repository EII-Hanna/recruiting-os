import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appId = Deno.env.get('META_APP_ID');
    const redirectUri = Deno.env.get('META_REDIRECT_URI');
    const graphVersion = Deno.env.get('META_GRAPH_VERSION') || 'v23.0';
    if (!appId || !redirectUri) throw new Error('META_APP_ID oder META_REDIRECT_URI fehlt.');

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'Nicht angemeldet.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });

    const { organization_id } = await req.json();
    const { data: memberships, error: membershipError } = await userClient.rpc('my_organizations');
    if (membershipError || !memberships?.some((item: any) => item.organization_id === organization_id)) {
      return new Response(JSON.stringify({ error: 'Kein Zugriff auf diese Organisation.' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const state = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await admin.from('meta_oauth_states').insert({ organization_id, user_id: user.id, state, expires_at: expiresAt });
    if (error) throw error;

    const scopes = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes.join(','),
    });
    const url = `https://www.facebook.com/${graphVersion}/dialog/oauth?${params.toString()}`;
    return new Response(JSON.stringify({ url }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});

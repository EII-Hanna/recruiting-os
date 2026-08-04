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
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'Nicht angemeldet.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { organization_id, business_id, ad_account_id, page_id, instagram_account_id } = body;
    const { data: memberships } = await userClient.rpc('my_organizations');
    if (!memberships?.some((item: any) => item.organization_id === organization_id)) {
      return new Response(JSON.stringify({ error: 'Kein Zugriff auf diese Organisation.' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: connection, error: connectionError } = await admin.from('meta_connections').select('*').eq('organization_id', organization_id).single();
    if (connectionError || !connection) throw new Error('Keine Meta-Verbindung vorhanden.');

    const businessValid = !business_id || (connection.businesses || []).some((item: any) => item.id === business_id);
    const accountValid = !ad_account_id || (connection.ad_accounts || []).some((item: any) => item.id === ad_account_id || item.account_id === ad_account_id);
    const page = (connection.pages || []).find((item: any) => item.id === page_id);
    const pageValid = !page_id || Boolean(page);
    const instagramValid = !instagram_account_id || page?.instagram_business_account?.id === instagram_account_id;
    if (!businessValid || !accountValid || !pageValid || !instagramValid) throw new Error('Ausgewählte Meta-Ressource gehört nicht zu dieser Verbindung.');

    const { error } = await admin.from('meta_connections').update({
      selected_business_id: business_id || null,
      selected_ad_account_id: ad_account_id || null,
      selected_page_id: page_id || null,
      selected_instagram_account_id: instagram_account_id || null,
      updated_at: new Date().toISOString(),
    }).eq('organization_id', organization_id);
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});

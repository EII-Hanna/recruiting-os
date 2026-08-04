import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const html = (title: string, message: string, success = false) => new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;background:#0a0d11;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:560px;padding:30px;border:1px solid #293442;border-radius:18px;background:#12171d}p{color:#91a0b3}.ok{color:#4cda98}.error{color:#ff7777}</style><div class="card"><h1 class="${success ? 'ok' : 'error'}">${title}</h1><p>${message}</p><p>Dieses Fenster kann geschlossen werden.</p><script>setTimeout(()=>window.close(),2500)</script></div></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function graph(path: string, token: string, version: string) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`https://graph.facebook.com/${version}/${path}${separator}access_token=${encodeURIComponent(token)}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `Meta API Fehler (${response.status})`);
  return data;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error_description');
    if (oauthError) return html('Verbindung abgebrochen', oauthError);
    if (!code || !state) return html('Verbindung fehlgeschlagen', 'OAuth-Code oder Sicherheitsstatus fehlt.');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appId = Deno.env.get('META_APP_ID');
    const appSecret = Deno.env.get('META_APP_SECRET');
    const redirectUri = Deno.env.get('META_REDIRECT_URI');
    const graphVersion = Deno.env.get('META_GRAPH_VERSION') || 'v23.0';
    if (!appId || !appSecret || !redirectUri) throw new Error('Meta-Konfiguration unvollständig.');

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: stateRow, error: stateError } = await admin.from('meta_oauth_states').select('*').eq('state', state).single();
    if (stateError || !stateRow) return html('Verbindung fehlgeschlagen', 'Ungültiger Sicherheitsstatus.');
    if (stateRow.used_at || new Date(stateRow.expires_at) < new Date()) return html('Verbindung fehlgeschlagen', 'Der Sicherheitsstatus ist abgelaufen.');
    await admin.from('meta_oauth_states').update({ used_at: new Date().toISOString() }).eq('id', stateRow.id);

    const tokenParams = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
    const tokenResponse = await fetch(`https://graph.facebook.com/${graphVersion}/oauth/access_token?${tokenParams.toString()}`);
    const shortToken = await tokenResponse.json();
    if (!tokenResponse.ok || shortToken.error) throw new Error(shortToken.error?.message || 'Token-Austausch fehlgeschlagen.');

    const longParams = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken.access_token });
    const longResponse = await fetch(`https://graph.facebook.com/${graphVersion}/oauth/access_token?${longParams.toString()}`);
    const longToken = await longResponse.json();
    const accessToken = longToken.access_token || shortToken.access_token;
    const expiresIn = Number(longToken.expires_in || shortToken.expires_in || 0);

    const [me, businesses, adAccounts, pages, permissions] = await Promise.all([
      graph('me?fields=id,name', accessToken, graphVersion),
      graph('me/businesses?fields=id,name&limit=100', accessToken, graphVersion).catch(() => ({ data: [] })),
      graph('me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name&limit=100', accessToken, graphVersion).catch(() => ({ data: [] })),
      graph('me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100', accessToken, graphVersion).catch(() => ({ data: [] })),
      graph('me/permissions', accessToken, graphVersion).catch(() => ({ data: [] })),
    ]);

    const safePages = (pages.data || []).map((page: any) => ({ id: page.id, name: page.name, instagram_business_account: page.instagram_business_account || null }));
    const scopes = (permissions.data || []).filter((item: any) => item.status === 'granted').map((item: any) => item.permission);
    const payload = {
      organization_id: stateRow.organization_id,
      connected_by: stateRow.user_id,
      meta_user_id: me.id,
      meta_user_name: me.name,
      access_token: accessToken,
      token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      granted_scopes: scopes,
      businesses: businesses.data || [],
      ad_accounts: adAccounts.data || [],
      pages: safePages,
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const { error: saveError } = await admin.from('meta_connections').upsert(payload, { onConflict: 'organization_id' });
    if (saveError) throw saveError;

    return html('Meta erfolgreich verbunden', `${me.name} wurde mit RecruitingOS verbunden.`, true);
  } catch (error) {
    return html('Verbindung fehlgeschlagen', error instanceof Error ? error.message : String(error));
  }
});

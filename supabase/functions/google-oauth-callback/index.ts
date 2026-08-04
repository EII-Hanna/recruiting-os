import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const encoder = new TextEncoder()

async function encryptionKey() {
  const raw = Deno.env.get('INTEGRATION_ENCRYPTION_KEY')
  if (!raw || raw.length < 32) throw new Error('INTEGRATION_ENCRYPTION_KEY fehlt oder ist zu kurz.')
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt'])
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await encryptionKey()
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value)))
  const bytes = new Uint8Array(iv.length + encrypted.length)
  bytes.set(iv, 0); bytes.set(encrypted, iv.length)
  return btoa(String.fromCharCode(...bytes))
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateToken = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let returnUrl = 'https://eii-hanna.github.io/recruiting-os/'

  try {
    if (oauthError) throw new Error(`Google OAuth: ${oauthError}`)
    if (!code || !stateToken) throw new Error('OAuth-Code oder State fehlt.')

    const { data: oauthState, error: stateError } = await admin
      .from('oauth_states')
      .select('*')
      .eq('state_token', stateToken)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .single()
    if (stateError || !oauthState) throw new Error('OAuth-Anfrage ist ungültig oder abgelaufen.')
    returnUrl = oauthState.redirect_uri

    const callback = `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-oauth-callback`
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        redirect_uri: callback,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenResponse.json()
    if (!tokenResponse.ok) throw new Error(tokens.error_description || tokens.error || 'Token-Austausch fehlgeschlagen.')

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileResponse.json()
    if (!profileResponse.ok) throw new Error('Google-Profil konnte nicht geladen werden.')

    const payload: Record<string, unknown> = {
      organization_id: oauthState.organization_id,
      provider: 'google',
      account_email: profile.email,
      status: 'connected',
      scopes: String(tokens.scope || '').split(' ').filter(Boolean),
      access_token_encrypted: await encrypt(tokens.access_token),
      token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      metadata: { google_sub: profile.sub, name: profile.name, picture: profile.picture },
      sync_status: 'idle',
      error_message: null,
      updated_at: new Date().toISOString(),
    }
    if (tokens.refresh_token) payload.refresh_token_encrypted = await encrypt(tokens.refresh_token)

    const { error: upsertError } = await admin.from('integrations').upsert(payload, {
      onConflict: 'organization_id,provider',
    })
    if (upsertError) throw upsertError

    await admin.from('oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', oauthState.id)

    return Response.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}google=connected`, 302)
  } catch (error) {
    const message = encodeURIComponent(String(error.message || error))
    return Response.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}google_error=${message}`, 302)
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const auth = req.headers.get('Authorization')
    if (!auth) throw new Error('Nicht angemeldet.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('Ungültige Sitzung.')

    const { organization_id, return_url } = await req.json()
    if (!organization_id || !return_url) throw new Error('Organisation oder Rücksprung-URL fehlt.')

    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('Kein Zugriff auf diese Organisation.')

    const state = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
    const callback = `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-oauth-callback`

    const { error: stateError } = await supabase.from('oauth_states').insert({
      organization_id,
      user_id: user.id,
      provider: 'google',
      state_token: state,
      redirect_uri: return_url,
    })
    if (stateError) throw stateError

    const scopes = [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive.file',
    ]

    const params = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      redirect_uri: callback,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      scope: scopes.join(' '),
    })

    return Response.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, { headers: cors })
  } catch (error) {
    return Response.json({ error: String(error.message || error) }, { status: 400, headers: cors })
  }
})

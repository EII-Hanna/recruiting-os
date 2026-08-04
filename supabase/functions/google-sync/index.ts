import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function key() {
  const raw = Deno.env.get('INTEGRATION_ENCRYPTION_KEY')
  if (!raw || raw.length < 32) throw new Error('INTEGRATION_ENCRYPTION_KEY fehlt.')
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt','decrypt'])
}
async function decrypt(value: string) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  const iv = bytes.slice(0,12), encrypted = bytes.slice(12)
  return decoder.decode(await crypto.subtle.decrypt({ name:'AES-GCM', iv }, await key(), encrypted))
}
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, await key(), encoder.encode(value)))
  const bytes = new Uint8Array(iv.length + encrypted.length); bytes.set(iv); bytes.set(encrypted, iv.length)
  return btoa(String.fromCharCode(...bytes))
}

function header(headers: Array<{name:string,value:string}> = [], name: string) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}
function decodeBody(data?: string) {
  if (!data) return ''
  const normalized = data.replace(/-/g,'+').replace(/_/g,'/')
  try { return decodeURIComponent(escape(atob(normalized))) } catch { return '' }
}
function bodyText(payload: any): string {
  if (payload?.mimeType === 'text/plain') return decodeBody(payload.body?.data)
  for (const part of payload?.parts || []) { const found = bodyText(part); if (found) return found }
  return decodeBody(payload?.body?.data)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let logId: string | null = null
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) throw new Error('Nicht angemeldet.')
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global:{ headers:{ Authorization:auth } } })
    const { data:{ user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Ungültige Sitzung.')

    const { organization_id, sync = 'all' } = await req.json()
    const { data: membership } = await userClient.from('organization_members').select('organization_id').eq('organization_id',organization_id).eq('user_id',user.id).maybeSingle()
    if (!membership) throw new Error('Kein Organisationszugriff.')

    const { data: integration, error } = await admin.from('integrations').select('*').eq('organization_id',organization_id).eq('provider','google').eq('status','connected').single()
    if (error || !integration) throw new Error('Google Workspace ist nicht verbunden.')

    const { data: log } = await admin.from('integration_sync_logs').insert({ organization_id, integration_id:integration.id, sync_type:sync === 'calendar' ? 'calendar' : 'gmail', status:'started' }).select('id').single()
    logId = log?.id || null
    await admin.from('integrations').update({ sync_status:'running', error_message:null }).eq('id',integration.id)

    let accessToken = await decrypt(integration.access_token_encrypted)
    if (!integration.token_expires_at || new Date(integration.token_expires_at).getTime() < Date.now()+60000) {
      if (!integration.refresh_token_encrypted) throw new Error('Google Refresh Token fehlt. Verbindung erneut herstellen.')
      const refreshToken = await decrypt(integration.refresh_token_encrypted)
      const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:Deno.env.get('GOOGLE_CLIENT_ID')!,client_secret:Deno.env.get('GOOGLE_CLIENT_SECRET')!,refresh_token:refreshToken,grant_type:'refresh_token'})})
      const refreshed = await response.json(); if (!response.ok) throw new Error(refreshed.error_description || 'Token-Aktualisierung fehlgeschlagen.')
      accessToken = refreshed.access_token
      await admin.from('integrations').update({ access_token_encrypted:await encrypt(accessToken), token_expires_at:new Date(Date.now()+Number(refreshed.expires_in||3600)*1000).toISOString() }).eq('id',integration.id)
    }

    let processed = 0
    if (sync === 'all' || sync === 'gmail') {
      const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=newer_than:30d',{headers:{Authorization:`Bearer ${accessToken}`}})
      const list = await listRes.json(); if (!listRes.ok) throw new Error(list.error?.message || 'Gmail-Synchronisierung fehlgeschlagen.')
      for (const item of list.messages || []) {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`,{headers:{Authorization:`Bearer ${accessToken}`}})
        const msg = await msgRes.json(); if (!msgRes.ok) continue
        const headers = msg.payload?.headers || []
        const from = header(headers,'From'), to = header(headers,'To'), subject = header(headers,'Subject')
        const senderEmail = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase()
        const recipients = to.split(',').map((x:string)=>(x.match(/<([^>]+)>/)?.[1]||x).trim().toLowerCase()).filter(Boolean)
        const internal = integration.account_email?.toLowerCase()
        const direction = senderEmail === internal ? 'outbound' : 'inbound'
        const { data:candidate } = await admin.from('candidates').select('id').eq('organization_id',organization_id).ilike('email',senderEmail).maybeSingle()
        const { data:contact } = await admin.from('contacts').select('company_id').eq('organization_id',organization_id).ilike('email',senderEmail).maybeSingle()
        await admin.from('email_messages').upsert({organization_id,integration_id:integration.id,provider_message_id:msg.id,thread_id:msg.threadId,direction,sender_email:senderEmail,recipient_emails:recipients,subject,snippet:msg.snippet,body_text:bodyText(msg.payload).slice(0,20000),candidate_id:candidate?.id||null,company_id:contact?.company_id||null,received_at:new Date(Number(msg.internalDate)).toISOString()},{onConflict:'organization_id,provider_message_id'})
        processed++
      }
      await admin.from('integrations').update({ last_email_sync_at:new Date().toISOString() }).eq('id',integration.id)
    }

    if (sync === 'all' || sync === 'calendar') {
      const from = new Date(Date.now()-7*86400000).toISOString(), to = new Date(Date.now()+90*86400000).toISOString()
      const eventsRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}&maxResults=100`,{headers:{Authorization:`Bearer ${accessToken}`}})
      const events = await eventsRes.json(); if (!eventsRes.ok) throw new Error(events.error?.message || 'Kalender-Synchronisierung fehlgeschlagen.')
      for (const event of events.items || []) {
        const attendeeEmails=(event.attendees||[]).map((a:any)=>a.email).filter(Boolean)
        let candidateId=null, companyId=null
        for (const email of attendeeEmails) {
          const {data:c}=await admin.from('candidates').select('id').eq('organization_id',organization_id).ilike('email',email).maybeSingle(); if(c){candidateId=c.id;break}
          const {data:ct}=await admin.from('contacts').select('company_id').eq('organization_id',organization_id).ilike('email',email).maybeSingle(); if(ct){companyId=ct.company_id;break}
        }
        await admin.from('calendar_events').upsert({organization_id,integration_id:integration.id,provider_event_id:event.id,title:event.summary||'Ohne Titel',description:event.description||null,starts_at:event.start?.dateTime||event.start?.date,ends_at:event.end?.dateTime||event.end?.date,attendee_emails:attendeeEmails,candidate_id:candidateId,company_id:companyId,meeting_url:event.hangoutLink||event.conferenceData?.entryPoints?.find((x:any)=>x.entryPointType==='video')?.uri||null,updated_at:new Date().toISOString()},{onConflict:'organization_id,provider_event_id'})
        processed++
      }
      await admin.from('integrations').update({ last_calendar_sync_at:new Date().toISOString() }).eq('id',integration.id)
    }

    await admin.from('integrations').update({ sync_status:'idle' }).eq('id',integration.id)
    if(logId) await admin.from('integration_sync_logs').update({status:'success',records_processed:processed,finished_at:new Date().toISOString()}).eq('id',logId)
    return Response.json({ok:true,processed},{headers:cors})
  } catch(error) {
    if(logId) await admin.from('integration_sync_logs').update({status:'error',message:String(error.message||error),finished_at:new Date().toISOString()}).eq('id',logId)
    return Response.json({error:String(error.message||error)},{status:400,headers:cors})
  }
})

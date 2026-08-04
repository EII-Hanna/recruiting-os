import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' };
const clean = (v:unknown) => String(v ?? '').trim();

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:cors});
  try {
    if (req.method !== 'POST') throw new Error('Methode nicht erlaubt.');
    const body = await req.json();
    const slug = clean(body.slug), firstName = clean(body.first_name), lastName = clean(body.last_name), email = clean(body.email).toLowerCase();
    const phone = clean(body.phone) || null;
    if (!slug || !firstName || !lastName || !email || !body.consent_given) throw new Error('Bitte alle Pflichtfelder und die Einwilligung bestätigen.');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data:funnel, error:funnelError } = await admin.from('application_funnels').select('*').eq('slug',slug).eq('status','published').single();
    if (funnelError || !funnel) throw new Error('Dieser Bewerbungsfunnel ist nicht verfügbar.');

    let candidateId:string|null = null;
    const existing = await admin.from('candidates').select('id').eq('organization_id',funnel.organization_id).ilike('email',email).maybeSingle();
    if (existing.data?.id) candidateId = existing.data.id;
    else {
      const created = await admin.from('candidates').insert({organization_id:funnel.organization_id,first_name:firstName,last_name:lastName,email,phone,status:'new',notes:`Bewerbung über Funnel: ${funnel.name}`}).select('id').single();
      if (created.error) throw created.error;
      candidateId = created.data.id;
    }

    const submission = await admin.from('funnel_submissions').insert({organization_id:funnel.organization_id,funnel_id:funnel.id,campaign_id:funnel.campaign_id,job_id:funnel.job_id,candidate_id:candidateId,first_name:firstName,last_name:lastName,email,phone,answers:body.answers||{},consent_given:true,consent_at:new Date().toISOString(),status:existing.data?.id?'duplicate':'new'}).select('id').single();
    if (submission.error) throw submission.error;

    const app = await admin.from('applications').select('id').eq('organization_id',funnel.organization_id).eq('candidate_id',candidateId).eq('job_id',funnel.job_id).maybeSingle();
    if (!app.data?.id) await admin.from('applications').insert({organization_id:funnel.organization_id,candidate_id:candidateId,job_id:funnel.job_id,stage:'new',probability:10,match_score:0});
    await admin.from('tasks').insert({organization_id:funnel.organization_id,candidate_id:candidateId,job_id:funnel.job_id,title:`Neue Funnel-Bewerbung: ${firstName} ${lastName}`,status:'open',priority:'high',due_at:new Date().toISOString()});
    await admin.from('activities').insert({organization_id:funnel.organization_id,candidate_id:candidateId,job_id:funnel.job_id,activity_type:'funnel_application',subject:'Neue Bewerbung',body:`${firstName} ${lastName} hat sich über ${funnel.name} beworben.`});

    return Response.json({ok:true,submission_id:submission.data.id,thank_you_text:funnel.thank_you_text},{headers:cors});
  } catch (e) {
    return Response.json({error:e.message},{status:400,headers:cors});
  }
});

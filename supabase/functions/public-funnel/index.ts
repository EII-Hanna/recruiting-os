import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' };
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:cors});
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    if (!slug) throw new Error('Funnel fehlt.');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.from('application_funnels')
      .select('id,slug,name,headline,intro_text,thank_you_text,questions,privacy_text,campaign_id,job_id,status,job:jobs(title,location,company:companies(name))')
      .eq('slug', slug).eq('status','published').single();
    if (error || !data) return Response.json({error:'Dieser Bewerbungsfunnel ist nicht verfügbar.'},{status:404,headers:cors});
    return Response.json({funnel:data},{headers:cors});
  } catch (e) {
    return Response.json({error:e.message},{status:400,headers:cors});
  }
});

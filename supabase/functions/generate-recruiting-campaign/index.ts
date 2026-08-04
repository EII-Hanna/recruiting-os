import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) throw new Error('OPENAI_API_KEY fehlt.');

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error('Nicht authentifiziert.');

    const { campaign_id } = await req.json();
    if (!campaign_id) throw new Error('campaign_id fehlt.');

    const { data: campaign, error: campaignError } = await userClient
      .from('recruiting_campaigns')
      .select('*,job:jobs(*,company:companies(name,industry,website,city,country))')
      .eq('id', campaign_id)
      .single();
    if (campaignError || !campaign) throw new Error(campaignError?.message || 'Kampagne nicht gefunden.');

    await admin.from('recruiting_campaigns').update({ generation_status: 'processing', generation_error: null }).eq('id', campaign_id);

    const schema = {
      type: 'object', additionalProperties: false,
      properties: {
        campaign_angle: { type: 'string' },
        strategy_summary: { type: 'string' },
        hooks: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 5 },
        primary_texts: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
        headlines: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 5 },
        descriptions: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
        ctas: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
        creative_briefs: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { angle: { type: 'string' }, format: { type: 'string' }, visual: { type: 'string' }, overlay: { type: 'string' } }, required: ['angle','format','visual','overlay'] } },
        compliance_notes: { type: 'array', items: { type: 'string' } }
      },
      required: ['campaign_angle','strategy_summary','hooks','primary_texts','headlines','descriptions','ctas','creative_briefs','compliance_notes']
    };

    const prompt = `Du bist ein Senior Performance Recruiting Stratege. Erstelle ein deutsches Meta-Recruiting-Kampagnenpaket. Die Anzeige gehört zwingend zur Special Ad Category EMPLOYMENT. Keine diskriminierenden Formulierungen oder Targeting-Vorschläge. Keine erfundenen Benefits oder Gehaltsangaben.\n\nVakanz: ${JSON.stringify(campaign.job)}\nKampagnenbriefing: ${JSON.stringify({daily_budget:campaign.daily_budget,duration_days:campaign.duration_days,radius_km:campaign.radius_km,target_cpl:campaign.target_cpl,hires_needed:campaign.hires_needed,benefits:campaign.benefits,audience_notes:campaign.audience_notes})}`;

    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_ADS_MODEL') || 'gpt-5-mini',
        store: false,
        input: [{ role: 'system', content: [{ type: 'input_text', text: 'Antworte ausschließlich im vorgegebenen JSON-Schema.' }] }, { role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        text: { format: { type: 'json_schema', name: 'recruiting_campaign_package', strict: true, schema } }
      })
    });
    if (!aiResponse.ok) throw new Error(`OpenAI: ${await aiResponse.text()}`);
    const ai = await aiResponse.json();
    const outputText = ai.output_text || ai.output?.flatMap((o:any)=>o.content||[]).find((c:any)=>c.type==='output_text')?.text;
    if (!outputText) throw new Error('Keine KI-Ausgabe erhalten.');
    const pkg = JSON.parse(outputText);

    const variants:any[] = [];
    const add = (type:string, values:string[], angle?:string) => values.forEach((content, index) => variants.push({ organization_id: campaign.organization_id, campaign_id, variant_type:type, angle: angle || pkg.campaign_angle, content, sort_order:index }));
    add('hook', pkg.hooks); add('primary_text', pkg.primary_texts); add('headline', pkg.headlines); add('description', pkg.descriptions); add('cta', pkg.ctas);
    pkg.creative_briefs.forEach((item:any,index:number)=>variants.push({ organization_id:campaign.organization_id,campaign_id,variant_type:'creative_brief',angle:item.angle,content:JSON.stringify(item),sort_order:index }));

    await admin.from('campaign_variants').delete().eq('campaign_id', campaign_id);
    const { error: insertError } = await admin.from('campaign_variants').insert(variants);
    if (insertError) throw new Error(insertError.message);
    const { error: updateError } = await admin.from('recruiting_campaigns').update({ status:'generated', generation_status:'completed', generated_package:pkg, campaign_angle:pkg.campaign_angle, updated_at:new Date().toISOString() }).eq('id', campaign_id);
    if (updateError) throw new Error(updateError.message);

    return new Response(JSON.stringify({ ok:true, package:pkg }), { headers:{...corsHeaders,'Content-Type':'application/json'} });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { const body = await req.clone().json(); if (body?.campaign_id) { const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); await admin.from('recruiting_campaigns').update({generation_status:'failed',generation_error:message}).eq('id',body.campaign_id); } } catch (_) {}
    return new Response(JSON.stringify({ error: message }), { status:400, headers:{...corsHeaders,'Content-Type':'application/json'} });
  }
});

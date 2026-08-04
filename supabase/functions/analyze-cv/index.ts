import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Nicht angemeldet.');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    if (!openaiKey) throw new Error('OPENAI_API_KEY fehlt.');

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error('Ungültige Sitzung.');

    const { document_id, candidate_id } = await req.json();
    if (!document_id || !candidate_id) throw new Error('document_id und candidate_id sind erforderlich.');

    const { data: doc, error: docError } = await userClient
      .from('documents')
      .select('*')
      .eq('id', document_id)
      .eq('candidate_id', candidate_id)
      .single();
    if (docError || !doc) throw new Error('Lebenslauf nicht gefunden oder nicht zugänglich.');

    const { data: analysis, error: analysisError } = await userClient
      .from('cv_analyses')
      .upsert({
        organization_id: doc.organization_id,
        candidate_id,
        document_id,
        status: 'processing',
        requested_by: user.id,
        error_message: null,
      }, { onConflict: 'candidate_id,document_id' })
      .select('*')
      .single();
    if (analysisError) throw analysisError;

    const { data: signed, error: signedError } = await userClient.storage
      .from('recruiting-documents')
      .createSignedUrl(doc.storage_path, 300);
    if (signedError || !signed?.signedUrl) throw new Error('Dokument konnte nicht gelesen werden.');

    const fileResponse = await fetch(signed.signedUrl);
    if (!fileResponse.ok) throw new Error('Dokumentdownload fehlgeschlagen.');
    const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
    let binary = '';
    for (let i = 0; i < fileBytes.length; i += 0x8000) {
      binary += String.fromCharCode(...fileBytes.subarray(i, i + 0x8000));
    }
    const base64 = btoa(binary);

    const schema = {
      type: 'object', additionalProperties: false,
      properties: {
        first_name: { type: ['string','null'] }, last_name: { type: ['string','null'] },
        email: { type: ['string','null'] }, phone: { type: ['string','null'] },
        current_title: { type: ['string','null'] }, location: { type: ['string','null'] },
        professional_summary: { type: ['string','null'] }, years_experience: { type: ['number','null'] },
        skills: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { language: { type: 'string' }, level: { type: ['string','null'] } }, required: ['language','level'] } },
        certifications: { type: 'array', items: { type: 'string' } },
        education: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { degree: { type: ['string','null'] }, institution: { type: ['string','null'] }, field: { type: ['string','null'] }, start: { type: ['string','null'] }, end: { type: ['string','null'] } }, required: ['degree','institution','field','start','end'] } },
        work_experience: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { company: { type: ['string','null'] }, title: { type: ['string','null'] }, start: { type: ['string','null'] }, end: { type: ['string','null'] }, description: { type: ['string','null'] } }, required: ['company','title','start','end','description'] } },
        notice_period: { type: ['string','null'] }, availability_date: { type: ['string','null'] },
        warnings: { type: 'array', items: { type: 'string' } }
      },
      required: ['first_name','last_name','email','phone','current_title','location','professional_summary','years_experience','skills','languages','certifications','education','work_experience','notice_period','availability_date','warnings']
    };

    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_CV_MODEL') || 'gpt-5-mini',
        store: false,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: 'Analysiere diesen Lebenslauf. Extrahiere nur eindeutig erkennbare Daten. Erfinde nichts. Unklare oder fehlende Werte müssen null sein. Formuliere die Zusammenfassung auf Deutsch.' },
          { type: 'input_file', filename: doc.file_name || 'lebenslauf.pdf', file_data: `data:${doc.mime_type || 'application/pdf'};base64,${base64}` }
        ] }],
        text: { format: { type: 'json_schema', name: 'cv_profile', strict: true, schema } }
      })
    });

    if (!apiResponse.ok) throw new Error(`OpenAI-Fehler: ${await apiResponse.text()}`);
    const result = await apiResponse.json();
    const outputText = result.output_text || result.output?.flatMap((item:any) => item.content || []).find((item:any) => item.type === 'output_text')?.text;
    if (!outputText) throw new Error('Die Analyse lieferte keine strukturierten Daten.');
    const extracted = JSON.parse(outputText);

    const { error: updateError } = await admin.from('cv_analyses').update({
      status: 'completed', extracted_data: extracted, warnings: extracted.warnings || [],
      model: Deno.env.get('OPENAI_CV_MODEL') || 'gpt-5-mini', updated_at: new Date().toISOString()
    }).eq('id', analysis.id);
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ analysis_id: analysis.id, extracted_data: extracted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
    });
  }
});

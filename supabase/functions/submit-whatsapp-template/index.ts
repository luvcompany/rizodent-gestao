import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
    const WABA_ID = Deno.env.get("WABA_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!WHATSAPP_TOKEN || !WABA_ID) {
      return new Response(
        JSON.stringify({ error: "API do WhatsApp não configurada. Adicione WHATSAPP_TOKEN e WABA_ID." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { template_name } = await req.json();
    if (!template_name) {
      return new Response(
        JSON.stringify({ error: "template_name é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: template, error: fetchErr } = await supabase
      .from("crm_whatsapp_templates")
      .select("*")
      .eq("name", template_name)
      .single();

    if (fetchErr || !template) {
      return new Response(
        JSON.stringify({ error: "Template não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Meta API payload
    const components: unknown[] = [];

    if (template.header_type && template.header_content) {
      if (template.header_type === "TEXT") {
        components.push({ type: "HEADER", format: "TEXT", text: template.header_content });
      } else {
        components.push({
          type: "HEADER",
          format: template.header_type,
          example: { header_handle: [template.header_content] },
        });
      }
    }

    if (template.body_text) {
      const variables = template.body_text.match(/\{\{\d+\}\}/g) || [];
      const bodyComponent: Record<string, unknown> = { type: "BODY", text: template.body_text };
      if (variables.length > 0) {
        bodyComponent.example = {
          body_text: [variables.map((_: string, i: number) => `exemplo${i + 1}`)],
        };
      }
      components.push(bodyComponent);
    }

    if (template.footer_text) {
      components.push({ type: "FOOTER", text: template.footer_text });
    }

    if (template.buttons && Array.isArray(template.buttons)) {
      const buttons = (template.buttons as { type: string; text: string; url?: string }[]).map((btn) => {
        if (btn.type === "URL") {
          return { type: "URL", text: btn.text, url: btn.url };
        }
        return { type: "QUICK_REPLY", text: btn.text };
      });
      components.push({ type: "BUTTONS", buttons });
    }

    const metaPayload = {
      name: template.name,
      language: template.language,
      category: template.category,
      components,
    };

    const metaRes = await fetch(
      `https://graph.facebook.com/v18.0/${WABA_ID}/message_templates`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metaPayload),
      }
    );

    const metaData = await metaRes.json();

    if (!metaRes.ok) {
      return new Response(
        JSON.stringify({ error: "Erro na API da Meta", details: metaData }),
        { status: metaRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update template with Meta ID
    await supabase
      .from("crm_whatsapp_templates")
      .update({
        meta_template_id: metaData.id,
        status: metaData.status || "PENDING",
        updated_at: new Date().toISOString(),
      })
      .eq("id", template.id);

    return new Response(
      JSON.stringify({ success: true, meta_template_id: metaData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Erro interno", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

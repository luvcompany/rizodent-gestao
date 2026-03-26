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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get WhatsApp config from integrations table
    const { data: integration } = await supabase
      .from("integrations")
      .select("config")
      .eq("key", "whatsapp_config")
      .maybeSingle();

    const config = integration?.config as Record<string, string> | null;
    const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
    const WABA_ID = config?.waba_id || Deno.env.get("WABA_ID");

    if (!WHATSAPP_TOKEN || !WABA_ID) {
      return new Response(
        JSON.stringify({ error: "WhatsApp não configurado. Configure WHATSAPP_TOKEN e WABA_ID." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, template_name } = await req.json();

    // ACTION: LIST - Fetch all templates from Meta API
    if (action === "list") {
      const url = `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?limit=100`;
      const metaRes = await fetch(url, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      });
      const metaData = await metaRes.json();

      if (!metaRes.ok) {
        return new Response(
          JSON.stringify({ error: "Erro ao buscar templates da Meta", details: metaData }),
          { status: metaRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const templates = (metaData.data || []).map((t: any) => {
        const headerComp = t.components?.find((c: any) => c.type === "HEADER");
        const bodyComp = t.components?.find((c: any) => c.type === "BODY");
        const footerComp = t.components?.find((c: any) => c.type === "FOOTER");
        const buttonsComp = t.components?.find((c: any) => c.type === "BUTTONS");

        return {
          meta_template_id: t.id,
          name: t.name,
          category: t.category,
          language: t.language,
          status: t.status,
          header_type: headerComp?.format || null,
          header_content: headerComp?.text || headerComp?.example?.header_handle?.[0] || null,
          body_text: bodyComp?.text || null,
          footer_text: footerComp?.text || null,
          buttons: buttonsComp?.buttons || null,
        };
      });

      // Sync to local database
      for (const tmpl of templates) {
        const { data: existing } = await supabase
          .from("crm_whatsapp_templates")
          .select("id")
          .eq("name", tmpl.name)
          .eq("language", tmpl.language)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("crm_whatsapp_templates")
            .update({
              meta_template_id: tmpl.meta_template_id,
              status: tmpl.status,
              category: tmpl.category,
              header_type: tmpl.header_type,
              header_content: tmpl.header_content,
              body_text: tmpl.body_text,
              footer_text: tmpl.footer_text,
              buttons: tmpl.buttons,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await supabase.from("crm_whatsapp_templates").insert({
            ...tmpl,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true, count: templates.length, templates }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: CREATE - Submit template to Meta API
    if (action === "create") {
      const { template_data } = await req.json().catch(() => ({})) || {};
      // template_data already parsed from original json, re-read from body
      const bodyJson = { action, ...JSON.parse("{}") };
      
      return new Response(
        JSON.stringify({ error: "Use create action properly" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: DELETE - Delete template from Meta API
    if (action === "delete") {
      if (!template_name) {
        return new Response(
          JSON.stringify({ error: "template_name é obrigatório para deletar" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const metaRes = await fetch(
        `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?name=${encodeURIComponent(template_name)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        }
      );
      const metaData = await metaRes.json();

      if (!metaRes.ok) {
        return new Response(
          JSON.stringify({ error: "Erro ao deletar template na Meta", details: metaData }),
          { status: metaRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Delete from local DB too
      await supabase.from("crm_whatsapp_templates").delete().eq("name", template_name);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Ação inválida. Use: list, delete" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Erro interno", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

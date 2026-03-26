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

    // Read tokens from Supabase secrets (env vars), NOT from integrations table
    const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
    const WABA_ID = Deno.env.get("WABA_ID");

    if (!WHATSAPP_TOKEN || !WABA_ID) {
      return new Response(
        JSON.stringify({ error: "WhatsApp não configurado. Configure os secrets WHATSAPP_TOKEN e WABA_ID." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action } = body;

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

    // ACTION: CREATE - Submit new template to Meta API
    if (action === "create") {
      const { name, language, category, header_type, header_content, body_text, footer_text, buttons } = body;

      if (!name || !body_text) {
        return new Response(
          JSON.stringify({ error: "Nome e corpo da mensagem são obrigatórios" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build Meta API components
      const components: any[] = [];

      if (header_type && header_content) {
        if (header_type === "TEXT") {
          components.push({ type: "HEADER", format: "TEXT", text: header_content });
        } else {
          components.push({
            type: "HEADER",
            format: header_type,
            example: { header_handle: [header_content] },
          });
        }
      }

      const variables = body_text.match(/\{\{\d+\}\}/g) || [];
      const bodyComponent: any = { type: "BODY", text: body_text };
      if (variables.length > 0) {
        bodyComponent.example = {
          body_text: [variables.map((_: string, i: number) => `exemplo${i + 1}`)],
        };
      }
      components.push(bodyComponent);

      if (footer_text) {
        components.push({ type: "FOOTER", text: footer_text });
      }

      if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        const metaButtons = buttons.map((btn: any) => {
          if (btn.type === "URL") {
            return { type: "URL", text: btn.text, url: btn.url };
          }
          return { type: "QUICK_REPLY", text: btn.text };
        });
        components.push({ type: "BUTTONS", buttons: metaButtons });
      }

      const metaPayload = { name, language, category, components };

      console.log("[CREATE] Sending to Meta:", JSON.stringify(metaPayload));

      const metaRes = await fetch(
        `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates`,
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
      console.log("[CREATE] Meta response:", JSON.stringify(metaData));

      if (!metaRes.ok) {
        return new Response(
          JSON.stringify({ error: "Erro na API da Meta", details: metaData }),
          { status: metaRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Save to local DB with Meta response
      const { error: dbError } = await supabase.from("crm_whatsapp_templates").insert({
        name,
        language,
        category,
        header_type: header_type || null,
        header_content: header_content || null,
        body_text,
        footer_text: footer_text || null,
        buttons: buttons && buttons.length > 0 ? buttons : null,
        meta_template_id: metaData.id,
        status: metaData.status || "PENDING",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (dbError) {
        console.error("[CREATE] DB save error:", dbError);
      }

      return new Response(
        JSON.stringify({ success: true, meta_template_id: metaData.id, status: metaData.status || "PENDING" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: DELETE - Delete template from Meta API
    if (action === "delete") {
      const { template_name } = body;
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
      JSON.stringify({ error: "Ação inválida. Use: list, create, delete" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Erro interno", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

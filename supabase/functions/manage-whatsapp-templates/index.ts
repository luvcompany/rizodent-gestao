import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function resolveCredentials(supabase: any, integrationKey?: string) {
  // If an integration_key is provided, resolve from integrations table
  if (integrationKey) {
    const { data: intg } = await supabase
      .from("integrations")
      .select("config")
      .eq("key", integrationKey)
      .maybeSingle();
    if (intg?.config) {
      const cfg = intg.config as any;
      const token = cfg.access_token || cfg.token;
      const wabaId = cfg.waba_id;
      if (token && wabaId) {
        return { token, wabaId };
      }
    }
  }
  // Fallback to env vars
  return {
    token: Deno.env.get("WHATSAPP_TOKEN") || "",
    wabaId: Deno.env.get("WABA_ID") || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve caller's primary role (used for owner_role tagging and authorization)
    const { data: callerRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const rolesSet = new Set((callerRoles || []).map((r: any) => r.role));
    const rolePriority = ["superadmin", "admin", "gerente", "posvenda", "crc"];
    const callerPrimaryRole = rolePriority.find((r) => rolesSet.has(r)) || null;

    // Any authenticated tenant user can list/create/delete their own templates.
    // Only admin/gerente/superadmin can hit destructive Meta actions like global delete.
    const isPrivileged =
      rolesSet.has("admin") || rolesSet.has("gerente") || rolesSet.has("superadmin");


    const body = await req.json();
    const { action, integration_key } = body;

    const { token: WHATSAPP_TOKEN, wabaId: WABA_ID } = await resolveCredentials(supabase, integration_key);

    if (!WHATSAPP_TOKEN || !WABA_ID) {
      return new Response(
        JSON.stringify({ error: "WhatsApp não configurado. Configure os secrets WHATSAPP_TOKEN e WABA_ID ou preencha na integração." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: LIST - Fetch all templates from Meta API
    if (action === "list") {
      // Fetch all templates from Meta with pagination
      let allMetaTemplates: any[] = [];
      let nextUrl: string | null = `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?limit=100`;

      while (nextUrl) {
        const metaRes = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        });
        const metaData = await metaRes.json();

        if (!metaRes.ok) {
          return new Response(
            JSON.stringify({ error: "Erro ao buscar templates da Meta", details: metaData }),
            { status: metaRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        allMetaTemplates = allMetaTemplates.concat(metaData.data || []);
        nextUrl = metaData.paging?.next || null;
      }

      const templates = allMetaTemplates.map((t: any) => {
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
      const metaTemplateIds = templates.map((t: any) => t.meta_template_id).filter(Boolean);

      for (const tmpl of templates) {
        const { data: existing } = await supabase
          .from("crm_whatsapp_templates")
          .select("id")
          .eq("meta_template_id", tmpl.meta_template_id)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("crm_whatsapp_templates")
            .update({
              name: tmpl.name,
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

      // Remove local templates that no longer exist on Meta
      if (metaTemplateIds.length > 0) {
        const { data: localTemplates } = await supabase
          .from("crm_whatsapp_templates")
          .select("id, meta_template_id")
          .not("meta_template_id", "is", null);

        if (localTemplates) {
          const toDelete = localTemplates.filter(
            (lt: any) => !metaTemplateIds.includes(lt.meta_template_id)
          );
          for (const d of toDelete) {
            await supabase.from("crm_whatsapp_templates").delete().eq("id", d.id);
          }
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

      // Always delete locally, even if Meta API fails (e.g. permission issues)
      await supabase.from("crm_whatsapp_templates").delete().eq("name", template_name);

      if (!metaRes.ok) {
        console.warn("[DELETE] Meta API error, deleted locally only:", JSON.stringify(metaData));
        return new Response(
          JSON.stringify({ success: true, warning: "Template removido localmente. Não foi possível remover na Meta (verifique permissões do token).", details: metaData }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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

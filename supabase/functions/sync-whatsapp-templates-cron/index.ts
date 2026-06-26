/**
 * sync-whatsapp-templates-cron
 *
 * Chamado pelo pg_cron a cada 5 minutos.
 * Itera todas as integrações WhatsApp conectadas e sincroniza os modelos
 * de mensagem com a Meta, atualizando o status (PENDING → APPROVED/REJECTED).
 *
 * Autenticação: aceita apikey (anon key) — a Supabase gateway valida.
 * Internamente usa service_role para acesso irrestrito.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Autenticação por x-cron-secret (valor em _internal_secrets.sync_templates_cron_token)
  const provided = req.headers.get("x-cron-secret") || "";
  const { data: secretRow } = await supabase
    .from("_internal_secrets")
    .select("value")
    .eq("name", "sync_templates_cron_token")
    .maybeSingle();
  const expected = (secretRow as any)?.value || "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  // Busca todas as integrações WhatsApp conectadas (todos os tenants)
  const { data: integrations, error: intgErr } = await supabase
    .from("integrations")
    .select("id, key, tenant_id, config")
    .eq("status", "connected")
    .like("key", "whatsapp_%");

  if (intgErr) {
    return new Response(JSON.stringify({ error: intgErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: { integration: string; synced: number; errors: string[] }[] = [];

  for (const intg of (integrations || [])) {
    const cfg = intg.config as any;
    const token: string = cfg?.access_token || cfg?.token || "";
    const wabaId: string = cfg?.waba_id || "";

    if (!token || !wabaId) {
      results.push({ integration: intg.key, synced: 0, errors: ["token ou waba_id ausente"] });
      continue;
    }

    const errors: string[] = [];
    let synced = 0;

    try {
      // Busca todos os templates da Meta (com paginação)
      let allMetaTemplates: any[] = [];
      let nextUrl: string | null =
        `https://graph.facebook.com/v25.0/${wabaId}/message_templates?limit=100&fields=id,name,category,language,status,components`;

      while (nextUrl) {
        const metaRes = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const metaData = await metaRes.json();

        if (!metaRes.ok) {
          errors.push(`Meta API error: ${JSON.stringify(metaData)}`);
          nextUrl = null;
          continue;
        }

        allMetaTemplates = allMetaTemplates.concat(metaData.data || []);
        nextUrl = metaData.paging?.next || null;
      }

      // Faz upsert de cada template — prioridade é ATUALIZAR o status
      for (const t of allMetaTemplates) {
        const headerComp = t.components?.find((c: any) => c.type === "HEADER");
        const bodyComp = t.components?.find((c: any) => c.type === "BODY");
        const footerComp = t.components?.find((c: any) => c.type === "FOOTER");
        const buttonsComp = t.components?.find((c: any) => c.type === "BUTTONS");

        const payload = {
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
          updated_at: new Date().toISOString(),
        };

        // Upsert por meta_template_id (unique constraint garante ausência de duplicatas)
        const { data: existingRows } = await supabase
          .from("crm_whatsapp_templates")
          .select("id")
          .eq("meta_template_id", t.id)
          .limit(1);
        const existing = existingRows && existingRows[0];

        if (existing) {
          await supabase
            .from("crm_whatsapp_templates")
            .update(payload)
            .eq("id", existing.id);
        } else {
          await supabase.from("crm_whatsapp_templates").insert({
            ...payload,
            created_at: new Date().toISOString(),
          });
        }
        synced++;
      }

      // Remove templates locais que não existem mais na Meta
      // (só remove os que têm meta_template_id preenchido)
      const metaIds = allMetaTemplates.map((t: any) => t.id).filter(Boolean);
      if (metaIds.length > 0) {
        const { data: localWithMeta } = await supabase
          .from("crm_whatsapp_templates")
          .select("id, meta_template_id");

        for (const local of (localWithMeta || [])) {
          if (local.meta_template_id && !metaIds.includes(local.meta_template_id)) {
            await supabase.from("crm_whatsapp_templates").delete().eq("id", local.id);
          }
        }
      }
    } catch (err: any) {
      errors.push(String(err));
    }

    results.push({ integration: intg.key, synced, errors });
  }

  const totalSynced = results.reduce((s, r) => s + r.synced, 0);

  console.log(
    `[sync-whatsapp-templates-cron] ${new Date().toISOString()} — ` +
    `${results.length} integrações, ${totalSynced} templates sincronizados`
  );

  return new Response(
    JSON.stringify({ success: true, integrations_processed: results.length, total_synced: totalSynced, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

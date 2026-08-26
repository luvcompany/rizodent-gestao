import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { motivoMidiaIncompleta } from "../_shared/mediaIntegrity.ts";
import { escopoDoNumero, escopoLegado, filtrarWaba, papelDonoDoNumero } from "../_shared/wabaEscopo.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Upload resumable do Meta: devolve o `header_handle` exigido para criar template
// com cabeçalho de MÍDIA (vídeo/imagem/documento). Sem isso não dá para ter vídeo
// em template — e template é o único que entrega FORA da janela de 24h.
async function uploadMediaToMeta(
  appId: string,
  token: string,
  bytes: Uint8Array,
  fileName: string,
  fileType: string,
): Promise<{ handle?: string; error?: string }> {
  if (!appId) return { error: "App ID (Meta) não configurado na integração do WhatsApp." };
  const base = "https://graph.facebook.com/v25.0";

  // 1) Abre a sessão de upload
  const startUrl = `${base}/${appId}/uploads?file_name=${encodeURIComponent(fileName)}&file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}`;
  const startRes = await fetch(startUrl, { method: "POST", headers: { Authorization: `OAuth ${token}` } });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startData?.id) {
    return { error: `abrir upload falhou (HTTP ${startRes.status}): ${JSON.stringify(startData).slice(0, 300)}` };
  }

  // 2) Envia os bytes e recebe o handle
  const upRes = await fetch(`${base}/${startData.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0", "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  const upData = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !upData?.h) {
    return { error: `enviar bytes falhou (HTTP ${upRes.status}): ${JSON.stringify(upData).slice(0, 300)}` };
  }
  // O Meta às vezes devolve várias linhas de handle; a 1ª é a válida.
  return { handle: String(upData.h).split("\n").map((s: string) => s.trim()).filter(Boolean)[0] };
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
    // 'closer' faltava aqui: template criado por closer ficava com owner_role null
    // e (pela RLS de owner_role) invisível para o próprio closer.
    const rolePriority = ["superadmin", "crc", "gerente", "posvenda", "recepcao", "closer"];
    const callerPrimaryRole = rolePriority.find((r) => rolesSet.has(r)) || null;

    // Any authenticated tenant user can list/create/delete their own templates.
    // Only admin/gerente/superadmin can hit destructive Meta actions like global delete.
    const isPrivileged =
      rolesSet.has("crc") || rolesSet.has("gerente") || rolesSet.has("superadmin");


    const body = await req.json();
    const { action } = body;

    // As telas mandam `integration_key` (whatsapp_<pnid> / whatsapp_es_<pnid>).
    // Ignorá-la fazia o seletor de conexão virar decoração — e, num cliente novo,
    // não havia outro jeito de dizer qual número usar. Aqui ela é traduzida para
    // phone_number_id; o acesso continua sendo checado abaixo.
    if (!body.phone_number_id && typeof body.integration_key === "string" && body.integration_key) {
      const chave = body.integration_key as string;
      if (chave !== "whatsapp_config") {
        const { data: intgSel } = await supabase
          .from("integrations")
          .select("config")
          .eq("key", chave)
          .maybeSingle();
        const pnid = ((intgSel as any)?.config ?? {}).phone_number_id;
        if (pnid) body.phone_number_id = String(pnid);
      }
    }

    // Tenant do chamador (usado para resolver o número/WABA do mundo dele).
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    const callerTenantId = profile?.tenant_id || null;

    // ===== WABA do CHAMADOR (cada número é um mundo) =====
    // Antes: qualquer integração whatsapp_% do tenant (arbitrária) — o closer
    // listava/criava templates na WABA do número principal e vice-versa.
    // Agora: closer/recepcao operam na WABA do número concedido a eles;
    // crc/gerente/superadmin/posvenda operam na WABA legada (whatsapp_config),
    // podendo apontar outro número via `phone_number_id` (validado por acesso).
    const escopoRestrito = (rolesSet.has("closer") || rolesSet.has("recepcao")) && !isPrivileged;
    let escopo = null as Awaited<ReturnType<typeof escopoLegado>> | null;

    if (escopoRestrito) {
      const { data: ovr } = await supabase
        .from("user_permission_overrides")
        .select("resource_id")
        .eq("user_id", user.id)
        .eq("scope", "whatsapp_number")
        .eq("granted", true);
      const numeros = (ovr || []).map((o: any) => o.resource_id);
      if (numeros.length === 0) {
        return new Response(
          JSON.stringify({ error: "Seu usuário não tem número de WhatsApp vinculado." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Só número ATIVO: o closer pode ter override de um número morto (o ID
      // antigo, de antes da coexistência), e cair nele devolve 400 da Meta.
      const alvo = typeof body.phone_number_id === "string" && body.phone_number_id
        ? (await supabase.from("whatsapp_numbers").select("id").eq("phone_number_id", body.phone_number_id)
            .eq("tenant_id", callerTenantId).eq("is_active", true).in("id", numeros).limit(1)).data?.[0]?.id
        : (await supabase.from("whatsapp_numbers").select("id")
            .eq("tenant_id", callerTenantId).eq("is_active", true).in("id", numeros)
            .order("created_at", { ascending: true }).limit(1)).data?.[0]?.id;
      if (!alvo) {
        return new Response(
          JSON.stringify({ error: "Número informado não pertence ao seu usuário." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      escopo = await escopoDoNumero(supabase, alvo, callerTenantId);
    } else if (typeof body.phone_number_id === "string" && body.phone_number_id) {
      const { data: numRow } = await supabase
        .from("whatsapp_numbers")
        .select("id")
        .eq("phone_number_id", body.phone_number_id)
        .eq("tenant_id", callerTenantId)
        .limit(1);
      const numId = numRow?.[0]?.id;
      if (!numId) {
        return new Response(
          JSON.stringify({ error: "Número não encontrado neste cliente." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: podeVer } = await userClient.rpc("can_access_whatsapp_number", { _number_id: numId });
      if (podeVer !== true) {
        return new Response(
          JSON.stringify({ error: "Sem acesso a este número de WhatsApp." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      escopo = await escopoDoNumero(supabase, numId, callerTenantId);
    } else {
      escopo = await escopoLegado(supabase, callerTenantId);
    }

    const WHATSAPP_TOKEN = escopo?.token || "";
    const WABA_ID = escopo?.wabaId || "";
    const META_APP_ID = escopo?.appId || Deno.env.get("META_APP_ID") || "";
    const escopoNumberId = escopo?.whatsappNumberId ?? null;
    // owner_role do template: no mundo legado fica com o papel do chamador; num
    // número próprio, com o papel dono daquele número (quando houver um só).
    const ownerRoleTemplate = escopoNumberId
      ? (await papelDonoDoNumero(supabase, escopoNumberId)) || callerPrimaryRole
      : callerPrimaryRole;

    if (!WHATSAPP_TOKEN || !WABA_ID) {
      return new Response(
        JSON.stringify({ error: "WhatsApp não configurado para este número (token/WABA ausentes na integração)." }),
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
        const { data: existingRows } = await supabase
          .from("crm_whatsapp_templates")
          .select("id")
          .eq("meta_template_id", tmpl.meta_template_id)
          .eq("tenant_id", callerTenantId)
          .eq("waba_id", WABA_ID)
          .limit(1);
        const existing = existingRows && existingRows[0];

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
            tenant_id: callerTenantId,
            waba_id: WABA_ID,
            whatsapp_number_id: escopoNumberId,
            owner_role: ownerRoleTemplate,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }

      // Remove local templates that no longer exist on Meta (só do tenant do chamador)
      if (metaTemplateIds.length > 0) {
        const { data: localTemplates } = await supabase
          .from("crm_whatsapp_templates")
          .select("id, meta_template_id")
          .eq("tenant_id", callerTenantId)
          .eq("waba_id", WABA_ID)
          .not("meta_template_id", "is", null);

        if (localTemplates) {
          const toDelete = localTemplates.filter(
            (lt: any) => !metaTemplateIds.includes(lt.meta_template_id)
          );
          for (const d of toDelete) {
            await supabase.from("crm_whatsapp_templates").delete().eq("id", d.id).eq("tenant_id", callerTenantId).eq("waba_id", WABA_ID);
          }
        }
      }


      return new Response(
        JSON.stringify({ success: true, count: templates.length, templates }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: CREATE - Submit new template to Meta API
    // ACTION: UPLOAD_MEDIA — sobe a mídia para o Meta e devolve o `header_handle`,
    // que é o que permite criar TEMPLATE com cabeçalho de vídeo/imagem/documento.
    // Template é o único formato que entrega FORA da janela de 24h.
    if (action === "upload_media") {
      // Quem chegou aqui com um escopo de WABA resolvido já provou acesso ao
      // número (o escopo passa por can_access_whatsapp_number). Decidir por
      // lista de papéis deixava pós-venda — e qualquer papel novo — só com
      // modelo de texto.
      if (!escopo?.token || !escopo?.wabaId) {
        return new Response(JSON.stringify({ error: "Sem permissão." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { media_url, file_name, file_type } = body;
      if (!media_url) {
        return new Response(JSON.stringify({ error: "media_url é obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const mediaRes = await fetch(media_url);
      if (!mediaRes.ok) {
        return new Response(JSON.stringify({ error: `Não consegui baixar a mídia (HTTP ${mediaRes.status}).` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bytes = new Uint8Array(await mediaRes.arrayBuffer());
      const mime = file_type || mediaRes.headers.get("content-type") || "video/mp4";
      // Validação estrutural: fonte pode devolver 200 com arquivo cortado.
      const motivoMidia = motivoMidiaIncompleta(bytes, mime);
      if (motivoMidia) {
        return new Response(JSON.stringify({
          error: `${motivoMidia}. Nada foi enviado à Meta — reenvie o arquivo original.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const name = file_name || (media_url.split("?")[0].split("/").pop() || "midia");
      const up = await uploadMediaToMeta(META_APP_ID, WHATSAPP_TOKEN, bytes, name, mime);
      if (up.error) {
        return new Response(JSON.stringify({ error: up.error }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ handle: up.handle, size: bytes.length, mime }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create") {
      const { name, language, category, header_type, header_content, body_text, footer_text, buttons,
              // Amostras reais de cada {{N}} — ver comentário abaixo.
              body_examples } = body;

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
          // header_content é a URL da mídia (guardada p/ o ENVIO). Para CRIAR o
          // template a Meta exige um header_handle do upload resumable — geramos
          // aqui a partir da URL. Handle legado (não-URL) passa direto.
          let creationHandle = header_content;
          if (/^https?:\/\//i.test(header_content)) {
            const mres = await fetch(header_content);
            if (!mres.ok) {
              return new Response(JSON.stringify({ error: `Não consegui baixar a mídia do cabeçalho (HTTP ${mres.status}).` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            const mbytes = new Uint8Array(await mres.arrayBuffer());
            const mmime = header_type === "VIDEO" ? "video/mp4" : header_type === "IMAGE" ? "image/jpeg" : "application/pdf";
            // Validação estrutural antes de mandar para a Meta.
            const motivoHeader = motivoMidiaIncompleta(mbytes, mres.headers.get("content-type") || mmime);
            if (motivoHeader) {
              return new Response(JSON.stringify({
                error: `${motivoHeader}. Nada foi enviado à Meta — reenvie o arquivo original.`,
              }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            const up = await uploadMediaToMeta(META_APP_ID, WHATSAPP_TOKEN, mbytes, name, mmime);
            if (up.error) {
              return new Response(JSON.stringify({ error: up.error }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            creationHandle = up.handle!;
          }
          components.push({ type: "HEADER", format: header_type, example: { header_handle: [creationHandle] } });
        }
      }

      const variables = body_text.match(/\{\{\d+\}\}/g) || [];
      const bodyComponent: any = { type: "BODY", text: body_text };
      if (variables.length > 0) {
        // A Meta lê estes valores como amostra do que a mensagem vai dizer.
        // Mandar "exemplo1"/"exemplo2" faz o revisor ver "consulta: exemplo2, na
        // unidade exemplo3" — amostra não representativa é causa clássica de
        // rejeição, e ainda enfraquece a evidência de que a mensagem é
        // transacional (o que decide a categoria UTILITY x MARKETING).
        const amostras = Array.isArray(body_examples) && body_examples.length === variables.length
          ? body_examples.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
          : [];
        bodyComponent.example = {
          body_text: [
            amostras.length === variables.length
              ? amostras
              : variables.map((_: string, i: number) => `exemplo${i + 1}`),
          ],
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

      console.log("[CREATE] Sending to Meta (WABA " + WABA_ID + "):", JSON.stringify(metaPayload));

      // Resolve tenant for logging
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      const tenantId = (profile as any)?.tenant_id || callerTenantId || (typeof body.tenant_id === "string" ? body.tenant_id : null);

      // Sem tenant resolvido o insert cairia no COALESCE da trigger (tenant
      // padrão Rizodent) e vazaria o template para outra clínica.
      if (!tenantId) {
        return new Response(
          JSON.stringify({ error: "tenant_id é obrigatório (não foi possível resolver o tenant do usuário)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }


      // Log REQUEST before fetch
      await supabase.from("whatsapp_template_logs").insert({
        tenant_id: tenantId,
        action: "create_request",
        template_name: name,
        waba_id: WABA_ID,
        request_payload: metaPayload,
        user_id: user.id,
      });

      let metaRes: Response;
      let metaData: any;
      try {
        metaRes = await fetch(
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
        metaData = await metaRes.json();
      } catch (fetchErr) {
        await supabase.from("whatsapp_template_logs").insert({
          tenant_id: tenantId,
          action: "create_fetch_error",
          template_name: name,
          waba_id: WABA_ID,
          response_body: { error: String(fetchErr) },
          user_id: user.id,
        });
        return new Response(
          JSON.stringify({ error: "Falha de rede ao contatar Meta", details: String(fetchErr) }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[CREATE] Meta response (" + metaRes.status + "):", JSON.stringify(metaData));

      // Log RESPONSE
      await supabase.from("whatsapp_template_logs").insert({
        tenant_id: tenantId,
        action: "create_response",
        template_name: name,
        waba_id: WABA_ID,
        response_body: metaData,
        http_status: metaRes.status,
        user_id: user.id,
      });

      if (!metaRes.ok) {
        return new Response(
          JSON.stringify({ error: "Erro na API da Meta", details: metaData, waba_id: WABA_ID }),
          { status: metaRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: dbError } = await supabase.from("crm_whatsapp_templates").insert({
        tenant_id: tenantId,
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
        created_by_user_id: user.id,
        owner_role: ownerRoleTemplate,
        waba_id: WABA_ID,
        whatsapp_number_id: escopoNumberId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (dbError) {
        console.error("[CREATE] DB save error:", dbError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          meta_template_id: metaData.id,
          status: metaData.status || "PENDING",
          waba_id: WABA_ID,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: DELETE - Delete template from Meta API
    if (action === "delete") {
      const { template_name, template_id } = body;
      if (!template_name && !template_id) {
        return new Response(
          JSON.stringify({ error: "template_name é obrigatório para deletar" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Only the template's creator OR admin/gerente/superadmin may delete (Meta is shared)
      // Alvo local sempre dentro da WABA do chamador: por id, ou por (name, waba_id).
      let alvoQuery = supabase
        .from("crm_whatsapp_templates")
        .select("id, name, created_by_user_id")
        .eq("tenant_id", callerTenantId)
        .eq("waba_id", WABA_ID);
      alvoQuery = template_id ? alvoQuery.eq("id", template_id) : alvoQuery.eq("name", template_name);
      const { data: alvoRows } = await filtrarWaba(alvoQuery, escopoNumberId).limit(1);
      const alvo = (alvoRows || [])[0];
      const nomeNaMeta = alvo?.name || template_name;

      if (!nomeNaMeta) {
        return new Response(
          JSON.stringify({ error: "Template não encontrado nesta WABA" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!isPrivileged) {
        const ownerRow = alvo;
        if (!ownerRow || (ownerRow as any).created_by_user_id !== user.id) {
          return new Response(
            JSON.stringify({ error: "Forbidden: only the template owner or an admin can delete this template" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const metaRes = await fetch(
        `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?name=${encodeURIComponent(nomeNaMeta)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        }
      );
      const metaData = await metaRes.json();

      // Always delete locally, even if Meta API fails (e.g. permission issues)
      if (alvo?.id) {
        await supabase.from("crm_whatsapp_templates").delete().eq("id", alvo.id).eq("tenant_id", callerTenantId);
      } else {
        await filtrarWaba(
          supabase.from("crm_whatsapp_templates").delete().eq("name", nomeNaMeta).eq("tenant_id", callerTenantId).eq("waba_id", WABA_ID),
          escopoNumberId,
        );
      }

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

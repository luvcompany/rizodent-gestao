// Conexão de WhatsApp INDIVIDUAL por usuário (closer / recepção).
//
// O token permanente da Meta NUNCA passa pelo navegador para o banco: o
// frontend envia o token para esta function, que valida contra a Graph API,
// grava em `integrations.config` (service role) e concede ao PRÓPRIO usuário
// o override de visibilidade do número (`user_permission_overrides`).
//
// Permitido apenas para os papéis `closer`, `recepcao` e `superadmin`.
// O fluxo do crc (tela de Integrações) não é tocado por aqui.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_VERSION = "v25.0";
const PAPEIS_PERMITIDOS = new Set(["closer", "recepcao", "superadmin"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** "+55 71 99999-9999" | "5571999999999" -> "+5571999999999" */
function toE164BR(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `+${digits.startsWith("55") ? digits : `55${digits}`}`;
}

interface ItemConexao {
  integration_id: string | null;
  number_id: string;
  display_name: string | null;
  phone_number_id: string | null;
  phone_e164: string | null;
  waba_id: string | null;
  status: string | null;
  pipeline_id: string | null;
  pipeline_name: string | null;
  criado_em: string | null;
}

/** Lista os números que o próprio usuário conectou. Nunca devolve token. */
async function listarMeusNumeros(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<ItemConexao[]> {
  const { data: overrides } = await admin
    .from("user_permission_overrides")
    .select("resource_id")
    .eq("user_id", userId)
    .eq("scope", "whatsapp_number")
    .eq("granted", true);

  const ids = (overrides ?? []).map((o: any) => o.resource_id).filter(Boolean);
  if (ids.length === 0) return [];

  const { data: numeros } = await admin
    .from("whatsapp_numbers")
    .select("id, phone_number_id, display_name, phone_e164, waba_id, is_active, created_at")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  if (!numeros || numeros.length === 0) return [];

  const { data: integracoes } = await admin
    .from("integrations")
    .select("id, key, status, config")
    .eq("tenant_id", tenantId);

  const pipelineIds = new Set<string>();
  for (const i of integracoes ?? []) {
    const pid = (i.config as any)?.pipeline_id;
    if (pid) pipelineIds.add(pid);
  }
  const { data: pipelines } = pipelineIds.size
    ? await admin.from("crm_pipelines").select("id, name").in("id", [...pipelineIds])
    : { data: [] as any[] };
  const nomePipeline = new Map((pipelines ?? []).map((p: any) => [p.id, p.name]));

  return numeros.map((n: any) => {
    const intg = (integracoes ?? []).find(
      (i: any) => (i.config as any)?.phone_number_id === n.phone_number_id,
    );
    const cfg = (intg?.config ?? {}) as any;
    return {
      integration_id: intg?.id ?? null,
      number_id: n.id,
      display_name: n.display_name ?? cfg.display_name ?? null,
      phone_number_id: n.phone_number_id ?? null,
      phone_e164: n.phone_e164 ?? null,
      waba_id: n.waba_id ?? cfg.waba_id ?? null,
      status: intg?.status ?? (n.is_active ? "connected" : "disabled"),
      pipeline_id: cfg.pipeline_id ?? null,
      pipeline_name: cfg.pipeline_id ? (nomePipeline.get(cfg.pipeline_id) ?? null) : null,
      criado_em: n.created_at ?? null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const ctx = await resolveCaller(req, admin);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);
    if (!ctx.userId || !ctx.tenantId) {
      return json({ error: "Somente usuários de uma clínica podem usar esta tela" }, 403);
    }
    const userId = ctx.userId;
    const tenantId = ctx.tenantId;

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const papeis = (roles ?? []).map((r: any) => r.role as string);
    if (!papeis.some((p) => PAPEIS_PERMITIDOS.has(p))) {
      return json({ error: "Seu perfil não gerencia conexões individuais" }, 403);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String((body as any).action ?? "list");
    console.log(`[minha-conexao-whatsapp] action=${action} user=${userId} tenant=${tenantId}`);

    if (action === "list") {
      return json({ items: await listarMeusNumeros(admin, userId, tenantId) });
    }

    if (action === "connect") {
      const {
        display_name,
        token,
        phone_number_id,
        waba_id,
        app_id,
        app_secret,
        webhook_verify_token,
      } = body as Record<string, string | undefined>;
      let pipeline_id = (body as Record<string, string | undefined>).pipeline_id;

      // Sem funil escolhido, recepção/closer caem no funil PADRÃO do seu papel
      // (criado pela RPC se ainda não existir) — nunca no funil do crc.
      if (!pipeline_id) {
        const papelPadrao = papeis.find((p) => p === "closer" || p === "recepcao");
        if (papelPadrao) {
          const { data: defId, error: erroDef } = await admin.rpc("ensure_role_default_pipeline", {
            _tenant_id: tenantId,
            _role: papelPadrao,
          });
          if (erroDef) {
            console.error(`[minha-conexao-whatsapp] funil padrão: ${erroDef.message}`);
          } else if (defId) {
            pipeline_id = defId as string;
          }
        }
      }

      const faltando = [
        !display_name && "Nome de exibição",
        !token && "Token de acesso",
        !phone_number_id && "Phone Number ID",
        !waba_id && "WABA ID",
      ].filter(Boolean);
      if (faltando.length) {
        return json({ error: `Preencha: ${faltando.join(", ")}` }, 400);
      }

      // 1b) IDs precisam ser numéricos (vão para a URL da Graph API).
      if (!/^\d{5,20}$/.test(String(phone_number_id)) || !/^\d{5,20}$/.test(String(waba_id))) {
        return json({ error: "Phone Number ID e WABA ID devem conter apenas números" }, 400);
      }

      // 2) Valida o token no SERVIDOR contra a Graph API.
      const metaRes = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${phone_number_id}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const metaText = await metaRes.text();
      if (!metaRes.ok) {
        let msg = metaText.slice(0, 400);
        try {
          msg = JSON.parse(metaText)?.error?.message ?? msg;
        } catch { /* corpo não-JSON */ }
        console.error(`[minha-conexao-whatsapp] meta ${metaRes.status}: ${msg}`);
        return json({ error: `A Meta recusou estes dados: ${msg}` }, 400);
      }
      const meta = JSON.parse(metaText) as {
        display_phone_number?: string;
        verified_name?: string;
      };

      // 3) Número já em uso por OUTRA clínica?
      const { data: outras } = await admin
        .from("integrations")
        .select("id")
        .eq("config->>phone_number_id", phone_number_id)
        .neq("tenant_id", tenantId)
        .limit(1);
      if ((outras ?? []).length > 0) {
        return json({ error: "Número já conectado em outra conta" }, 409);
      }

      // 3b) Número já cadastrado em whatsapp_numbers de outro tenant?
      const { data: numeroExistente } = await admin
        .from("whatsapp_numbers")
        .select("id, tenant_id")
        .eq("phone_number_id", phone_number_id)
        .maybeSingle();
      if (numeroExistente && numeroExistente.tenant_id !== tenantId) {
        return json({ error: "Número já conectado em outra conta" }, 409);
      }

      const key = `whatsapp_${phone_number_id}`;

      // 3c) Coexistência (WhatsApp Business App): assinar o app na WABA e pedir
      // o sync de estado + histórico. Sem essa sequência a Meta DESATIVA a
      // coexistência em 24h e o webhook fica mudo. Tudo BEST-EFFORT: falha aqui
      // nunca aborta a conexão — só volta como aviso para o usuário.
      const avisos: string[] = [];
      let isCoexistence = false;

      try {
        const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${waba_id}/subscribed_apps`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          const t = (await r.text()).slice(0, 300);
          console.error(`[minha-conexao-whatsapp] subscribed_apps ${r.status}: ${t}`);
          avisos.push(`Não foi possível assinar o app na conta do WhatsApp: ${t}`);
        }
      } catch (e) {
        console.error(`[minha-conexao-whatsapp] subscribed_apps erro: ${(e as Error).message}`);
        avisos.push(`Não foi possível assinar o app na conta do WhatsApp: ${(e as Error).message}`);
      }

      try {
        const r = await fetch(
          `https://graph.facebook.com/${API_VERSION}/${phone_number_id}?fields=is_on_biz_app,platform_type`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const t = await r.text();
        if (!r.ok) {
          console.error(`[minha-conexao-whatsapp] is_on_biz_app ${r.status}: ${t.slice(0, 300)}`);
          avisos.push(`Não foi possível verificar a coexistência: ${t.slice(0, 300)}`);
        } else {
          isCoexistence = JSON.parse(t)?.is_on_biz_app === true;
        }
      } catch (e) {
        console.error(`[minha-conexao-whatsapp] is_on_biz_app erro: ${(e as Error).message}`);
        avisos.push(`Não foi possível verificar a coexistência: ${(e as Error).message}`);
      }

      if (isCoexistence) {
        // Ordem obrigatória: primeiro o estado, depois o histórico.
        for (const sync_type of ["smb_app_state_sync", "history"]) {
          try {
            const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${phone_number_id}/smb_app_data`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ messaging_product: "whatsapp", sync_type }),
            });
            if (!r.ok) {
              const t = (await r.text()).slice(0, 300);
              console.error(`[minha-conexao-whatsapp] smb_app_data ${sync_type} ${r.status}: ${t}`);
              avisos.push(`Sincronização "${sync_type}" falhou: ${t}`);
            }
          } catch (e) {
            console.error(`[minha-conexao-whatsapp] smb_app_data ${sync_type} erro: ${(e as Error).message}`);
            avisos.push(`Sincronização "${sync_type}" falhou: ${(e as Error).message}`);
          }
        }
      }

      // 7a) O funil precisa ser do MUNDO do chamador: do próprio tenant, que
      // permita o papel dele e que não esteja vinculado a OUTRO número.
      const meusPapeis = papeis.filter((p) => p === "closer" || p === "recepcao");
      if (pipeline_id) {
        const { data: pipe } = await admin
          .from("crm_pipelines")
          .select("id, allowed_roles")
          .eq("id", pipeline_id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (!pipe) return json({ error: "Funil inválido para esta clínica" }, 403);

        const permitidos: string[] = (pipe as any).allowed_roles ?? [];
        const ehSuper = papeis.includes("superadmin");
        if (!ehSuper && !meusPapeis.some((p) => permitidos.includes(p))) {
          return json({ error: "Este funil não pertence ao seu escopo" }, 403);
        }

        const { data: canaisDoFunil } = await admin
          .from("funnel_channels")
          .select("id, channel_config")
          .eq("channel_type", "whatsapp")
          .eq("pipeline_id", pipeline_id);
        const deOutroNumero = (canaisDoFunil ?? []).some((c: any) => {
          const k = (c.channel_config ?? {})?.integration_key;
          return k && k !== key;
        });
        if (deOutroNumero) return json({ error: "Funil já vinculado a outro número" }, 409);
      }

      const config = {
        token,
        phone_number_id,
        waba_id,
        app_id: app_id ?? "",
        api_version: API_VERSION,
        // App secret do app Meta DESTE cliente (opcional). Usado só para
        // validar a assinatura HMAC do webhook — nunca é devolvido em respostas.
        app_secret: app_secret ?? "",
        webhook_verify_token: webhook_verify_token ?? "",
        display_name,
        pipeline_id: pipeline_id ?? "",
      };


      // 4) Upsert manual em integrations (tenant_id + key não tem unique).
      const { data: existente } = await admin
        .from("integrations")
        .select("id, config")
        .eq("tenant_id", tenantId)
        .eq("key", key)
        .maybeSingle();

      // Reconectar sem informar app_secret não apaga o que já estava gravado.
      if (!config.app_secret) {
        const anterior = (existente?.config as any)?.app_secret;
        if (typeof anterior === "string" && anterior) config.app_secret = anterior;
      }

      let integrationId: string | null = existente?.id ?? null;
      if (integrationId) {
        const { error } = await admin
          .from("integrations")
          .update({ config, status: "connected", updated_at: new Date().toISOString() })
          .eq("id", integrationId);
        if (error) return json({ error: error.message }, 500);
      } else {
        const { data: nova, error } = await admin
          .from("integrations")
          .insert({ tenant_id: tenantId, key, config, status: "connected" })
          .select("id")
          .single();
        if (error) return json({ error: error.message }, 500);
        integrationId = nova.id;
      }

      // 5) Upsert do número por phone_number_id — NUNCA sobrescreve tenant_id.
      const dadosNumero = {
        display_name: display_name ?? meta.verified_name ?? null,
        phone_e164: toE164BR(meta.display_phone_number),
        waba_id,
        app_id: app_id ?? null,
        token,
        verify_token: webhook_verify_token ?? null,
        is_coexistence: isCoexistence,
        is_active: true,
        updated_at: new Date().toISOString(),
      };
      let numero: { id: string } | null = null;
      let erroNumero: any = null;
      if (numeroExistente) {
        const r = await admin
          .from("whatsapp_numbers")
          .update(dadosNumero)
          .eq("id", numeroExistente.id)
          .eq("tenant_id", tenantId)
          .select("id")
          .single();
        numero = r.data as any;
        erroNumero = r.error;
      } else {
        const r = await admin
          .from("whatsapp_numbers")
          .insert({ tenant_id: tenantId, phone_number_id, ...dadosNumero })
          .select("id")
          .single();
        numero = r.data as any;
        erroNumero = r.error;
      }
      if (erroNumero || !numero) return json({ error: erroNumero?.message ?? "Falha ao salvar o número" }, 500);

      // 6) Override de visibilidade para o PRÓPRIO usuário.
      const { error: erroOverride } = await admin.from("user_permission_overrides").upsert(
        {
          user_id: userId,
          scope: "whatsapp_number",
          resource_id: numero.id,
          granted: true,
          created_by: userId,
        },
        { onConflict: "user_id,scope,resource_id" },
      );
      if (erroOverride) return json({ error: erroOverride.message }, 500);

      // 7b) Vincula o funil ao canal. O delete é pela PRÓPRIA integration_key
      // (em qualquer funil) — nunca por pipeline_id solto: reconectar com outro
      // funil deixava 2 linhas com a mesma key e o webhook escolhia a errada.
      if (pipeline_id) {
        await admin
          .from("funnel_channels")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("channel_type", "whatsapp")
          .eq("channel_config->>integration_key", key);
        const { error: erroCanal } = await admin.from("funnel_channels").insert({
          pipeline_id,
          channel_type: "whatsapp",
          channel_config: { integration_key: key },
          tenant_id: tenantId,
        });
        if (erroCanal) return json({ error: erroCanal.message }, 500);
      }

      const itens = await listarMeusNumeros(admin, userId, tenantId);
      const item = itens.find((i) => i.number_id === numero.id) ?? null;
      return json({ item, integration_key: key, avisos });
    }

    if (action === "disconnect") {
      const numberId = String((body as any).number_id ?? "");
      if (!numberId) return json({ error: "number_id é obrigatório" }, 400);

      const { data: override } = await admin
        .from("user_permission_overrides")
        .select("id")
        .eq("user_id", userId)
        .eq("scope", "whatsapp_number")
        .eq("resource_id", numberId)
        .eq("granted", true)
        .maybeSingle();
      if (!override) return json({ error: "Este número não é seu" }, 403);

      const { data: numero } = await admin
        .from("whatsapp_numbers")
        .select("id, phone_number_id, tenant_id")
        .eq("id", numberId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!numero) return json({ error: "Número não encontrado" }, 404);

      await admin
        .from("integrations")
        .update({ status: "disabled", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("key", `whatsapp_${numero.phone_number_id}`);

      await admin
        .from("whatsapp_numbers")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", numberId);

      return json({ ok: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    console.error("[minha-conexao-whatsapp] erro:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

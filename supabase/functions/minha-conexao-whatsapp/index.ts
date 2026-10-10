// Conexão de WhatsApp INDIVIDUAL por usuário (closer / recepção).
//
// O token permanente da Meta NUNCA passa pelo navegador para o banco: o
// frontend envia o token para esta function, que valida contra a Graph API e
// grava em `integrations.config` (service role). O gatilho
// trg_integracao_whatsapp_numero espelha a integração em `whatsapp_numbers`
// com a EQUIPE (mundo) e o dono do número.
//
// Desde 09/10/2026 a conexão NÃO grava mais permissão por usuário
// (`user_permission_overrides`): quem usa o número é a equipe dele, decidida
// pela can_access_whatsapp_number. "Meus números" = números da minha equipe
// (closer/recepção: os de que sou dono; central: os da central).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller } from "../_shared/authz.ts";
import { integracaoDoPnid } from "../_shared/numeroDeSaida.ts";
import { donoDaConexao, MUNDO_CENTRAL, numeroEhDaEquipe, ordemDeNumeros } from "../_shared/mundoNumero.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_VERSION = "v25.0";
// Num cliente novo é o DONO da operação (crc/gerente) que conecta o primeiro
// número — sem isto ele não tem tela de autoatendimento e alguém precisa entrar
// no banco por fora. O fluxo já é seguro: valida o token na Meta pelo servidor,
// recusa número já usado por outro cliente e grava com credencial de serviço.
const PAPEIS_PERMITIDOS = new Set(["closer", "recepcao", "crc", "gerente", "superadmin"]);

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
  integration_key: string | null;
  number_id: string;
  display_name: string | null;
  phone_number_id: string | null;
  phone_e164: string | null;
  waba_id: string | null;
  status: string | null;
  pipeline_id: string | null;
  pipeline_name: string | null;
  app_id: string | null;
  criado_em: string | null;
  is_coexistence: boolean;
  is_active: boolean;
  is_default: boolean;
  /** Número desligado/trocado: fica na lista só como histórico (as conversas dele continuam visíveis). */
  historico: boolean;
}

/** Erro de banco vira exceção com o passo no texto (o catch devolve 500 com a mensagem). */
function falhou(passo: string, error: { message?: string } | null | undefined): void {
  if (error) throw new Error(`${passo}: ${error.message ?? "erro desconhecido"}`);
}

/** Integrações de WhatsApp do tenant (para achar a de cada número pelo phone_number_id). */
async function integracoesDoTenant(admin: any, tenantId: string): Promise<any[]> {
  const { data, error } = await admin
    .from("integrations")
    .select("id, key, status, owner_role, config")
    .eq("tenant_id", tenantId)
    .like("key", "whatsapp%");
  falhou("ler integrações", error);
  return (data ?? []) as any[];
}

/**
 * Lista os números ATIVOS da EQUIPE do usuário (closer/recepção: os de que ele
 * é dono; demais papéis: os da central). Nunca devolve token. Antes listava
 * pelos user_permission_overrides do usuário — que a conexão deixou de gravar.
 *
 * Número excluído/desativado não aparece mais (como no Kommo: excluiu, some).
 * A linha continua em whatsapp_numbers só como histórico das conversas e dos
 * leads; conectar de novo o mesmo número reativa essa linha.
 */
async function listarMeusNumeros(
  admin: any,
  userId: string,
  tenantId: string,
  papeis: string[],
): Promise<ItemConexao[]> {
  const { data: todos, error } = await admin
    .from("whatsapp_numbers")
    .select("id, phone_number_id, display_name, phone_e164, waba_id, is_active, is_default, is_coexistence, created_at, mundo, dono_user_id")
    .eq("tenant_id", tenantId);
  falhou("ler números", error);

  const numeros = ((todos ?? []) as any[])
    .filter((n) => n.is_active === true && numeroEhDaEquipe(n, userId, papeis))
    .sort(ordemDeNumeros);
  if (numeros.length === 0) return [];

  const integracoes = await integracoesDoTenant(admin, tenantId);

  const pipelineIds = new Set<string>();
  for (const i of integracoes) {
    const pid = (i.config as any)?.pipeline_id;
    if (pid) pipelineIds.add(pid);
  }
  let nomePipeline = new Map<string, string>();
  if (pipelineIds.size) {
    const { data: pipelines, error: erroFunis } = await admin
      .from("crm_pipelines").select("id, name").eq("tenant_id", tenantId).in("id", [...pipelineIds]);
    falhou("ler funis", erroFunis);
    nomePipeline = new Map((pipelines ?? []).map((p: any) => [p.id, p.name]));
  }

  return numeros.map((n: any) => {
    const intg = integracaoDoPnid(integracoes, n.phone_number_id);
    const cfg = (intg?.config ?? {}) as any;
    const ativo = n.is_active === true;
    return {
      integration_id: intg?.id ?? null,
      integration_key: intg?.key ?? null,
      number_id: n.id,
      display_name: n.display_name ?? cfg.display_name ?? null,
      phone_number_id: n.phone_number_id ?? null,
      phone_e164: n.phone_e164 ?? null,
      waba_id: n.waba_id ?? cfg.waba_id ?? null,
      // Número inativo é "disabled" mesmo que sobre uma integração antiga.
      status: ativo ? (intg?.status ?? "connected") : "disabled",
      pipeline_id: cfg.pipeline_id || null,
      app_id: cfg.app_id ?? null,
      pipeline_name: cfg.pipeline_id ? (nomePipeline.get(cfg.pipeline_id) ?? null) : null,
      criado_em: n.created_at ?? null,
      is_coexistence: n.is_coexistence === true,
      is_active: ativo,
      is_default: n.is_default === true,
      historico: !ativo,
    };
  });
}

/** Gerência e superadmin mexem em número de qualquer equipe do próprio cliente. */
function ehGestao(papeis: string[]): boolean {
  return papeis.includes("gerente") || papeis.includes("superadmin");
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
      return json({ items: await listarMeusNumeros(admin, userId, tenantId, papeis) });
    }

    if (action === "connect") {
      let { token } = body as Record<string, string | undefined>;
      const {
        display_name,
        phone_number_id,
        waba_id,
        app_id,
        app_secret,
        webhook_verify_token,
      } = body as Record<string, string | undefined>;
      let pipeline_id = (body as Record<string, string | undefined>).pipeline_id;

      const avisos: string[] = [];

      // Número já cadastrado NESTE cliente (whatsapp_numbers) e a integração
      // dele — achada pelo phone_number_id: o número oficial vive na chave
      // herdada `whatsapp_config`, e criar uma `whatsapp_<id>` ao lado deixava
      // o mesmo número com duas integrações.
      let numeroExistente: any = null;
      let intgExistente: any = null;
      if (phone_number_id) {
        const { data: numAnt, error: erroNumAnt } = await admin
          .from("whatsapp_numbers")
          .select("id, tenant_id, mundo, dono_user_id, is_active")
          .eq("tenant_id", tenantId)
          .eq("phone_number_id", phone_number_id)
          .maybeSingle();
        falhou("ler número", erroNumAnt);
        numeroExistente = numAnt ?? null;
        intgExistente = integracaoDoPnid(await integracoesDoTenant(admin, tenantId), phone_number_id);
      }

      // De quem é: número já cadastrado só é mexido pela equipe dele (ou pela
      // gerência/superadmin) e NÃO muda de equipe ao ser reconectado. Antes
      // valia "ter override" e o owner_role era o papel de quem reconectava —
      // um crc que reconectasse o número do closer o levava para a central.
      const dono = donoDaConexao({ papeis, userId, numero: numeroExistente, integracao: intgExistente });
      if (!dono.podeMexer) {
        return json({ error: "Este número já está conectado por outra equipe desta clínica." }, 403);
      }

      // Sem funil escolhido, número de recepção/closer cai no funil PADRÃO do
      // papel dele (criado pela RPC se ainda não existir) — nunca no funil da
      // central. Vale a equipe do NÚMERO (não o papel de quem conecta).
      if (!pipeline_id && (dono.mundo === "closer" || dono.mundo === "recepcao")) {
        const { data: defId, error: erroDef } = await admin.rpc("ensure_role_default_pipeline", {
          _tenant_id: tenantId,
          _role: dono.mundo,
        });
        if (erroDef) {
          console.error(`[minha-conexao-whatsapp] funil padrão: ${erroDef.message}`);
          avisos.push(`Não foi possível criar o funil padrão (${erroDef.message}); escolha um funil para este número.`);
        } else if (defId) {
          pipeline_id = defId as string;
        }
      }

      // Edição: sem token novo, reaproveita o já gravado (o número é da equipe
      // de quem edita, conferido acima).
      const configAnterior: Record<string, any> = (intgExistente?.config ?? {}) as Record<string, any>;
      if (!token) token = configAnterior.access_token || configAnterior.token || undefined;

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

      // 3) Número já em uso por OUTRA clínica? (Depois de validar o token na
      // Meta: sem o token do número ninguém descobre onde ele está conectado.)
      const { data: outras, error: erroOutras } = await admin
        .from("integrations")
        .select("id")
        .eq("config->>phone_number_id", phone_number_id)
        .neq("tenant_id", tenantId)
        .limit(1);
      falhou("conferir integrações de outros clientes", erroOutras);
      if ((outras ?? []).length > 0) {
        return json({ error: "Número já conectado em outra conta" }, 409);
      }

      // 3b) Número já cadastrado em whatsapp_numbers de outro tenant?
      // (phone_number_id é ÚNICO no banco inteiro.)
      const { data: deOutroCliente, error: erroOutroCliente } = await admin
        .from("whatsapp_numbers")
        .select("id")
        .eq("phone_number_id", phone_number_id)
        .neq("tenant_id", tenantId)
        .limit(1);
      falhou("conferir números de outros clientes", erroOutroCliente);
      if ((deOutroCliente ?? []).length > 0) {
        return json({ error: "Número já conectado em outra conta" }, 409);
      }

      // Chave da integração: a que já existe para este phone_number_id (pode
      // ser a herdada whatsapp_config) ou, número novo, whatsapp_<id>.
      const key: string = intgExistente?.key ?? `whatsapp_${phone_number_id}`;

      // Equipe (mundo) e dono do número: número novo é da equipe de quem
      // conecta; número existente mantém a dele (regra em donoDaConexao).
      const { ownerRole, ownerUserId } = dono;
      const mundoDaConexao = dono.mundo;

      // 3c) Coexistência (WhatsApp Business App): assinar o app na WABA e pedir
      // o sync de estado + histórico. Sem essa sequência a Meta DESATIVA a
      // coexistência em 24h e o webhook fica mudo. Tudo BEST-EFFORT: falha aqui
      // nunca aborta a conexão — só volta como aviso para o usuário.
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

      // 7a) O funil precisa ser do MUNDO do número: do próprio tenant, da
      // mesma equipe e não vinculado a OUTRO número. Closer/recepção: funil que
      // permita o papel; central: funil sem papel restrito ou que permita um
      // papel da central. (Antes só passava funil de closer/recepção: o
      // crc/gerente que conectasse o 1º número de um cliente novo com funil
      // escolhido levava 403.) Ligar um número central a um funil do closer
      // levaria o funil inteiro para o mundo central — e vice-versa.
      if (pipeline_id) {
        const { data: pipe, error: erroFunil } = await admin
          .from("crm_pipelines")
          .select("id, allowed_roles")
          .eq("id", pipeline_id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        falhou("ler funil", erroFunil);
        if (!pipe) return json({ error: "Funil inválido para esta clínica" }, 403);

        const permitidos: string[] = (pipe as any).allowed_roles ?? [];
        const papeisDoFunil = permitidos.filter((r) => r !== "gerente" && r !== "superadmin");
        const funilDaEquipe = mundoDaConexao === MUNDO_CENTRAL
          ? papeisDoFunil.length === 0 || papeisDoFunil.some((r) => ["crc", "sdr", "crc_legacy", "posvenda"].includes(r))
          : permitidos.includes(mundoDaConexao);
        if (!papeis.includes("superadmin") && !funilDaEquipe) {
          return json({ error: "Este funil não pertence ao seu escopo" }, 403);
        }

        const { data: canaisDoFunil, error: erroCanais } = await admin
          .from("funnel_channels")
          .select("id, channel_config")
          .eq("tenant_id", tenantId)
          .eq("channel_type", "whatsapp")
          .eq("pipeline_id", pipeline_id);
        falhou("ler canais do funil", erroCanais);
        const deOutroNumero = (canaisDoFunil ?? []).some((c: any) => {
          const k = (c.channel_config ?? {})?.integration_key;
          return k && k !== key;
        });
        if (deOutroNumero) return json({ error: "Funil já vinculado a outro número" }, 409);
      }

      const config: Record<string, any> = {
        // Mescla com o que já estava gravado (mm_lite, campos da tela de
        // Integrações…): antes a config inteira era trocada e esses campos
        // sumiam ao reconectar.
        ...configAnterior,
        token,
        phone_number_id,
        waba_id,
        app_id: app_id || configAnterior.app_id || "",
        api_version: API_VERSION,
        // App secret do app Meta DESTE cliente (opcional). Usado só para
        // validar a assinatura HMAC do webhook — nunca é devolvido em respostas.
        // Reconectar sem informar não apaga o que já estava gravado.
        app_secret: app_secret || configAnterior.app_secret || "",
        webhook_verify_token: webhook_verify_token || configAnterior.webhook_verify_token || "",
        display_name,
        pipeline_id: pipeline_id ?? configAnterior.pipeline_id ?? "",
        // Número individual (closer/recepção): não aparece na tela Integrações
        // da clínica. Número que já existe mantém o dono que tinha.
        owner_user_id: ownerUserId,
      };
      // Os leitores usam `access_token || token`: se a integração antiga tinha
      // access_token, ele venceria o token novo.
      if ("access_token" in config) config.access_token = token;

      // 4) Integração: atualiza a que já existe para este phone_number_id ou
      // cria `whatsapp_<id>`. (tenant_id + key é único no banco.)
      const agora = new Date().toISOString();
      let integrationId: string | null = intgExistente?.id ?? null;
      let atualizarIntegracao = !!integrationId;
      if (!integrationId) {
        const { data: nova, error } = await admin
          .from("integrations")
          .insert({ tenant_id: tenantId, key, config, owner_role: ownerRole, status: "connected" })
          .select("id")
          .single();
        if (error && error.code !== "23505") falhou("criar integração", error);
        if (error) {
          // Outra aba conectou o mesmo número ao mesmo tempo: atualiza a dela.
          const { data: ja, error: erroJa } = await admin
            .from("integrations").select("id").eq("tenant_id", tenantId).eq("key", key).maybeSingle();
          falhou("reler integração", erroJa);
          integrationId = (ja as any)?.id ?? null;
          atualizarIntegracao = true;
        } else {
          integrationId = (nova as any)?.id ?? null;
        }
        if (!integrationId) return json({ error: "Falha ao salvar a integração" }, 500);
      }
      if (atualizarIntegracao) {
        const { error } = await admin
          .from("integrations")
          .update({ config, owner_role: ownerRole, status: "connected", updated_at: agora })
          .eq("id", integrationId)
          .eq("tenant_id", tenantId);
        falhou("atualizar integração", error);
      }

      // 5) Número por phone_number_id. O gatilho da integração já o criou ou
      // atualizou (com equipe e dono); aqui só completa o que a integração não
      // tem (telefone, coexistência). Relido DEPOIS da integração: ler antes e
      // inserir depois dava 23505 na 1ª conexão (o gatilho tinha acabado de
      // inserir a mesma linha). NUNCA sobrescreve tenant_id nem a equipe de
      // um número existente.
      const dadosNumero = {
        display_name: display_name ?? meta.verified_name ?? null,
        phone_e164: toE164BR(meta.display_phone_number),
        waba_id,
        app_id: config.app_id || null,
        token,
        verify_token: config.webhook_verify_token || null,
        is_coexistence: isCoexistence,
        is_active: true,
        updated_at: agora,
      };
      const lerNumero = async (): Promise<{ id: string; tenant_id: string } | null> => {
        const { data, error } = await admin
          .from("whatsapp_numbers")
          .select("id, tenant_id")
          .eq("phone_number_id", phone_number_id)
          .maybeSingle();
        falhou("reler número", error);
        return (data as { id: string; tenant_id: string } | null) ?? null;
      };
      let numero = await lerNumero();
      if (!numero) {
        const { error } = await admin
          .from("whatsapp_numbers")
          .insert({
            tenant_id: tenantId,
            phone_number_id,
            ...dadosNumero,
            mundo: mundoDaConexao,
            dono_user_id: ownerUserId || null,
          });
        // 23505 = alguém (gatilho, outra aba) inseriu no meio do caminho.
        if (error && error.code !== "23505") falhou("criar número", error);
        numero = await lerNumero();
        if (!numero) return json({ error: "Falha ao salvar o número" }, 500);
      }
      if (numero.tenant_id !== tenantId) {
        return json({ error: "Número já conectado em outra conta" }, 409);
      }
      {
        const { error } = await admin
          .from("whatsapp_numbers")
          .update(dadosNumero)
          .eq("id", numero.id)
          .eq("tenant_id", tenantId);
        falhou("atualizar número", error);
      }

      // 6) Nenhuma permissão por usuário: o número já vale para a equipe
      // inteira (can_access_whatsapp_number decide pelo mundo do número).

      // 7b) Vincula o funil ao canal. O delete é pela PRÓPRIA integration_key
      // (em qualquer funil) — nunca por pipeline_id solto: reconectar com outro
      // funil deixava 2 linhas com a mesma key e o webhook escolhia a errada.
      if (pipeline_id) {
        const { error: erroApagaCanal } = await admin
          .from("funnel_channels")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("channel_type", "whatsapp")
          .eq("channel_config->>integration_key", key);
        falhou("trocar o funil do número", erroApagaCanal);
        const { error: erroCanal } = await admin.from("funnel_channels").insert({
          pipeline_id,
          channel_type: "whatsapp",
          channel_config: { integration_key: key },
          tenant_id: tenantId,
        });
        falhou("vincular o funil ao número", erroCanal);
      }

      const itens = await listarMeusNumeros(admin, userId, tenantId, papeis);
      const numeroId = numero.id;
      const item = itens.find((i) => i.number_id === numeroId) ?? null;
      return json({ item, integration_key: key, avisos });
    }

    // Número do próprio cliente + se é da equipe de quem pede (closer/recepção:
    // dono; central: número central) ou gestão. Antes: "tem override".
    const meuNumero = async (numberId: string, permitirGestao: boolean) => {
      const { data, error } = await admin
        .from("whatsapp_numbers")
        .select("id, phone_number_id, tenant_id, mundo, dono_user_id")
        .eq("id", numberId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      falhou("ler número", error);
      if (!data) return { numero: null, meu: false };
      const meu = numeroEhDaEquipe(data as any, userId, papeis) || (permitirGestao && ehGestao(papeis));
      return { numero: data as any, meu };
    };

    // Marcar/desmarcar coexistência à mão. A detecção automática acontece na
    // conexão, mas números conectados antes dela ficaram sem a marca — e só quem
    // opera sabe se o número também é usado no celular. A marca muda a tela: em
    // coexistência a Cloud API não faz chamadas, então os botões de ligar e de
    // pedir permissão somem e fica só a telefonia.
    if (action === "set_coexistence") {
      const numberId = String((body as any).number_id ?? "");
      const valor = (body as any).is_coexistence === true;
      if (!numberId) return json({ error: "number_id é obrigatório" }, 400);

      // crc/gerente/superadmin marcam em qualquer número do cliente (como antes).
      const privilegiado = papeis.some((p) => ["crc", "gerente", "superadmin"].includes(p));
      const { numero, meu } = await meuNumero(numberId, true);
      if (!numero) return json({ error: "Número não encontrado" }, 404);
      if (!meu && !privilegiado) return json({ error: "Este número não é da sua equipe" }, 403);

      const { error } = await admin
        .from("whatsapp_numbers")
        .update({ is_coexistence: valor, updated_at: new Date().toISOString() })
        .eq("id", numberId)
        .eq("tenant_id", tenantId);
      falhou("marcar coexistência", error);

      return json({ ok: true, is_coexistence: valor });
    }

    if (action === "disconnect") {
      const numberId = String((body as any).number_id ?? "");
      if (!numberId) return json({ error: "number_id é obrigatório" }, 400);

      const { numero, meu } = await meuNumero(numberId, true);
      if (!numero) return json({ error: "Número não encontrado" }, 404);
      if (!meu) return json({ error: "Este número não é da sua equipe" }, 403);

      // A integração é achada pelo phone_number_id (antes: só `whatsapp_<id>`).
      // O número principal da clínica (chave herdada whatsapp_config) não sai
      // por aqui: é a conta legada da qual o resto do sistema depende.
      const intg = integracaoDoPnid(await integracoesDoTenant(admin, tenantId), numero.phone_number_id);
      if (intg?.key === "whatsapp_config") {
        return json({ error: "Este é o número principal da clínica; troque-o pela tela de Integrações." }, 400);
      }
      const chave = intg?.key ?? `whatsapp_${numero.phone_number_id}`;

      // Excluir de verdade: remove a integração e o vínculo de funil. O número
      // fica inativo (histórico): equipe, dono e conversas continuam visíveis.
      const { error: erroCanal } = await admin.from("funnel_channels").delete().eq("tenant_id", tenantId)
        .eq("channel_config->>integration_key", chave);
      falhou("desvincular funil", erroCanal);
      const { error: erroIntg } = await admin.from("integrations").delete().eq("tenant_id", tenantId).eq("key", chave);
      falhou("remover integração", erroIntg);

      const { error: erroNum } = await admin
        .from("whatsapp_numbers")
        .update({ is_active: false, is_default: false, updated_at: new Date().toISOString() })
        .eq("id", numberId)
        .eq("tenant_id", tenantId);
      falhou("desativar número", erroNum);

      return json({ ok: true });
    }
    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    console.error("[minha-conexao-whatsapp] erro:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

// API de Conversões da Meta — worker da fila meta_capi_events.
//
// O que faz: pega os eventos pendentes que os gatilhos do banco enfileiraram
// (LeadSubmitted / QualifiedLead / InitiateCheckout / Purchase), monta a carga
// no formato da Meta e faz POST em graph.facebook.com/<versão>/<dataset>/events.
//
// Dois modos de casamento, decididos por lead:
//   • business_messaging — lead com ctwa_clid (veio de anúncio de clique-para-
//     WhatsApp). É o que permite otimizar campanhas de WhatsApp por agendamento/
//     contrato. Exige o ID da conta do WhatsApp Business (WABA) do número.
//   • crm (system_generated) — lead sem ctwa_clid (site, Google, Instagram):
//     evento de CRM casado por telefone/nome/cidade em hash SHA-256.
//
// Ações (campo "action" do corpo):
//   • processar         — cron (x-cron-secret) ou service_role. Padrão.
//   • testar            — usuário logado (crc/gerente/superadmin): manda um evento
//                         de teste com test_event_code e devolve a resposta crua.
//   • descobrir_dataset — usuário logado: GET /{waba}/dataset com o token do
//                         cliente, para achar o conjunto de dados ligado ao número.
//   • criar_dataset     — usuário logado: POST /{waba}/dataset (cria ou devolve).
//
// O token NUNCA sai daqui: nem no log, nem na resposta.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";
import { resolveCaller } from "../_shared/authz.ts";
import { escopoLegado } from "../_shared/wabaEscopo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const GRAPH_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const LOTE = 50;
const MAX_TENTATIVAS = 6;
// A Meta recusa evento com event_time de mais de 7 dias; paramos um pouco antes.
const JANELA_MAX_MS = 6.5 * 24 * 60 * 60 * 1000;

type Config = {
  tenant_id: string;
  enabled: boolean;
  dataset_id: string | null;
  access_token: string | null;
  waba_id: string | null;
  test_event_code: string | null;
  event_source_url?: string | null;
  send_crm_events: boolean;
  send_lead_event: boolean;
  partner_agent: string | null;
};

type Evento = {
  id: string;
  tenant_id: string;
  lead_id: string;
  event_name: string;
  event_id: string;
  event_time: string;
  origem: string | null;
  value: number | string | null;
  currency: string | null;
  attempts: number;
};

type Lead = {
  id: string;
  tenant_id: string;
  name: string | null;
  phone: string | null;
  cidade: string | null;
  ctwa_clid: string | null;
  whatsapp_number_id: string | null;
  active_channel: string | null;
};

type Modo = "business_messaging" | "crm";

type RespostaGraph = {
  ok: boolean;
  http: number;
  body: any;
};

// ------------------------------------------------------------------ utilidades

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Variantes do telefone para o hash `ph`. crm_leads.phone é canônico
 * "55<DDD><8 dígitos>" com o 9º dígito REMOVIDO (trigger normalize_lead_phone);
 * a Meta espera o número real. Mandamos as duas formas: a canônica e a com o 9
 * (celular tem o resto começando em 6–9).
 */
function variantesTelefone(phone: string | null): string[] {
  const d = (phone || "").replace(/\D/g, "");
  if (!d) return [];
  const out = new Set<string>([d]);
  let nacional = d;
  if (nacional.startsWith("55") && nacional.length >= 12) nacional = nacional.slice(2);
  if (nacional.length === 10) {
    const ddd = nacional.slice(0, 2);
    const resto = nacional.slice(2);
    if (/^[6-9]/.test(resto)) out.add("55" + ddd + "9" + resto);
  } else if (nacional.length === 11 && nacional[2] === "9") {
    out.add("55" + nacional.slice(0, 2) + nacional.slice(3));
  }
  return Array.from(out);
}

async function hashes(valores: string[]): Promise<string[]> {
  return Promise.all(valores.map((v) => sha256(v)));
}

function unix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Resposta da Graph sem nunca ecoar o token. */
async function chamarGraph(url: string, init: RequestInit): Promise<RespostaGraph> {
  try {
    const r = await fetch(url, init);
    const texto = await r.text();
    let body: any = null;
    try { body = texto ? JSON.parse(texto) : null; } catch { body = { raw: texto.slice(0, 500) }; }
    return { ok: r.ok, http: r.status, body };
  } catch (e) {
    return { ok: false, http: 0, body: { error: { message: String((e as Error)?.message || e), is_transient: true } } };
  }
}

function erroDaMeta(resp: RespostaGraph): { mensagem: string; transiente: boolean; ctwaInvalido: boolean } {
  const err = resp.body?.error || {};
  const mensagem = [err.error_user_title, err.error_user_msg || err.message, err.code ? `código ${err.code}` : null,
    err.error_subcode ? `sub ${err.error_subcode}` : null]
    .filter(Boolean).join(" — ") || `HTTP ${resp.http}`;
  const transiente = resp.http === 0 || resp.http === 429 || resp.http >= 500 || err.is_transient === true;
  // 2804087 = ctwa_clid inválido/expirado; 2804132 = o conjunto de dados não
  // tem conta do WhatsApp vinculada (o evento de mensagem não cabe ali). Nos
  // dois casos o evento ainda vale como evento de CRM casado por telefone.
  const ctwaInvalido = err.error_subcode === 2804087 || err.error_subcode === 2804132
    || /ctwa/i.test(String(err.error_user_title || err.message || ""));
  return { mensagem: mensagem.slice(0, 500), transiente, ctwaInvalido };
}

// ----------------------------------------------------------- credenciais/WABA

async function wabaDoLead(admin: any, lead: Lead, cfg: Config): Promise<string | null> {
  if (lead.whatsapp_number_id) {
    const { data } = await admin
      .from("whatsapp_numbers")
      .select("waba_id")
      .eq("id", lead.whatsapp_number_id)
      .eq("tenant_id", lead.tenant_id)
      .maybeSingle();
    if (data?.waba_id) return String(data.waba_id);
  }
  if (cfg.waba_id) return cfg.waba_id;
  try {
    const escopo = await escopoLegado(admin, lead.tenant_id);
    if (escopo?.wabaId) return escopo.wabaId;
  } catch (_) { /* segue para a env */ }
  return Deno.env.get("WABA_ID") || null;
}

/** Token com escopo de WhatsApp do cliente (para a API de conjuntos de dados). */
async function tokenWhatsappDoTenant(admin: any, tenantId: string): Promise<string | null> {
  try {
    const escopo = await escopoLegado(admin, tenantId);
    if (escopo?.token) return escopo.token;
  } catch (_) { /* segue */ }
  return Deno.env.get("WHATSAPP_TOKEN") || null;
}

// ---------------------------------------------------------------- a carga

async function userDataCrm(lead: Lead): Promise<Record<string, unknown>> {
  const ud: Record<string, unknown> = {};
  const ph = await hashes(variantesTelefone(lead.phone));
  if (ph.length) ud.ph = ph;
  const primeiroNome = semAcento(String(lead.name || "").trim().split(/\s+/)[0] || "").toLowerCase();
  if (primeiroNome && !/^lead\b/i.test(primeiroNome) && primeiroNome.length >= 2) ud.fn = [await sha256(primeiroNome)];
  const cidade = semAcento(String(lead.cidade || "")).toLowerCase().replace(/[^a-z]/g, "");
  if (cidade) ud.ct = [await sha256(cidade)];
  ud.country = [await sha256("br")];
  return ud;
}

async function montarEvento(ev: Evento, lead: Lead, modo: Modo, waba: string | null, cfg: Config) {
  const evento: Record<string, unknown> = {
    event_name: ev.event_name,
    event_time: unix(ev.event_time),
    event_id: ev.event_id,
  };
  const custom: Record<string, unknown> = {};
  if (ev.event_name === "Purchase" || (ev.value != null && Number(ev.value) > 0)) {
    custom.currency = ev.currency || "BRL";
    custom.value = Math.max(0, Number(ev.value || 0));
  }
  if (modo === "business_messaging") {
    evento.action_source = "business_messaging";
    evento.messaging_channel = "whatsapp";
    const ud: Record<string, unknown> = {
      whatsapp_business_account_id: waba,
      ctwa_clid: lead.ctwa_clid,
    };
    const ph = await hashes(variantesTelefone(lead.phone));
    if (ph.length) ud.ph = ph;
    evento.user_data = ud;
  } else {
    evento.action_source = "system_generated";
    // Conjunto de dados em categoria restrita (saúde) bloqueia evento de servidor
    // sem event_source_url — regra da empresa, vista no Diagnóstico em 23/09.
    // SÓ no modo CRM: a Meta recusa event_source_url em business_messaging
    // (subcódigo 2804064, visto no primeiro lead real).
    if (cfg.event_source_url) evento.event_source_url = cfg.event_source_url;
    custom.event_source = "crm";
    custom.lead_event_source = "CRClin";
    evento.user_data = await userDataCrm(lead);
  }
  if (Object.keys(custom).length) evento.custom_data = custom;

  const corpo: Record<string, unknown> = {
    data: [evento],
    partner_agent: cfg.partner_agent || "crclin",
  };
  if (cfg.test_event_code) corpo.test_event_code = cfg.test_event_code;
  return corpo;
}

async function enviar(cfg: Config, corpo: Record<string, unknown>): Promise<RespostaGraph> {
  return chamarGraph(`${GRAPH}/${cfg.dataset_id}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...corpo, access_token: cfg.access_token }),
  });
}

// ------------------------------------------------------------- processar

async function processar(admin: any) {
  const relatorio = { pegos: 0, enviados: 0, falhas: 0, reagendados: 0, pulados: 0, erros: [] as string[] };

  const { data: eventos, error: errClaim } = await admin.rpc("meta_capi_claim", { p_limite: LOTE });
  if (errClaim) throw new Error(`meta_capi_claim: ${errClaim.message}`);
  const fila: Evento[] = eventos ?? [];
  relatorio.pegos = fila.length;
  if (!fila.length) return relatorio;

  const tenantIds = Array.from(new Set(fila.map((e) => e.tenant_id)));
  const { data: cfgRows } = await admin.from("meta_capi_config").select("*").in("tenant_id", tenantIds);
  const configs = new Map<string, Config>();
  for (const c of (cfgRows ?? []) as Config[]) configs.set(c.tenant_id, c);

  for (const ev of fila) {
    const marcar = async (patch: Record<string, unknown>) => {
      await admin.from("meta_capi_events").update(patch).eq("id", ev.id);
    };
    try {
      const cfg = configs.get(ev.tenant_id);
      if (!cfg || !cfg.enabled || !cfg.dataset_id || !cfg.access_token) {
        relatorio.pulados++;
        await marcar({ status: "skipped", last_error: "API de Conversões desligada ou sem conjunto de dados/token" });
        continue;
      }
      if (Date.now() - new Date(ev.event_time).getTime() > JANELA_MAX_MS) {
        relatorio.falhas++;
        await marcar({ status: "failed", last_error: "Expirado: a Meta só aceita evento com até 7 dias" });
        continue;
      }
      const { data: lead } = await admin
        .from("crm_leads")
        .select("id, tenant_id, name, phone, cidade, ctwa_clid, whatsapp_number_id, active_channel")
        .eq("id", ev.lead_id)
        .eq("tenant_id", ev.tenant_id)
        .maybeSingle();
      if (!lead) {
        relatorio.pulados++;
        await marcar({ status: "skipped", last_error: "Lead não existe mais" });
        continue;
      }

      const podeBm = !!lead.ctwa_clid && lead.active_channel !== "instagram";
      let modo: Modo = podeBm ? "business_messaging" : "crm";
      let waba: string | null = null;
      if (modo === "business_messaging") {
        waba = await wabaDoLead(admin, lead as Lead, cfg);
        if (!waba) modo = "crm";
      }
      if (modo === "crm" && !cfg.send_crm_events) {
        relatorio.pulados++;
        await marcar({ status: "skipped", modo, last_error: podeBm
          ? "Sem ID da conta do WhatsApp Business (WABA) para o número do lead"
          : "Lead sem ctwa_clid e envio de eventos de CRM desligado" });
        continue;
      }

      let corpo = await montarEvento(ev, lead as Lead, modo, waba, cfg);
      let resp = await enviar(cfg, corpo);

      // ctwa_clid recusado (expirado/inválido): cai para o casamento por telefone.
      if (!resp.ok && modo === "business_messaging" && erroDaMeta(resp).ctwaInvalido && cfg.send_crm_events) {
        modo = "crm";
        corpo = await montarEvento(ev, lead as Lead, modo, null, cfg);
        resp = await enviar(cfg, corpo);
      }

      if (resp.ok) {
        relatorio.enviados++;
        await marcar({
          status: "sent", modo, sent_at: new Date().toISOString(), last_error: null,
          attempts: (ev.attempts || 0) + 1,
          response: { events_received: resp.body?.events_received ?? null, fbtrace_id: resp.body?.fbtrace_id ?? null,
            messages: resp.body?.messages ?? null, teste: !!cfg.test_event_code },
        });
        continue;
      }

      const erro = erroDaMeta(resp);
      const tentativas = (ev.attempts || 0) + 1;
      const desiste = !erro.transiente || tentativas >= MAX_TENTATIVAS;
      if (desiste) {
        relatorio.falhas++;
        await marcar({ status: "failed", modo, attempts: tentativas, last_error: erro.mensagem,
          response: { http: resp.http, error: resp.body?.error ?? null } });
      } else {
        relatorio.reagendados++;
        const atrasoMin = Math.min(60, 2 ** tentativas);
        await marcar({ status: "pending", modo, attempts: tentativas, last_error: erro.mensagem,
          next_attempt_at: new Date(Date.now() + atrasoMin * 60_000).toISOString(),
          response: { http: resp.http, error: resp.body?.error ?? null } });
      }
    } catch (e) {
      const msg = String((e as Error)?.message || e).slice(0, 500);
      relatorio.erros.push(`${ev.id}: ${msg}`);
      try {
        await marcar({ status: "pending", attempts: (ev.attempts || 0) + 1, last_error: msg,
          next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() });
      } catch (_) { /* fica em processing; o claim solta em 10 min */ }
    }
  }
  return relatorio;
}

// ------------------------------------------------------- ações da tela

async function lerConfig(admin: any, tenantId: string): Promise<Config | null> {
  const { data } = await admin.from("meta_capi_config").select("*").eq("tenant_id", tenantId).maybeSingle();
  return (data as Config) ?? null;
}

async function acaoTestar(admin: any, tenantId: string, body: any) {
  const cfg = await lerConfig(admin, tenantId);
  if (!cfg?.dataset_id || !cfg?.access_token) {
    return json(400, { ok: false, erro: "Salve o conjunto de dados e o token antes de testar." });
  }
  const codigo = String(body?.test_event_code || cfg.test_event_code || "").trim();
  if (!codigo) {
    return json(400, { ok: false, erro: "Informe o código de teste (aba Eventos de teste do Gerenciador de Eventos)." });
  }
  const cfgTeste: Config = { ...cfg, test_event_code: codigo };
  const agora = new Date().toISOString();
  let lead: Lead | null = null;
  if (body?.lead_id) {
    const { data } = await admin
      .from("crm_leads")
      .select("id, tenant_id, name, phone, cidade, ctwa_clid, whatsapp_number_id, active_channel")
      .eq("id", String(body.lead_id)).eq("tenant_id", tenantId).maybeSingle();
    lead = (data as Lead) ?? null;
  }
  if (!lead) {
    lead = { id: "teste", tenant_id: tenantId, name: "Teste CRClin", phone: "5577999990000",
      cidade: "Vitória da Conquista", ctwa_clid: null, whatsapp_number_id: null, active_channel: "whatsapp" };
  }
  const modo: Modo = lead.ctwa_clid ? "business_messaging" : "crm";
  const waba = modo === "business_messaging" ? await wabaDoLead(admin, lead, cfg) : null;
  const ev: Evento = { id: "teste", tenant_id: tenantId, lead_id: lead.id, event_name: String(body?.event_name || "QualifiedLead"),
    event_id: `teste-${Date.now()}`, event_time: agora, origem: "teste", value: body?.value ?? null, currency: "BRL", attempts: 0 };
  const corpo = await montarEvento(ev, lead, modo, waba, cfgTeste);
  const resp = await enviar(cfgTeste, corpo);
  return json(200, {
    ok: resp.ok, http: resp.http, modo, waba_id: waba, test_event_code: codigo,
    carga: corpo, resposta: resp.body,
    erro: resp.ok ? null : erroDaMeta(resp).mensagem,
  });
}

async function acaoDataset(admin: any, tenantId: string, criar: boolean) {
  const cfg = await lerConfig(admin, tenantId);
  let waba = cfg?.waba_id || null;
  if (!waba) {
    try { waba = (await escopoLegado(admin, tenantId))?.wabaId || null; } catch (_) { waba = null; }
  }
  if (!waba) waba = Deno.env.get("WABA_ID") || null;
  if (!waba) return json(400, { ok: false, erro: "Sem ID da conta do WhatsApp Business (WABA). Preencha o campo e salve." });

  // Token: o da CAPI se já foi colado; senão o do WhatsApp do cliente.
  const token = cfg?.access_token || (await tokenWhatsappDoTenant(admin, tenantId));
  if (!token) return json(400, { ok: false, erro: "Sem token para consultar a Meta." });

  const url = `${GRAPH}/${waba}/dataset`;
  const resp = criar
    ? await chamarGraph(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token }) })
    : await chamarGraph(`${url}?access_token=${encodeURIComponent(token)}`, { method: "GET" });

  const datasets: string[] = [];
  if (Array.isArray(resp.body?.data)) for (const d of resp.body.data) if (d?.id) datasets.push(String(d.id));
  if (resp.body?.id) datasets.push(String(resp.body.id));
  return json(200, {
    ok: resp.ok, http: resp.http, waba_id: waba, datasets,
    erro: resp.ok ? null : erroDaMeta(resp).mensagem,
    resposta: resp.ok ? resp.body : { error: resp.body?.error ?? resp.body },
  });
}

// ------------------------------------------------------------------- HTTP

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body?.action || "processar");

  if (action === "processar") {
    const auth = await authorizeInternal(req, admin, { cronSecretName: "automation_cron_token" });
    if (!auth.ok) return unauthorizedResponse(corsHeaders);
    try {
      const relatorio = await processar(admin);
      if (relatorio.pegos > 0) console.log(`[meta-capi] ${JSON.stringify(relatorio)}`);
      return json(200, { ok: true, ...relatorio });
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      console.error(`[meta-capi] erro: ${msg}`);
      return json(500, { ok: false, erro: msg });
    }
  }

  // Ações da tela: usuário logado com papel de gestão, sempre no próprio tenant.
  const ctx = await resolveCaller(req, admin);
  if (!ctx.ok) return json(ctx.status, { ok: false, erro: ctx.error });
  const roles: string[] = (ctx as any).roles ?? [];
  const podeGerir = !ctx.isServiceRole && !!ctx.tenantId
    && (ctx.isSuperadmin || roles.includes("crc") || roles.includes("gerente"));
  if (!podeGerir) return json(403, { ok: false, erro: "Sem permissão para a API de Conversões" });
  const tenantId = ctx.tenantId as string;

  try {
    if (action === "testar") return await acaoTestar(admin, tenantId, body);
    if (action === "descobrir_dataset") return await acaoDataset(admin, tenantId, false);
    if (action === "criar_dataset") return await acaoDataset(admin, tenantId, true);
    return json(400, { ok: false, erro: `Ação desconhecida: ${action}` });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error(`[meta-capi] ${action}: ${msg}`);
    return json(500, { ok: false, erro: msg });
  }
});

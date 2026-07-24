// @ts-nocheck
// Admin API multi-tenant do CRClin — autenticada por API Key (Bearer/x-api-key).
// Routes: /leads, /leads/:id, /leads/:id/messages, /leads/:id/send,
//         /conversations, /appointments, /tasks, /reports/overview,
//         /reports/funnel, /reports/by-source, /reports/financeiro
// Regras canônicas dos relatórios: datas em America/Bahia (períodos inclusivos),
// FATURAMENTO = soma de pagamentos por data_pagamento, CONTRATADO = paciente
// cujo PRIMEIRO pagamento cai no período (nunca crm_leads.value/updated_at).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { safeEqual } from "../_shared/authz.ts";
import {
  BAHIA_TZ,
  addDays,
  assertDay,
  businessDaysBetween,
  chunk,
  fetchAllPaged,
  normalizeCidadeKey,
  rangeBahia,
  SEM_CIDADE,
  todayBahia,
} from "../_shared/reporting.ts";

const RIZODENT_TENANT_ID = "00000000-0000-0000-0000-000000000010"; // Rizodent (legacy default)
// O tenant é resolvido POR REQUEST em resolveTenantFromAuth e passado como
// parâmetro para cada handler — nunca guardar em variável de módulo (handlers
// concorrentes de tenants diferentes causariam race condition).
// Resolve dinamicamente a partir da chave: RIZODENT_ADMIN_API_KEY -> Rizodent;
// senão procura em `tenant_api_keys` (active=true) e usa o tenant_id da linha.

const ALLOWED_ORIGINS = [
  "https://crclin.com.br",
  "https://www.crclin.com.br",
  "https://app.crclin.com.br",
  "https://rizodent-gestao.lovable.app",
  "https://id-preview--776b814b-ba0d-4aab-a78f-ae5953dabe2a.lovable.app",
];
// `cors` é reatribuído no início de cada request (Deno.serve) para refletir a Origin permitida.
let cors: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "X-Admin-API-Version": "relatorios-canonicos-2026-07-08",
};
function buildCorsFor(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "X-Admin-API-Version": "relatorios-canonicos-2026-07-08",
  };
}
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function resolveTenantFromAuth(req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  const xKey = (req.headers.get("x-api-key") || "").trim();
  const provided = token || xKey;
  if (!provided) return null;

  // 1) Rizodent legacy key — comportamento atual preservado.
  const rizoKey = Deno.env.get("RIZODENT_ADMIN_API_KEY");
  if (rizoKey) {
    if (safeEqual(token, rizoKey) || safeEqual(xKey, rizoKey)) {
      return RIZODENT_TENANT_ID;
    }
  }

  // 2) Chaves per-tenant em tenant_api_keys.
  const { data } = await admin
    .from("tenant_api_keys")
    .select("tenant_id, api_key, active")
    .eq("api_key", provided)
    .eq("active", true)
    .maybeSingle();
  if (data && (data as any).tenant_id) return (data as any).tenant_id as string;
  return null;
}

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_BASE, SR);

// Período em dias-calendário de America/Bahia, INCLUSIVO (o dia `to` entra
// inteiro, até 23:59:59.999 -03). Default: últimos 30 dias até hoje (Bahia).
// - fromDay/toDay: para colunas DATE (data_pagamento, scheduled_date).
// - gteIso/lteIso: fronteiras UTC para colunas timestamptz (created_at, ...).
function parseRange(p: URLSearchParams) {
  const toDay = assertDay((p.get("to") || todayBahia()).slice(0, 10));
  const fromDay = assertDay((p.get("from") || addDays(toDay, -30)).slice(0, 10));
  const { gteIso, lteIso } = rangeBahia(fromDay, toDay);
  return { fromDay, toDay, gteIso, lteIso };
}

async function listLeads(tenantId: string, p: URLSearchParams) {
  const limit = Math.min(parseInt(p.get("limit") || "50"), 500);
  const offset = parseInt(p.get("offset") || "0");
  const search = p.get("search");
  const stageId = p.get("stage_id");
  const pipelineId = p.get("pipeline_id");
  let q = admin.from("crm_leads")
    .select("id,name,phone,source,tags,value,pipeline_id,stage_id,assigned_to,cidade,servico_interesse,score,last_message_at,last_inbound_at,last_outbound_at,created_at,updated_at,is_blocked", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (search) {
    // Escape PostgREST .or() reserved characters to block filter injection.
    // PostgREST splits on commas and parentheses; backslashes/double-quotes also need escaping.
    const safe = search.replace(/[\\"(),]/g, " ").trim();
    if (safe) q = q.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }
  if (stageId) q = q.eq("stage_id", stageId);
  if (pipelineId) q = q.eq("pipeline_id", pipelineId);
  const { data, error, count } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ data, count, limit, offset });
}

async function getLead(tenantId: string, id: string) {
  const { data, error } = await admin.from("crm_leads").select("*")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
}

async function createLead(tenantId: string, body: any) {
  const payload = { ...body, tenant_id: tenantId };
  const { data, error } = await admin.from("crm_leads").insert(payload).select().single();
  if (error) return json({ error: error.message }, 400);
  return json(data, 201);
}

async function updateLead(tenantId: string, id: string, body: any) {
  const { tenant_id, ...rest } = body || {};
  const { data, error } = await admin.from("crm_leads").update(rest)
    .eq("tenant_id", tenantId).eq("id", id).select().maybeSingle();
  if (error) return json({ error: error.message }, 400);
  return json(data);
}

async function deleteLead(tenantId: string, id: string) {
  const { error } = await admin.from("crm_leads").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) return json({ error: error.message }, 400);
  return json({ deleted: true });
}

// Extract { bucket, path } from a Supabase storage URL (sign/public/authenticated).
function parseStorageUrl(u: string | null): { bucket: string; path: string } | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    const m = url.pathname.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
  } catch { return null; }
}

async function signMediaUrl(rawUrl: string | null, expiresIn = 3600): Promise<string | null> {
  const parsed = parseStorageUrl(rawUrl);
  if (!parsed) return rawUrl;
  const { data, error } = await admin.storage.from(parsed.bucket).createSignedUrl(parsed.path, expiresIn);
  if (error || !data) return rawUrl;
  return data.signedUrl;
}

async function leadMessages(tenantId: string, id: string, p: URLSearchParams) {
  const limit = Math.min(parseInt(p.get("limit") || "100"), 500);
  const sign = p.get("sign") !== "false"; // default true
  const expiresIn = Math.min(parseInt(p.get("expires_in") || "3600"), 60 * 60 * 24 * 7);
  const { data, error } = await admin.from("messages")
    .select("id,direction,type,content,media_url,status,transcription,created_at,channel,whatsapp_message_id")
    .eq("tenant_id", tenantId).eq("lead_id", id)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return json({ error: error.message }, 500);
  let rows = (data || []).reverse();
  if (sign) {
    rows = await Promise.all(rows.map(async (m: any) => {
      if (!m.media_url) return m;
      const signed = await signMediaUrl(m.media_url, expiresIn);
      return { ...m, media_url_signed: signed };
    }));
  }
  return json({ data: rows });
}

// Escapa curingas de LIKE/ILIKE (%, _, \) para usar valor literal no padrão.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// A mídia só pode ser assinada se pertencer ao tenant da chave: precisa existir
// uma linha em `messages` do tenant cujo media_url aponte para o mesmo
// bucket/path (pré-filtro por ILIKE + confirmação exata via parseStorageUrl).
async function mediaBelongsToTenant(tenantId: string, bucket: string, path: string): Promise<boolean> {
  const { data, error } = await admin.from("messages")
    .select("media_url")
    .eq("tenant_id", tenantId)
    .ilike("media_url", `%${escapeLike(bucket)}/${escapeLike(path)}%`)
    .limit(20);
  if (error) throw new Error(error.message);
  return (data || []).some((m: any) => {
    const parsed = parseStorageUrl(m.media_url);
    return parsed && parsed.bucket === bucket && parsed.path === path;
  });
}

async function mediaSign(tenantId: string, p: URLSearchParams, body: any) {
  const url = p.get("url") || body?.url;
  const bucket = p.get("bucket") || body?.bucket;
  const path = p.get("path") || body?.path;
  const expiresIn = Math.min(parseInt(p.get("expires_in") || body?.expires_in || "3600"), 60 * 60 * 24 * 7);
  let b = bucket, pa = path;
  if (!b || !pa) {
    const parsed = parseStorageUrl(url);
    if (!parsed) return json({ error: "provide ?url= or ?bucket=&path=" }, 400);
    b = parsed.bucket; pa = parsed.path;
  }
  // Isolamento de tenant: nunca assinar mídia que não pertença ao tenant da
  // chave (sem isso, uma 2ª chave per-tenant poderia assinar mídia alheia).
  if (!(await mediaBelongsToTenant(tenantId, b!, pa!))) {
    return json({ error: "not_found" }, 404);
  }
  const { data, error } = await admin.storage.from(b!).createSignedUrl(pa!, expiresIn);
  if (error) return json({ error: error.message }, 400);
  return json({ bucket: b, path: pa, signed_url: data.signedUrl, expires_in: expiresIn });
}

async function mediaDownload(tenantId: string, messageId: string) {
  const { data: msg, error } = await admin.from("messages")
    .select("id,media_url,type,tenant_id").eq("tenant_id", tenantId).eq("id", messageId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!msg || !msg.media_url) return json({ error: "not_found" }, 404);
  const parsed = parseStorageUrl(msg.media_url);
  if (!parsed) {
    // External URL — just redirect.
    return new Response(null, { status: 302, headers: { ...cors, Location: msg.media_url } });
  }
  const { data: file, error: dErr } = await admin.storage.from(parsed.bucket).download(parsed.path);
  if (dErr || !file) return json({ error: dErr?.message || "download_failed" }, 500);
  const ext = parsed.path.split(".").pop() || "bin";
  const filename = `${msg.id}.${ext}`;
  return new Response(file, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": file.type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function sendMessage(tenantId: string, id: string, body: any) {
  // Isolamento de tenant: o lead precisa pertencer ao tenant da chave antes
  // do proxy (sem isso, uma 2ª chave per-tenant dispararia WhatsApp em lead alheio).
  const { data: lead, error: leadErr } = await admin.from("crm_leads")
    .select("id, phone").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (leadErr) return json({ error: leadErr.message }, 500);
  if (!lead) return json({ error: "not_found" }, 404);
  // Proxy to send-whatsapp-message function using service role.
  // send-whatsapp-message exige `to` (telefone) — usa o do body ou o do lead.
  const res = await fetch(`${URL_BASE}/functions/v1/send-whatsapp-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SR}`,
      "apikey": SR,
    },
    body: JSON.stringify({ lead_id: id, ...body, to: (body?.to || (lead as any).phone) }),
  });
  const txt = await res.text();
  try { return json(JSON.parse(txt), res.status); } catch { return new Response(txt, { status: res.status, headers: cors }); }
}

// Base de leads "aguardando resposta" — usa last_relevant_inbound calculado
// via messages (WhatsApp + Direct), IGNORANDO comentários do Instagram
// (instagram_comment_id NOT NULL). O CRM continua atualizando last_inbound_at
// com comentários — por isso NÃO usamos essa coluna aqui.
async function fetchUnreadBase(tenantId: string): Promise<any[]> {
  const { data, error } = await admin.rpc("admin_api_unread_leads_base", { _tenant: tenantId });
  if (error) throw new Error(error.message);
  return (data as any[]) || [];
}

async function conversations(tenantId: string, p: URLSearchParams) {
  const limit = Math.min(parseInt(p.get("limit") || "50"), 200);
  const unreadOnly = p.get("unread") === "true";
  if (unreadOnly) {
    const rows = await fetchUnreadBase(tenantId);
    rows.sort((a: any, b: any) =>
      String(b.last_message_at || "").localeCompare(String(a.last_message_at || "")));
    // Mantém o mesmo shape das versões anteriores (last_inbound_at) para o
    // consumidor; expõe também last_relevant_inbound.
    const out = rows.slice(0, limit).map((l: any) => ({
      id: l.id, name: l.name, phone: l.phone,
      last_message_at: l.last_message_at,
      last_inbound_at: l.last_relevant_inbound,
      last_relevant_inbound: l.last_relevant_inbound,
      last_outbound_at: l.last_outbound_at,
      stage_id: l.stage_id, assigned_to: l.assigned_to,
    }));
    return json({ data: out });
  }
  const { data, error } = await admin.from("crm_leads")
    .select("id,name,phone,last_message_at,last_inbound_at,last_outbound_at,stage_id,assigned_to")
    .eq("tenant_id", tenantId)
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);
  return json({ data: data || [] });
}

async function conversationsUnreadCount(tenantId: string) {
  // Endpoint LEVE p/ o dashboard consultar a cada minuto. Regra: COMENTÁRIO
  // do Instagram NÃO conta como conversa. Base = last_relevant_inbound
  // (max created_at de messages inbound não deletadas SEM instagram_comment_id).
  const unread = await fetchUnreadBase(tenantId);

  // Mapa stage_id → é pós-venda? Identifica pipeline pelo nome (case+acentos insensitive).
  const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const { data: pipelines } = await admin.from("crm_pipelines").select("id,name").eq("tenant_id", tenantId);
  const posVendaPipelineIds = new Set((pipelines || []).filter((p: any) => norm(p.name).startsWith("pos-venda") || norm(p.name).startsWith("pos venda") || norm(p.name) === "posvenda").map((p: any) => p.id));
  const { data: stages } = await admin.from("crm_stages").select("id,pipeline_id").eq("tenant_id", tenantId);
  const posVendaStageIds = new Set((stages || []).filter((s: any) => posVendaPipelineIds.has(s.pipeline_id)).map((s: any) => s.id));

  let wa = 0, ig = 0, comercial = 0, pos_venda = 0;
  let maisAntigoComercial: string | null = null;
  let maisAntigoPosVenda: string | null = null;
  const porCidade = new Map<string, number>();
  for (const l of unread) {
    const rel = l.last_relevant_inbound as string | null;
    if (l.stage_id && posVendaStageIds.has(l.stage_id)) {
      pos_venda++;
      if (rel && (!maisAntigoPosVenda || rel < maisAntigoPosVenda)) {
        maisAntigoPosVenda = rel;
      }
      continue;
    }
    comercial++;
    if (rel && (!maisAntigoComercial || rel < maisAntigoComercial)) {
      maisAntigoComercial = rel;
    }
    if (l.instagram_user_id) ig++; else wa++;
    const cidade = (l.cidade && String(l.cidade).trim()) || "SEM_CIDADE";
    porCidade.set(cidade, (porCidade.get(cidade) || 0) + 1);
  }
  const por_unidade = Array.from(porCidade.entries())
    .map(([cidade, count]) => ({ cidade, count }))
    .sort((a, b) => b.count - a.count);
  return json({
    total: unread.length,
    comercial,
    pos_venda,
    mais_antigo_comercial: maisAntigoComercial,
    mais_antigo_pos_venda: maisAntigoPosVenda,
    por_canal: { whatsapp: wa, instagram: ig },
    por_unidade,
  });

}


async function appointments(tenantId: string, method: string, p: URLSearchParams, body: any, id?: string) {
  if (method === "GET") {
    // crm_appointments usa scheduled_date (DATE) — não existe scheduled_at.
    const { fromDay, toDay } = parseRange(p);
    const data = await fetchAllPaged<any>(
      () => admin.from("crm_appointments").select("*")
        .eq("tenant_id", tenantId).gte("scheduled_date", fromDay).lte("scheduled_date", toDay),
      "id",
    );
    data.sort((a: any, b: any) =>
      `${a.scheduled_date}T${a.scheduled_time || ""}`.localeCompare(`${b.scheduled_date}T${b.scheduled_time || ""}`));
    return json({ data });
  }
  if (method === "POST") {
    const { data, error } = await admin.from("crm_appointments")
      .insert({ ...body, tenant_id: tenantId }).select().single();
    if (error) return json({ error: error.message }, 400);
    return json(data, 201);
  }
  if (method === "PATCH" && id) {
    const { data, error } = await admin.from("crm_appointments").update(body)
      .eq("tenant_id", tenantId).eq("id", id).select().maybeSingle();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }
  return json({ error: "method_not_allowed" }, 405);
}

async function tasks(tenantId: string, method: string, p: URLSearchParams, body: any, id?: string) {
  if (method === "GET") {
    const status = p.get("status");
    let q = admin.from("crm_tasks").select("*").eq("tenant_id", tenantId)
      .order("scheduled_at", { ascending: true }).limit(500);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ data });
  }
  if (method === "POST") {
    const { data, error } = await admin.from("crm_tasks")
      .insert({ ...body, tenant_id: tenantId }).select().single();
    if (error) return json({ error: error.message }, 400);
    return json(data, 201);
  }
  if (method === "PATCH" && id) {
    const { data, error } = await admin.from("crm_tasks").update(body)
      .eq("tenant_id", tenantId).eq("id", id).select().maybeSingle();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }
  return json({ error: "method_not_allowed" }, 405);
}

// ===== Definição canônica de CONTRATADO =====
// Paciente cujo PRIMEIRO pagamento no tenant (todas as clínicas, sem recorte
// de período) cai dentro do período. Nunca usa updated_at nem crm_leads.value.
async function contratadosCanonicos(
  clinicaIds: string[],
  fromDay: string,
  toDay: string,
): Promise<{ paciente_id: string; clinica_id: string | null; primeiro_pagamento: string }[]> {
  if (!clinicaIds.length) return [];
  // pagamentos NÃO tem tenant_id — o escopo vem de clinica_id ∈ clinicas do tenant.
  // Pagamentos marcados como recorrência de ortodontia não contam como
  // "início de tratamento" (regra oficial de 07/2026): excluímos da lista
  // usada para determinar o primeiro pagamento do paciente.
  const noPeriodo = await fetchAllPaged<any>(
    () => admin.from("pagamentos")
      .select("id, paciente_id, clinica_id, data_pagamento, created_at")
      .in("clinica_id", clinicaIds)
      .eq("recorrencia_orto", false)
      .gte("data_pagamento", fromDay).lte("data_pagamento", toDay),
    "id",
  );
  // Primeiro pagamento do período por paciente (desempate determinístico por
  // data_pagamento, created_at, id — mesmo critério da RPC rpt_contratados).
  const keyOf = (r: any) => `${r.data_pagamento}|${r.created_at}|${r.id}`;
  const primeiroPorPaciente = new Map<string, any>();
  for (const r of noPeriodo) {
    if (!r.paciente_id) continue;
    const atual = primeiroPorPaciente.get(r.paciente_id);
    if (!atual || keyOf(r) < keyOf(atual)) primeiroPorPaciente.set(r.paciente_id, r);
  }
  if (!primeiroPorPaciente.size) return [];
  // Exclui quem já tinha pagamento ANTES do período (em qualquer clínica do tenant).
  const comPagamentoAnterior = new Set<string>();
  for (const ids of chunk([...primeiroPorPaciente.keys()], 150)) {
    const prev = await fetchAllPaged<any>(
      () => admin.from("pagamentos").select("id, paciente_id")
        .in("clinica_id", clinicaIds).in("paciente_id", ids)
        .eq("recorrencia_orto", false)
        .lt("data_pagamento", fromDay),
      "id",
    );
    for (const r of prev) comPagamentoAnterior.add(r.paciente_id);
  }
  const out: { paciente_id: string; clinica_id: string | null; primeiro_pagamento: string }[] = [];
  for (const [pid, r] of primeiroPorPaciente) {
    if (comPagamentoAnterior.has(pid)) continue;
    out.push({ paciente_id: pid, clinica_id: r.clinica_id ?? null, primeiro_pagamento: r.data_pagamento });
  }
  return out;
}

// ===== /reports/financeiro =====
async function reportFinanceiro(tenantId: string, p: URLSearchParams) {
  // Defaults no dia-calendário de America/Bahia (não no relógio UTC do servidor):
  // mês atual completo; "ontem" também é calculado na Bahia.
  const hoje = todayBahia();
  const [hy, hm] = hoje.split("-").map(Number);
  const firstOfMonth = `${hoje.slice(0, 8)}01`;
  const lastOfMonth = new Date(Date.UTC(hy, hm, 0)).toISOString().slice(0, 10);
  const from = assertDay((p.get("from") || firstOfMonth).slice(0, 10));
  const to = assertDay((p.get("to") || lastOfMonth).slice(0, 10));
  const clinicaId = p.get("clinica");

  // Clínicas do TENANT (inclui inativas para atribuir pagamentos antigos ao
  // nome real da clínica — nada de strings chumbadas).
  const clinRes = await admin.from("clinicas")
    .select("id, nome, cidade, ativa").eq("tenant_id", tenantId);
  if (clinRes.error) return json({ error: clinRes.error.message }, 500);
  const clinicas = (clinRes.data || []) as any[];
  const clinicaIds = clinicas.map((c) => c.id as string);
  // O filtro ?clinica= só vale se a clínica pertencer ao tenant.
  const pagClinicaIds = clinicaId ? clinicaIds.filter((cid) => cid === clinicaId) : clinicaIds;

  // pagamentos do tenant (a tabela NÃO tem tenant_id — escopo via clinica_id
  // ∈ clinicas do tenant), paginando além do cap de 1000 linhas do PostgREST.
  // Regra oficial (conciliada com o Dontus em 07/2026): pagamentos marcados
  // como recorrência de ortodontia (recorrencia_orto=true) NÃO entram nos
  // agregados de faturamento — só o início de tratamento (panorâmica/aparelho
  // no dia) conta. Filtramos aqui na origem; agendamentos ficam intocados.
  const pagamentos = pagClinicaIds.length
    ? await fetchAllPaged<any>(
        () => admin.from("pagamentos")
          .select("id, valor, tipo, paciente_id, tratamento_id, clinica_id, data_pagamento, especialidade")
          .in("clinica_id", pagClinicaIds)
          .eq("recorrencia_orto", false)
          .gte("data_pagamento", from).lte("data_pagamento", to),
        "id",
      )
    : [];

  // crm_appointments do tenant por scheduled_date (coluna DATE), paginado.
  const appointments = await fetchAllPaged<any>(
    () => admin.from("crm_appointments")
      .select("id, lead_id, scheduled_date, status, is_rescheduled, crm_leads(cidade)")
      .eq("tenant_id", tenantId)
      .gte("scheduled_date", from).lte("scheduled_date", to),
    "id",
  );

  // feriados do tenant
  const holRes = await admin.from("dashboard_holidays" as any)
    .select("id, data, descricao, clinica_id").eq("tenant_id", tenantId);
  if (holRes.error) return json({ error: holRes.error.message }, 500);
  const holidays = (holRes.data || []) as any[];

  const num = (v: any) => Number(v) || 0;

  // KPIs faturamento (soma de pagamentos por data_pagamento — fonte canônica)
  const fatTotal = pagamentos.reduce((s, pg) => s + num(pg.valor), 0);
  const fatNovos = pagamentos.filter((pg) => pg.tipo === "primeiro").reduce((s, pg) => s + num(pg.valor), 0);
  const fatRecorrentes = pagamentos.filter((pg) => pg.tipo === "recorrente").reduce((s, pg) => s + num(pg.valor), 0);

  const pacientesTotalSet = new Set(pagamentos.map((pg) => pg.paciente_id).filter(Boolean));

  // pacientes do tenant presentes nos pagamentos do período (por id, em blocos)
  const pacientes: any[] = [];
  for (const ids of chunk([...pacientesTotalSet] as string[], 150)) {
    const r = await admin.from("pacientes").select("id, origem, nome_anuncio")
      .eq("tenant_id", tenantId).in("id", ids);
    if (r.error) return json({ error: r.error.message }, 500);
    pacientes.push(...(r.data || []));
  }

  // CONTRATADOS (definição canônica): pacientes cujo PRIMEIRO pagamento cai
  // no período; com ?clinica=, filtra pela clínica do primeiro pagamento.
  const contratados = await contratadosCanonicos(clinicaIds, from, to);
  const contratadosNoFiltro = clinicaId
    ? contratados.filter((c) => c.clinica_id === clinicaId)
    : contratados;

  // Ticket médio DE VERDADE: por pagamento e por paciente.
  const ticketPorPagamento = pagamentos.length ? fatTotal / pagamentos.length : 0;
  const ticketPorPaciente = pacientesTotalSet.size ? fatTotal / pacientesTotalSet.size : 0;

  // Média diária de faturamento (NÃO é ticket médio) — mesma regra do
  // Dashboard: numerador = pagamentos até ontem (America/Bahia); janela =
  // início do período até min(ontem, fim do período); domingo = 0,
  // feriado = 0, sábado = 0,5.
  const holidaySet = new Set<string>();
  holidays.forEach((h: any) => {
    const applies = !h.clinica_id || !clinicaId || h.clinica_id === clinicaId;
    if (applies) holidaySet.add(h.data);
  });
  // Lançamentos atrasam (a clínica digita os pagamentos no dia seguinte), então
  // "ontem" quase sempre ainda não tem dado. Ancorar no ÚLTIMO DIA COM LANÇAMENTO
  // (max data_pagamento) evita diluir a média/projeção com dias não lançados —
  // mesma regra de src/pages/Relatorios.tsx (predictability).
  const ultimoDiaLancado = pagamentos.reduce((mx, pg) => (pg.data_pagamento > mx ? pg.data_pagamento : mx), "");
  const fimJanela = ultimoDiaLancado || to;
  const diasUteisPassados = (ultimoDiaLancado && fimJanela >= from) ? Math.max(businessDaysBetween(from, fimJanela, holidaySet), 0.5) : 0;
  const fatAteOntem = fatTotal; // todos os pagamentos lançados no período (todos <= ultimoDiaLancado)
  const faturamentoMedioDiaUtil = diasUteisPassados > 0 ? fatAteOntem / diasUteisPassados : 0;

  // Projeção do MÊS CORRENTE (mesma fórmula do Dashboard do CRClin em
  // src/pages/Dashboard.tsx — projecaoMensal = ticketMedioDiario * diasUteisMes,
  // onde ticketMedioDiario = fatAteOntem / diasUteisPassados e diasUteisMes
  // cobre o mês corrente inteiro. Domingo=0, feriado=0, Sáb=1, Seg-Sex=1
  // (regra única em _shared/reporting.ts + src/lib/businessDays.ts).
  const firstOfCurMonth = `${hoje.slice(0, 8)}01`;
  const lastOfCurMonth = new Date(Date.UTC(hy, hm, 0)).toISOString().slice(0, 10);
  const diasUteisTotaisMes = Math.max(businessDaysBetween(firstOfCurMonth, lastOfCurMonth, holidaySet), 1);
  const projecaoMes = faturamentoMedioDiaUtil * diasUteisTotaisMes;

  // por especialidade
  const espMap = new Map<string, { faturamento: number; qtd: number }>();
  pagamentos.forEach((pg) => {
    const k = pg.especialidade || "Sem especialidade";
    const e = espMap.get(k) || { faturamento: 0, qtd: 0 };
    e.faturamento += num(pg.valor); e.qtd += 1;
    espMap.set(k, e);
  });
  const porEspecialidade = Array.from(espMap.entries())
    .map(([especialidade, v]) => ({ especialidade, ...v }))
    .sort((a, b) => b.faturamento - a.faturamento);

  // por clínica — nome real vindo da tabela clinicas (sem strings chumbadas)
  const clinicById = new Map<string, any>();
  clinicas.forEach((c) => clinicById.set(c.id, c));
  const clinMap = new Map<string, { faturamento: number; pacientes: Set<string> }>();
  pagamentos.forEach((pg) => {
    const c = pg.clinica_id ? clinicById.get(pg.clinica_id) : null;
    const name = c?.nome || "Sem clínica";
    const entry = clinMap.get(name) || { faturamento: 0, pacientes: new Set<string>() };
    entry.faturamento += num(pg.valor);
    if (pg.paciente_id) entry.pacientes.add(pg.paciente_id);
    clinMap.set(name, entry);
  });
  const porClinica = Array.from(clinMap.entries())
    .map(([clinica, v]) => ({ clinica, faturamento: v.faturamento, pacientes: v.pacientes.size }))
    .sort((a, b) => b.faturamento - a.faturamento);

  // por origem (pacientes.origem || 'Outros') — só pacientes que aparecem em pagamentos
  const pacienteById = new Map<string, any>();
  pacientes.forEach((pc) => pacienteById.set(pc.id, pc));
  const pagByPaciente = new Map<string, number>();
  pagamentos.forEach((pg) => {
    if (!pg.paciente_id) return;
    pagByPaciente.set(pg.paciente_id, (pagByPaciente.get(pg.paciente_id) || 0) + num(pg.valor));
  });
  const origemMap = new Map<string, { pacientes: number; faturamento: number }>();
  pacientesTotalSet.forEach((pid) => {
    const pac = pacienteById.get(pid as string);
    const origem = (pac?.origem || "Outros") as string;
    const entry = origemMap.get(origem) || { pacientes: 0, faturamento: 0 };
    entry.pacientes += 1;
    entry.faturamento += pagByPaciente.get(pid as string) || 0;
    origemMap.set(origem, entry);
  });
  const porOrigem = Array.from(origemMap.entries())
    .map(([origem, v]) => ({ origem, ...v }))
    .sort((a, b) => b.faturamento - a.faturamento);

  // por anúncio — atribuição por paciente -> lead -> ad_id (nome real do criativo), tenant-scoped
  let porAnuncio: any[] = [];
  try {
    const pacientesComFat = [...pacientesTotalSet].filter((pid) => (pagByPaciente.get(pid) || 0) > 0);
    // 1) todos os vínculos (paginado: fan-out 1:N pode passar de 1000 linhas)
    const allLinks: any[] = [];
    for (const ids of chunk(pacientesComFat, 150)) {
      let from = 0; const PAGE = 1000;
      while (true) {
        const { data, error } = await admin.from("crm_lead_pacientes")
          .select("paciente_id, lead_id, is_primary, created_at")
          .in("paciente_id", ids)
          .order("paciente_id", { ascending: true }).order("is_primary", { ascending: false })
          .order("created_at", { ascending: true }).order("lead_id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        allLinks.push(...(data || []));
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
    }
    // 2) leads VÁLIDOS do tenant (barreira de segurança)
    const allLeadIds = [...new Set(allLinks.map((r) => r.lead_id).filter(Boolean))];
    const leadById = new Map<string, any>();
    for (const ids of chunk(allLeadIds, 150)) {
      const { data, error } = await admin.from("crm_leads")
        .select("id, ad_id, nome_anuncio, source").eq("tenant_id", tenantId).in("id", ids);
      if (error) throw new Error(error.message);
      (data || []).forEach((l: any) => leadById.set(l.id, l));
    }
    // 3) melhor lead por paciente SÓ entre leads do tenant (desempate global determinístico; created_at NULL perde)
    const leadByPaciente = new Map<string, any>();
    for (const link of allLinks) {
      const lead = leadById.get(link.lead_id);
      if (!lead) continue;
      const cur = leadByPaciente.get(link.paciente_id);
      if (!cur) { leadByPaciente.set(link.paciente_id, { link, lead }); continue; }
      const a = link, b = cur.link;
      let win = (a.is_primary ? 1 : 0) - (b.is_primary ? 1 : 0);
      if (win === 0) { const at = a.created_at || "9999", bt = b.created_at || "9999"; win = at < bt ? 1 : at > bt ? -1 : 0; }
      if (win === 0) win = String(a.lead_id) < String(b.lead_id) ? 1 : -1;
      if (win > 0) leadByPaciente.set(link.paciente_id, { link, lead });
    }
    // 4) ad_id_mapping TENANT-SCOPED (não vazar nome de criativo entre clientes concorrentes)
    const adIds = [...new Set(Array.from(leadByPaciente.values()).map((x) => x.lead?.ad_id).filter(Boolean))];
    const adMap = new Map<string, any>();
    for (const ids of chunk(adIds, 150)) {
      const { data, error } = await admin.from("ad_id_mapping")
        .select("ad_id, ad_name, ad_headline, tenant_id").eq("tenant_id", tenantId).in("ad_id", ids);
      if (error) throw new Error(error.message);
      (data || []).forEach((m: any) => adMap.set(m.ad_id, m));
    }
    // 5) origem por token (evita falso-positivo de substring)
    const AD_TOKENS = new Set(["facebook","instagram","messenger","whatsapp","meta","tiktok","fb","ig","wpp","ad","ads","cpc","ppc","paid"]);
    const isAdSource = (s: any) => !!s && String(s).toLowerCase().split(/[^a-z0-9]+/).some((t) => AD_TOKENS.has(t));
    const anuncioMap = new Map<string, { display: string; faturamento: number; pacientes: Set<string> }>();
    for (const pid of pacientesComFat) {
      const fat = pagByPaciente.get(pid) || 0;
      if (!fat) continue;
      const picked = leadByPaciente.get(pid);
      const lead = picked?.lead;
      const pac = pacienteById.get(pid);
      const m = lead?.ad_id ? adMap.get(lead.ad_id) : null;
      let display: string;
      if (m && m.ad_name) display = String(m.ad_name).trim();
      else if (lead?.nome_anuncio && String(lead.nome_anuncio).trim()) display = String(lead.nome_anuncio).trim();
      else if (m && m.ad_headline) display = String(m.ad_headline).trim();
      else if (pac?.nome_anuncio && String(pac.nome_anuncio).trim()) display = String(pac.nome_anuncio).trim();
      else if (isAdSource(lead?.source)) display = "Anúncio (não identificado)";
      else display = "Sem anúncio / outro";
      const key = display.toLowerCase();
      const entry = anuncioMap.get(key) || { display, faturamento: 0, pacientes: new Set<string>() };
      entry.faturamento += fat; entry.pacientes.add(pid);
      anuncioMap.set(key, entry);
    }
    porAnuncio = Array.from(anuncioMap.values())
      .map((v) => ({ anuncio: v.display, faturamento: v.faturamento, pacientes: v.pacientes.size }))
      .sort((a, b) => b.faturamento - a.faturamento).slice(0, 20);
  } catch (_e) {
    const anuncioMap = new Map<string, { display: string; faturamento: number }>();
    pacientes.forEach((pc: any) => {
      if (!pc.nome_anuncio) return;
      const fat = pagByPaciente.get(pc.id) || 0;
      if (!fat) return;
      const key = String(pc.nome_anuncio).trim().toLowerCase();
      const entry = anuncioMap.get(key) || { display: String(pc.nome_anuncio).trim(), faturamento: 0 };
      entry.faturamento += fat; anuncioMap.set(key, entry);
    });
    porAnuncio = Array.from(anuncioMap.values())
      .map((v) => ({ anuncio: v.display, faturamento: v.faturamento }))
      .sort((a, b) => b.faturamento - a.faturamento).slice(0, 10);
  }

  // por clínica via crm_leads.cidade — casamento por chave normalizada com
  // clinicas.cidade do TENANT (clínica ativa vence se a cidade se repetir);
  // cidade sem clínica correspondente aparece como veio; nula = "Sem cidade".
  const clinicByCidade = new Map<string, any>();
  [...clinicas].sort((a, b) => Number(b.ativa) - Number(a.ativa)).forEach((c) => {
    const k = normalizeCidadeKey(c.cidade);
    if (k && !clinicByCidade.has(k)) clinicByCidade.set(k, c);
  });
  const cidadeToClinicaId = (cidade: string | null | undefined): string | null => {
    const k = normalizeCidadeKey(cidade);
    if (!k) return null;
    const c = clinicByCidade.get(k);
    return c ? (c.id as string) : null;
  };
  const cidadeToClinica = (cidade: string | null | undefined): string => {
    const k = normalizeCidadeKey(cidade);
    if (!k) return SEM_CIDADE;
    const c = clinicByCidade.get(k);
    return c ? c.nome : String(cidade).trim();
  };

  // agendamentos — quando ?clinica= está presente, restringe aos appointments
  // cuja clínica (derivada de crm_leads.cidade) bate com o filtro. Sem filtro,
  // usa todos os appointments do tenant (comportamento original preservado).
  const appointmentsScope = clinicaId
    ? appointments.filter((a: any) => cidadeToClinicaId(a.crm_leads?.cidade) === clinicaId)
    : appointments;
  const total = appointmentsScope.length;
  const porStatus: Record<string, number> = {};
  appointmentsScope.forEach((a) => {
    const s = a.status || "sem_status";
    porStatus[s] = (porStatus[s] || 0) + 1;
  });
  const remarcados = appointmentsScope.filter((a) => a.is_rescheduled === true).length;

  const aptClinMap = new Map<string, { total: number; por_status: Record<string, number> }>();
  appointmentsScope.forEach((a: any) => {
    const cidade = a.crm_leads?.cidade ?? null;
    const key = cidadeToClinica(cidade);
    const entry = aptClinMap.get(key) || { total: 0, por_status: {} };
    entry.total += 1;
    const st = a.status || "sem_status";
    entry.por_status[st] = (entry.por_status[st] || 0) + 1;
    aptClinMap.set(key, entry);
  });
  const aptPorClinica = Array.from(aptClinMap.entries())
    .map(([clinica, v]) => ({ clinica, total: v.total, por_status: v.por_status }))
    .sort((a, b) => b.total - a.total);

  return json({
    period: { from, to, timezone: BAHIA_TZ },
    faturamento: { total: fatTotal, novos: fatNovos, recorrentes: fatRecorrentes },
    // Ticket médio real. O antigo campo "ticket_medio" (número único) era, na
    // verdade, faturamento por dia útil — ver faturamento_medio_dia_util.
    ticket_medio: { por_pagamento: ticketPorPagamento, por_paciente: ticketPorPaciente },
    faturamento_medio_dia_util: faturamentoMedioDiaUtil,
    dias_uteis_passados: diasUteisPassados,
    projecao_mes: projecaoMes,
    dias_uteis_totais_mes: diasUteisTotaisMes,
    ultimo_dia_lancado: ultimoDiaLancado || null,
    pacientes_total: pacientesTotalSet.size,
    // novos_contratados = definição canônica (primeiro pagamento no período)
    novos_contratados: contratadosNoFiltro.length,
    num_pagamentos: pagamentos.length,
    por_especialidade: porEspecialidade,
    por_clinica: porClinica,
    por_origem: porOrigem,
    por_anuncio: porAnuncio,
    agendamentos: {
      total,
      por_status: porStatus,
      remarcados,
      por_clinica: aptPorClinica,
    },
  });
}

async function reportOverview(tenantId: string, p: URLSearchParams) {
  const { fromDay, toDay, gteIso, lteIso } = parseRange(p);
  const results = await Promise.all([
    // leads_created EXCLUI leads sintéticos criados pelo trigger
    // ensure_lead_for_pagamento (source='Retroativo', nascem com
    // created_at=now() ao lançar pagamento antigo — não são leads novos).
    // `.or` em vez de `.neq` para não descartar source NULL (lógica ternária SQL).
    admin.from("crm_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).or("source.is.null,source.neq.Retroativo").gte("created_at", gteIso).lte("created_at", lteIso),
    admin.from("crm_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("source", "Retroativo").gte("created_at", gteIso).lte("created_at", lteIso),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("direction", "inbound").gte("created_at", gteIso).lte("created_at", lteIso),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("direction", "outbound").gte("created_at", gteIso).lte("created_at", lteIso),
    // crm_appointments usa scheduled_date (DATE) — scheduled_at não existe.
    admin.from("crm_appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("scheduled_date", fromDay).lte("scheduled_date", toDay),
    // status por scheduled_date (data estável), nunca por updated_at.
    admin.from("crm_appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "contracted").gte("scheduled_date", fromDay).lte("scheduled_date", toDay),
    admin.from("clinicas").select("id").eq("tenant_id", tenantId),
  ]);
  // Nenhum erro pode virar zero silencioso.
  const failed = results.find((r: any) => r.error);
  if (failed) return json({ error: (failed as any).error.message }, 500);
  const [leadsRes, leadsRetroRes, inRes, outRes, schedRes, contrApptRes, clinRes] = results as any[];

  // CONTRATADOS canônicos: pacientes cujo primeiro pagamento cai no período.
  const clinicaIds = ((clinRes.data || []) as any[]).map((c) => c.id as string);
  const contratados = await contratadosCanonicos(clinicaIds, fromDay, toDay);

  return json({
    period: { from: fromDay, to: toDay, timezone: BAHIA_TZ },
    leads_created: leadsRes.count ?? 0,
    // Leads sintéticos do trigger ensure_lead_for_pagamento, segregados para
    // não inflar leads_created (não são leads que chegaram no período).
    leads_retroativos: leadsRetroRes.count ?? 0,
    messages_inbound: inRes.count ?? 0,
    messages_outbound: outRes.count ?? 0,
    appointments_scheduled: schedRes.count ?? 0,
    // Agendamentos com status "contracted" por scheduled_date no período.
    appointments_contracted: contrApptRes.count ?? 0,
    // Definição canônica de fechamento: primeiro pagamento no período.
    pacientes_contratados: contratados.length,
  });
}

async function reportFunnel(tenantId: string, p: URLSearchParams) {
  const pipelineId = p.get("pipeline_id");
  let stagesQ = admin.from("crm_stages").select("id,name,position,pipeline_id").eq("tenant_id", tenantId).order("position");
  if (pipelineId) stagesQ = stagesQ.eq("pipeline_id", pipelineId);
  const { data: stages, error: sErr } = await stagesQ;
  if (sErr) return json({ error: sErr.message }, 500);
  const out: any[] = [];
  for (const s of stages || []) {
    const { count, error } = await admin.from("crm_leads").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("stage_id", s.id);
    if (error) return json({ error: error.message }, 500);
    out.push({ ...s, leads_count: count ?? 0 });
  }
  return json({
    data: out,
    // Rótulo honesto: isto NÃO mede fechamentos de um período.
    observacao: "Fotografia ATUAL do funil (etapa atual de cada lead), sem período. Para fechamentos use 'pacientes_contratados' em /reports/overview ou 'novos_contratados' em /reports/financeiro (definição canônica: primeiro pagamento do paciente dentro do período).",
  });
}

async function reportBySource(tenantId: string, p: URLSearchParams) {
  const { fromDay, toDay, gteIso, lteIso } = parseRange(p);
  // Paginado — o PostgREST corta em 1000 linhas e truncaria a contagem.
  const rows = await fetchAllPaged<{ source: string | null }>(
    () => admin.from("crm_leads").select("id, source")
      .eq("tenant_id", tenantId).gte("created_at", gteIso).lte("created_at", lteIso),
    "id",
  );
  // Leads sintéticos do trigger ensure_lead_for_pagamento (source='Retroativo')
  // ficam FORA de data/total (created_at deles é a data do lançamento do
  // pagamento, não a chegada de um lead) — segregados em `retroativos` para a
  // soma de `data` sempre bater com `total`.
  const retroativos = rows.filter((r) => r.source === "Retroativo").length;
  const reais = rows.filter((r) => r.source !== "Retroativo");
  const counts: Record<string, number> = {};
  for (const r of reais) {
    const k = r.source || "Sem origem";
    counts[k] = (counts[k] || 0) + 1;
  }
  return json({
    period: { from: fromDay, to: toDay, timezone: BAHIA_TZ },
    total: reais.length,
    retroativos,
    data: Object.entries(counts).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    observacao: "Leads com source='Retroativo' (criados automaticamente ao lançar pagamento de paciente sem lead) são segregados em 'retroativos' e não entram em total/data.",
  });
}

// ===== /reports/clientes-pagantes =====
// Lista agregada de pacientes que já efetuaram algum pagamento (histórico completo).
// Somente leitura. Escopo por tenant via clinicas do tenant (mesma regra do /reports/financeiro).
function normalizePhoneE164BR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
}

async function reportClientesPagantes(tenantId: string, p: URLSearchParams) {
  const limit = Math.min(Math.max(parseInt(p.get("limit") || "5000", 10) || 5000, 1), 20000);
  const offset = Math.max(parseInt(p.get("offset") || "0", 10) || 0, 0);

  const clinRes = await admin.from("clinicas").select("id").eq("tenant_id", tenantId);
  if (clinRes.error) return json({ error: clinRes.error.message }, 500);
  const clinicaIds = ((clinRes.data || []) as any[]).map((c) => c.id as string);
  if (!clinicaIds.length) return json({ data: [], total: 0 });

  const pagamentos = await fetchAllPaged<any>(
    () => admin.from("pagamentos")
      .select("paciente_id, valor, data_pagamento, especialidade, id")
      .in("clinica_id", clinicaIds),
    "id",
  );

  type Agg = {
    valor_total: number;
    qtd_pagamentos: number;
    primeira_compra: string;
    ultima_compra: string;
    especialidades: Map<string, number>;
  };
  const byPaciente = new Map<string, Agg>();
  for (const pg of pagamentos) {
    const pid = pg.paciente_id as string | null;
    if (!pid) continue;
    const valor = Number(pg.valor) || 0;
    const data = String(pg.data_pagamento || "").slice(0, 10);
    let a = byPaciente.get(pid);
    if (!a) {
      a = { valor_total: 0, qtd_pagamentos: 0, primeira_compra: data, ultima_compra: data, especialidades: new Map() };
      byPaciente.set(pid, a);
    }
    a.valor_total += valor;
    a.qtd_pagamentos += 1;
    if (data && (a.primeira_compra === "" || data < a.primeira_compra)) a.primeira_compra = data;
    if (data && data > a.ultima_compra) a.ultima_compra = data;
    const esp = (pg.especialidade || "").trim();
    if (esp) a.especialidades.set(esp, (a.especialidades.get(esp) || 0) + valor);
  }

  const pacienteIds = [...byPaciente.keys()];
  const pacienteById = new Map<string, any>();
  for (const ids of chunk(pacienteIds, 150)) {
    const r = await admin.from("pacientes")
      .select("id, nome, telefone, cidade")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    if (r.error) return json({ error: r.error.message }, 500);
    (r.data || []).forEach((pc: any) => pacienteById.set(pc.id, pc));
  }

  const rows: any[] = [];
  for (const [pid, a] of byPaciente.entries()) {
    const pac = pacienteById.get(pid);
    if (!pac) continue; // fora do tenant
    let servico: string | null = null;
    let bestVal = -1;
    for (const [esp, v] of a.especialidades.entries()) {
      if (v > bestVal) { bestVal = v; servico = esp; }
    }
    rows.push({
      nome: pac.nome || null,
      telefone: normalizePhoneE164BR(pac.telefone),
      cidade: pac.cidade || null,
      valor_total: Math.round(a.valor_total * 100) / 100,
      qtd_pagamentos: a.qtd_pagamentos,
      primeira_compra: a.primeira_compra || null,
      ultima_compra: a.ultima_compra || null,
      servico,
    });
  }

  rows.sort((x, y) => y.valor_total - x.valor_total);
  const total = rows.length;
  const paged = rows.slice(offset, offset + limit);
  return json({ data: paged, total });
}

// ── WhatsApp templates (Meta) ────────────────────────────────────────────────
async function resolveWhatsAppCreds(tenantId: string): Promise<{ token: string; wabaId: string; appId: string } | null> {
  const { data: list } = await admin
    .from("integrations")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("status", "connected")
    .like("key", "whatsapp_%")
    .limit(1);
  const cfg = (list && (list as any)[0]?.config) as any;
  if (!cfg) return null;
  const token = cfg.access_token || cfg.token;
  const wabaId = cfg.waba_id;
  const appId = cfg.app_id || Deno.env.get("META_APP_ID") || "";
  if (!token || !wabaId) return null;
  return { token, wabaId, appId };
}

async function adminUploadMediaToMeta(appId: string, token: string, bytes: Uint8Array, fileName: string, fileType: string): Promise<{ handle?: string; error?: string }> {
  if (!appId) return { error: "META_APP_ID/app_id não configurado na integração do WhatsApp." };
  const base = "https://graph.facebook.com/v25.0";
  const startUrl = `${base}/${appId}/uploads?file_name=${encodeURIComponent(fileName)}&file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}`;
  const startRes = await fetch(startUrl, { method: "POST", headers: { Authorization: `OAuth ${token}` } });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !(startData as any)?.id) return { error: `abrir upload falhou (HTTP ${startRes.status}): ${JSON.stringify(startData).slice(0, 300)}` };
  const upRes = await fetch(`${base}/${(startData as any).id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0", "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  const upData = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !(upData as any)?.h) return { error: `enviar bytes falhou (HTTP ${upRes.status}): ${JSON.stringify(upData).slice(0, 300)}` };
  // O Meta às vezes devolve várias linhas de handle; a 1ª é a válida p/ criação.
  return { handle: String((upData as any).h).split("\n").map((s) => s.trim()).filter(Boolean)[0] };
}

function adminB64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function templatesUploadMedia(tenantId: string, body: any) {
  let bytes: Uint8Array | null = null;
  let mime = body.file_type || "video/mp4";
  let name = body.file_name || `midia-${Date.now()}`;
  if (body.file_b64) {
    try { bytes = adminB64ToBytes(String(body.file_b64)); } catch { return json({ error: "file_b64 inválido." }, 400); }
  } else if (body.media_url) {
    const r = await fetch(body.media_url);
    if (!r.ok) return json({ error: `não consegui baixar media_url (HTTP ${r.status}).` }, 400);
    bytes = new Uint8Array(await r.arrayBuffer());
    mime = body.file_type || r.headers.get("content-type") || mime;
    name = body.file_name || (String(body.media_url).split("?")[0].split("/").pop() || name);
  } else {
    return json({ error: "envie file_b64 (base64) ou media_url." }, 400);
  }
  // header_content precisa ser URL (o ENVIO baixa a mídia). Cacheia no bucket
  // privado chat-media e gera signed URL de 1 ano (mesmo padrão do envio).
  const safe = String(name).replace(/[^a-z0-9._-]+/gi, "-");
  const path = `whatsapp-template-media/${Date.now()}_${safe}`;
  const blob = new Blob([bytes!], { type: mime });
  const { error: upErr } = await admin.storage.from("chat-media").upload(path, blob, { contentType: mime, upsert: true });
  if (upErr) return json({ error: `falha ao cachear no storage: ${upErr.message}` }, 500);
  const { data: signed, error: signErr } = await admin.storage.from("chat-media").createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed?.signedUrl) return json({ error: `falha ao assinar URL: ${signErr?.message || "?"}` }, 500);
  const mediaUrl = signed.signedUrl;
  let patched = false;
  if (body.template_name) {
    const { error: updErr } = await admin.from("crm_whatsapp_templates")
      .update({ header_content: mediaUrl, updated_at: new Date().toISOString() })
      .eq("name", body.template_name);
    patched = !updErr;
  }
  return json({ media_url: mediaUrl, size: bytes!.length, mime, patched });
}

async function templatesCreate(tenantId: string, body: any) {
  const creds = await resolveWhatsAppCreds(tenantId);
  if (!creds) return json({ error: "WhatsApp não conectado para este tenant." }, 400);
  const { name, language, category, header_type, header_content, body_text, footer_text, buttons } = body;
  if (!name || !body_text) return json({ error: "name e body_text são obrigatórios." }, 400);
  const lang = language || "pt_BR";
  const cat = category || "UTILITY";
  const HT = header_type ? String(header_type).toUpperCase() : "";
  const isMedia = ["VIDEO", "IMAGE", "DOCUMENT"].includes(HT);
  const components: any[] = [];
  if (HT === "TEXT" && header_content) {
    components.push({ type: "HEADER", format: "TEXT", text: header_content });
  } else if (isMedia && header_content) {
    // header_content é URL (guardada p/ o envio). A criação exige um handle do
    // upload resumable — gera aqui a partir da URL. Handle legado (não-URL) passa direto.
    let creationHandle = header_content;
    if (/^https?:\/\//i.test(header_content)) {
      const r = await fetch(header_content);
      if (!r.ok) return json({ error: `não consegui baixar a mídia do header (HTTP ${r.status}).` }, 400);
      const mbytes = new Uint8Array(await r.arrayBuffer());
      const mmime = HT === "VIDEO" ? "video/mp4" : HT === "IMAGE" ? "image/jpeg" : "application/pdf";
      const up = await adminUploadMediaToMeta(creds.appId, creds.token, mbytes, String(name), mmime);
      if (up.error) return json({ error: up.error }, 502);
      creationHandle = up.handle!;
    }
    components.push({ type: "HEADER", format: HT, example: { header_handle: [creationHandle] } });
  }
  const variables = String(body_text).match(/\{\{\d+\}\}/g) || [];
  const bodyComponent: any = { type: "BODY", text: body_text };
  if (variables.length > 0) bodyComponent.example = { body_text: [variables.map((_: string, i: number) => `exemplo${i + 1}`)] };
  components.push(bodyComponent);
  if (footer_text) components.push({ type: "FOOTER", text: footer_text });
  if (buttons && Array.isArray(buttons) && buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: buttons.map((btn: any) => btn.type === "URL" ? { type: "URL", text: btn.text, url: btn.url } : { type: "QUICK_REPLY", text: btn.text }) });
  }
  const metaPayload = { name, language: lang, category: cat, components };
  await admin.from("whatsapp_template_logs").insert({ tenant_id: tenantId, action: "create_request", template_name: name, waba_id: creds.wabaId, request_payload: metaPayload });
  const metaRes = await fetch(`https://graph.facebook.com/v25.0/${creds.wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(metaPayload),
  });
  const metaData = await metaRes.json().catch(() => ({}));
  await admin.from("whatsapp_template_logs").insert({ tenant_id: tenantId, action: "create_response", template_name: name, waba_id: creds.wabaId, response_body: metaData, http_status: metaRes.status });
  if (!metaRes.ok) return json({ error: "Erro na API da Meta", details: metaData, waba_id: creds.wabaId }, metaRes.status);
  await admin.from("crm_whatsapp_templates").insert({
    name, language: lang, category: cat,
    header_type: header_type || null, header_content: header_content || null,
    body_text, footer_text: footer_text || null,
    buttons: buttons && buttons.length > 0 ? buttons : null,
    meta_template_id: (metaData as any).id, status: (metaData as any).status || "PENDING",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  return json({ success: true, meta_template_id: (metaData as any).id, status: (metaData as any).status || "PENDING", waba_id: creds.wabaId });
}

async function templatesList(tenantId: string, p: URLSearchParams) {
  const creds = await resolveWhatsAppCreds(tenantId);
  if (!creds) return json({ error: "WhatsApp não conectado para este tenant." }, 400);
  const nameFilter = p.get("name");
  let out: any[] = [];
  let next: string | null = `https://graph.facebook.com/v25.0/${creds.wabaId}/message_templates?limit=100`;
  while (next) {
    const r: Response = await fetch(next, { headers: { Authorization: `Bearer ${creds.token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "Erro ao listar na Meta", details: d }, r.status);
    out = out.concat(((d as any).data || []).map((t: any) => ({ name: t.name, status: t.status, category: t.category, language: t.language })));
    next = (d as any).paging?.next || null;
  }
  if (nameFilter) out = out.filter((t) => t.name === nameFilter);
  return json({ data: out, count: out.length });
}

Deno.serve(async (req) => {
  cors = buildCorsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  // Tenant resolvido POR REQUEST e passado por parâmetro (nunca em global
  // mutável — requests concorrentes de tenants distintos causariam corrida).
  const tenantId = await resolveTenantFromAuth(req);
  if (!tenantId) return json({ error: "Unauthorized — provide API key as Bearer token or x-api-key header" }, 401);

  const url = new URL(req.url);
  // Path after /admin-api
  const path = url.pathname.replace(/^.*\/admin-api/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const p = url.searchParams;
  let body: any = {};
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {
    if (parts[0] === undefined || parts[0] === "") {
      return json({
        name: "CRClin Admin API",
        endpoints: [
          "GET /leads?search=&stage_id=&pipeline_id=&limit=&offset=",
          "GET /leads/:id",
          "POST /leads",
          "PATCH /leads/:id",
          "DELETE /leads/:id",
          "GET /leads/:id/messages?limit=&sign=true&expires_in=3600",
          "POST /leads/:id/send  { type:'text'|'template'|'image'|..., content?, template_name?, media_url? }",
          "GET /messages/:id/download  (binary download of media)",
          "GET /media/sign?url=...  or  ?bucket=&path=&expires_in=3600",
          "GET /conversations?limit=&unread=true",
          "GET /conversations/unread-count  → { total, comercial, pos_venda, por_canal, por_unidade }",
          "GET /appointments?from=&to=",
          "POST /appointments",
          "PATCH /appointments/:id",
          "GET /tasks?status=",
          "POST /tasks",
          "PATCH /tasks/:id",
          "GET /reports/overview?from=&to=",
          "GET /reports/funnel?pipeline_id=",
          "GET /reports/by-source?from=&to=",
          "GET /reports/financeiro?from=YYYY-MM-DD&to=YYYY-MM-DD&clinica=<uuid?>",
          "GET /reports/clientes-pagantes?limit=&offset=",
          "GET /templates?name=  (lista status dos templates na Meta)",
          "POST /templates/upload-media  { file_b64 | media_url, file_name, file_type }  → { handle }",
          "POST /templates  { name, language, category, header_type:'VIDEO'|'IMAGE'|'TEXT', header_content, body_text, footer_text?, buttons? }",
        ],
      });
    }

    if (parts[0] === "leads") {
      const id = parts[1];
      if (!id) {
        if (req.method === "GET") return await listLeads(tenantId, p);
        if (req.method === "POST") return await createLead(tenantId, body);
      } else if (parts[2] === "messages" && req.method === "GET") {
        return await leadMessages(tenantId, id, p);
      } else if (parts[2] === "send" && req.method === "POST") {
        return await sendMessage(tenantId, id, body);
      } else {
        if (req.method === "GET") return await getLead(tenantId, id);
        if (req.method === "PATCH") return await updateLead(tenantId, id, body);
        if (req.method === "DELETE") return await deleteLead(tenantId, id);
      }
    }
    if (parts[0] === "conversations" && parts[1] === "unread-count" && req.method === "GET") {
      return await conversationsUnreadCount(tenantId);
    }
    if (parts[0] === "conversations" && req.method === "GET") return await conversations(tenantId, p);
    if (parts[0] === "messages" && parts[1] && parts[2] === "download" && req.method === "GET") {
      return await mediaDownload(tenantId, parts[1]);
    }
    if (parts[0] === "media" && parts[1] === "sign") return await mediaSign(tenantId, p, body);
    if (parts[0] === "appointments") return await appointments(tenantId, req.method, p, body, parts[1]);
    if (parts[0] === "tasks") return await tasks(tenantId, req.method, p, body, parts[1]);
    if (parts[0] === "reports") {
      if (parts[1] === "overview") return await reportOverview(tenantId, p);
      if (parts[1] === "funnel") return await reportFunnel(tenantId, p);
      if (parts[1] === "by-source") return await reportBySource(tenantId, p);
      if (parts[1] === "financeiro") return await reportFinanceiro(tenantId, p);
      if (parts[1] === "clientes-pagantes") return await reportClientesPagantes(tenantId, p);
    }
    if (parts[0] === "templates") {
      if (parts[1] === "upload-media" && req.method === "POST") return await templatesUploadMedia(tenantId, body);
      if (!parts[1] && req.method === "POST") return await templatesCreate(tenantId, body);
      if (!parts[1] && req.method === "GET") return await templatesList(tenantId, p);
    }
    if (parts[0] === "sync-dontus" && req.method === "POST") {
      // Só Rizodent (tenant do Dontus real) pode acionar.
      if (tenantId !== RIZODENT_TENANT_ID) return json({ error: "forbidden" }, 403);
      const url2 = `${Deno.env.get("SUPABASE_URL")}/functions/v1/dontus-sync`;
      const res = await fetch(url2, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify(body || {}),
      });
      const txt = await res.text();
      return new Response(txt, { status: res.status, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (parts[0] === "dedup-dontus" && req.method === "POST") {
      if (tenantId !== RIZODENT_TENANT_ID) return json({ error: "forbidden" }, 403);
      const url3 = `${Deno.env.get("SUPABASE_URL")}/functions/v1/dontus-dedup`;
      const res = await fetch(url3, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify(body || {}),
      });
      const txt = await res.text();
      return new Response(txt, { status: res.status, headers: { ...cors, "Content-Type": "application/json" } });
    }
    return json({ error: "not_found", path, method: req.method }, 404);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // Erros de validação de período (parseRange/assertDay/rangeBahia) são 400.
    const isValidation = /data inválida|'from' é depois de 'to'/.test(msg);
    return json({ error: msg }, isValidation ? 400 : 500);
  }
});

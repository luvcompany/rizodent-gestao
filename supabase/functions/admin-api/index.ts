// @ts-nocheck
// Admin API for Rizodent tenant — API Key authenticated (Bearer).
// Routes: /leads, /leads/:id, /leads/:id/messages, /leads/:id/send,
//         /conversations, /appointments, /tasks, /reports/overview,
//         /reports/funnel, /reports/by-source
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { safeEqual } from "../_shared/authz.ts";

const RIZODENT_TENANT_ID = "00000000-0000-0000-0000-000000000010"; // Rizodent (legacy default)
// Reatribuído no início de cada request (mesmo padrão do `cors` global).
// Resolve dinamicamente a partir da chave: RIZODENT_ADMIN_API_KEY -> Rizodent;
// senão procura em `tenant_api_keys` (active=true) e usa o tenant_id da linha.
let TENANT_ID: string = RIZODENT_TENANT_ID;

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
  "X-Admin-API-Version": "media-download-2026-06-22",
};
function buildCorsFor(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "X-Admin-API-Version": "media-download-2026-06-22",
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

function parseRange(p: URLSearchParams) {
  const from = p.get("from"); const to = p.get("to");
  const fromD = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
  const toD = to ? new Date(to) : new Date();
  return { fromISO: fromD.toISOString(), toISO: toD.toISOString() };
}

async function listLeads(p: URLSearchParams) {
  const limit = Math.min(parseInt(p.get("limit") || "50"), 500);
  const offset = parseInt(p.get("offset") || "0");
  const search = p.get("search");
  const stageId = p.get("stage_id");
  const pipelineId = p.get("pipeline_id");
  let q = admin.from("crm_leads")
    .select("id,name,phone,source,tags,value,pipeline_id,stage_id,assigned_to,cidade,servico_interesse,score,last_message_at,last_inbound_at,last_outbound_at,created_at,updated_at,is_blocked", { count: "exact" })
    .eq("tenant_id", TENANT_ID)
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

async function getLead(id: string) {
  const { data, error } = await admin.from("crm_leads").select("*")
    .eq("tenant_id", TENANT_ID).eq("id", id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
}

async function createLead(body: any) {
  const payload = { ...body, tenant_id: TENANT_ID };
  const { data, error } = await admin.from("crm_leads").insert(payload).select().single();
  if (error) return json({ error: error.message }, 400);
  return json(data, 201);
}

async function updateLead(id: string, body: any) {
  const { tenant_id, ...rest } = body || {};
  const { data, error } = await admin.from("crm_leads").update(rest)
    .eq("tenant_id", TENANT_ID).eq("id", id).select().maybeSingle();
  if (error) return json({ error: error.message }, 400);
  return json(data);
}

async function deleteLead(id: string) {
  const { error } = await admin.from("crm_leads").delete().eq("tenant_id", TENANT_ID).eq("id", id);
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

async function leadMessages(id: string, p: URLSearchParams) {
  const limit = Math.min(parseInt(p.get("limit") || "100"), 500);
  const sign = p.get("sign") !== "false"; // default true
  const expiresIn = Math.min(parseInt(p.get("expires_in") || "3600"), 60 * 60 * 24 * 7);
  const { data, error } = await admin.from("messages")
    .select("id,direction,type,content,media_url,status,transcription,created_at,channel,whatsapp_message_id")
    .eq("tenant_id", TENANT_ID).eq("lead_id", id)
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

async function mediaSign(p: URLSearchParams, body: any) {
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
  const { data, error } = await admin.storage.from(b!).createSignedUrl(pa!, expiresIn);
  if (error) return json({ error: error.message }, 400);
  return json({ bucket: b, path: pa, signed_url: data.signedUrl, expires_in: expiresIn });
}

async function mediaDownload(messageId: string) {
  const { data: msg, error } = await admin.from("messages")
    .select("id,media_url,type,tenant_id").eq("tenant_id", TENANT_ID).eq("id", messageId).maybeSingle();
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

async function sendMessage(id: string, body: any) {
  // Proxy to send-whatsapp-message function using service role.
  const res = await fetch(`${URL_BASE}/functions/v1/send-whatsapp-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SR}`,
      "apikey": ANON,
    },
    body: JSON.stringify({ lead_id: id, ...body }),
  });
  const txt = await res.text();
  try { return json(JSON.parse(txt), res.status); } catch { return new Response(txt, { status: res.status, headers: cors }); }
}

async function conversations(p: URLSearchParams) {
  const limit = Math.min(parseInt(p.get("limit") || "50"), 200);
  const unreadOnly = p.get("unread") === "true";
  let q = admin.from("crm_leads")
    .select("id,name,phone,last_message_at,last_inbound_at,last_outbound_at,stage_id,assigned_to")
    .eq("tenant_id", TENANT_ID)
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  let list = data || [];
  if (unreadOnly) list = list.filter((l: any) => l.last_inbound_at && (!l.last_outbound_at || l.last_inbound_at > l.last_outbound_at));
  return json({ data: list });
}

async function appointments(method: string, p: URLSearchParams, body: any, id?: string) {
  if (method === "GET") {
    const { fromISO, toISO } = parseRange(p);
    const { data, error } = await admin.from("crm_appointments").select("*")
      .eq("tenant_id", TENANT_ID).gte("scheduled_at", fromISO).lte("scheduled_at", toISO)
      .order("scheduled_at", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ data });
  }
  if (method === "POST") {
    const { data, error } = await admin.from("crm_appointments")
      .insert({ ...body, tenant_id: TENANT_ID }).select().single();
    if (error) return json({ error: error.message }, 400);
    return json(data, 201);
  }
  if (method === "PATCH" && id) {
    const { data, error } = await admin.from("crm_appointments").update(body)
      .eq("tenant_id", TENANT_ID).eq("id", id).select().maybeSingle();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }
  return json({ error: "method_not_allowed" }, 405);
}

async function tasks(method: string, p: URLSearchParams, body: any, id?: string) {
  if (method === "GET") {
    const status = p.get("status");
    let q = admin.from("crm_tasks").select("*").eq("tenant_id", TENANT_ID)
      .order("scheduled_at", { ascending: true }).limit(500);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ data });
  }
  if (method === "POST") {
    const { data, error } = await admin.from("crm_tasks")
      .insert({ ...body, tenant_id: TENANT_ID }).select().single();
    if (error) return json({ error: error.message }, 400);
    return json(data, 201);
  }
  if (method === "PATCH" && id) {
    const { data, error } = await admin.from("crm_tasks").update(body)
      .eq("tenant_id", TENANT_ID).eq("id", id).select().maybeSingle();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }
  return json({ error: "method_not_allowed" }, 405);
}

// ===== /reports/financeiro — replica a lógica do Dashboard.tsx =====
function toLocalDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function reportFinanceiro(p: URLSearchParams) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const from = (p.get("from") || toLocalDateStr(firstOfMonth)).slice(0, 10);
  const to = (p.get("to") || toLocalDateStr(lastOfMonth)).slice(0, 10);
  const clinicaId = p.get("clinica");

  // pagamentos
  let pagQ = admin.from("pagamentos")
    .select("id, valor, tipo, paciente_id, tratamento_id, clinica_id, data_pagamento, especialidade")
    .gte("data_pagamento", from).lte("data_pagamento", to).limit(50000);
  if (clinicaId) pagQ = pagQ.eq("clinica_id", clinicaId);

  // crm_appointments (tenant-scoped) com cidade do lead
  let aptQ = admin.from("crm_appointments")
    .select("id, lead_id, scheduled_date, status, is_rescheduled, crm_leads(cidade)")
    .eq("tenant_id", TENANT_ID)
    .gte("scheduled_date", `${from}T00:00:00`).lte("scheduled_date", `${to}T23:59:59`).limit(10000);

  const [pagRes, clinRes, pacRes, aptRes, holRes] = await Promise.all([
    pagQ,
    admin.from("clinicas").select("id, nome, cidade, ativa").eq("ativa", true),
    admin.from("pacientes").select("id, origem, nome_anuncio").limit(20000),
    aptQ,
    admin.from("dashboard_holidays" as any).select("id, data, descricao, clinica_id"),
  ]);
  if (pagRes.error) return json({ error: pagRes.error.message }, 500);
  const pagamentos = (pagRes.data || []) as any[];
  const clinicas = (clinRes.data || []) as any[];
  const pacientes = (pacRes.data || []) as any[];
  const appointments = (aptRes.data || []) as any[];
  const holidays = (holRes.data || []) as any[];

  const num = (v: any) => Number(v) || 0;

  // KPIs faturamento
  const fatTotal = pagamentos.reduce((s, p) => s + num(p.valor), 0);
  const fatNovos = pagamentos.filter((p) => p.tipo === "primeiro").reduce((s, p) => s + num(p.valor), 0);
  const fatRecorrentes = pagamentos.filter((p) => p.tipo === "recorrente").reduce((s, p) => s + num(p.valor), 0);

  const pacientesTotalSet = new Set(pagamentos.map((p) => p.paciente_id).filter(Boolean));
  const novosContratadosSet = new Set(pagamentos.filter((p) => p.tipo === "primeiro").map((p) => p.paciente_id).filter(Boolean));

  // ticket_medio (mesma lógica do Dashboard): fatTotal / dias úteis com pagamento
  // dias úteis = seg-sáb (exclui domingos) - feriados aplicáveis, do 1º pagamento até ontem ou último dia do mês de referência.
  const holidaySet = new Set<string>();
  holidays.forEach((h: any) => {
    const applies = !h.clinica_id || !clinicaId || h.clinica_id === clinicaId;
    if (applies) holidaySet.add(h.data);
  });
  const isWorkingDay = (d: Date, ds: string) => d.getDay() !== 0 && !holidaySet.has(ds);

  let diasUteisPassados = 1;
  if (pagamentos.length) {
    const dates = pagamentos.map((p) => p.data_pagamento as string).sort();
    const firstDate = new Date(dates[0] + "T12:00:00");
    const todayLocal = new Date(); todayLocal.setHours(12, 0, 0, 0);
    const yesterday = new Date(todayLocal); yesterday.setDate(yesterday.getDate() - 1);
    const lastDayMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0);
    const end = yesterday < lastDayMonth ? yesterday : lastDayMonth;
    let count = 0;
    const cur = new Date(firstDate);
    while (cur <= end) {
      const ds = toLocalDateStr(cur);
      if (isWorkingDay(cur, ds)) count++;
      cur.setDate(cur.getDate() + 1);
    }
    diasUteisPassados = Math.max(count, 1);
  }
  const ticketMedio = fatTotal / diasUteisPassados;

  // por especialidade
  const espMap = new Map<string, { faturamento: number; qtd: number }>();
  pagamentos.forEach((p) => {
    const k = p.especialidade || "Sem Especialidade";
    const e = espMap.get(k) || { faturamento: 0, qtd: 0 };
    e.faturamento += num(p.valor); e.qtd += 1;
    espMap.set(k, e);
  });
  const porEspecialidade = Array.from(espMap.entries())
    .map(([especialidade, v]) => ({ especialidade, ...v }))
    .sort((a, b) => b.faturamento - a.faturamento);

  // por clínica (agrupando VCA 01 + VCA 02 como "VCA")
  const clinicNameFor = (c: any) => {
    let n = String(c?.nome || "").replace("Clínica ", "").replace("Rizodent ", "");
    if (n.includes("VCA")) n = "VCA";
    return n || "Sem Clínica";
  };
  const clinicById = new Map<string, any>();
  clinicas.forEach((c) => clinicById.set(c.id, c));
  const clinMap = new Map<string, { faturamento: number; pacientes: Set<string> }>();
  pagamentos.forEach((p) => {
    const c = p.clinica_id ? clinicById.get(p.clinica_id) : null;
    const name = c ? clinicNameFor(c) : "Sem Clínica";
    const entry = clinMap.get(name) || { faturamento: 0, pacientes: new Set<string>() };
    entry.faturamento += num(p.valor);
    if (p.paciente_id) entry.pacientes.add(p.paciente_id);
    clinMap.set(name, entry);
  });
  const porClinica = Array.from(clinMap.entries())
    .map(([clinica, v]) => ({ clinica, faturamento: v.faturamento, pacientes: v.pacientes.size }))
    .sort((a, b) => b.faturamento - a.faturamento);

  // por origem (pacientes.origem || 'Outros') — só pacientes que aparecem em pagamentos
  const pacienteById = new Map<string, any>();
  pacientes.forEach((p) => pacienteById.set(p.id, p));
  const pagByPaciente = new Map<string, number>();
  pagamentos.forEach((p) => {
    if (!p.paciente_id) return;
    pagByPaciente.set(p.paciente_id, (pagByPaciente.get(p.paciente_id) || 0) + num(p.valor));
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

  // por anúncio top 10
  const anuncioMap = new Map<string, { display: string; faturamento: number }>();
  pacientes.forEach((p) => {
    if (!p.nome_anuncio) return;
    const fat = pagByPaciente.get(p.id) || 0;
    if (!fat) return;
    const key = String(p.nome_anuncio).trim().toLowerCase();
    const entry = anuncioMap.get(key) || { display: String(p.nome_anuncio).trim(), faturamento: 0 };
    entry.faturamento += fat;
    anuncioMap.set(key, entry);
  });
  const porAnuncio = Array.from(anuncioMap.values())
    .map((v) => ({ anuncio: v.display, faturamento: v.faturamento }))
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 10);

  // agendamentos
  const total = appointments.length;
  const porStatus: Record<string, number> = {};
  appointments.forEach((a) => {
    const s = a.status || "sem_status";
    porStatus[s] = (porStatus[s] || 0) + 1;
  });
  const remarcados = appointments.filter((a) => a.is_rescheduled === true).length;

  // por clínica via crm_leads.cidade
  const norm = (s: string) => s.toLowerCase();
  const cidadeToClinica = (cidade: string | null | undefined): string => {
    const cid = (cidade || "").trim();
    if (!cid) return "Sem Cidade";
    const c = clinicas.find((cc: any) => cc.cidade && norm(cc.cidade) === norm(cid));
    if (c) return clinicNameFor(c);
    return cid;
  };
  const aptClinMap = new Map<string, { total: number; por_status: Record<string, number> }>();
  appointments.forEach((a: any) => {
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
    period: { from, to },
    faturamento: { total: fatTotal, novos: fatNovos, recorrentes: fatRecorrentes },
    ticket_medio: ticketMedio,
    dias_uteis_passados: diasUteisPassados,
    pacientes_total: pacientesTotalSet.size,
    novos_contratados: novosContratadosSet.size,
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

async function reportOverview(p: URLSearchParams) {
  const { fromISO, toISO } = parseRange(p);
  const [{ count: leadsCount }, { count: msgsIn }, { count: msgsOut }, { count: aptScheduled }, { count: aptContracted }] = await Promise.all([
    admin.from("crm_leads").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).gte("created_at", fromISO).lte("created_at", toISO),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("direction", "inbound").gte("created_at", fromISO).lte("created_at", toISO),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("direction", "outbound").gte("created_at", fromISO).lte("created_at", toISO),
    admin.from("crm_appointments").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).gte("scheduled_at", fromISO).lte("scheduled_at", toISO),
    admin.from("crm_appointments").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "contracted").gte("updated_at", fromISO).lte("updated_at", toISO),
  ]);
  return json({
    period: { from: fromISO, to: toISO },
    leads_created: leadsCount ?? 0,
    messages_inbound: msgsIn ?? 0,
    messages_outbound: msgsOut ?? 0,
    appointments_scheduled: aptScheduled ?? 0,
    appointments_contracted: aptContracted ?? 0,
  });
}

async function reportFunnel(p: URLSearchParams) {
  const pipelineId = p.get("pipeline_id");
  let stagesQ = admin.from("crm_stages").select("id,name,position,pipeline_id").eq("tenant_id", TENANT_ID).order("position");
  if (pipelineId) stagesQ = stagesQ.eq("pipeline_id", pipelineId);
  const { data: stages, error: sErr } = await stagesQ;
  if (sErr) return json({ error: sErr.message }, 500);
  const out: any[] = [];
  for (const s of stages || []) {
    const { count } = await admin.from("crm_leads").select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID).eq("stage_id", s.id);
    out.push({ ...s, leads_count: count ?? 0 });
  }
  return json({ data: out });
}

async function reportBySource(p: URLSearchParams) {
  const { fromISO, toISO } = parseRange(p);
  const { data, error } = await admin.from("crm_leads").select("source")
    .eq("tenant_id", TENANT_ID).gte("created_at", fromISO).lte("created_at", toISO);
  if (error) return json({ error: error.message }, 500);
  const counts: Record<string, number> = {};
  for (const r of data || []) {
    const k = (r as any).source || "Sem origem";
    counts[k] = (counts[k] || 0) + 1;
  }
  return json({ data: Object.entries(counts).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count) });
}

Deno.serve(async (req) => {
  cors = buildCorsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const resolvedTenant = await resolveTenantFromAuth(req);
  if (!resolvedTenant) return json({ error: "Unauthorized — provide API key as Bearer token or x-api-key header" }, 401);
  TENANT_ID = resolvedTenant;

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
        name: "Rizodent Admin API",
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
        ],
      });
    }

    if (parts[0] === "leads") {
      const id = parts[1];
      if (!id) {
        if (req.method === "GET") return await listLeads(p);
        if (req.method === "POST") return await createLead(body);
      } else if (parts[2] === "messages" && req.method === "GET") {
        return await leadMessages(id, p);
      } else if (parts[2] === "send" && req.method === "POST") {
        return await sendMessage(id, body);
      } else {
        if (req.method === "GET") return await getLead(id);
        if (req.method === "PATCH") return await updateLead(id, body);
        if (req.method === "DELETE") return await deleteLead(id);
      }
    }
    if (parts[0] === "conversations" && req.method === "GET") return await conversations(p);
    if (parts[0] === "messages" && parts[1] && parts[2] === "download" && req.method === "GET") {
      return await mediaDownload(parts[1]);
    }
    if (parts[0] === "media" && parts[1] === "sign") return await mediaSign(p, body);
    if (parts[0] === "appointments") return await appointments(req.method, p, body, parts[1]);
    if (parts[0] === "tasks") return await tasks(req.method, p, body, parts[1]);
    if (parts[0] === "reports") {
      if (parts[1] === "overview") return await reportOverview(p);
      if (parts[1] === "funnel") return await reportFunnel(p);
      if (parts[1] === "by-source") return await reportBySource(p);
      if (parts[1] === "financeiro") return await reportFinanceiro(p);
    }
    return json({ error: "not_found", path, method: req.method }, 404);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

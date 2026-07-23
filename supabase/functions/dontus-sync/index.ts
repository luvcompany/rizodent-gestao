// @ts-nocheck
// Sincronização Dontus → CRClin.
// Fluxo:
//   1) Registrar client OAuth 1x (cache em dontus_sync_state).
//   2) PKCE + form GET/POST /oauth/authorize com DONTUS_TEAM_TOKEN.
//   3) Trocar code por access_token (~30d).
//   4) MCP: initialize + tools/call (SSE data:).
//   5) Aplicar regras de importação (dry-run ou grava).
//
// Auth: chamado apenas pelo admin-api (Bearer SUPABASE_SERVICE_ROLE_KEY) ou por
// pg_cron (x-cron-secret + AUTOMATION_CRON_TOKEN).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DONTUS_BASE = "https://one.dontus.com.br";
const DONTUS_ID = 210380;
const REDIRECT_URI = "http://localhost:8976/callback";

const CLINICA_MAP: Record<number, { id: string; nome: string }> = {
  2: { id: "c9f82611-a9d2-4729-9b44-afeb2208bc0e", nome: "Ipiaú" },
  3: { id: "91e304ed-53bb-483c-bfca-0c6e599c52ba", nome: "Guanambi" },
  4: { id: "87062a6d-ddd8-4ffa-95a6-b36d42eea327", nome: "Itabuna" },
  5: { id: "93c99d9a-8698-495a-829b-a6592ade8d06", nome: "Rizodent VCA" },
};

// Mapeamento de especialidades Dontus → CRClin.
const ESP_MAP: Record<string, string> = {
  "CLINICO GERAL": "CLÍNICO GERAL",
  "CLÍNICO GERAL": "CLÍNICO GERAL",
  "ESTÉTICA FACETA": "ESTÉTICA",
  "ESTETICA FACETA": "ESTÉTICA",
  "ESTÉTICA": "ESTÉTICA",
  "ESTETICA": "ESTÉTICA",
  "ORTODONTIA": "ORTODONTIA",
  "IMPLANTODONTIA": "IMPLANTODONTIA",
  "IMPLANTE": "IMPLANTODONTIA",
  "IMPLANTES": "IMPLANTODONTIA",
  "PERIODONTIA": "PERIODONTIA",
  "ENDODONTIA": "ENDODONTIA",
  "PRÓTESE": "PRÓTESE",
  "PROTESE": "PRÓTESE",
  "CIRURGIA": "CIRURGIA",
  "HARMONIZAÇÃO OROFACIAL": "HARMONIZAÇÃO",
  "HARMONIZACAO OROFACIAL": "HARMONIZAÇÃO",
};

function mapEspecialidade(raw: string | null | undefined): string {
  const key = String(raw || "").trim().toUpperCase();
  if (!key) return "CLÍNICO GERAL";
  return ESP_MAP[key] ?? key;
}

function normalizeName(raw: string | null | undefined): string {
  return String(raw || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

function tailPhone(raw: string | null | undefined): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(-8);
}

// Stopwords BR frequentes em nomes — não contam como token significativo.
const NAME_STOPWORDS = new Set([
  "DE","DA","DO","DAS","DOS","E","DI","DU","LA","LE","EL",
  "JR","JUNIOR","NETO","FILHO","FILHA","SOBRINHO",
  "SANTOS","SILVA","SOUZA","SOUSA","OLIVEIRA","LIMA","COSTA","PEREIRA","FERREIRA",
  "RODRIGUES","ALVES","GOMES","MARTINS","ARAUJO","BARBOSA","RIBEIRO","CARVALHO","MELO","MOURA",
]);
function significantTokens(name: string): string[] {
  return name.split(/\s+/).filter((t) => t.length > 2 && !NAME_STOPWORDS.has(t));
}
// Compatibilidade de nomes para aceitar match por telefone:
// - iguais normalizados, OU
// - mesmo primeiro nome (não-stopword), OU
// - >=2 tokens SIGNIFICATIVOS em comum (excluindo stopwords/sobrenomes comuns).
function namesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(/\s+/).filter(Boolean);
  const tb = nb.split(/\s+/).filter(Boolean);
  if (!ta.length || !tb.length) return false;
  // Primeiro nome deve bater E não ser stopword comum.
  if (ta[0] === tb[0] && !NAME_STOPWORDS.has(ta[0]) && ta[0].length > 2) return true;
  const sigA = significantTokens(na);
  const setB = new Set(significantTokens(nb));
  let common = 0;
  for (const t of sigA) {
    if (setB.has(t)) common++;
    if (common >= 2) return true;
  }
  return false;
}

// ============ OAuth helpers ============
function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(input: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(hash);
}
function randomVerifier(): string {
  const arr = new Uint8Array(48);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

async function ensureClientId(admin: any): Promise<string> {
  const { data } = await admin.from("dontus_sync_state").select("client_id").eq("id", "singleton").maybeSingle();
  if (data?.client_id) return data.client_id;
  const res = await fetch(`${DONTUS_BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "CRClin Sync",
    }),
  });
  if (!res.ok) throw new Error(`oauth/register failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  const clientId = j.client_id;
  await admin.from("dontus_sync_state").upsert({ id: "singleton", client_id: clientId, updated_at: new Date().toISOString() });
  return clientId;
}

async function performAuthorize(clientId: string, teamToken: string): Promise<string> {
  const verifier = randomVerifier();
  const challenge = b64url(await sha256(verifier));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));

  const authUrl = `${DONTUS_BASE}/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=finance.read&state=${encodeURIComponent(state)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;

  const getRes = await fetch(authUrl, { method: "GET", redirect: "manual" });
  const html = await getRes.text();

  // Parse hidden inputs and normalize dontus_token field
  const hidden: Record<string, string> = {};
  const re = /<input[^>]+name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) hidden[m[1]] = m[2];
  // Fill required fields even if not present in HTML.
  const form = new URLSearchParams();
  const need = ["response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method"];
  const defaults: Record<string, string> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI,
    state, scope: "finance.read", code_challenge: challenge, code_challenge_method: "S256",
  };
  for (const k of need) form.set(k, hidden[k] ?? defaults[k]);
  form.set("dontus_token", teamToken);

  const postRes = await fetch(`${DONTUS_BASE}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
  });
  if (postRes.status !== 302) {
    throw new Error(`authorize POST expected 302, got ${postRes.status}: ${await postRes.text().catch(() => "")}`);
  }
  const loc = postRes.headers.get("location") || "";
  const codeMatch = loc.match(/[?&]code=([^&]+)/);
  if (!codeMatch) throw new Error(`authorize POST redirect sem code: ${loc}`);
  const code = decodeURIComponent(codeMatch[1]);

  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const tokRes = await fetch(`${DONTUS_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenForm.toString(),
  });
  if (!tokRes.ok) throw new Error(`oauth/token failed: ${tokRes.status} ${await tokRes.text()}`);
  const tj = await tokRes.json();
  return tj.access_token;
}

async function getAccessToken(admin: any, teamToken: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const { data } = await admin.from("dontus_sync_state").select("access_token, token_expires_at").eq("id", "singleton").maybeSingle();
    if (data?.access_token && data?.token_expires_at) {
      const exp = new Date(data.token_expires_at).getTime();
      // renovar 1 dia antes
      if (exp - Date.now() > 24 * 3600 * 1000) return data.access_token;
    }
  }
  const clientId = await ensureClientId(admin);
  const token = await performAuthorize(clientId, teamToken);
  const expiresAt = new Date(Date.now() + 29 * 24 * 3600 * 1000).toISOString();
  await admin.from("dontus_sync_state").update({
    access_token: token, token_expires_at: expiresAt,
    last_authorize_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", "singleton");
  return token;
}

// ============ MCP call ============
async function mcpCall(accessToken: string, method: string, params: any): Promise<any> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params });
  const res = await fetch(`${DONTUS_BASE}/mcp`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body,
  });
  if (res.status === 401) throw Object.assign(new Error("MCP 401"), { code: 401 });
  if (!res.ok) throw new Error(`MCP ${method} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  // SSE — pega a linha data:
  const line = text.split("\n").find((l) => l.trim().startsWith("data:"));
  if (!line) {
    // pode ser JSON puro
    try { return JSON.parse(text); } catch { throw new Error("MCP resposta sem data: e não é JSON"); }
  }
  const jsonStr = line.trim().replace(/^data:\s*/, "");
  return JSON.parse(jsonStr);
}

async function mcpToolCall(admin: any, teamToken: string, name: string, args: any): Promise<any[]> {
  let token = await getAccessToken(admin, teamToken);
  let attempt = 0;
  while (attempt < 2) {
    try {
      // initialize é barato; alguns servidores exigem antes do tools/call.
      await mcpCall(token, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "crclin-sync", version: "1.0.0" },
      }).catch(() => {});
      const resp = await mcpCall(token, "tools/call", { name, arguments: args });
      const dados = resp?.result?.dados
        ?? resp?.result?.structuredContent?.dados
        ?? resp?.result?.content?.[0]?.dados
        ?? (Array.isArray(resp?.result) ? resp.result : null);
      if (dados) return dados;
      // Alguns servidores embutem em content[0].text (JSON string).
      const txt = resp?.result?.content?.[0]?.text;
      if (typeof txt === "string") {
        try {
          const p = JSON.parse(txt);
          return p.dados ?? p.data ?? p ?? [];
        } catch {}
      }
      return [];
    } catch (e: any) {
      if (e?.code === 401 && attempt === 0) {
        token = await getAccessToken(admin, teamToken, true);
        attempt++;
        continue;
      }
      throw e;
    }
  }
  return [];
}

// ============ Main sync logic ============
type PlanItem = {
  action: "import" | "adopt" | "skip";
  clinica_id: string;
  clinica_nome: string;
  paciente_nome: string;
  paciente_id_dontus: number;
  telefone: string | null;
  valor: number;
  data: string;
  especialidade: string;
  especialidade_raw: string;
  servico: string;
  forma_pagamento: string | null;
  recorrencia_orto: boolean;
  dontus_key: string;
  origem_paciente: string;
  matched_by: "kommo" | "phone" | "name" | null;
  matched_lead_id: string | null;
  matched_lead_name: string | null;
  matched_paciente_id: string | null; // paciente já existente no CRClin
  move_to_contratado: boolean;
  // Tipo primeiro/recorrente baseado no HISTÓRICO DO DONTUS (não no CRClin).
  tipo: "primeiro" | "recorrente";
  tipo_source: "visto_antes_no_dontus" | "primeiro_no_dontus";
  // Criar lead novo no CRClin diretamente em "Contratados" (para KOMMO sem lead
  // com pagamento que CONTA no dia). Apenas um item por paciente/dia recebe true.
  create_lead: boolean;
  notification: string | null;
  reason?: string;
};

// Helpers de data (yyyy-mm-dd)
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d);
}
function minIso(a: string, b: string): string { return a < b ? a : b; }
function maxIso(a: string, b: string): string { return a > b ? a : b; }

// Backfill incremental do histórico de pagamentos do Dontus por clínica.
// A tool `consultar_contas_recebidas` aceita no máximo 31 dias por chamada,
// então iteramos em janelas de 30 dias. Persistimos até que data já foi
// coberta em `dontus_seen_coverage` para tornar o processo idempotente e
// retomável. Executa no máximo 1x/dia por clínica (coberto_ate >= ontem).
// Retorna Set<idPaciente> com pacientes cuja primeira_data < `date` (hoje).
const LOOKBACK_MONTHS = 18;
const WINDOW_DAYS = 30;

async function ensureDontusPacienteSeen(
  admin: any,
  teamToken: string,
  idClinicaDontus: number,
  clinicaId: string,
  date: string,
): Promise<Set<number>> {
  const today = date; // yyyy-mm-dd
  const ontem = addDays(today, -1);

  // Lê cobertura existente
  const { data: covRow } = await admin.from("dontus_seen_coverage")
    .select("coberto_de, coberto_ate")
    .eq("clinica_id", clinicaId)
    .maybeSingle();

  const desiredStart = (() => {
    const d = new Date(ontem + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() - LOOKBACK_MONTHS);
    return ymd(d);
  })();

  // Determina intervalos que ainda precisam ser buscados.
  const ranges: Array<{ ini: string; fim: string }> = [];
  const covDe: string | null = covRow?.coberto_de ?? null;
  const covAte: string | null = covRow?.coberto_ate ?? null;

  if (!covDe || !covAte) {
    // primeira vez: cobre tudo
    if (desiredStart <= ontem) ranges.push({ ini: desiredStart, fim: ontem });
  } else {
    // extensão para trás (se lookback ficou maior que cobertura antiga)
    if (desiredStart < covDe) ranges.push({ ini: desiredStart, fim: addDays(covDe, -1) });
    // extensão para frente até ontem
    if (covAte < ontem) ranges.push({ ini: addDays(covAte, 1), fim: ontem });
    // já cobre até ontem? Pula fetch.
  }

  let windowsFailed = 0;
  let windowsOk = 0;
  const primeiraPorPaciente = new Map<number, string>();

  for (const rng of ranges) {
    let cursor = rng.ini;
    while (cursor <= rng.fim) {
      const wFim = minIso(addDays(cursor, WINDOW_DAYS - 1), rng.fim);
      try {
        const rows: any[] = await mcpToolCall(admin, teamToken, "consultar_contas_recebidas", {
          input: {
            contexto: { idDontus: DONTUS_ID, idClinica: idClinicaDontus },
            dataInicio: cursor, dataFim: wFim,
          },
        });
        if (!Array.isArray(rows)) {
          windowsFailed++;
        } else {
          for (const r of rows) {
            const id = Number(r.idPaciente);
            const d = String(r.dataRecebimento || "").slice(0, 10);
            if (!id || !d) continue;
            const prev = primeiraPorPaciente.get(id);
            if (!prev || d < prev) primeiraPorPaciente.set(id, d);
          }
          windowsOk++;
        }
      } catch (e) {
        windowsFailed++;
        console.warn(`[dontus-sync] janela ${cursor}..${wFim} clinica ${clinicaId} falhou:`, (e as any)?.message || e);
      }
      cursor = addDays(wFim, 1);
    }
  }

  // Upsert das primeiras datas encontradas (mantém a MENOR data por conflito)
  if (primeiraPorPaciente.size) {
    // Busca existentes para preservar min(primeira_data)
    const ids = Array.from(primeiraPorPaciente.keys());
    const existing = new Map<number, string>();
    const CHUNK_Q = 500;
    for (let i = 0; i < ids.length; i += CHUNK_Q) {
      const slice = ids.slice(i, i + CHUNK_Q);
      const { data: exs } = await admin.from("dontus_paciente_seen")
        .select("id_paciente_dontus, primeira_data")
        .eq("clinica_id", clinicaId)
        .in("id_paciente_dontus", slice);
      for (const r of exs || []) {
        existing.set(Number(r.id_paciente_dontus), String(r.primeira_data));
      }
    }

    const rows = Array.from(primeiraPorPaciente.entries()).map(([id, d]) => {
      const prev = existing.get(id);
      const primeira = prev ? minIso(prev, d) : d;
      return {
        id_paciente_dontus: id,
        clinica_id: clinicaId,
        primeira_data: primeira,
        refreshed_on: today,
        updated_at: new Date().toISOString(),
      };
    });
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await admin.from("dontus_paciente_seen")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "id_paciente_dontus,clinica_id" });
    }
  }

  // Atualiza cobertura apenas com janelas que rodaram (mesmo se algumas falharem
  // no meio, expandimos o intervalo cumulativamente porque as falhas são logadas
  // e podem ser retomadas na próxima execução via re-fetch do gap — aqui,
  // conservadoramente, só avançamos se NENHUMA janela do range falhou).
  if (ranges.length && windowsFailed === 0) {
    const newDe = covDe ? minIso(covDe, desiredStart) : desiredStart;
    const newAte = covAte ? maxIso(covAte, ontem) : ontem;
    await admin.from("dontus_seen_coverage").upsert({
      clinica_id: clinicaId,
      coberto_de: newDe,
      coberto_ate: newAte,
      updated_at: new Date().toISOString(),
    }, { onConflict: "clinica_id" });
  } else if (windowsFailed > 0) {
    console.warn(`[dontus-sync] clinica ${clinicaId}: ${windowsFailed} janela(s) falharam, ${windowsOk} ok — cobertura NÃO avançada.`);
  }

  // Monta o Set final lendo o cache completo (inclui runs anteriores).
  const { data: all } = await admin.from("dontus_paciente_seen")
    .select("id_paciente_dontus, primeira_data")
    .eq("clinica_id", clinicaId);
  const seen = new Set<number>();
  for (const r of all || []) {
    if (String(r.primeira_data) < today) seen.add(Number(r.id_paciente_dontus));
  }
  return seen;
}

// ============ Execução real do plano (não-dry-run) ============
const RIZODENT_TENANT_ID = "00000000-0000-0000-0000-000000000010";

async function resolveFallbackUser(admin: any): Promise<string | null> {
  const { data } = await admin.from("profiles")
    .select("id").eq("tenant_id", RIZODENT_TENANT_ID)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}

async function findMainPipelineContratado(admin: any): Promise<{ pipeline_id: string; stage_id: string } | null> {
  // Pipeline principal = qualquer pipeline do tenant Rizodent que contenha etapa ILIKE %contratado%.
  // Preferência: pipeline cujo nome contenha "principal".
  const { data: stages } = await admin.from("crm_stages")
    .select("id, name, pipeline_id, crm_pipelines!inner(id, name, tenant_id)")
    .ilike("name", "%contratado%")
    .eq("crm_pipelines.tenant_id", RIZODENT_TENANT_ID);
  if (!stages?.length) return null;
  const principal = stages.find((s: any) => /principal/i.test(s.crm_pipelines?.name || ""));
  const chosen = principal || stages[0];
  return { pipeline_id: chosen.pipeline_id, stage_id: chosen.id };
}

async function ensurePacienteFromItem(admin: any, item: PlanItem, leadId: string | null): Promise<string> {
  // 1) via vínculo de lead
  if (leadId) {
    const { data: vinc } = await admin.from("crm_lead_pacientes")
      .select("paciente_id").eq("lead_id", leadId).limit(1);
    if (vinc?.length) return vinc[0].paciente_id;
  }
  // 2) por telefone (últimos 8 dígitos) + nome compatível na clínica
  if (item.telefone) {
    const tail = tailPhone(item.telefone);
    if (tail) {
      const { data: pacs } = await admin.from("pacientes")
        .select("id, nome, telefone")
        .eq("tenant_id", RIZODENT_TENANT_ID)
        .ilike("telefone", `%${tail}`).limit(10);
      const match = (pacs || []).find((p: any) => namesCompatible(p.nome, item.paciente_nome));
      if (match) return match.id;
    }
  }
  // 3) por nome normalizado exato + clinica
  const norm = normalizeName(item.paciente_nome);
  if (norm) {
    const { data: pacs } = await admin.from("pacientes")
      .select("id, nome")
      .eq("tenant_id", RIZODENT_TENANT_ID).limit(2000);
    const match = (pacs || []).find((p: any) => normalizeName(p.nome) === norm);
    if (match) return match.id;
  }
  // 4) criar
  const { data: created, error } = await admin.from("pacientes").insert({
    nome: item.paciente_nome,
    telefone: item.telefone || "",
    cidade: item.clinica_nome,
    origem: item.origem_paciente === "KOMMO" ? "kommo" : (item.origem_paciente || null),
    tenant_id: RIZODENT_TENANT_ID,
  }).select("id").single();
  if (error) throw new Error(`criar paciente falhou: ${error.message}`);
  return created.id;
}

async function executePlan(admin: any, plan: PlanItem[]): Promise<{
  importados: number; adotados: number; leads_criados: number;
  movidos: number; notificacoes: number; erros: number; erros_det: any[];
}> {
  const c = { importados: 0, adotados: 0, leads_criados: 0, movidos: 0, notificacoes: 0, erros: 0, erros_det: [] as any[] };
  const fallbackUser = await resolveFallbackUser(admin);
  let mainPipeline: { pipeline_id: string; stage_id: string } | null = null;
  const movedLeads = new Set<string>();
  const createdLeadByPaciente = new Map<number, { leadId: string; pacienteId: string }>();

  const notify = async (userId: string | null, item: PlanItem, leadId: string | null, dedupe: string) => {
    if (!userId || !item.notification) return;
    const { error } = await admin.from("crm_notifications").insert({
      user_id: userId, lead_id: leadId,
      title: "Sync Dontus", body: item.notification,
      type: "dontus_sync", dedupe_key: dedupe,
    });
    if (!error) c.notificacoes++;
    else if (!/duplicate|unique/i.test(error.message || "")) throw error;
  };

  for (const item of plan) {
    try {
      // Guarda de tenant: clínicas do CLINICA_MAP são todas Rizodent, mas checamos.
      if (item.action === "skip") {
        if (item.notification) {
          await notify(fallbackUser, item, item.matched_lead_id, `sync:skip:${item.dontus_key}`);
        }
        continue;
      }

      let leadId = item.matched_lead_id;
      let pacienteId = item.matched_paciente_id;

      // --- create_lead: reusar por telefone/nome antes de criar ---
      if (item.create_lead && !leadId) {
        const cached = createdLeadByPaciente.get(item.paciente_id_dontus);
        if (cached) {
          leadId = cached.leadId;
          pacienteId = cached.pacienteId;
        } else {
          let existing: any = null;
          if (item.telefone) {
            const tail = tailPhone(item.telefone);
            if (tail) {
              const { data } = await admin.from("crm_leads")
                .select("id, name, phone, pipeline_id, stage_id")
                .eq("tenant_id", RIZODENT_TENANT_ID)
                .ilike("phone", `%${tail}`)
                .order("created_at", { ascending: false }).limit(10);
              existing = (data || []).find((l: any) => namesCompatible(l.name, item.paciente_nome)) || null;
            }
          }
          if (!existing) {
            const norm = normalizeName(item.paciente_nome);
            if (norm) {
              const { data } = await admin.from("crm_leads")
                .select("id, name, pipeline_id, stage_id")
                .eq("tenant_id", RIZODENT_TENANT_ID)
                .order("created_at", { ascending: false }).limit(1000);
              existing = (data || []).find((l: any) => normalizeName(l.name) === norm) || null;
            }
          }

          if (existing) {
            leadId = existing.id;
          } else {
            mainPipeline = mainPipeline || await findMainPipelineContratado(admin);
            if (!mainPipeline) throw new Error("pipeline principal com etapa Contratado não encontrado");
            const ins = await admin.from("crm_leads").insert({
              tenant_id: RIZODENT_TENANT_ID,
              name: item.paciente_nome,
              phone: item.telefone || null,
              source: "kommo",
              pipeline_id: mainPipeline.pipeline_id,
              stage_id: mainPipeline.stage_id,
              cidade: item.clinica_nome,
            }).select("id").single();
            if (ins.error) throw new Error(`criar lead falhou: ${ins.error.message}`);
            leadId = ins.data.id;
            c.leads_criados++;
            await admin.from("crm_lead_stage_history").insert({
              lead_id: leadId, stage_id: mainPipeline.stage_id,
            });
            movedLeads.add(leadId); // já entra em Contratado; não mover de novo
          }

          pacienteId = await ensurePacienteFromItem(admin, item, leadId);
          // garantir vínculo
          if (leadId && pacienteId) {
            await admin.from("crm_lead_pacientes")
              .upsert({ lead_id: leadId, paciente_id: pacienteId, is_primary: true },
                { onConflict: "lead_id,paciente_id" });
          }
          createdLeadByPaciente.set(item.paciente_id_dontus, { leadId: leadId!, pacienteId });
        }
      }

      // --- garantir paciente para import/adopt ---
      if (!pacienteId) {
        pacienteId = await ensurePacienteFromItem(admin, item, leadId);
        if (leadId && pacienteId) {
          await admin.from("crm_lead_pacientes")
            .upsert({ lead_id: leadId, paciente_id: pacienteId, is_primary: false },
              { onConflict: "lead_id,paciente_id" });
        }
      }

      // --- action ---
      if (item.action === "adopt") {
        const { data: rows } = await admin.from("pagamentos")
          .select("id, valor, dontus_key")
          .eq("paciente_id", pacienteId)
          .eq("data_pagamento", item.data)
          .is("dontus_key", null);
        const target = (rows || []).find((r: any) => Number(r.valor) === Number(item.valor));
        if (target) {
          const upd = await admin.from("pagamentos")
            .update({ dontus_key: item.dontus_key })
            .eq("id", target.id).is("dontus_key", null);
          if (upd.error) {
            if (!/duplicate|unique/i.test(upd.error.message || "")) throw upd.error;
          } else {
            c.adotados++;
          }
        }
        // Se sumiu, apenas não conta como adotado — evita gerar duplicado.
      } else if (item.action === "import") {
        const { data: dup } = await admin.from("pagamentos")
          .select("id").eq("dontus_key", item.dontus_key).maybeSingle();
        if (!dup) {
          const ins = await admin.from("pagamentos").insert({
            paciente_id: pacienteId,
            clinica_id: item.clinica_id,
            valor: item.valor,
            data_pagamento: item.data,
            especialidade: item.especialidade,
            forma_pagamento: item.forma_pagamento || "Não informado",
            tipo: item.tipo === "recorrente" ? "recorrente" : "primeiro",
            recorrencia_orto: item.recorrencia_orto,
            dontus_key: item.dontus_key,
          });
          if (ins.error) {
            if (!/duplicate|unique/i.test(ins.error.message || "")) throw ins.error;
          } else {
            c.importados++;
          }
        }
      }

      // --- move para Contratado (uma vez por lead) ---
      if (item.move_to_contratado && leadId && !movedLeads.has(leadId)) {
        movedLeads.add(leadId);
        const { data: lead } = await admin.from("crm_leads")
          .select("id, pipeline_id, stage_id").eq("id", leadId).maybeSingle();
        if (lead?.pipeline_id) {
          const { data: curStg } = await admin.from("crm_stages")
            .select("id, name").eq("id", lead.stage_id).maybeSingle();
          if (!/contratado/i.test(curStg?.name || "")) {
            const { data: tgt } = await admin.from("crm_stages")
              .select("id").eq("pipeline_id", lead.pipeline_id)
              .ilike("name", "%contratado%").limit(1).maybeSingle();
            if (tgt?.id) {
              const upd = await admin.from("crm_leads")
                .update({ stage_id: tgt.id }).eq("id", leadId);
              if (upd.error) throw upd.error;
              await admin.from("crm_lead_stage_history").insert({
                lead_id: leadId, stage_id: tgt.id, from_stage_id: lead.stage_id,
              });
              c.movidos++;
            }
          }
        }
      }

      // --- notificação ---
      if (item.notification) {
        const userId = leadId
          ? (await admin.from("crm_leads").select("assigned_to").eq("id", leadId).maybeSingle()).data?.assigned_to || fallbackUser
          : fallbackUser;
        await notify(userId, item, leadId, `sync:${item.action}:${item.dontus_key}`);
      }
    } catch (e: any) {
      c.erros++;
      c.erros_det.push({ dontus_key: item.dontus_key, paciente: item.paciente_nome, error: e?.message || String(e) });
    }
  }
  return c;
}



async function syncClinica(
  admin: any,
  teamToken: string,
  idClinica: number,
  date: string,
  dryRun: boolean,
): Promise<any> {
  const runStart = new Date().toISOString();
  const clinicaInfo = CLINICA_MAP[idClinica];
  if (!clinicaInfo) return { erro: `idClinica ${idClinica} não mapeado` };

  const args = {
    input: { contexto: { idDontus: DONTUS_ID, idClinica }, dataInicio: date, dataFim: date },
  };

  const recebidos: any[] = await mcpToolCall(admin, teamToken, "consultar_contas_recebidas", args);

  // Cache telefone Dontus por idPaciente (últimos ~3 dias)
  const phoneCache = new Map<number, string>();
  try {
    const start = new Date(date); start.setDate(start.getDate() - 3);
    const dIni = start.toISOString().slice(0, 10);
    const pacs: any[] = await mcpToolCall(admin, teamToken, "consultar_relatorio_pacientes", {
      input: { contexto: { idDontus: DONTUS_ID, idClinica }, dataInicio: dIni, dataFim: date },
    });
    for (const p of pacs) {
      const id = Number(p.idPaciente || p.id);
      const tel = String(p.celular || p.telefone || "").trim();
      if (id && tel) phoneCache.set(id, tel);
    }
  } catch (_) { /* best-effort */ }

  // Agrupar orto por paciente/dia
  const ortoDayHasStart = new Map<string, boolean>(); // key = paciente_id_dontus|data
  for (const it of recebidos) {
    const esp = String(it.especialidade || "").toUpperCase();
    if (!esp.includes("ORTO")) continue;
    const svc = String(it.servico || "").toUpperCase();
    const key = `${it.idPaciente}|${it.dataRecebimento}`;
    if (svc.includes("PANOR") || svc.includes("APARELHO")) ortoDayHasStart.set(key, true);
    else if (!ortoDayHasStart.has(key)) ortoDayHasStart.set(key, false);
  }

  const clinicaId = clinicaInfo.id;

  // Set de idPaciente vistos em data ANTERIOR a hoje no Dontus (fonte da verdade
  // para 'primeiro' vs 'recorrente'). Best-effort: se falhar, todo mundo cai como 'primeiro'.
  let seenBefore: Set<number> = new Set();
  try {
    seenBefore = await ensureDontusPacienteSeen(admin, teamToken, idClinica, clinicaId, date);
  } catch (_) { /* best-effort */ }

  const plan: PlanItem[] = [];
  const contratadoAlreadyForLead = new Set<string>(); // dedupe move por lead




  for (const it of recebidos) {
    const idPaciente = Number(it.idPaciente);
    const idPag = Number(it.idPagamento);
    const idConta = Number(it.idContaReceberPaciente);
    const parcela = Number(it.parcela ?? 1);
    const dontus_key = `${idConta}-${idPag}-${parcela}`;
    const nome = String(it.paciente || "").trim();
    const valor = Number(it.valorRecebido || 0);
    const dataPag = String(it.dataRecebimento || date).slice(0, 10);
    const espRaw = String(it.especialidade || "");
    const especialidade = mapEspecialidade(espRaw);
    const servico = String(it.servico || "");
    const origem = String(it.origemPaciente || "").toUpperCase();
    const telefone = phoneCache.get(idPaciente) || null;

    // 1) Já importado?
    const { data: existing } = await admin.from("pagamentos")
      .select("id").eq("dontus_key", dontus_key).maybeSingle();
    if (existing) {
      plan.push({
        action: "skip", reason: "já importado",
        clinica_id: clinicaId, clinica_nome: clinicaInfo.nome, paciente_nome: nome,
        paciente_id_dontus: idPaciente, telefone, valor, data: dataPag,
        especialidade, especialidade_raw: espRaw, servico,
        forma_pagamento: it.formaPagamento || null, recorrencia_orto: false, dontus_key,
        origem_paciente: origem, matched_by: null, matched_lead_id: null, matched_lead_name: null,
        matched_paciente_id: null, move_to_contratado: false, notification: null,
      });
      continue;
    }

    // 2) Elegibilidade + match
    // Regras:
    //  - origem=KOMMO é sempre elegível (importa mesmo sem lead).
    //  - Match por telefone (últimos 8 dígitos) só vincula se o NOME for compatível
    //    (namesCompatible); telefone bate mas nome incompatível → não vincula e,
    //    se não for KOMMO, gera notificação de conferência e ignora (skip).
    //  - Match por nome exige normalizado IGUAL.
    let matched_by: PlanItem["matched_by"] = null;
    let matched_lead_id: string | null = null;
    let matched_lead_name: string | null = null;
    let notification: string | null = null;
    let phoneNameConflictLead: { id: string; name: string } | null = null;

    // Buscar lead por telefone (últimos 8 dígitos) — pega o mais recente com nome compatível.
    let leadRow: any = null;
    if (telefone) {
      const tail = tailPhone(telefone);
      if (tail) {
        const { data: leads } = await admin.from("crm_leads")
          .select("id, name, phone, stage_id, pipeline_id, created_at")
          .ilike("phone", `%${tail}`)
          .order("created_at", { ascending: false }).limit(10);
        if (leads?.length) {
          const compat = leads.find((l) => namesCompatible(l.name, nome));
          if (compat) {
            leadRow = compat;
            matched_by = origem === "KOMMO" ? "kommo" : "phone";
          } else {
            // telefone bate mas nomes divergem → conflito
            phoneNameConflictLead = { id: leads[0].id, name: String(leads[0].name || "") };
          }
        }
      }
    }
    // Match por nome (sem telefone ou telefone com conflito): exige nome normalizado igual.
    if (!leadRow) {
      const norm = normalizeName(nome);
      if (norm) {
        const { data: leads } = await admin.from("crm_leads")
          .select("id, name, phone, stage_id, pipeline_id, created_at")
          .order("created_at", { ascending: false }).limit(500);
        leadRow = (leads || []).find((l) => normalizeName(l.name) === norm) || null;
        if (leadRow) matched_by = origem === "KOMMO" ? "kommo" : "name";
      }
    }

    if (leadRow) {
      matched_lead_id = leadRow.id;
      matched_lead_name = leadRow.name;
      if (matched_by === "phone") {
        notification = "Vinculado por telefone (nomes compatíveis) — conferir";
      } else if (matched_by === "name") {
        notification = "Vinculado por NOME — conferência obrigatória";
      }
    }

    // KOMMO: sempre importa. Se não achou lead, gera notificação e segue sem vincular/mover.
    if (origem === "KOMMO") {
      if (!leadRow) {
        matched_by = "kommo";
        notification = "Venda KOMMO sem lead vinculado no CRM — conferir";
      }
      // segue o fluxo (não faz skip)
    } else {
      // Não-KOMMO precisa de lead para importar.
      if (!leadRow) {
        // Se telefone bateu mas nomes divergiram, sinaliza conferência.
        if (phoneNameConflictLead) {
          plan.push({
            action: "skip",
            reason: `Telefone coincide com lead ${phoneNameConflictLead.name}, mas nomes divergem — conferência manual`,
            clinica_id: clinicaId, clinica_nome: clinicaInfo.nome, paciente_nome: nome,
            paciente_id_dontus: idPaciente, telefone, valor, data: dataPag,
            especialidade, especialidade_raw: espRaw, servico,
            forma_pagamento: it.formaPagamento || null, recorrencia_orto: false, dontus_key,
            origem_paciente: origem, matched_by: null, matched_lead_id: null, matched_lead_name: null,
            matched_paciente_id: null, move_to_contratado: false,
            notification: `Telefone de ${nome} coincide com lead ${phoneNameConflictLead.name}, mas os nomes divergem — conferir manualmente`,
          });
          continue;
        }
        plan.push({
          action: "skip", reason: "sem match (não é KOMMO e não bateu tel/nome)",
          clinica_id: clinicaId, clinica_nome: clinicaInfo.nome, paciente_nome: nome,
          paciente_id_dontus: idPaciente, telefone, valor, data: dataPag,
          especialidade, especialidade_raw: espRaw, servico,
          forma_pagamento: it.formaPagamento || null, recorrencia_orto: false, dontus_key,
          origem_paciente: origem, matched_by: null, matched_lead_id: null, matched_lead_name: null,
          matched_paciente_id: null, move_to_contratado: false, notification: null,
        });
        continue;
      }
    }


    // 3) Recorrência de ortodontia
    let recorrencia_orto = false;
    if (especialidade === "ORTODONTIA") {
      const key = `${idPaciente}|${dataPag}`;
      recorrencia_orto = !ortoDayHasStart.get(key);
    }

    // 4) Dedupe com pagamento manual (só se houver lead vinculado + paciente)
    let pacienteCrmId: string | null = null;
    if (matched_lead_id) {
      const { data: vinc } = await admin.from("crm_lead_pacientes")
        .select("paciente_id").eq("lead_id", matched_lead_id).limit(1);
      if (vinc?.length) pacienteCrmId = vinc[0].paciente_id;
    }

    let action: PlanItem["action"] = "import";
    if (pacienteCrmId) {
      const { data: sameDay } = await admin.from("pagamentos")
        .select("id, valor, dontus_key")
        .eq("paciente_id", pacienteCrmId)
        .eq("data_pagamento", dataPag)
        .is("dontus_key", null);
      if (sameDay?.length) {
        const sameValor = sameDay.find((p) => Number(p.valor) === valor);
        if (sameValor) {
          action = "adopt";
        } else {
          notification = (notification ? notification + " | " : "") +
            `Divergência de valor com lançamento manual (${sameDay.map((s) => `R$${s.valor}`).join(", ")}) — conferir`;
        }
      }
    }

    // 5) Contratado? Só se conta (recorrencia_orto=false), há lead vinculado
    //    e ainda não movemos esse lead neste batch (dedupe por lead).
    let move_to_contratado = false;
    if (
      !recorrencia_orto &&
      matched_lead_id &&
      leadRow?.stage_id &&
      leadRow?.pipeline_id &&
      !contratadoAlreadyForLead.has(matched_lead_id)
    ) {
      const { data: stg } = await admin.from("crm_stages")
        .select("id, name").eq("id", leadRow.stage_id).maybeSingle();
      if (stg && !/contratado/i.test(stg.name || "")) {
        const { data: targetStage } = await admin.from("crm_stages")
          .select("id, name").eq("pipeline_id", leadRow.pipeline_id)
          .ilike("name", "%contratado%").limit(1).maybeSingle();
        if (targetStage) {
          move_to_contratado = true;
          contratadoAlreadyForLead.add(matched_lead_id);
        }
      } else if (stg) {
        // já está em Contratado — marca como movido pra não repetir
        contratadoAlreadyForLead.add(matched_lead_id);
      }
    }


    plan.push({
      action,
      clinica_id: clinicaId, clinica_nome: clinicaInfo.nome, paciente_nome: nome,
      paciente_id_dontus: idPaciente, telefone, valor, data: dataPag,
      especialidade, especialidade_raw: espRaw, servico,
      forma_pagamento: it.formaPagamento || null, recorrencia_orto, dontus_key,
      origem_paciente: origem, matched_by, matched_lead_id, matched_lead_name,
      matched_paciente_id: pacienteCrmId, move_to_contratado, notification,
    });
  }

  // ============ Pós-processamento ============
  // (A) Classificar tipo primeiro/recorrente com base no histórico DO DONTUS.
  //     Fonte: seenBefore (idPaciente com pagamento em data anterior a hoje).
  for (const p of plan) {
    const seen = seenBefore.has(p.paciente_id_dontus);
    p.tipo = seen ? "recorrente" : "primeiro";
    p.tipo_source = seen ? "visto_antes_no_dontus" : "primeiro_no_dontus";
    p.create_lead = false;
  }

  // (B) KOMMO sem lead: se o paciente tem AO MENOS UM item que CONTA no dia
  //     (recorrencia_orto=false) e não há lead vinculável, marcar o PRIMEIRO
  //     item que conta com create_lead=true (novo lead direto em "Contratados").
  //     Se só houver itens que NÃO contam (ex.: orto manutenção), NÃO cria lead.
  const kommoNoLeadByPaciente = new Map<number, PlanItem[]>();
  for (const p of plan) {
    if (p.action === "skip") continue;
    if (p.origem_paciente !== "KOMMO") continue;
    if (p.matched_lead_id) continue;
    const arr = kommoNoLeadByPaciente.get(p.paciente_id_dontus) || [];
    arr.push(p);
    kommoNoLeadByPaciente.set(p.paciente_id_dontus, arr);
  }
  for (const [_idPac, items] of kommoNoLeadByPaciente.entries()) {
    const counting = items.filter((i) => !i.recorrencia_orto);
    if (!counting.length) {
      // Só recorrência orto → não cria lead, mantém notificação de KOMMO sem lead
      for (const i of items) {
        i.notification = "Venda KOMMO (orto manutenção) sem lead prévio — importada como recorrência, sem criar lead";
      }
      continue;
    }
    const primary = counting[0];
    primary.create_lead = true;
    primary.move_to_contratado = true;
    primary.notification =
      `Lead criado automaticamente a partir de venda KOMMO sem lead prévio — conferir | ` +
      `paciente=${primary.paciente_nome}, tel=${primary.telefone ?? "?"}, valor=R$${primary.valor.toFixed(2)}, clínica=${primary.clinica_nome}`;
    // Demais itens do mesmo paciente KOMMO (se houver) — anexar ao mesmo lead novo
    // apenas informacionalmente no dry-run; contador único de criação de lead.
    for (const i of items) {
      if (i !== primary) {
        i.notification = `Anexado ao lead criado automaticamente para ${primary.paciente_nome}`;
      }
    }
  }

  const summary: any = {
    clinica: clinicaInfo.nome,
    id_clinica_dontus: idClinica,
    itens_lidos: recebidos.length,
    a_importar: plan.filter((p) => p.action === "import").length,
    a_adotar: plan.filter((p) => p.action === "adopt").length,
    ignorados: plan.filter((p) => p.action === "skip").length,
    vinculos_telefone: plan.filter((p) => p.matched_by === "phone").length,
    vinculos_nome: plan.filter((p) => p.matched_by === "name").length,
    mover_contratado: plan.filter((p) => p.move_to_contratado && !p.create_lead).length,
    leads_criados_em_contratado: plan.filter((p) => p.create_lead).length,
    primeiros: plan.filter((p) => p.tipo === "primeiro").length,
    recorrentes: plan.filter((p) => p.tipo === "recorrente").length,
    notificacoes: plan.filter((p) => p.notification).length,
    plan,
  };

  // Registrar run
  await admin.from("dontus_sync_runs").insert({
    started_at: runStart, finished_at: new Date().toISOString(),
    date_sincronizada: date, clinica_id: clinicaId, id_clinica_dontus: idClinica, dry_run: dryRun,
    itens_lidos: recebidos.length,
    importados: dryRun ? 0 : summary.a_importar,
    adotados: dryRun ? 0 : summary.a_adotar,
    ignorados: summary.ignorados,
    vinculados_telefone: summary.vinculos_telefone,
    vinculados_nome: summary.vinculos_nome,
    movidos_contratado: dryRun ? 0 : summary.mover_contratado,
    notificacoes: dryRun ? 0 : summary.notificacoes,
    erros: 0,
    detalhes: dryRun ? summary : { resumo: { ...summary, plan: undefined } },
  });

  // Escrita real ainda não implementada — feature em dry-run.
  if (!dryRun) {
    summary.observacao = "Escrita ainda não habilitada — sync efetivo será liberado após aprovação (dry-run apenas).";
  }

  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const auth = await authorizeInternal(req, admin, { cronSecretName: "automation_cron_token", allowUserJwt: true });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);
  // Se veio via user JWT, exige superadmin (dry-run/staging manual).
  if (auth.via === "user_jwt") {
    const { data: isSuper } = await admin.rpc("has_role", { _user_id: auth.userId, _role: "superadmin" });
    if (!isSuper) return unauthorizedResponse(corsHeaders);
  }

  const teamToken = Deno.env.get("DONTUS_TEAM_TOKEN");
  if (!teamToken) {
    return new Response(JSON.stringify({
      error: "DONTUS_TEAM_TOKEN não configurado. Adicione em Project Settings → Secrets.",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const date: string = String(body.date || new Date().toISOString().slice(0, 10));
  const dryRun: boolean = body.dry_run !== false; // padrão: TRUE (dry-run) para segurança
  const clinicas: number[] = Array.isArray(body.clinicas) && body.clinicas.length
    ? body.clinicas.map((n: any) => Number(n)).filter((n) => CLINICA_MAP[n])
    : [2, 3, 4, 5];

  const results: any[] = [];
  const errors: any[] = [];
  for (const idC of clinicas) {
    try {
      const r = await syncClinica(admin, teamToken, idC, date, dryRun);
      results.push(r);
    } catch (e: any) {
      errors.push({ id_clinica_dontus: idC, error: e?.message ?? String(e) });
      await admin.from("dontus_sync_runs").insert({
        date_sincronizada: date, clinica_id: CLINICA_MAP[idC]?.id, id_clinica_dontus: idC,
        dry_run: dryRun, erros: 1, error_message: e?.message ?? String(e),
      });
    }
  }

  return new Response(JSON.stringify({
    date, dry_run: dryRun, clinicas: results, errors,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

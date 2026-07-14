// ==========================================================================
// daily-backup — export lógico diário das tabelas do CRClin para um bucket
// privado do Supabase Storage, com particionamento (bound de memória),
// manifesto, retenção e ENCADEAMENTO por lotes (para não estourar o limite de
// compute da edge function em bancos grandes).
//
// É um backup COMPLEMENTAR (snapshot lógico, self-owned). Para recuperação de
// desastre completa/point-in-time, use também os backups gerenciados do
// Supabase (plano Pro: Database > Backups + PITR).
//
// Como o encadeamento funciona:
//   - Cada invocação processa tabelas até um orçamento de tempo (~90s), sempre
//     ao menos UMA tabela, e então dispara a si mesma (service-role) com a
//     lista de tabelas RESTANTES e o mesmo `stamp` (pasta do dia). A cadeia
//     continua em background até acabar. Assim nenhuma invocação faz trabalho
//     demais e o backup cobre qualquer tamanho de banco.
//
// Chamadas permitidas (via _shared/internalAuth):
//   - pg_cron: header x-cron-secret = automation_cron_token
//   - função→função (auto-encadeamento): Authorization: Bearer SERVICE_ROLE_KEY
//   - admin logado (crc/gerente) via JWT: para acionar "Backup agora" pela UI
//
// Saída: um NDJSON por tabela (particionado .0000.ndjson, .0001.ndjson…) em
//   <bucket>/<AAAA-MM-DD>/<tabela>.<parte>.ndjson  +  _manifest.json
// ==========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

// Global do runtime do Supabase Edge (mantém a promise viva após a resposta).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const BUCKET = Deno.env.get("BACKUP_BUCKET") || "crm-backups";
const RETENTION_DAYS = Math.max(Number(Deno.env.get("BACKUP_RETENTION_DAYS") || "30"), 1);
const PAGE_SIZE = 1000;
const ROWS_PER_PART = 8000; // ~5-8 MB por arquivo; limita o pico de memória
const TIME_BUDGET_MS = 90_000; // por invocação; ao estourar, encadeia o restante

// Tabelas que NÃO entram no export (segredos de infra / estado efêmero de OAuth).
const BLOCKLIST = new Set<string>([
  "_internal_secrets",
  "whatsapp_oauth_states",
  "instagram_oauth_states",
]);

type TableInfo = { name: string; orderBy: string | null };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SELF_URL = `${SUPABASE_URL}/functions/v1/daily-backup`;

async function listTables(supabase: any): Promise<TableInfo[]> {
  const { data, error } = await supabase.rpc("backup_list_tables");
  if (!error && Array.isArray(data)) {
    return (data as any[])
      .filter((t) => !BLOCKLIST.has(t.table_name))
      .map((t) => ({ name: t.table_name, orderBy: t.order_col || null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  console.error("[daily-backup] backup_list_tables indisponível:", error?.message);
  return [];
}

async function uploadText(supabase: any, path: string, text: string, contentType: string) {
  const body = new Blob([text], { type: contentType });
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

async function backupTable(supabase: any, stamp: string, t: TableInfo): Promise<{ rows: number; parts: number }> {
  let from = 0;
  let total = 0;
  let part = 0;
  let buffer: string[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const path = `${stamp}/${t.name}.${String(part).padStart(4, "0")}.ndjson`;
    await uploadText(supabase, path, buffer.join("\n") + "\n", "application/x-ndjson");
    part++;
    buffer = [];
  };

  const MAX_ROWS = 2_000_000; // trava de segurança
  while (from < MAX_ROWS) {
    let q = supabase.from(t.name).select("*").range(from, from + PAGE_SIZE - 1);
    if (t.orderBy) q = q.order(t.orderBy, { ascending: true });
    const { data, error } = await q;
    if (error) {
      console.error(`[daily-backup] erro lendo ${t.name} (range ${from}):`, error.message);
      break; // não aborta o backup inteiro
    }
    if (!data || data.length === 0) break;
    for (const row of data) buffer.push(JSON.stringify(row));
    total += data.length;
    if (buffer.length >= ROWS_PER_PART) await flush();
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  await flush();
  return { rows: total, parts: part };
}

// Lê / mescla / grava o manifesto do dia (a cadeia é sequencial → sem corrida).
async function mergeManifest(
  supabase: any,
  stamp: string,
  patch: { tables?: Record<string, any>; errors?: string[]; done?: boolean },
) {
  let manifest: any = { stamp, bucket: BUCKET, retention_days: RETENTION_DAYS, tables: {}, errors: [] };
  try {
    const { data } = await supabase.storage.from(BUCKET).download(`${stamp}/_manifest.json`);
    if (data) manifest = JSON.parse(await data.text());
  } catch (_) {
    /* primeiro lote do dia */
  }
  manifest.tables = { ...(manifest.tables || {}), ...(patch.tables || {}) };
  if (patch.errors?.length) manifest.errors = [...(manifest.errors || []), ...patch.errors];
  manifest.total_rows = Object.values(manifest.tables).reduce((a: number, b: any) => a + (b.rows || 0), 0);
  manifest.updated_at = new Date().toISOString();
  if (patch.done) manifest.finished_at = new Date().toISOString();
  await uploadText(supabase, `${stamp}/_manifest.json`, JSON.stringify(manifest, null, 2), "application/json");
  return manifest;
}

async function applyRetention(supabase: any, cutoff: string): Promise<string[]> {
  const removed: string[] = [];
  const { data: folders, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) {
    console.error("[daily-backup] retenção: erro listando raiz:", error.message);
    return removed;
  }
  for (const f of folders || []) {
    const name = f.name;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    if (name >= cutoff) continue;
    const { data: files } = await supabase.storage.from(BUCKET).list(name, { limit: 10000 });
    const paths = (files || []).map((x: any) => `${name}/${x.name}`);
    if (paths.length) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
      if (rmErr) console.error(`[daily-backup] retenção: erro removendo ${name}:`, rmErr.message);
      else removed.push(name);
    }
  }
  return removed;
}

function chainNext(only: string[], stamp: string) {
  // Dispara a próxima leva (fire-and-forget, autenticada por service-role).
  const p = fetch(SELF_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action: "run", only, stamp }),
  }).catch((e) => console.error("[daily-backup] chainNext erro:", e?.message || e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const auth = await authorizeInternal(req, supabase, { cronSecretName: "automation_cron_token", allowUserJwt: true });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);
  if (auth.via === "user_jwt") {
    const { data: role } = await supabase
      .from("user_roles").select("role").eq("user_id", auth.userId).in("role", ["crc", "gerente"]).maybeSingle();
    if (!role) return unauthorizedResponse(corsHeaders);
  }

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const action = String(body.action || "run");

  try {
    await supabase.storage.createBucket(BUCKET, { public: false });
  } catch (_) {
    /* já existe */
  }

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (action === "list") {
    const { data: folders } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
    const dates = (folders || [])
      .map((f: any) => f.name)
      .filter((n: string) => /^\d{4}-\d{2}-\d{2}$/.test(n))
      .sort().reverse();
    return json({ ok: true, backups: dates });
  }

  if (action === "download") {
    const path = String(body.path || "");
    if (!path) return json({ error: "path obrigatório" }, 400);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, url: data.signedUrl });
  }

  // action === 'run'
  const start = Date.now();
  const now = new Date();
  const stamp = typeof body.stamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.stamp)
    ? body.stamp
    : now.toISOString().slice(0, 10);

  // Lista de tabelas: `only` (encadeamento) ou tudo (primeira leva).
  let queue: TableInfo[];
  const isChained = Array.isArray(body.only);
  if (isChained) {
    const all = await listTables(supabase);
    const byName = new Map(all.map((t) => [t.name, t]));
    queue = (body.only as string[]).map((n) => byName.get(n)).filter(Boolean) as TableInfo[];
  } else {
    queue = await listTables(supabase);
  }
  if (queue.length === 0) {
    if (!isChained) return json({ error: "Nenhuma tabela para backup (RPC backup_list_tables ausente?)" }, 500);
    // fim da cadeia
    await mergeManifest(supabase, stamp, { done: true });
  }

  const doneTables: Record<string, any> = {};
  const errors: string[] = [];
  const remaining: string[] = [];

  for (let i = 0; i < queue.length; i++) {
    // sempre processa ao menos 1; depois respeita o orçamento de tempo
    if (i > 0 && Date.now() - start > TIME_BUDGET_MS) {
      for (let j = i; j < queue.length; j++) remaining.push(queue[j].name);
      break;
    }
    const t = queue[i];
    try {
      doneTables[t.name] = await backupTable(supabase, stamp, t);
    } catch (e: any) {
      console.error(`[daily-backup] falha em ${t.name}:`, e?.message || e);
      errors.push(`${t.name}: ${e?.message || e}`);
    }
  }

  await mergeManifest(supabase, stamp, { tables: doneTables, errors, done: remaining.length === 0 });

  if (remaining.length > 0) {
    console.log(`[daily-backup] ${stamp}: lote com ${Object.keys(doneTables).length} tabela(s); encadeando ${remaining.length} restante(s)`);
    chainNext(remaining, stamp);
    return json({ ok: true, stamp, batch_done: Object.keys(doneTables).length, remaining: remaining.length, continued: true });
  }

  // Última leva: retenção + finaliza
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
  const removed = await applyRetention(supabase, cutoff);
  const finalManifest = await mergeManifest(supabase, stamp, { done: true });
  console.log(`[daily-backup] ${stamp} FINALIZADO: ${Object.keys(finalManifest.tables).length} tabelas, ${finalManifest.total_rows} linhas, ${(finalManifest.errors || []).length} erro(s), retenção removeu ${removed.length}`);
  return json({
    ok: true, stamp, done: true,
    tables: Object.keys(finalManifest.tables).length,
    total_rows: finalManifest.total_rows,
    errors: finalManifest.errors,
    retention_removed: removed,
  });
});

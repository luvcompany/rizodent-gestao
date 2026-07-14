// ==========================================================================
// daily-backup — export lógico diário das tabelas do CRClin para um bucket
// privado do Supabase Storage, com particionamento (bound de memória),
// manifesto e retenção automática.
//
// É um backup COMPLEMENTAR (snapshot lógico, self-owned). Para recuperação de
// desastre completa/point-in-time, use também os backups gerenciados do
// Supabase (plano Pro: Database > Backups + PITR).
//
// Chamadas permitidas (via _shared/internalAuth):
//   - pg_cron: header x-cron-secret = automation_cron_token
//   - função→função: Authorization: Bearer SERVICE_ROLE_KEY
//   - admin logado (crc/gerente) via JWT: para acionar "Backup agora" pela UI
//
// Formato: um NDJSON por tabela (particionado em .0000.ndjson, .0001.ndjson…),
// gravado em  <bucket>/<AAAA-MM-DD>/<tabela>.<parte>.ndjson  +  _manifest.json
// ==========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const BUCKET = Deno.env.get("BACKUP_BUCKET") || "crm-backups";
const RETENTION_DAYS = Math.max(Number(Deno.env.get("BACKUP_RETENTION_DAYS") || "30"), 1);
const PAGE_SIZE = 1000;
const ROWS_PER_PART = 15000; // ~10-15 MB por arquivo; limita o pico de memória

// Tabelas que NÃO entram no export (segredos de infra / estado efêmero de OAuth).
// Secrets são reprovisionáveis; não devem ser espalhados em arquivos de backup.
const BLOCKLIST = new Set<string>([
  "_internal_secrets",
  "whatsapp_oauth_states",
  "instagram_oauth_states",
]);

type TableInfo = { name: string; orderBy: string | null };

async function listTables(supabase: any): Promise<TableInfo[]> {
  // Pega tabelas base do schema public + define uma coluna estável de ordenação
  // (id > created_at > nenhuma) para paginação consistente.
  const { data, error } = await supabase.rpc("backup_list_tables");
  if (!error && Array.isArray(data)) {
    return (data as any[])
      .filter((t) => !BLOCKLIST.has(t.table_name))
      .map((t) => ({ name: t.table_name, orderBy: t.order_col || null }));
  }
  // Fallback: sem a RPC, usa uma introspecção via information_schema por PostgREST
  // não é possível; então retorna vazio e loga (a RPC é criada por migration).
  console.error("[daily-backup] backup_list_tables indisponível:", error?.message);
  return [];
}

async function uploadPart(supabase: any, path: string, ndjson: string) {
  const body = new Blob([ndjson], { type: "application/x-ndjson" });
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: "application/x-ndjson",
    upsert: true,
  });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

async function backupTable(
  supabase: any,
  stamp: string,
  t: TableInfo,
): Promise<{ rows: number; parts: number }> {
  let from = 0;
  let total = 0;
  let part = 0;
  let buffer: string[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const path = `${stamp}/${t.name}.${String(part).padStart(4, "0")}.ndjson`;
    await uploadPart(supabase, path, buffer.join("\n") + "\n");
    part++;
    buffer = [];
  };

  // Loop de paginação
  // Limite de segurança para não rodar indefinidamente em caso de tabela gigante.
  const MAX_ROWS = 2_000_000;
  while (from < MAX_ROWS) {
    let q = supabase.from(t.name).select("*").range(from, from + PAGE_SIZE - 1);
    if (t.orderBy) q = q.order(t.orderBy, { ascending: true });
    const { data, error } = await q;
    if (error) {
      console.error(`[daily-backup] erro lendo ${t.name} (range ${from}):`, error.message);
      break; // não aborta o backup inteiro; grava o que já leu
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

async function applyRetention(supabase: any, cutoff: string): Promise<string[]> {
  const removed: string[] = [];
  const { data: folders, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) {
    console.error("[daily-backup] retenção: erro listando raiz:", error.message);
    return removed;
  }
  for (const f of folders || []) {
    const name = f.name;
    // Só pastas com nome de data AAAA-MM-DD e anteriores ao cutoff
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: cron secret, service-role, ou admin logado (crc/gerente).
  const auth = await authorizeInternal(req, supabase, {
    cronSecretName: "automation_cron_token",
    allowUserJwt: true,
  });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);
  if (auth.via === "user_jwt") {
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId)
      .in("role", ["crc", "gerente"])
      .maybeSingle();
    if (!role) return unauthorizedResponse(corsHeaders);
  }

  // Ação: 'run' (padrão) | 'list' | 'download'
  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const action = String(body.action || "run");

  // Garante o bucket privado
  try {
    await supabase.storage.createBucket(BUCKET, { public: false });
  } catch (_) {
    /* já existe */
  }

  if (action === "list") {
    const { data: folders } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
    const dates = (folders || [])
      .map((f: any) => f.name)
      .filter((n: string) => /^\d{4}-\d{2}-\d{2}$/.test(n))
      .sort()
      .reverse();
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
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10); // AAAA-MM-DD (UTC)
  const startedAt = now.toISOString();

  const tables = await listTables(supabase);
  if (tables.length === 0) {
    return json({ error: "Nenhuma tabela para backup (RPC backup_list_tables ausente?)" }, 500);
  }

  const manifest: Record<string, any> = {
    stamp,
    started_at: startedAt,
    bucket: BUCKET,
    retention_days: RETENTION_DAYS,
    tables: {} as Record<string, { rows: number; parts: number }>,
    errors: [] as string[],
  };

  for (const t of tables) {
    try {
      const res = await backupTable(supabase, stamp, t);
      manifest.tables[t.name] = res;
    } catch (e: any) {
      console.error(`[daily-backup] falha em ${t.name}:`, e?.message || e);
      manifest.errors.push(`${t.name}: ${e?.message || e}`);
    }
  }

  const totalRows = Object.values(manifest.tables).reduce((a: number, b: any) => a + b.rows, 0);
  manifest.total_rows = totalRows;
  manifest.finished_at = new Date().toISOString();

  // Grava o manifesto
  try {
    await uploadPart(supabase, `${stamp}/_manifest.json`, JSON.stringify(manifest, null, 2));
  } catch (e: any) {
    console.error("[daily-backup] erro gravando manifesto:", e?.message || e);
  }

  // Retenção
  const cutoffDate = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
  const removed = await applyRetention(supabase, cutoffDate);

  console.log(
    `[daily-backup] concluído ${stamp}: ${Object.keys(manifest.tables).length} tabelas, ${totalRows} linhas, ${manifest.errors.length} erros, retenção removeu ${removed.length} pasta(s)`,
  );

  return json({
    ok: true,
    stamp,
    tables: Object.keys(manifest.tables).length,
    total_rows: totalRows,
    errors: manifest.errors,
    retention_removed: removed,
  });

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

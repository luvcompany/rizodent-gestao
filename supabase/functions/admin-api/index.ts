// @ts-nocheck
// Admin API for Rizodent tenant — API Key authenticated (Bearer).
// Routes: /leads, /leads/:id, /leads/:id/messages, /leads/:id/send,
//         /conversations, /appointments, /tasks, /reports/overview,
//         /reports/funnel, /reports/by-source
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const TENANT_ID = "00000000-0000-0000-0000-000000000010"; // Rizodent

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function authOk(req: Request) {
  const key = Deno.env.get("RIZODENT_ADMIN_API_KEY");
  if (!key) return false;
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  const xKey = (req.headers.get("x-api-key") || "").trim();
  return token === key || xKey === key;
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
  if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
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
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!authOk(req)) return json({ error: "Unauthorized — provide API key as Bearer token or x-api-key header" }, 401);

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
    if (parts[0] === "appointments") return await appointments(req.method, p, body, parts[1]);
    if (parts[0] === "tasks") return await tasks(req.method, p, body, parts[1]);
    if (parts[0] === "reports") {
      if (parts[1] === "overview") return await reportOverview(p);
      if (parts[1] === "funnel") return await reportFunnel(p);
      if (parts[1] === "by-source") return await reportBySource(p);
    }
    return json({ error: "not_found", path, method: req.method }, 404);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

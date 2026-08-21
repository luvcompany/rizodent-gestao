// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = [
  "https://crclin.com.br",
  "https://www.crclin.com.br",
  "https://app.crclin.com.br",
  "https://rizodent-gestao.lovable.app",
];
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  /^https:\/\/[a-z0-9-]+\.lovable\.dev$/i,
];
function buildCors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed =
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  const allowed = isAllowed ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const jsonWith = (cors: Record<string, string>) => (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req);
  const json = jsonWith(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { slug, email, password } = await req.json().catch(() => ({}));
    if (!slug || !email || !password) return json({ error: "Dados incompletos." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent") ?? null;

    // Resposta genérica: nunca revelar se o e-mail existe, se pertence a outro
    // cliente ou se está bloqueado. O motivo real vai só para access_logs.
    const GENERIC = "E-mail ou senha inválidos.";

    // Rate limit: falhas E bloqueios contam, por e-mail E por IP.
    // Fail-CLOSED: se a consulta de logs falhar, recusamos (antes era fail-open,
    // o que permitia derrubar o limite provocando erro na leitura dos logs).
    try {
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const events = ["login_failed", "login_blocked"];
      const [{ count: emailCount, error: e1 }, ipRes] = await Promise.all([
        admin
          .from("access_logs")
          .select("id", { count: "exact", head: true })
          .eq("email", email)
          .in("event", events)
          .gte("created_at", since),
        ip
          ? admin
              .from("access_logs")
              .select("id", { count: "exact", head: true })
              .eq("ip", ip)
              .in("event", events)
              .gte("created_at", since)
          : Promise.resolve({ count: 0, error: null } as any),
      ]);
      if (e1 || ipRes?.error) throw e1 || ipRes.error;
      if ((emailCount ?? 0) >= 10 || (ipRes?.count ?? 0) >= 30) {
        return json({ error: "Muitas tentativas. Tente novamente em alguns minutos." }, 429);
      }
    } catch (_e) {
      return json({ error: "Muitas tentativas. Tente novamente em alguns minutos." }, 429);
    }

    // 1) Resolver tenant pelo slug
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .select("id, status")
      .eq("slug", slug)
      .maybeSingle();
    // Slug inexistente => resposta genérica (não enumera clientes).
    if (tErr || !tenant) {
      try {
        await admin.from("access_logs").insert({
          user_id: null, email, tenant_id: null, context: "client",
          event: "login_failed", ip, user_agent: ua, metadata: { reason: "no_tenant", slug },
        });
      } catch (_e) { /* swallow */ }
      return json({ error: GENERIC }, 401);
    }
    if (tenant.status === "paused") return json({ error: "O acesso deste cliente está pausado." }, 403);
    if (tenant.status === "deleted") return json({ error: "Cliente desativado." }, 403);

    const logAttempt = async (event: string, userId: string | null, extra?: any) => {
      try {
        await admin.from("access_logs").insert({
          user_id: userId,
          email,
          tenant_id: tenant.id,
          context: "client",
          event,
          ip,
          user_agent: ua,
          metadata: extra ?? {},
        });
      } catch (_e) { /* swallow */ }
    };

    // 2) Verifica se o profile com esse email pertence a este tenant
    const { data: prof } = await admin
      .from("profiles")
      .select("id, tenant_id, is_blocked")
      .eq("email", email)
      .maybeSingle();

    // Respostas UNIFICADAS: no_profile / tenant_mismatch / user_blocked devolvem
    // sempre 401 genérico. O motivo real fica apenas no access_logs.
    if (!prof) {
      await logAttempt("login_failed", null, { reason: "no_profile" });
      return json({ error: GENERIC }, 401);
    }

    if (prof.tenant_id !== tenant.id) {
      await logAttempt("login_blocked", prof.id, { reason: "tenant_mismatch", attempted_tenant: tenant.id });
      return json({ error: GENERIC }, 401);
    }

    if (prof.is_blocked) {
      await logAttempt("login_blocked", prof.id, { reason: "user_blocked" });
      return json({ error: GENERIC }, 401);
    }

    // 3) Autentica via cliente anônimo (gera sessão real)
    const userClient = createClient(SUPABASE_URL, ANON);
    const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData.session) {
      await logAttempt("login_failed", prof.id, { reason: "bad_password" });
      return json({ error: GENERIC }, 401);
    }

    await logAttempt("login", prof.id);
    try { await admin.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", prof.id); } catch (_e) {}

    return json({
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
      },
    });
  } catch (e: any) {
    return json({ error: e?.message || "Erro interno." }, 500);
  }
});

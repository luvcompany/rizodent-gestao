// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { slug, email, password } = await req.json().catch(() => ({}));
    if (!slug || !email || !password) return json({ error: "Dados incompletos." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Resolver tenant pelo slug
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .select("id, status")
      .eq("slug", slug)
      .maybeSingle();
    if (tErr || !tenant) return json({ error: "Cliente não encontrado." }, 404);
    if (tenant.status === "paused") return json({ error: "O acesso deste cliente está pausado." }, 403);
    if (tenant.status === "deleted") return json({ error: "Cliente desativado." }, 403);

    const ip = req.headers.get("x-forwarded-for") ?? null;
    const ua = req.headers.get("user-agent") ?? null;

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

    if (!prof) {
      await logAttempt("login_failed", null, { reason: "no_profile" });
      return json({ error: "E-mail ou senha inválidos." }, 401);
    }

    if (prof.tenant_id !== tenant.id) {
      // tentativa cross-tenant — log explícito para auditoria
      await logAttempt("login_blocked", prof.id, { reason: "tenant_mismatch", attempted_tenant: tenant.id });
      return json({ error: "Esta conta não pertence a este cliente." }, 403);
    }

    if (prof.is_blocked) {
      await logAttempt("login_blocked", prof.id, { reason: "user_blocked" });
      return json({ error: "Seu acesso foi bloqueado pelo administrador." }, 403);
    }

    // 3) Autentica via cliente anônimo (gera sessão real)
    const userClient = createClient(SUPABASE_URL, ANON);
    const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData.session) {
      await logAttempt("login_failed", prof.id, { reason: "bad_password" });
      return json({ error: "E-mail ou senha inválidos." }, 401);
    }

    await logAttempt("login", prof.id);

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

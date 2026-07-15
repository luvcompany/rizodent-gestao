// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Slugs que quebrariam o roteamento (têm que bater com RESERVED_PATHS/SUBDOMAIN_SKIP em src/main.tsx)
const RESERVED_SLUGS = new Set(["", "admin", "change-password", "crclin", "privacidade", "termos", "exclusao-de-dados", "oauth-close", "www", "app", "api"]);
const PROTECTED = ["rizodent"];
const normalizeSlug = (s: string) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9-]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = auth.replace("Bearer ", "");
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const user = { id: claimsData.claims.sub as string };

    const admin = createClient(URL, SR);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { tenant_id, action, patch, confirm_name } = await req.json();
    if (!tenant_id || !action) return json({ error: "tenant_id and action required" }, 400);

    // -------- EDITAR --------
    if (action === "update") {
      const allowed: any = {};
      const fields = ["name", "primary_color", "secondary_color", "tertiary_color", "logo_url", "logo_dark_url", "favicon_url", "status", "timezone", "business_hours", "trial_ends_at"];
      for (const f of fields) if (patch?.[f] !== undefined) allowed[f] = patch[f];
      if (patch?.slug !== undefined) {
        const slug = normalizeSlug(patch.slug);
        if (!slug) return json({ error: "Slug inválido (vazio após normalização). Use letras, números e hífen." }, 400);
        if (RESERVED_SLUGS.has(slug)) return json({ error: `O slug "${slug}" é reservado e deixaria o cliente inacessível. Escolha outro.` }, 400);
        const { data: clash } = await admin.from("tenants").select("id").eq("slug", slug).neq("id", tenant_id).maybeSingle();
        if (clash) return json({ error: `O slug "${slug}" já está em uso por outro cliente.` }, 400);
        allowed.slug = slug;
      }
      if (Object.keys(allowed).length === 0) return json({ error: "Nada para atualizar." }, 400);
      const { data, error } = await admin.from("tenants").update(allowed).eq("id", tenant_id).select().single();
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: user.id, tenant_id, context: "admin", event: "tenant_update", metadata: allowed });
      return json({ tenant: data });
    }

    // -------- UPLOAD DE LOGO/FAVICON (via service role — ignora RLS do Storage) --------
    if (action === "upload_logo") {
      const kind = String(patch?.kind ?? "logo");
      const ext = (String(patch?.ext ?? "png").replace(/[^a-z0-9]/gi, "").toLowerCase()) || "png";
      const b64 = String(patch?.data_base64 ?? "");
      const contentType = String(patch?.content_type ?? "image/png");
      if (!b64) return json({ error: "Sem dados de imagem." }, 400);
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch (_) {
        return json({ error: "Imagem inválida (base64)." }, 400);
      }
      const path = `${tenant_id}/${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await admin.storage.from("tenant-logos").upload(path, bytes, { upsert: true, contentType });
      if (upErr) return json({ error: upErr.message }, 400);
      const { data: pub } = admin.storage.from("tenant-logos").getPublicUrl(path);
      return json({ ok: true, url: pub.publicUrl });
    }

    // -------- EXCLUIR (SOFT → Lixeira) --------
    if (action === "delete") {
      const { data: tRow } = await admin.from("tenants").select("slug").eq("id", tenant_id).maybeSingle();
      if (tRow && PROTECTED.includes(String(tRow.slug).toLowerCase())) {
        return json({ error: "Este cliente é protegido e não pode ser excluído." }, 403);
      }
      const { error } = await admin.from("tenants").update({ status: "deleted", deleted_at: new Date().toISOString() }).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: user.id, tenant_id, context: "admin", event: "tenant_soft_delete" });
      return json({ ok: true, status: "deleted" });
    }

    // -------- RESTAURAR (da Lixeira) --------
    if (action === "restore") {
      const { error } = await admin.from("tenants").update({ status: "active", deleted_at: null }).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: user.id, tenant_id, context: "admin", event: "tenant_restore" });
      return json({ ok: true, status: "active" });
    }

    // -------- EXCLUIR DEFINITIVAMENTE (purga irreversível) --------
    if (action === "hard_delete") {
      const { data: tRow } = await admin.from("tenants").select("slug, name").eq("id", tenant_id).maybeSingle();
      if (!tRow) return json({ error: "Cliente não encontrado." }, 404);
      if (PROTECTED.includes(String(tRow.slug).toLowerCase())) {
        return json({ error: "Este cliente é protegido e não pode ser excluído." }, 403);
      }
      // Confirmação forte: precisa digitar exatamente o nome do cliente.
      if (!confirm_name || String(confirm_name).trim() !== String(tRow.name).trim()) {
        return json({ error: "Confirmação inválida: digite exatamente o nome do cliente para excluir definitivamente." }, 400);
      }
      const { data: rpcData, error: rpcErr } = await admin.rpc("hard_delete_tenant", { _tenant_id: tenant_id });
      if (rpcErr) return json({ error: rpcErr.message }, 400);
      const userIds: string[] = Array.isArray((rpcData as any)?.user_ids) ? (rpcData as any).user_ids : [];
      for (const uid of userIds) { try { await admin.auth.admin.deleteUser(uid); } catch (_) { /* ignore */ } }
      // Limpa arquivos órfãos do Storage (logos/favicons do tenant).
      try {
        const { data: objs } = await admin.storage.from("tenant-logos").list(tenant_id);
        if (objs?.length) await admin.storage.from("tenant-logos").remove(objs.map((o: any) => `${tenant_id}/${o.name}`));
      } catch (_) { /* bucket pode não existir */ }
      // Loga SEM tenant_id (o tenant já não existe → evita violar FK).
      await admin.from("access_logs").insert({ user_id: user.id, tenant_id: null, context: "admin", event: "tenant_hard_delete", metadata: { tenant_id, name: tRow.name, removed_users: userIds.length } });
      return json({ ok: true, hard_deleted: true, removed_users: userIds.length });
    }

    // -------- PAUSAR / ATIVAR --------
    if (action === "pause" || action === "activate") {
      const status = action === "pause" ? "paused" : "active";
      const { error } = await admin.from("tenants").update({ status }).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: user.id, tenant_id, context: "admin", event: `tenant_${action}` });
      return json({ ok: true, status });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

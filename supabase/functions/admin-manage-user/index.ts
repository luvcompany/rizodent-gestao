// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { assertTenantRole, TENANT_ROLES as SHARED_TENANT_ROLES } from "../_shared/roles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Papéis atribuíveis a usuários de um cliente — fonte única em _shared/roles.ts.
const TENANT_ROLES = new Set<string>(SHARED_TENANT_ROLES);
const BAN_FOREVER = "876000h"; // ~100 anos

// Rodízio de SDRs (Fase 1): além do superadmin, o GESTOR DA EQUIPE do tenant
// usa esta porta — e só para isto. Gestor é o que o BANCO diz que é gestor:
// is_gestor_equipe() = superadmin OU crm_rodizio_config.gestor_user_id do
// tenant atual. NÃO existe ramo por papel ali de propósito: se bastasse "ser
// gerente", todo gerente de todo cliente passaria a criar conta no Auth e a
// trocar senha de terceiro — poder novo para um papel existente, o que a Fase 1
// proíbe. Quem gere a equipe é NOMEADO pelo superadmin, um a um.
// Ações liberadas ao gestor:
//   • create          → papel obrigatoriamente 'sdr', tenant SEMPRE o do gestor
//                       (o tenant_id do corpo é ignorado);
//   • reset_password  → alvo do tenant do gestor cujo ÚNICO papel é 'sdr';
//   • set_email       → idem (09/09: "trocar de SDR é só trocar nome e e-mail");
//                       derruba as sessões da conta (equipe_encerrar_sessoes);
//   • delete          → idem; ANTES de apagar, redistribui os leads dela pela
//                       RPC equipe_redistribuir_leads (caminho autorizado da
//                       regra de propriedade — um UPDATE direto seria
//                       preservado em silêncio pelo gatilho). Falhou a
//                       redistribuição → nada é apagado.
// Nome é RPC (equipe_editar_nome). Bloquear/desbloquear e ligar/desligar no
// rodízio são RPCs (equipe_bloquear, equipe_rodizio). set_role / block /
// unblock continuam exclusivos do superadmin. Um crc que não seja o gestor
// (ex.: o usuário do Meta App Review) recebe 403 como sempre recebeu.
const GESTOR_ROLE = "sdr";
const GESTOR_ACTIONS = new Set<string>(["create", "reset_password", "set_email", "delete"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function ensureProfile(admin: any, user: any, tenantId: string, nome?: string, cargo?: string | null, mustChangePassword = true) {
  const { error } = await admin
    .from("profiles")
    .upsert({
      id: user.id,
      nome: nome || user.user_metadata?.nome || user.email,
      email: user.email,
      tenant_id: tenantId,
      cargo: cargo || null,
      must_change_password: mustChangePassword,
    }, { onConflict: "id" });
  return error;
}

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
    const userId = claimsData.claims.sub;

    const admin = createClient(URL, SR);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "superadmin").maybeSingle();
    const isSuperadmin = !!roleRow;

    // Quem não é superadmin só passa se o BANCO disser que é gestor da equipe —
    // checado com o JWT do próprio usuário (fonte única de verdade com as RPCs).
    let gestorTenant: string | null = null;
    if (!isSuperadmin) {
      const { data: isGestor, error: gestorErr } = await userClient.rpc("is_gestor_equipe");
      if (gestorErr || isGestor !== true) return json({ error: "Forbidden" }, 403);
      const { data: callerProfile } = await admin.from("profiles").select("tenant_id, is_blocked").eq("id", userId).maybeSingle();
      if (!callerProfile?.tenant_id || callerProfile.is_blocked) return json({ error: "Forbidden" }, 403);
      gestorTenant = callerProfile.tenant_id;
    }
    const isGestor = !isSuperadmin;
    const logContext = isGestor ? "tenant" : "admin";

    const { action, tenant_id, user_id, email, password, nome, role, destino } = await req.json();
    const callerEmail = typeof claimsData.claims.email === "string" ? claimsData.claims.email : null;

    if (isGestor && !GESTOR_ACTIONS.has(action)) {
      return json({ error: "Ação reservada ao painel administrativo." }, 403);
    }

    if (action === "create") {
      // Gestor: o tenant é SEMPRE o dele e o papel só pode ser 'sdr'.
      const effTenant = isGestor ? gestorTenant : tenant_id;
      if (!effTenant || !email || !password) return json({ error: "missing fields" }, 400);
      if (isGestor && role !== GESTOR_ROLE) {
        return json({ error: "O gestor da equipe só cria usuárias com papel SDR." }, 400);
      }
      // NUNCA rebaixar em silêncio: antes, papel desconhecido virava "crc" —
      // criando um ADMIN da clínica quando se pediu "recepcao", sem erro algum.
      const roleCheck = assertTenantRole(role ?? "crc");
      if (!roleCheck.ok) return json({ error: roleCheck.error }, 400);
      const wantRole = roleCheck.role;
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nome: nome || email, tenant_id: effTenant, must_change_password: true },
      });
      if (error) return json({ error: error.message }, 400);

      const profErr = await ensureProfile(admin, created.user, effTenant, nome || email, null, true);
      if (profErr) return json({ error: `Falha ao criar perfil: ${profErr.message}` }, 500);

      // O insert em user_roles dispara no banco: concede_numeros_ao_novo_usuario
      // (sdr → só o número principal) e sdr_prepara_novo_membro (membro do
      // rodízio INATIVO + overrides dos funis gerais do tenant).
      const { error: roleErr } = await admin
        .from("user_roles")
        .upsert({ user_id: created.user.id, role: wantRole, tenant_id: effTenant }, { onConflict: "user_id,role" });
      if (roleErr) return json({ error: `Falha ao atribuir papel: ${roleErr.message}` }, 500);

      if (isGestor) {
        await admin.from("access_logs").insert({ user_id: userId, tenant_id: effTenant, context: logContext, event: "sdr_create", metadata: { target: created.user.id, email } });
      }

      return json({ user_id: created.user.id, role: wantRole });
    }

    if (!user_id) return json({ error: "user_id required" }, 400);

    // Nunca agir sobre si mesmo por esta porta (auto-bloqueio/auto-delete/escalada).
    if (user_id === userId) return json({ error: "Não é possível executar esta ação sobre a própria conta." }, 400);

    // tenant do alvo: SEMPRE do profile. Se vier tenant_id no corpo e divergir,
    // é tentativa de mover/registrar o usuário em outro cliente => 400.
    const { data: targetProfile } = await admin.from("profiles").select("tenant_id").eq("id", user_id).maybeSingle();
    const targetTenant = targetProfile?.tenant_id || null;
    if (tenant_id && targetTenant && tenant_id !== targetTenant) {
      return json({ error: "tenant_id divergente do usuário alvo." }, 400);
    }

    // Alvo superadmin da plataforma é intocável por esta função.
    const { data: targetRoles } = await admin.from("user_roles").select("role").eq("user_id", user_id);
    if ((targetRoles || []).some((r: any) => r.role === "superadmin")) {
      return json({ error: "Este usuário é administrador da plataforma e não pode ser alterado aqui." }, 403);
    }

    // Gestor: alvo do MESMO tenant e cujo único papel é 'sdr' — nunca outro
    // crc, gerente, closer, recepção ou pós-venda.
    if (isGestor) {
      if (!targetTenant || targetTenant !== gestorTenant) return json({ error: "Forbidden" }, 403);
      const roles = (targetRoles || []).map((r: any) => r.role);
      if (roles.length === 0 || roles.some((r: string) => r !== GESTOR_ROLE)) {
        return json({ error: "O gestor da equipe só altera usuárias com papel SDR." }, 403);
      }
    }

    if (action === "block") {
      // Revoga a sessão de verdade (ban no auth) + marca no perfil.
      try { await admin.auth.admin.updateUserById(user_id, { ban_duration: BAN_FOREVER }); } catch (_) { /* ignore */ }
      await admin.from("profiles").update({ is_blocked: true, blocked_at: new Date().toISOString(), blocked_by: userId }).eq("id", user_id);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_block", metadata: { target: user_id } });
      return json({ ok: true });
    }
    if (action === "unblock") {
      try { await admin.auth.admin.updateUserById(user_id, { ban_duration: "none" }); } catch (_) { /* ignore */ }
      await admin.from("profiles").update({ is_blocked: false, blocked_at: null, blocked_by: null }).eq("id", user_id);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_unblock", metadata: { target: user_id } });
      return json({ ok: true });
    }
    if (action === "reset_password") {
      if (!password || String(password).length < 6) return json({ error: "A senha precisa ter ao menos 6 caracteres." }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ must_change_password: true }).eq("id", user_id);
      await admin.from("access_logs").insert({
        user_id: userId, tenant_id: targetTenant, context: logContext,
        event: isGestor ? "sdr_reset_password" : "user_reset_password",
        metadata: { target: user_id },
      });
      return json({ ok: true });
    }
    if (action === "set_role") {
      const setRoleCheck = assertTenantRole(role);
      if (!setRoleCheck.ok) return json({ error: setRoleCheck.error }, 400);
      if (!targetTenant) return json({ error: "Usuário sem tenant." }, 400);
      // Papel 'sdr' já é exatamente este: nada a fazer. Evita o DELETE+INSERT
      // que dispararia os gatilhos de saída/entrada à toa e tiraria a SDR do
      // rodízio (crm_rodizio_membros.ativo).
      //
      // O atalho é CERCADO ao papel novo de propósito, espelhando o retorno
      // antecipado de tenant_set_user_role na migration 20260908150000: para
      // crc, gerente, pós-venda, recepção e closer o comportamento de produção
      // é o DELETE+INSERT SEMPRE — inclusive o efeito colateral de que
      // reaplicar o papel re-dispara concede_numeros_ao_novo_usuario e recompõe
      // overrides de número revogados, e o registro user_set_role em
      // access_logs. Generalizar o atalho mudaria o contrato desses papéis.
      const papeisAtuais = (targetRoles || []).map((r: any) => r.role).filter((r: string) => TENANT_ROLES.has(r));
      if (setRoleCheck.role === "sdr" && papeisAtuais.length === 1 && papeisAtuais[0] === "sdr") {
        return json({ ok: true, role: setRoleCheck.role, unchanged: true });
      }
      // Um usuário tem um papel: remove os antigos e define o novo.
      // IMPORTANTE: apaga só papéis de tenant — nunca `superadmin`.
      await admin
        .from("user_roles")
        .delete()
        .eq("user_id", user_id)
        .in("role", [...SHARED_TENANT_ROLES]);
      const { error } = await admin.from("user_roles").upsert({ user_id, role: setRoleCheck.role, tenant_id: targetTenant }, { onConflict: "user_id,role" });
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_set_role", metadata: { target: user_id, role } });
      return json({ ok: true, role: setRoleCheck.role });
    }
    // Alvo cujo único papel é 'sdr' (para o superadmin também): é o caso em que
    // as RPCs da equipe (sessões, redistribuição) se aplicam.
    const alvoRoles = (targetRoles || []).map((r: any) => r.role);
    const alvoSoSdr = alvoRoles.length > 0 && alvoRoles.every((r: string) => r === GESTOR_ROLE);

    if (action === "set_email") {
      const novoEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (!novoEmail || !EMAIL_RE.test(novoEmail)) return json({ error: "Informe um e-mail válido." }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { email: novoEmail, email_confirm: true });
      if (error) {
        const dup = /already|exists|registered/i.test(error.message);
        return json({ error: dup ? "Já existe uma conta com este e-mail." : error.message }, 400);
      }
      await admin.from("profiles").update({ email: novoEmail }).eq("id", user_id);
      // Trocou a pessoa por trás do login: a anterior não continua logada.
      let sessoes: number | null = null;
      if (alvoSoSdr) {
        const { data: n, error: sErr } = await admin.rpc("equipe_encerrar_sessoes", { p_user_id: user_id });
        if (!sErr && typeof n === "number") sessoes = n;
      }
      await admin.from("access_logs").insert({
        user_id: userId, tenant_id: targetTenant, context: logContext,
        event: isGestor ? "sdr_set_email" : "user_set_email",
        metadata: { target: user_id, email: novoEmail, sessoes_encerradas: sessoes },
      });
      return json({ ok: true, sessoes_encerradas: sessoes });
    }
    if (action === "delete") {
      let redistribuicao: any = null;
      if (alvoSoSdr) {
        // SDR: os leads dela têm dona protegida (trg_zz_propriedade_lead) — só
        // a RPC autorizada os move. Falhou → não apaga nada.
        const dest = typeof destino === "string" && ["auto", "rodizio", "gestor"].includes(destino) ? destino : "auto";
        const { data, error: rErr } = await admin.rpc("equipe_redistribuir_leads", {
          p_user_id: user_id, p_destino: dest,
          p_motivo: `conta excluída${callerEmail ? ` por ${callerEmail}` : ""}`,
        });
        if (rErr) return json({ error: `Não foi possível redistribuir os leads dela (nada foi apagado): ${rErr.message}` }, 400);
        redistribuicao = data ?? null;
      } else {
        // Outros papéis: solta os leads antes de remover (evita órfãos).
        try { await admin.from("crm_leads").update({ assigned_to: null }).eq("assigned_to", user_id); } catch (_) { /* ignore */ }
      }
      await admin.from("user_roles").delete().eq("user_id", user_id);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({
        user_id: userId, tenant_id: targetTenant, context: logContext,
        event: isGestor ? "sdr_delete" : "user_delete",
        metadata: { target: user_id, redistribuicao },
      });
      return json({ ok: true, redistribuicao });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

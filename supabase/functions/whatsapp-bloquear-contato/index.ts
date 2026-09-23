/**
 * Bloquear / desbloquear um contato NA META (não só no CRClin).
 *
 * Hoje o botão "Bloquear lead" só marca crm_leads.is_blocked: o card some da
 * tela e a pessoa continua mandando mensagem para o número da clínica. Esta
 * function chama a Block Users API da Cloud API, que corta de verdade.
 *
 * Regras da Meta que moldam o comportamento aqui:
 *  - só dá para bloquear quem mandou mensagem nas últimas 24 h (erro 131047);
 *  - a resposta pode ser PARCIAL: added_users + failed_users + error 139100;
 *  - 139102 (duas chamadas mexendo na lista ao mesmo tempo) e 139103/130429
 *    pedem nova tentativa; os outros são definitivos.
 *
 * Esta function NUNCA derruba o bloqueio local: o front já marcou o lead antes
 * de chamar aqui, e a resposta diz só se a Meta aceitou.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { resolveCaller, callerHasRole } from "../_shared/authz.ts";
import { escopoDoLead } from "../_shared/wabaEscopo.ts";
import { BASE_GRAPH_META } from "../_shared/metaVersao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Mensagem em português para o código que a Meta devolveu. */
function motivoDaFalha(codigo: number | null, texto: string): string {
  switch (codigo) {
    case 131047:
      return "A Meta só deixa bloquear quem mandou mensagem nas últimas 24 horas. O lead foi bloqueado no CRClin; o bloqueio na Meta pode ser feito quando ele escrever de novo.";
    case 139101:
      return "A lista de bloqueados da Meta está cheia (limite de 64 mil números).";
    case 131021:
      return "Não dá para bloquear o próprio número da clínica.";
    case 130429:
      return "A Meta está limitando as chamadas agora. Tente de novo em alguns minutos.";
    case 139102:
      return "Outra alteração na lista de bloqueados estava em andamento. Tente de novo.";
    case 139103:
      return "Erro interno da Meta ao bloquear. Tente de novo.";
    default:
      return texto || "A Meta recusou o bloqueio.";
  }
}

const RETENTAR = new Set([139102, 139103, 130429]);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const caller = await resolveCaller(req, admin);
    if (!caller.ok) return json({ error: caller.error }, caller.status);

    // Bloquear na Meta é decisão de gestão: a SDR continua marcando o lead como
    // bloqueado só no CRClin (o update dela em crm_leads não passa por aqui).
    const podeBloquearNaMeta =
      caller.isServiceRole ||
      caller.isSuperadmin ||
      callerHasRole(caller, "crc") ||
      callerHasRole(caller, "gerente");
    if (!podeBloquearNaMeta) {
      return json({ error: "Só a gestão pode bloquear o contato na Meta." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const leadId = String(body?.lead_id || "").trim();
    const acao = String(body?.acao || "bloquear").trim();
    if (!leadId) return json({ error: "lead_id é obrigatório" }, 400);
    if (acao !== "bloquear" && acao !== "desbloquear") {
      return json({ error: "acao deve ser 'bloquear' ou 'desbloquear'" }, 400);
    }

    const { data: lead } = await admin
      .from("crm_leads")
      .select("id, phone, tenant_id, whatsapp_number_id, name")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return json({ error: "Lead não encontrado" }, 404);

    // Isolamento por cliente: ninguém age em lead de outro tenant.
    if (!caller.isServiceRole && !caller.isSuperadmin && caller.tenantId !== (lead as any).tenant_id) {
      return json({ error: "Lead de outro cliente" }, 403);
    }

    const telefone = String((lead as any).phone || "").replace(/\D/g, "");
    if (!telefone) return json({ error: "Lead sem telefone", ok: false }, 400);

    // Credenciais do MUNDO do lead (o número que o trouxe), a mesma regra do envio.
    const escopo = await escopoDoLead(admin, {
      whatsapp_number_id: (lead as any).whatsapp_number_id ?? null,
      tenant_id: (lead as any).tenant_id ?? null,
    });
    if (!escopo.phoneNumberId || !escopo.token) {
      return json({ ok: false, motivo: "Número do lead sem credenciais de WhatsApp." }, 200);
    }

    const url = `${BASE_GRAPH_META}/${encodeURIComponent(escopo.phoneNumberId)}/block_users`;
    const payload = { messaging_product: "whatsapp", block_users: [{ user: telefone }] };

    let resposta: any = null;
    let httpStatus = 0;
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const res = await fetch(url, {
        method: acao === "bloquear" ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${escopo.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      httpStatus = res.status;
      resposta = await res.json().catch(() => ({}));

      const codigoTopo = Number(resposta?.error?.code) || null;
      const codigoItem = Number(resposta?.block_users?.failed_users?.[0]?.errors?.[0]?.code) || null;
      const codigo = codigoItem ?? codigoTopo;
      if (!codigo || !RETENTAR.has(codigo) || tentativa === 2) break;
      await espera(700);
    }

    const bloco = resposta?.block_users ?? {};
    const listaOk = acao === "bloquear" ? bloco.added_users : bloco.removed_users;
    const sucesso = Array.isArray(listaOk) && listaOk.length > 0;
    const falha = Array.isArray(bloco.failed_users) ? bloco.failed_users[0] : null;
    const codigo =
      Number(falha?.errors?.[0]?.code) || Number(resposta?.error?.code) || null;
    const textoErro =
      falha?.errors?.[0]?.message || resposta?.error?.message || (httpStatus >= 400 ? `HTTP ${httpStatus}` : "");

    await admin.from("whatsapp_bloqueios").insert({
      tenant_id: (lead as any).tenant_id,
      lead_id: leadId,
      telefone,
      wa_id: (listaOk?.[0]?.wa_id ?? falha?.wa_id ?? null),
      phone_number_id: escopo.phoneNumberId,
      acao,
      sucesso,
      erro_codigo: sucesso ? null : codigo,
      erro_texto: sucesso ? null : String(textoErro || "").slice(0, 400),
      feito_por: caller.userId,
    });

    if (sucesso) {
      return json({
        ok: true,
        acao,
        wa_id: listaOk[0]?.wa_id ?? null,
        mensagem: acao === "bloquear" ? "Contato bloqueado na Meta." : "Contato desbloqueado na Meta.",
      });
    }

    console.warn(
      `[whatsapp-bloquear-contato] ${acao} falhou lead=${leadId} code=${codigo ?? "-"} http=${httpStatus}`,
    );
    return json({ ok: false, acao, codigo, motivo: motivoDaFalha(codigo, String(textoErro || "")) });
  } catch (e) {
    // Nunca derruba o fluxo do front: o bloqueio local já aconteceu.
    console.error("[whatsapp-bloquear-contato] erro inesperado:", e);
    return json({ ok: false, motivo: "Erro inesperado ao falar com a Meta." });
  }
});

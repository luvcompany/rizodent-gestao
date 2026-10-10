/**
 * sync-whatsapp-templates-cron
 *
 * Chamado pelo pg_cron a cada 5 minutos.
 * Sincroniza os modelos de mensagem com a Meta, atualizando o status
 * (PENDING → APPROVED/REJECTED).
 *
 * Uma passada por CONTA (cliente + WABA), não por integração: o modelo é da
 * conta. Antes, com o oficial (whatsapp_config) e o "Comercial 2" na mesma
 * WABA, cada passada regravava o whatsapp_number_id que a outra tinha gravado —
 * os 154 modelos trocavam de número a cada 5 minutos (400 mil UPDATEs). A
 * regra de qual número fica com o modelo, o que é regravado e o que acontece
 * com o modelo que sumiu da Meta está em _shared/modelosDaConta.ts.
 *
 * Autenticação: aceita apikey (anon key) — a Supabase gateway valida.
 * Internamente usa service_role para acesso irrestrito.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";
import {
  contasDasIntegracoes,
  type IntegracaoWhatsapp,
  listarModelosDaMeta,
  type NumeroDoCliente,
  numeroDaConta,
  sincronizarConta,
  tokensDaConta,
} from "../_shared/modelosDaConta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Autenticação: cron secret / service role (comparação segura no helper).
  const auth = await authorizeInternal(req, supabase, { cronSecretName: "sync_templates_cron_token" });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);

  // Integrações WhatsApp conectadas (todos os tenants) e os números de cada um.
  const [{ data: integrations, error: intgErr }, { data: numerosRaw, error: numErr }] = await Promise.all([
    supabase
      .from("integrations")
      .select("id, key, tenant_id, config")
      .eq("status", "connected")
      .like("key", "whatsapp%"),
    supabase
      .from("whatsapp_numbers")
      .select("id, tenant_id, waba_id, phone_number_id, is_active, is_default, created_at, mundo"),
  ]);

  if (intgErr || numErr) {
    return new Response(JSON.stringify({ error: (intgErr || numErr)!.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const numeros = (numerosRaw || []) as (NumeroDoCliente & { tenant_id: string })[];

  // Agrupa por conta. Integração sem token ou sem WABA não entra em conta nenhuma.
  const { contas, semCredencial } = contasDasIntegracoes((integrations || []) as IntegracaoWhatsapp[]);
  const results: {
    conta: string;
    integracoes: string[];
    numero: string | null;
    synced: number;
    inseridos: number;
    atualizados: number;
    marcados_excluidos: number;
    errors: string[];
  }[] = [];

  for (const intg of semCredencial) {
    results.push({
      conta: `${intg.tenant_id}|?`, integracoes: [intg.key], numero: null,
      synced: 0, inseridos: 0, atualizados: 0, marcados_excluidos: 0, errors: ["token ou waba_id ausente"],
    });
  }

  for (const conta of contas) {
    const numerosDoCliente = numeros.filter((n) => n.tenant_id === conta.tenantId);
    const pnids = conta.integracoes.map((i) => String(i.config?.phone_number_id || "")).filter(Boolean);
    const escolhido = numeroDaConta(numerosDoCliente, conta.wabaId, pnids);
    const pnidEscolhido = numerosDoCliente.find((n) => n.id === escolhido)?.phone_number_id ?? null;
    const errors: string[] = [];

    // Token: o da integração do número escolhido primeiro; se a Meta recusar
    // (token vencido de uma das integrações), tenta o das outras da mesma conta.
    let modelosMeta: any[] | null = null;
    for (const token of tokensDaConta(conta, pnidEscolhido)) {
      const listagem = await listarModelosDaMeta(conta.wabaId, token);
      if (listagem.ok) {
        modelosMeta = listagem.modelos;
        break;
      }
      errors.push(`Meta: ${listagem.erro}`);
    }

    const base = {
      conta: conta.chave,
      integracoes: conta.integracoes.map((i) => i.key),
      numero: escolhido,
    };

    // Sem a lista COMPLETA da Meta não se grava nem se remove nada.
    if (!modelosMeta) {
      results.push({ ...base, synced: 0, inseridos: 0, atualizados: 0, marcados_excluidos: 0, errors });
      continue;
    }

    try {
      const r = await sincronizarConta(supabase, {
        tenantId: conta.tenantId,
        wabaId: conta.wabaId,
        modelosMeta,
        numeros: numerosDoCliente,
        pnidsDaConta: pnids,
        papelDoChamador: null,
      });
      results.push({
        ...base,
        synced: modelosMeta.length,
        inseridos: r.inseridos,
        atualizados: r.atualizados,
        marcados_excluidos: r.marcadosExcluidos,
        errors: [...errors, ...r.erros],
      });
    } catch (err) {
      results.push({
        ...base, synced: 0, inseridos: 0, atualizados: 0, marcados_excluidos: 0,
        errors: [...errors, String(err)],
      });
    }
  }

  const totalSynced = results.reduce((s, r) => s + r.synced, 0);
  const totalAtualizados = results.reduce((s, r) => s + r.atualizados, 0);

  console.log(
    `[sync-whatsapp-templates-cron] ${new Date().toISOString()} — ` +
    `${contas.length} contas, ${totalSynced} modelos lidos, ${totalAtualizados} linhas regravadas`
  );

  return new Response(
    JSON.stringify({
      success: true,
      contas_processadas: contas.length,
      total_synced: totalSynced,
      total_atualizados: totalAtualizados,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

// Fecha a conversa dos leads que entraram em etapa de agendamento há X minutos
// (padrão 15) e ENVIA a pesquisa de satisfação — de verdade, pelo mesmo
// send-whatsapp-message que a tela e o automation-queue-worker já usam.
//
// Roda de minuto em minuto pelo cron. Todo o "quem pode fechar agora" está no
// banco (public.fechar_agendado_pendentes), que também é quem trava a
// concorrência; aqui só acontece o que o banco não sabe fazer: a chamada HTTP.
//
// A ORDEM IMPORTA, e é ela que impede a pesquisa fantasma:
//   1. conversa_fechar_automatico fecha e, se couber, CRIA a linha da pesquisa
//      e devolve o texto;
//   2. mandamos a mensagem;
//   3. se o envio falhar, pesquisa_envio_falhou APAGA a linha.
// Uma pesquisa que não saiu nunca fica marcada como enviada, e por isso nunca
// queima os 15 dias de silêncio do paciente.
//
// Por que a conversa fecha mesmo quando a pesquisa falha: fechar é o pedido
// principal do dono ("espera 15 minutos pra fechar"), e a conversa fechada não
// incomoda ninguém — a SDR reabre com um clique, e qualquer mensagem do
// paciente reabre sozinha.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const LOTE = 30;        // leads por execução; o cron roda a cada minuto
const PAUSA_MS = 350;   // respiro entre envios, para não empilhar no gateway

type Pesquisa = { resposta_id: string; texto: string; telefone: string; escala: string };
type Fechamento = {
  ok: boolean;
  ja_fechada?: boolean;
  pesquisa: Pesquisa | null;
  pesquisa_nao_enviada?: string | null;
  motivo?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Mesmo nome de segredo que o automation-queue-worker e o dontus-sync usam:
  // é o que o cron já sabe mandar em x-cron-secret.
  const auth = await authorizeInternal(req, supabase, { cronSecretName: "automation_cron_token" });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);

  const relatorio = {
    candidatos: 0,
    fechados: 0,
    ja_estavam_fechadas: 0,
    pesquisas_enviadas: 0,
    pesquisas_falharam: 0,
    sem_pesquisa: {} as Record<string, number>,
    erros: [] as string[],
  };

  try {
    const { data: pendentes, error: errPend } = await supabase.rpc("fechar_agendado_pendentes", {
      p_limite: LOTE,
    });
    if (errPend) throw new Error(`fechar_agendado_pendentes: ${errPend.message}`);

    const leads: string[] = (pendentes ?? [])
      .map((r: unknown) => (typeof r === "string" ? r : (r as { lead_id?: string })?.lead_id))
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

    relatorio.candidatos = leads.length;

    for (const leadId of leads) {
      try {
        const { data, error } = await supabase.rpc("conversa_fechar_automatico", { p_lead_id: leadId });
        if (error) throw new Error(`conversa_fechar_automatico: ${error.message}`);

        const r = (data ?? {}) as Fechamento;
        if (r.ja_fechada) { relatorio.ja_estavam_fechadas++; continue; }
        if (!r.ok) { relatorio.erros.push(`${leadId}: ${r.motivo ?? "recusado"}`); continue; }

        relatorio.fechados++;

        if (!r.pesquisa) {
          const motivo = r.pesquisa_nao_enviada ?? "sem_motivo";
          relatorio.sem_pesquisa[motivo] = (relatorio.sem_pesquisa[motivo] ?? 0) + 1;
          continue;
        }

        const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({
            lead_id: leadId,
            to: r.pesquisa.telefone,
            type: "text",
            message: r.pesquisa.texto,
          }),
        });

        const txt = await resp.text();
        let falhou = !resp.ok;
        if (!falhou) {
          // send-whatsapp-message pode devolver 200 com {error} no corpo.
          try { falhou = Boolean(JSON.parse(txt)?.error); } catch (_) { /* corpo não-JSON: vale o status */ }
        }

        if (falhou) {
          // Desfaz a marca de "enviada" para não mentir no relatório nem
          // consumir a janela de 15 dias do paciente.
          await supabase.rpc("pesquisa_envio_falhou", { p_resposta_id: r.pesquisa.resposta_id });
          relatorio.pesquisas_falharam++;
          relatorio.erros.push(`${leadId}: pesquisa ${resp.status} ${txt.substring(0, 160)}`);
        } else {
          relatorio.pesquisas_enviadas++;
        }

        await new Promise((res) => setTimeout(res, PAUSA_MS));
      } catch (e) {
        relatorio.erros.push(`${leadId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, ...relatorio }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), ...relatorio }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * "Estou aqui, nesta conversa, agora."
 *
 * Carimba crm_leads.em_atendimento_por/_em pela RPC conversa_estou_aqui. Dois
 * relógios do sistema respeitam esse carimbo e não atropelam quem está
 * atendendo:
 *   • a realocação por silêncio não tira da dona um lead carimbado há poucos
 *     minutos (crm_rodizio_config.presenca_segura_min) — é a resposta ao relato
 *     do dono em 11/09: "ela já estava pra responder" e o lead foi transferido
 *     no meio;
 *   • o fechamento automático depois do agendamento adia em vez de fechar por
 *     cima da conversa aberta.
 *
 * POR QUE VIROU HOOK: o efeito vivia dentro de CrmConversas.tsx (a tela de
 * lista + chat). A página /crm/conversa/:id — que é a que a SDR abre pelo
 * Kanban e pela notificação, e onde ela agenda — não tinha nada disso, então
 * justamente no caminho mais usado ela ficava desprotegida nos dois relógios.
 *
 * Renova a cada minuto e PARA quando a aba perde a visibilidade, de propósito:
 * quem deixou a tela aberta e foi embora não segura o lead. Falha em silêncio
 * porque presença é conforto, não pode quebrar o chat — e porque o site pode
 * estar publicado antes de a migration da RPC existir.
 */
export function usePresencaNaConversa(leadId: string | null | undefined) {
  useEffect(() => {
    if (!leadId) return;
    const carimbar = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (supabase as any).rpc("conversa_estou_aqui", { p_lead_id: leadId }).then(() => {}, () => {}); }
      catch { /* presença é best-effort */ }
    };
    carimbar();
    const t = window.setInterval(carimbar, 60_000);
    document.addEventListener("visibilitychange", carimbar);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", carimbar);
    };
  }, [leadId]);
}

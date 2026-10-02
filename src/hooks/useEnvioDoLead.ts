import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  FRASE_SEM_ACESSO_AO_NUMERO,
  FRASE_WABA_PAUSADA,
  PLACEHOLDER_PAUSADO,
  fraseNumeroDesconectado,
  fraseWhatsappDesconectado,
} from "@/lib/erroDoEnvio";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Por qual número de WhatsApp o servidor vai falar com o lead, e se dá para
 * enviar agora — S29P-3c (WABA pausada) e CRC-11 (cliente sem número).
 *
 * Fonte: RPC numero_de_envio_do_lead (migration 20260929002260), que resolve o
 * número na MESMA ordem do send-whatsapp-message (carimbo do lead → canal do
 * funil → número padrão) e diz conectado/pronto/pausado/acessivel. O compositor e os
 * cartões do chat (sugestão da IA, cartão de agendamento, encaminhar) mostram
 * o selo e desligam o envio ANTES de a pessoa escrever, em vez de deixar
 * escrever e só falhar no fim.
 *
 * Regra de ouro (corrida do papel no boot): só bloqueia com a resposta do
 * banco em mãos. Carregando, RPC ausente (ambiente sem a migration) ou erro
 * de rede = sem bloqueio — o servidor continua recusando de verdade.
 *
 * Uma consulta por lead, compartilhada pelo react-query entre os componentes
 * (chave ["envio-do-lead", leadId]).
 */

export type NumeroDeEnvio = {
  /** Nulo quando quem chama não tem acesso ao número (acessivel=false). */
  numero_id: string | null;
  tenant_id: string;
  nome: string | null;
  phone_e164: string | null;
  waba_id: string | null;
  origem: "lead" | "funil" | "padrao";
  conectado: boolean;
  pronto: boolean;
  pausado: boolean;
  /**
   * Quem chama pode enviar por esse número (as duas checagens de número do
   * servidor). Ausente = ambiente com a versão antiga da função: vale true.
   */
  acessivel?: boolean;
};

export type BloqueioDoEnvio = {
  tipo: "pausado" | "desconectado" | "sem_acesso";
  /** Texto curto do selo ("Pausado" / "Desconectado" / "Sem acesso"). */
  selo: string;
  /** Frase do aviso. */
  texto: string;
  /** Placeholder do campo travado. */
  placeholder: string;
};

export const CHAVE_ENVIO_DO_LEAD = "envio-do-lead";

/**
 * Regra do bloqueio (pura, testada): sem resposta do banco não bloqueia; sem
 * número = desconectado; sem acesso ao número resolvido = sem acesso (o
 * servidor recusa isso antes de olhar a conexão); pausa vence a falta de
 * conexão (é o que o servidor responde primeiro); número que não está pronto
 * = desconectado.
 */
export function bloqueioDoEnvio(
  consultado: boolean,
  numero: NumeroDeEnvio | null,
  papel?: string | null,
): BloqueioDoEnvio | null {
  if (!consultado) return null;
  if (!numero) {
    return { tipo: "desconectado", selo: "Desconectado", texto: fraseWhatsappDesconectado(papel), placeholder: "WhatsApp desconectado" };
  }
  if (numero.acessivel === false) {
    return { tipo: "sem_acesso", selo: "Sem acesso", texto: FRASE_SEM_ACESSO_AO_NUMERO, placeholder: "Sem acesso ao número deste lead" };
  }
  if (numero.pausado) return { tipo: "pausado", selo: "Pausado", texto: FRASE_WABA_PAUSADA, placeholder: PLACEHOLDER_PAUSADO };
  if (!numero.pronto) {
    return {
      tipo: "desconectado",
      selo: "Desconectado",
      texto: fraseNumeroDesconectado(numero.nome, papel),
      placeholder: "WhatsApp desconectado",
    };
  }
  return null;
}

export function useEnvioDoLead(leadId: string | null | undefined, opcoes: { ativo?: boolean } = {}) {
  const ativo = opcoes.ativo ?? true;
  const queryClient = useQueryClient();
  const { userRole } = useAuth();
  const consulta = useQuery({
    queryKey: [CHAVE_ENVIO_DO_LEAD, leadId ?? null],
    enabled: !!leadId && ativo,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<NumeroDeEnvio | null> => {
      // Cast: RPC nova (G2 — types.ts não é editado aqui).
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }).rpc("numero_de_envio_do_lead", { p_lead_id: leadId });
      if (error) throw error;
      const linhas = Array.isArray(data) ? data : data ? [data] : [];
      return (linhas[0] as NumeroDeEnvio | undefined) ?? null;
    },
  });

  /** Reconsulta (ex.: o servidor acabou de recusar por pausa). */
  const reconsultar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [CHAVE_ENVIO_DO_LEAD] });
  }, [queryClient]);

  const consultado = ativo && !!leadId && consulta.isSuccess;
  const numero = consultado ? consulta.data ?? null : null;
  // Objeto estável enquanto nada muda (entra em dependências de useCallback).
  return useMemo(
    () => ({ numero, bloqueio: bloqueioDoEnvio(consultado, numero, userRole), consultado, reconsultar }),
    [numero, consultado, reconsultar, userRole],
  );
}

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { mensagemDeErroRpc, rpcAusente } from "@/lib/relatorioSdr";

/**
 * Fechar / reabrir conversa (Fase 2 do rodízio) — a parte sem tela.
 *
 * O banco decide (RPC conversa_fechar / conversa_reabrir, SECURITY DEFINER):
 * só a dona do lead (assigned_to) ou a gestão (crc/gerente/superadmin).
 * Fechar grava crm_leads.conversa_fechada_em/por e uma mensagem de sistema no
 * chat; qualquer mensagem nova do lead reabre sozinha (gatilho em messages).
 *
 * Pesquisa de satisfação: quando a clínica a tem ligada, a RPC devolve o
 * texto pronto e o ENVIO sai daqui pelo caminho que já existe
 * (send-whatsapp-message, type "text") — nenhum fluxo novo de envio. Se o
 * envio falhar, pesquisa_envio_falhou apaga a linha para não contar como
 * enviada, e a conversa continua fechada.
 *
 * Janela entre o site publicado e a migration aplicada: a RPC ainda não existe
 * (PGRST202). O erro vira aviso em PT-BR (mensagemDeErroRpc, a mesma detecção
 * do relatório) e o botão some (conversaRpcDisponivel) em vez de abrir um
 * diálogo que vai falhar.
 *
 * Separado do componente (FecharConversaButton) para o fast-refresh: o arquivo
 * do componente só exporta componentes.
 */

type Pesquisa = { resposta_id: string; texto: string; telefone: string; escala: string };
type RespostaFechar = {
  ok: boolean;
  ja_fechada?: boolean;
  conversa_fechada_em: string | null;
  pesquisa: Pesquisa | null;
  pesquisa_nao_enviada:
    | "pesquisa_desligada"
    | "lead_sem_telefone"
    | "canal_instagram"
    | "pesquisa_recente"
    | null;
};

type RespostaRpc = { data: unknown; error: unknown };
// RPCs da Fase 2 ainda não estão em types.ts (gerado pelo Lovable).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nome: string, args?: Record<string, unknown>): Promise<RespostaRpc> => (supabase as any).rpc(nome, args);

const TEXTO_RPC_AUSENTE = "Fechar conversa ainda não está instalado no banco (migration da Fase 2 pendente).";
const mensagemDe = (e: unknown, fallback: string): string => mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE);

/**
 * "As RPCs de fechar conversa já existem no banco?" — uma sonda por sessão,
 * compartilhada por todos os botões. Sonda = pesquisa_envio_falhou (a mesma
 * migration 20260909100100) com id NULL: quando existe devolve false sem
 * escrever nem levantar erro (nada de 4xx nos logs); quando não existe,
 * PGRST202. Erro de rede NÃO decide "não existe" (o botão continua e a chamada
 * real dá a mensagem) e não fica em cache. "Não existe" fica em cache até
 * recarregar a página — a migration aplicada aparece no próximo carregamento.
 */
let sondaRpc: Promise<boolean> | null = null;
export function conversaRpcDisponivel(): Promise<boolean> {
  if (!sondaRpc) {
    sondaRpc = rpc("pesquisa_envio_falhou", { p_resposta_id: null })
      .then(({ error }) => {
        if (error && rpcAusente(error)) return false;
        if (error) sondaRpc = null;
        return true;
      })
      .catch(() => {
        sondaRpc = null;
        return true;
      });
  }
  return sondaRpc;
}

const MOTIVO_SEM_PESQUISA: Record<string, string> = {
  lead_sem_telefone: "Pesquisa não enviada: o lead não tem telefone.",
  canal_instagram: "Pesquisa não enviada: a conversa é pelo Instagram.",
  pesquisa_recente: "Pesquisa não enviada: este lead já respondeu uma há menos de 15 dias.",
};

/**
 * "Dá para oferecer a pesquisa neste lead agora?" — perguntado ANTES de a
 * pessoa marcar a caixa, para ela não escolher uma coisa que o banco vai
 * recusar. Mesma régua de pesquisa_pode_enviar, com o texto pronto.
 *
 * Enquanto a migration não está aplicada a RPC não existe: devolvemos
 * `{ pode: true }` para o diálogo continuar como era antes — a recusa real
 * ainda acontece no banco, e nada quebra.
 */
export type PesquisaOferta = {
  pode: boolean;
  motivo: "pesquisa_desligada" | "lead_sem_telefone" | "canal_instagram" | "pesquisa_recente" | null;
  aviso: string | null;
  enviada_em?: string | null;
  liberada_em?: string | null;
};

export async function pesquisaOferecer(leadId: string): Promise<PesquisaOferta> {
  const { data, error } = await rpc("pesquisa_oferecer", { p_lead_id: leadId });
  if (error || !data) return { pode: true, motivo: null, aviso: null };
  return data as PesquisaOferta;
}

/** Fecha e, se houver, envia a pesquisa. Devolve o novo conversa_fechada_em ou null em erro. */
export async function fecharConversa(leadId: string, enviarPesquisa: boolean): Promise<string | null> {
  const { data, error } = await rpc("conversa_fechar", { p_lead_id: leadId, p_enviar_pesquisa: enviarPesquisa });
  if (error) {
    toast.error(mensagemDe(error, "Não foi possível fechar a conversa."));
    return null;
  }
  const r = data as RespostaFechar;
  if (r.ja_fechada) {
    toast.info("Esta conversa já estava fechada.");
    return r.conversa_fechada_em;
  }
  if (r.pesquisa) {
    const { data: env, error: envErr } = await supabase.functions.invoke("send-whatsapp-message", {
      body: { lead_id: leadId, to: r.pesquisa.telefone, type: "text", message: r.pesquisa.texto },
    });
    const corpo = (env ?? {}) as { error?: unknown };
    if (envErr || corpo.error) {
      const motivo = await motivoDoServidor(env, envErr, "falha no envio");
      await rpc("pesquisa_envio_falhou", { p_resposta_id: r.pesquisa.resposta_id });
      toast.error(`Conversa fechada, mas a pesquisa não foi enviada: ${motivo}`);
    } else {
      toast.success("Conversa fechada e pesquisa de satisfação enviada.");
    }
  } else {
    const aviso = r.pesquisa_nao_enviada ? MOTIVO_SEM_PESQUISA[r.pesquisa_nao_enviada] : undefined;
    toast.success(aviso ? `Conversa fechada. ${aviso}` : "Conversa fechada.");
  }
  return r.conversa_fechada_em ?? new Date().toISOString();
}

export async function reabrirConversa(leadId: string): Promise<boolean> {
  const { error } = await rpc("conversa_reabrir", { p_lead_id: leadId });
  if (error) {
    toast.error(mensagemDe(error, "Não foi possível reabrir a conversa."));
    return false;
  }
  toast.success("Conversa reaberta.");
  return true;
}

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

// Versão CRClin: o chat interno é um recurso do v2 (chat_mensagens e as RPCs
// chat_* não existem aqui). Listas vazias e zero não lidas — o item "Interno"
// do menu não tem o que mostrar. Mesma interface do v2.
export interface CanalInterno {
  id: string; tipo: "geral" | "setor" | "direta"; setor_id: string | null;
  outro_user: string | null; ultima_mensagem_em: string | null; nao_lidas: number;
}
export interface PessoaDoCliente { user_id: string; nome: string; avatar_url: string | null }

export function usePessoasDoCliente() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["chat-pessoas-crclin", profile?.tenant_id],
    queryFn: async () => [] as PessoaDoCliente[],
    staleTime: Infinity,
  });
}

export function useCanaisInternos() {
  const { user, profile } = useAuth();
  const q = useQuery({
    queryKey: ["chat-canais-crclin", profile?.tenant_id, user?.id],
    queryFn: async () => [] as CanalInterno[],
    staleTime: Infinity,
  });
  return { ...q, canais: q.data ?? [], totalNaoLidas: 0 };
}

export interface Mencao { tipo: "pessoa" | "setor"; id: string; nome: string }

export function mencoesNoTexto(texto: string, mencoes: Mencao[]) {
  const vivas = mencoes.filter((m) => texto.includes(`@${m.nome}`));
  return {
    usuarios: [...new Set(vivas.filter((m) => m.tipo === "pessoa").map((m) => m.id))],
    setores: [...new Set(vivas.filter((m) => m.tipo === "setor").map((m) => m.id))],
  };
}

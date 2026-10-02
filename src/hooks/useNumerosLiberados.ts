import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FRASE_NUMERO_NAO_LIBERADO } from "@/lib/mensagemDeErro";

// Versão CRClin: o v2 lê pela RPC whatsapp_numeros_visiveis, que não existe
// aqui. O CRClin sempre leu whatsapp_numbers direto (o Kanban faz isso), com a
// RLS filtrando o que cada papel pode ver — SÓ colunas públicas, nunca token,
// app_secret ou verify_token. Mesma interface e mesma regra de ouro do v2: só
// afirma "sem número" com a resposta do banco em mãos.
export interface NumeroLiberado {
  id: string;
  display_name: string | null;
  phone_e164: string | null;
  is_active: boolean;
  is_default: boolean;
  status: string | null;
  waba_pausada?: boolean | null;
}

const PAPEIS_POR_NUMERO = new Set(["recepcao", "closer"]);

export function useNumerosLiberados() {
  const { user, userRole, roleResolved } = useAuth();
  const consulta = useQuery({
    queryKey: ["numeros-liberados-crclin", user?.id ?? null],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<NumeroLiberado[]> => {
      const { data, error } = await supabase
        .from("whatsapp_numbers")
        .select("id, display_name, phone_e164, is_active, is_default")
        .order("display_name");
      if (error) throw error;
      return ((data ?? []) as Omit<NumeroLiberado, "status">[])
        .filter((n) => !!n?.id)
        .map((n) => ({ ...n, status: null, waba_pausada: null }));
    },
  });

  const numeros = consulta.data ?? [];
  const resolvido = roleResolved && consulta.isSuccess;
  const dependeDeNumero = !!userRole && PAPEIS_POR_NUMERO.has(userRole);

  return {
    numeros,
    ativos: numeros.filter((n) => n.is_active),
    carregando: consulta.isLoading,
    erro: consulta.error,
    resolvido,
    semNumeroLiberado: resolvido && dependeDeNumero && numeros.length === 0,
    aviso: FRASE_NUMERO_NAO_LIBERADO,
    recarregar: consulta.refetch,
  };
}

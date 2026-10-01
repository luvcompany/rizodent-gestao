import { useMemo } from "react";
import { useTenantConfig, VOCABULARIO_NEUTRO } from "@/hooks/useTenantConfig";

// Termos e listas do segmento do cliente (ex.: "Paciente" x "Cliente",
// "Procedimento" x "Serviço"). Enquanto a config carrega, devolve o
// vocabulário neutro, com listas vazias e sem rótulo de receita recorrente.

export interface Vocab {
  pessoa: string;
  pessoaPlural: string;
  servico: string;
  servicoPlural: string;
  unidade: string;
  unidadePlural: string;
  profissional: string;
  especialidades: string[];
  servicosInteresse: string[];
  /** Só odontologia tem ("Recorrência de ortodontia"); null esconde a pergunta. */
  receitaRecorrenteLabel: string | null;
  resolvido: boolean;
}

export function useVocab(): Vocab {
  const { config, resolvido } = useTenantConfig();
  const v = config?.vocabulary ?? VOCABULARIO_NEUTRO;

  return useMemo<Vocab>(
    () => ({
      pessoa: v.pessoa,
      pessoaPlural: v.pessoa_plural,
      servico: v.servico,
      servicoPlural: v.servico_plural,
      unidade: v.unidade,
      unidadePlural: v.unidade_plural,
      profissional: v.profissional,
      especialidades: v.especialidades,
      servicosInteresse: v.servicos_interesse,
      receitaRecorrenteLabel: v.receita_recorrente_label,
      resolvido,
    }),
    [v, resolvido],
  );
}

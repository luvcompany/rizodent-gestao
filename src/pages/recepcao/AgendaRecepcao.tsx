import { useQuery } from "@tanstack/react-query";

// Versão CRClin: a "Agenda do dia / Registro de consultas" é recurso do v2
// (consulta_falta_registrar e consulta_procedimentos não existem aqui) e a
// página não tem rota no CRClin. Só o contador do menu é importado pela casca.
export function useFaltaRegistrar(_enabled = true) {
  return useQuery({
    queryKey: ["consulta-falta-registrar-crclin"],
    queryFn: async () => [] as { id: string; atrasada: boolean }[],
    staleTime: Infinity,
  });
}

export default function AgendaRecepcao() {
  return null;
}

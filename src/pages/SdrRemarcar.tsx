import { useQuery } from "@tanstack/react-query";

// Versão CRClin: a fila "Remarcar" é recurso do v2 (sdr_fila_remarcar não
// existe aqui) e a página não tem rota no CRClin. Só o contador do menu é
// importado pela casca — fica em zero. A etapa "Reagendar" do CRClin continua
// sendo o lugar de quem precisa remarcar.
export function useFilaRemarcar(_enabled = true) {
  return useQuery({
    queryKey: ["sdr-fila-remarcar-crclin"],
    queryFn: async () => [] as { id: string; lead_id: string; lead_name: string | null; phone: string | null; scheduled_date: string; scheduled_time: string | null; sdr_nome: string | null }[],
    staleTime: Infinity,
  });
}

export default function SdrRemarcar() {
  return null;
}

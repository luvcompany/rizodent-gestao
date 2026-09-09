import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Destinos para os quais uma SDR pode transferir o lead DELA: outras SDRs, o
 * gestor da equipe e a pós-venda (RPC sdr_destinos_transferencia, Fase 1+).
 * A SDR não lê user_roles das colegas, por isso a lista vem por RPC.
 * Para quem não é SDR, devolve lista vazia sem consultar nada.
 */
export interface DestinoSdr { user_id: string; nome: string; papel: "sdr" | "gestor" | "posvenda" }

let cache: { destinos: DestinoSdr[]; em: number } | null = null;
const TTL = 5 * 60 * 1000;

export function useDestinosTransferenciaSdr(ativo: boolean): DestinoSdr[] {
  const [destinos, setDestinos] = useState<DestinoSdr[]>(() => (ativo && cache ? cache.destinos : []));
  useEffect(() => {
    if (!ativo) return;
    if (cache && Date.now() - cache.em < TTL) { setDestinos(cache.destinos); return; }
    let vivo = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("sdr_destinos_transferencia").then(({ data, error }: { data: DestinoSdr[] | null; error: unknown }) => {
      if (!vivo || error) return;
      const lista = (data ?? []) as DestinoSdr[];
      cache = { destinos: lista, em: Date.now() };
      setDestinos(lista);
    });
    return () => { vivo = false; };
  }, [ativo]);
  return destinos;
}

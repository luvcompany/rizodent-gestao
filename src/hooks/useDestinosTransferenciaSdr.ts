import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Destinos para os quais uma SDR pode transferir o lead DELA: outras SDRs e o
 * gestor da equipe (RPC sdr_destinos_transferencia). Pós-venda saiu da lista
 * em 09/09: transfer-lead só aceita pós-venda em etapa Contratado, que a SDR
 * nunca tem (o ciclo dela termina no comparecimento) — era uma opção morta.
 * A SDR não lê user_roles das colegas, por isso a lista vem por RPC.
 * Para quem não é SDR, devolve lista vazia sem consultar nada.
 *
 * Cache por USUÁRIO: trocar de conta na mesma aba (login é SPA, sem reload)
 * não pode mostrar a lista da SDR anterior.
 */
export interface DestinoSdr { user_id: string; nome: string; papel: "sdr" | "gestor" | "posvenda" }

let cache: { uid: string; destinos: DestinoSdr[]; em: number } | null = null;
const TTL = 5 * 60 * 1000;

export function useDestinosTransferenciaSdr(ativo: boolean): DestinoSdr[] {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const cacheValido = () => !!(uid && cache && cache.uid === uid && Date.now() - cache.em < TTL);
  const [destinos, setDestinos] = useState<DestinoSdr[]>(() => (ativo && cacheValido() ? cache!.destinos : []));
  useEffect(() => {
    if (!ativo || !uid) { setDestinos([]); return; }
    if (cacheValido()) { setDestinos(cache!.destinos); return; }
    let vivo = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("sdr_destinos_transferencia").then(({ data, error }: { data: DestinoSdr[] | null; error: unknown }) => {
      if (!vivo || error) return;
      const lista = (data ?? []) as DestinoSdr[];
      cache = { uid, destinos: lista, em: Date.now() };
      setDestinos(lista);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, uid]);
  return destinos;
}

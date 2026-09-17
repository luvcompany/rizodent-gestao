import { useCallback, useEffect, useRef } from "react";

/**
 * "O Realtime avisou que estes leads mudaram e eles não estão na minha lista:
 * busca no banco e me entrega os que eu posso ver."
 *
 * POR QUE EXISTE. É o caminho pelo qual um lead DISTRIBUÍDO para a SDR aparece
 * na tela dela sem recarregar a página — entrega imediata, lote reservado
 * aplicado na abertura do expediente, corte das 9h, realocação por silêncio,
 * transferência. O evento de Realtime é só um AVISO: quem decide se o lead é
 * dela é a RLS, na consulta ao banco.
 *
 * O DEFEITO QUE ISTO SUBSTITUI (relatado em 16/09/2026: "o lead ficou oculto e
 * não apareceu pra ela"). CrmConversas guardava o id avisado num useState de UM
 * valor, e um efeito buscava esse lead. Perdia lead de dois jeitos:
 *   1. vários avisos no mesmo instante — a abertura do expediente entrega o lote
 *      reservado de uma vez (12 leads para a Bia às 08:02 de 17/09) — e cada
 *      setState sobrescrevia o anterior: só o último era buscado;
 *   2. um aviso chegando antes de a busca do anterior terminar: o cleanup do
 *      efeito cancelava a busca anterior e o resultado ia fora.
 * O lead era dela no banco e não aparecia até ela recarregar a página.
 * Reprodução e prova do conserto: src/test/hidratacaoLeadsRealtime.test.tsx.
 *
 * COMO FUNCIONA AGORA. Os avisos vão para uma FILA (Set). Um respiro curto junta
 * a rajada numa consulta só, em lotes de até 100 ids (o .in() viaja na URL).
 * Nenhuma busca em andamento é cancelada por um aviso novo: o aviso novo espera
 * a próxima rodada. Aviso repetido de um id já em voo é ignorado.
 *
 * O que NÃO é responsabilidade daqui: recuperar aviso que o Realtime nunca
 * entregou (canal caído, aba dormindo). Para isso a tela faz uma reconciliação
 * periódica com o banco — ver CrmConversas.tsx.
 */
export function useHidratarLeadsAvisados<T extends { id: string }>(
  buscar: (ids: string[]) => Promise<T[]>,
  aoChegar: (novos: T[]) => void,
  opcoes: { respiroMs?: number; lote?: number } = {},
): (id: string | null | undefined) => void {
  const respiroMs = opcoes.respiroMs ?? 150;
  const tamanhoLote = opcoes.lote ?? 100;

  const pendentes = useRef(new Set<string>());
  const emVoo = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const montado = useRef(true);

  // As funções mudam a cada render da tela; a fila não pode depender delas.
  const buscarRef = useRef(buscar);
  const aoChegarRef = useRef(aoChegar);
  buscarRef.current = buscar;
  aoChegarRef.current = aoChegar;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const drenar = useCallback(async () => {
    timer.current = null;
    const ids = [...pendentes.current].filter((id) => !emVoo.current.has(id));
    pendentes.current.clear();
    if (ids.length === 0) return;

    ids.forEach((id) => emVoo.current.add(id));
    try {
      for (let i = 0; i < ids.length; i += tamanhoLote) {
        const lote = ids.slice(i, i + tamanhoLote);
        let achados: T[] = [];
        try {
          achados = await buscarRef.current(lote);
        } catch {
          // Falha de rede numa consulta não derruba a tela nem as outras
          // consultas. O lead perdido volta pela reconciliação periódica.
          continue;
        }
        if (!montado.current) return;
        if (achados.length) aoChegarRef.current(achados);
      }
    } finally {
      ids.forEach((id) => emVoo.current.delete(id));
    }
  }, [tamanhoLote]);

  return useCallback(
    (id: string | null | undefined) => {
      if (!id || emVoo.current.has(id)) return;
      pendentes.current.add(id);
      if (timer.current == null) timer.current = setTimeout(() => void drenar(), respiroMs);
    },
    [drenar, respiroMs],
  );
}

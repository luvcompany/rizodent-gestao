/**
 * Lead distribuído para a SDR que não aparece na lista dela.
 *
 * RELATO (16/09/2026): uma SDR reclamou que "o lead ficou oculto e não apareceu
 * pra ela". O dono precisou: "ele fica oculto quando está sendo distribuído pra
 * sdr ... preciso saber se não está bugando na hora da distribuição".
 *
 * No BANCO não havia nada oculto: emulando a sessão de cada SDR, 100% dos leads
 * dela saíam em get_conversation_leads e pela RLS (Bia 349/349, Kelly 76/76), e
 * as 35 reservas do dia foram todas aplicadas na abertura do expediente.
 *
 * O defeito estava na TELA. O Realtime avisa "este lead mudou"; quando o lead
 * ainda não está na lista, CrmConversas guardava o id num useState de UM valor
 * e um efeito buscava esse lead no banco. Dois jeitos de perder lead:
 *   1. vários avisos no mesmo instante (a abertura do expediente entrega o lote
 *      reservado de uma vez — 12 leads para a Bia às 08:02 de 17/09): cada
 *      setState sobrescreve o anterior e só o último é buscado;
 *   2. um aviso chegando antes de a busca do anterior terminar: o cleanup do
 *      efeito marca a busca anterior como cancelada e o resultado é jogado fora.
 * Nos dois casos o lead é dela no banco e não aparece até recarregar a página.
 *
 * Este arquivo prova o defeito com uma cópia FIEL do padrão antigo, e prova que
 * o hook novo (useHidratarLeadsAvisados) não perde nenhum.
 */
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect, useState, useImperativeHandle, forwardRef } from "react";
import { useHidratarLeadsAvisados } from "@/hooks/useHidratarLeadsAvisados";

type Lead = { id: string };
type Api = { avisar: (id: string) => void; ids: () => string[] };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O banco, simulado: devolve o lead depois de `latencia` ms. */
function bancoFalso(latencia: number) {
  return {
    umPorVez: vi.fn(async (id: string): Promise<Lead | null> => {
      await esperar(latencia);
      return { id };
    }),
    emLote: vi.fn(async (ids: string[]): Promise<Lead[]> => {
      await esperar(latencia);
      return ids.map((id) => ({ id }));
    }),
  };
}

// ---------------------------------------------------------------------------
// CÓPIA FIEL do padrão que estava em src/pages/CrmConversas.tsx até 17/09/2026
// (estado `leadParaHidratar` + efeito com cancelamento + handler do Realtime).
// ---------------------------------------------------------------------------
const ListaAntiga = forwardRef<Api, { buscar: (id: string) => Promise<Lead | null> }>(({ buscar }, ref) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadParaHidratar, setLeadParaHidratar] = useState<string | null>(null);

  useEffect(() => {
    if (!leadParaHidratar) return;
    let cancelado = false;
    (async () => {
      const data = await buscar(leadParaHidratar);
      if (cancelado) return;
      setLeadParaHidratar(null);
      if (!data) return;
      setLeads((prev) => (prev.some((l) => l.id === data.id) ? prev : [data, ...prev]));
    })();
    return () => {
      cancelado = true;
    };
  }, [leadParaHidratar, buscar]);

  useImperativeHandle(ref, () => ({
    // o handler de UPDATE do Realtime para lead que não está na lista
    avisar: (id: string) =>
      setLeads((prev) => {
        if (!prev.some((l) => l.id === id)) {
          setLeadParaHidratar(id);
          return prev;
        }
        return prev;
      }),
    ids: () => leads.map((l) => l.id).sort(),
  }));
  return null;
});

// ---------------------------------------------------------------------------
// A lista com o hook novo.
// ---------------------------------------------------------------------------
const ListaNova = forwardRef<Api, { buscar: (ids: string[]) => Promise<Lead[]> }>(({ buscar }, ref) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const avisar = useHidratarLeadsAvisados<Lead>(buscar, (novos) =>
    setLeads((prev) => {
      const ja = new Set(prev.map((l) => l.id));
      const entram = novos.filter((n) => !ja.has(n.id));
      return entram.length ? [...entram, ...prev] : prev;
    }),
  );
  useImperativeHandle(ref, () => ({ avisar, ids: () => leads.map((l) => l.id).sort() }));
  return null;
});

/**
 * Simula a chegada dos avisos do Realtime.
 *
 * `intervaloEntreAvisos = 0` → os três no MESMO instante: vão num único act(),
 * e o React os processa juntos antes de renderizar — é o que acontece quando o
 * lote reservado é aplicado de uma vez na abertura do expediente.
 *
 * `intervaloEntreAvisos > 0` → cada aviso num act() PRÓPRIO, com a espera
 * também num act() próprio. Isso importa: dentro de um único act() assíncrono
 * o React adia os renders até o fim, e o teste deixaria de representar o
 * navegador, onde cada mensagem do WebSocket é uma tarefa separada e a tela
 * renderiza entre elas. (A primeira versão deste teste errava exatamente isso,
 * e o "controle" acusou.)
 */
async function cenario(
  Lista: typeof ListaAntiga | typeof ListaNova,
  buscar: unknown,
  intervaloEntreAvisos: number,
) {
  const ref = { current: null as Api | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<Lista ref={ref as any} buscar={buscar as any} />);
  const ids = ["lead-A", "lead-B", "lead-C"];
  if (intervaloEntreAvisos === 0) {
    await act(async () => {
      ids.forEach((id) => ref.current!.avisar(id));
    });
  } else {
    for (const id of ids) {
      await act(async () => {
        ref.current!.avisar(id);
      });
      await act(async () => {
        await esperar(intervaloEntreAvisos);
      });
    }
  }
  await act(async () => {
    await esperar(800); // tempo de sobra para qualquer busca terminar
  });
  return ref.current!.ids();
}

describe("lead distribuído para a SDR aparece na lista dela", () => {
  describe("PADRÃO ANTIGO — reprodução do defeito", () => {
    it("3 leads no mesmo instante (lote da abertura do expediente): só 1 aparece", async () => {
      const banco = bancoFalso(100);
      const ids = await cenario(ListaAntiga, banco.umPorVez, 0);
      expect(ids).toEqual(["lead-C"]);
    });

    it("3 leads com 20 ms entre si e consulta de 100 ms: só o último aparece", async () => {
      const banco = bancoFalso(100);
      const ids = await cenario(ListaAntiga, banco.umPorVez, 20);
      expect(ids).toEqual(["lead-C"]);
    });

    it("controle: 3 leads espaçados mais que a consulta — aí os 3 aparecem", async () => {
      const banco = bancoFalso(50);
      const ids = await cenario(ListaAntiga, banco.umPorVez, 200);
      expect(ids).toEqual(["lead-A", "lead-B", "lead-C"]);
    });
  });

  describe("HOOK NOVO — nenhum lead se perde", () => {
    it("3 leads no mesmo instante: os 3 aparecem, numa consulta só", async () => {
      const banco = bancoFalso(100);
      const ids = await cenario(ListaNova, banco.emLote, 0);
      expect(ids).toEqual(["lead-A", "lead-B", "lead-C"]);
      expect(banco.emLote).toHaveBeenCalledTimes(1);
    });

    it("3 leads com 20 ms entre si e consulta de 100 ms: os 3 aparecem", async () => {
      const banco = bancoFalso(100);
      const ids = await cenario(ListaNova, banco.emLote, 20);
      expect(ids).toEqual(["lead-A", "lead-B", "lead-C"]);
    });

    it("aviso que chega DURANTE uma consulta em andamento não é perdido", async () => {
      const banco = bancoFalso(300);
      const ids = await cenario(ListaNova, banco.emLote, 200);
      expect(ids).toEqual(["lead-A", "lead-B", "lead-C"]);
    });

    it("lote grande (130 leads, como uma abertura de segunda-feira): todos aparecem, em lotes de 100", async () => {
      const banco = bancoFalso(30);
      const ref = { current: null as Api | null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<ListaNova ref={ref as any} buscar={banco.emLote} />);
      const todos = Array.from({ length: 130 }, (_, i) => `lead-${String(i).padStart(3, "0")}`);
      await act(async () => {
        todos.forEach((id) => ref.current!.avisar(id));
        await esperar(800);
      });
      expect(ref.current!.ids()).toEqual(todos);
      // 100 + 30: a URL do .in() não pode levar 130 uuids de uma vez
      expect(banco.emLote.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([100, 30]);
    });

    it("lead que a RLS não devolve (não é dela) não aparece — e não trava os outros", async () => {
      const buscar = vi.fn(async (ids: string[]) => {
        await esperar(50);
        return ids.filter((id) => id !== "lead-B").map((id) => ({ id }));
      });
      const ids = await cenario(ListaNova, buscar, 0);
      expect(ids).toEqual(["lead-A", "lead-C"]);
    });

    it("falha de rede numa consulta não derruba a tela e as seguintes continuam", async () => {
      let chamadas = 0;
      const buscar = vi.fn(async (ids: string[]) => {
        chamadas++;
        await esperar(30);
        if (chamadas === 1) throw new Error("rede caiu");
        return ids.map((id) => ({ id }));
      });
      const ref = { current: null as Api | null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<ListaNova ref={ref as any} buscar={buscar} />);
      await act(async () => {
        ref.current!.avisar("lead-A");
        await esperar(400);
        ref.current!.avisar("lead-B");
        await esperar(400);
      });
      // A falhou na rede (a reconciliação periódica da tela recupera); B entrou.
      expect(ref.current!.ids()).toEqual(["lead-B"]);
    });
  });
});

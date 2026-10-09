/**
 * Tela de Ligações somando só parte do período.
 *
 * RELATO (09/10/2026): no filtro "Este mês" a tela mostrava 522 ligações e 165
 * atendidas; o banco tinha 737 e 214 (715 da telefonia + 22 do WhatsApp). A
 * telefonia só aparecia a partir de 05/10 07:35.
 *
 * CAUSA: CrmLigacoes buscava as 500 ligações MAIS RECENTES de cada tabela
 * (.limit(500)) e só depois filtrava o período na tela. Quando o mês passou de
 * 500 ligações de telefonia, o começo do mês ficou de fora de todos os totais.
 *
 * Aqui o "banco" é falso e se comporta como o PostgREST: aplica os filtros,
 * respeita order/range e nunca devolve mais de 1000 linhas por pedido.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type Row = Record<string, unknown>;
const banco: Record<string, Row[]> = { whatsapp_calls: [], api4com_calls: [] };
const pedidos: { tabela: string; filtros: string[]; de: number; ate: number }[] = [];
const TETO_POSTGREST = 1000;

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: string[] = [];
    const testes: ((r: Row) => boolean)[] = [];
    let ordem: string | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      gte: (col: string, v: string) => { filtros.push(`${col}.gte.${v}`); testes.push((r) => String(r[col]) >= v); return q; },
      lte: (col: string, v: string) => { filtros.push(`${col}.lte.${v}`); testes.push((r) => String(r[col]) <= v); return q; },
      // Só o formato que a tela manda: started_at no período, ou created_at quando started_at falta.
      or: (expr: string) => {
        filtros.push(`or=${expr}`);
        const de = /started_at\.gte\."([^"]+)"/.exec(expr)?.[1] ?? "";
        const ate = /started_at\.lte\."([^"]+)"/.exec(expr)?.[1] ?? "";
        testes.push((r) => {
          const t = String(r.started_at ?? r.created_at);
          return t >= de && t <= ate;
        });
        return q;
      },
      order: (col: string) => { ordem = col; return q; },
      range: (de: number, ate: number) => {
        pedidos.push({ tabela, filtros: [...filtros], de, ate });
        const linhas = banco[tabela]
          .filter((r) => testes.every((t) => t(r)))
          .sort((a, b) => String(a[ordem ?? "id"]).localeCompare(String(b[ordem ?? "id"])));
        const fim = Math.min(ate + 1, de + TETO_POSTGREST);
        return Promise.resolve({ data: linhas.slice(de, fim), error: null });
      },
    });
    return q;
  };
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      from: vi.fn(consulta),
      rpc: vi.fn(() => Promise.resolve({ data: true, error: null })),
      channel: vi.fn(() => canal),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userRole: "gerente", user: { id: "u" } }) }));
vi.mock("@/contexts/WhatsappCallContext", () => ({
  useWhatsappCall: () => ({ podeLigarPorWhatsapp: () => true, numerosVisiveis: [] }),
  numeroConectado: () => true,
}));

import CrmLigacoes from "@/pages/CrmLigacoes";

const iso = (local: string) => new Date(local).toISOString();
const id = (prefixo: string, i: number) => `${prefixo}-${String(i).padStart(5, "0")}`;

/** n ligações da telefonia espalhadas entre `deDia` e `ateDia` de outubro (09:00–18:00). */
function telefonia(n: number, atendidas: number, deDia = 1, ateDia = 9, prefixo = "a") {
  return Array.from({ length: n }, (_, i) => {
    const dia = deDia + (i % (ateDia - deDia + 1));
    const t = iso(`2026-10-${String(dia).padStart(2, "0")}T${String(9 + (i % 9)).padStart(2, "0")}:00:00-03:00`);
    const atendeu = i < atendidas;
    return {
      id: id(prefixo, i), tenant_id: "t", lead_id: null, from_phone: "7730000000", to_phone: "77999990000",
      direction: "outbound", status: atendeu ? "answered" : "no-answer", started_at: t, created_at: t,
      answered_at: atendeu ? t : null, ended_at: t, duration_seconds: atendeu ? 60 : 0,
      recording_url: null, transcription: null, lead: null,
    };
  });
}

function whatsapp(n: number, atendidas: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = iso(`2026-10-0${1 + (i % 6)}T10:00:00-03:00`);
    const atendeu = i < atendidas;
    return {
      id: id("w", i), tenant_id: "t", lead_id: null, from_phone: "77999990000", to_phone: "7730000000",
      direction: "inbound", status: atendeu ? "completed" : "missed", started_at: t, connected_at: atendeu ? t : null,
      ended_at: t, duration_seconds: atendeu ? 174 : 0, error_message: null, recording_url: null,
      transcription: null, initiated_by: null, answered_by: null, lead: null,
    };
  });
}

/** Valor do card de KPI pelo rótulo (o rótulo "Atendidas" também é um botão de filtro). */
function kpi(rotulo: string) {
  const el = screen.getAllByText(rotulo).find((e) => e.tagName === "DIV" && e.nextElementSibling);
  return el?.nextElementSibling?.textContent;
}

const linhasDaLista = (c: HTMLElement) => c.querySelectorAll("ul > li").length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T15:00:00-03:00"));
  pedidos.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Ligações: totais do período sem corte", () => {
  it("outubro/2026: 715 da telefonia + 22 do WhatsApp = 737 ligações e 214 atendidas", async () => {
    banco.api4com_calls = [
      ...telefonia(715, 200),
      // setembro: fica fora do "Este mês" — e já é barrado no banco
      ...telefonia(400, 100, 1, 9, "set").map((r) => ({ ...r, started_at: String(r.started_at).replace("2026-10", "2026-09"), created_at: String(r.created_at).replace("2026-10", "2026-09") })),
    ];
    banco.whatsapp_calls = whatsapp(22, 14);

    const { container } = render(<MemoryRouter><CrmLigacoes /></MemoryRouter>);

    await waitFor(() => expect(kpi("Total")).toBe("737"));
    expect(kpi("Atendidas")).toBe("214");
    expect(kpi("Taxa atend.")).toBe("29%");
    expect(kpi("Perdidas")).toBe("8");

    // O período vai como filtro no banco (não baixa setembro para filtrar na tela).
    const api = pedidos.find((p) => p.tabela === "api4com_calls")!;
    expect(api.filtros.join(" ")).toContain('started_at.gte."2026-10-01T03:00:00.000Z"');
    expect(api.filtros.join(" ")).toContain("started_at.is.null,created_at.gte.");
    const wa = pedidos.find((p) => p.tabela === "whatsapp_calls")!;
    expect(wa.filtros).toContain("started_at.gte.2026-10-01T03:00:00.000Z");

    // A LISTA desenha 500 por vez; os totais acima já contam as 737.
    expect(linhasDaLista(container)).toBe(500);
    expect(screen.getByText("Mostrando 500 de 737 ligações")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais" }));
    expect(linhasDaLista(container)).toBe(737);
    expect(screen.queryByRole("button", { name: "Mostrar mais" })).not.toBeInTheDocument();
  });

  it("período com mais de 1000 ligações numa tabela: pagina até acabar", async () => {
    banco.api4com_calls = telefonia(2350, 700);
    banco.whatsapp_calls = whatsapp(22, 14);

    render(<MemoryRouter><CrmLigacoes /></MemoryRouter>);

    await waitFor(() => expect(kpi("Total")).toBe("2372"));
    expect(kpi("Atendidas")).toBe("714");
    const paginas = pedidos.filter((p) => p.tabela === "api4com_calls").map((p) => [p.de, p.ate]);
    expect(paginas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});

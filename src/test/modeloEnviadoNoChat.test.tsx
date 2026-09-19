/**
 * O balão do modelo mostra o que o paciente RECEBEU — nunca os dados de hoje.
 *
 * RELATO (dono, 19/09/2026): mandou um modelo com a consulta de 21/09, remarcou
 * para 22/09 e recarregou a página: o balão passou a mostrar 22/09, que o
 * paciente nunca recebeu. O componente remontava o texto a cada abertura com o
 * nome atual do lead e as consultas que existem hoje.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const tabelasConsultadas: string[] = [];
let historico: Record<string, unknown> | null = null;

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    tabelasConsultadas.push(tabela);
    const q: Record<string, unknown> = {};
    const encadeia = () => q;
    Object.assign(q, {
      select: encadeia, eq: encadeia, order: encadeia, limit: encadeia, in: encadeia,
      maybeSingle: () => Promise.resolve({ data: tabela === "mensagens_template_historico" && historico ? { snapshot: historico } : null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (r: unknown) => void) => ok({ data: [], error: null }),
    });
    return q;
  };
  return { supabase: { from: vi.fn(consulta), storage: { from: vi.fn() }, rpc: vi.fn() } };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t" } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u" } }) }));
vi.mock("@/lib/mediaUtils", () => ({ getSignedMediaUrl: vi.fn(async (u: string) => u), extractStoragePath: () => null }));

import ChatMessageContent from "@/components/chat/ChatMessageContent";

const base = { id: "m1", lead_id: "l1", type: "text", media_url: null, created_at: "2026-09-19T15:46:00Z", content: "📋 Template: agendamentovca" };

beforeEach(() => {
  tabelasConsultadas.length = 0;
  historico = null;
});

describe("balão do modelo enviado", () => {
  it("mostra exatamente o texto gravado no envio, sem consultar lead nem consultas", async () => {
    render(
      <ChatMessageContent
        message={{
          ...base,
          template_snapshot: {
            v: 1, origem: "envio", nome: "agendamentovca",
            body: "Oi, Vitor Santos! Seu agendamento na Rizodent está marcado:\n\n🗓️ Segunda, 21/09 às 09:00",
            buttons: [{ type: "QUICK_REPLY", text: "Sim, confirmo" }, { type: "QUICK_REPLY", text: "Preciso reagendar" }],
          },
        }}
      />,
    );
    expect(screen.getByText(/Segunda, 21\/09 às 09:00/)).toBeInTheDocument();
    expect(screen.getByText("Sim, confirmo")).toBeInTheDocument();
    expect(screen.queryByText(/reconstruído/)).not.toBeInTheDocument();
    expect(tabelasConsultadas).not.toContain("crm_appointments");
    expect(tabelasConsultadas).not.toContain("crm_leads");
    expect(tabelasConsultadas).not.toContain("mensagens_template_historico");
  });

  it("mensagem antiga: usa o registro reconstruído e avisa que é reconstrução", async () => {
    historico = {
      v: 1, origem: "reconstruido", nome: "agendamento_vca_2_evzjg6", body: "Agendamento Realizado\nVitor\n21/09/2026 às 09:00",
      variaveis_reconstruidas: true, data_certeza: "nota", nome_da_epoca: true,
    };
    render(<ChatMessageContent message={{ ...base, id: "m-antiga", content: "📋 Template: agendamento_vca_2_evzjg6" }} />);
    await waitFor(() => expect(screen.getByText(/21\/09\/2026 às 09:00/)).toBeInTheDocument());
    expect(screen.getByText(/Enviado antes de 19\/09\/2026 · texto reconstruído pelo histórico$/)).toBeInTheDocument();
    expect(tabelasConsultadas).toEqual(["mensagens_template_historico"]);
  });

  it("data estimada e nome atual aparecem no aviso", async () => {
    historico = { v: 1, origem: "reconstruido", nome: "x", body: "Oi Ana, 21/07/2026 às 10:00", variaveis_reconstruidas: true, data_certeza: "estimada", nome_da_epoca: false };
    render(<ChatMessageContent message={{ ...base, id: "m-estimada", content: "📋 Template: x" }} />);
    await waitFor(() => expect(screen.getByText(/data estimada pelo histórico · nome do cadastro atual/)).toBeInTheDocument());
  });

  it("data que não dá para recuperar: diz isso, sem inventar", async () => {
    historico = { v: 1, origem: "reconstruido", nome: "x", body: "Oi Ana, [data não registrada]", variaveis_reconstruidas: true, data_certeza: "desconhecida", nome_da_epoca: false };
    render(<ChatMessageContent message={{ ...base, id: "m-desconhecida", content: "📋 Template: x" }} />);
    await waitFor(() => expect(screen.getByText(/\[data não registrada\]/)).toBeInTheDocument());
    expect(screen.getByText(/a data enviada não pôde ser recuperada/)).toBeInTheDocument();
  });

  it("registro do histórico fica na memória: a segunda abertura não consulta de novo", async () => {
    historico = { v: 1, origem: "reconstruido", nome: "x", body: "texto fixo", variaveis_reconstruidas: false };
    const { unmount } = render(<ChatMessageContent message={{ ...base, id: "m-cache", content: "📋 Template: x" }} />);
    await waitFor(() => expect(screen.getByText("texto fixo")).toBeInTheDocument());
    unmount();
    tabelasConsultadas.length = 0;
    historico = null; // se consultasse de novo, não acharia
    render(<ChatMessageContent message={{ ...base, id: "m-cache", content: "📋 Template: x" }} />);
    expect(screen.getByText("texto fixo")).toBeInTheDocument();
    expect(tabelasConsultadas).toEqual([]);
  });

  it("sem registro nenhum: mostra só o nome do modelo — nunca completa com dados de hoje", async () => {
    render(<ChatMessageContent message={{ ...base, id: "m-sem-registro" }} />);
    await waitFor(() => expect(screen.getByText(/Modelo: agendamentovca/)).toBeInTheDocument());
    expect(screen.getByText(/ainda não foi registrado/)).toBeInTheDocument();
    expect(tabelasConsultadas).not.toContain("crm_appointments");
    expect(tabelasConsultadas).not.toContain("crm_leads");
    expect(tabelasConsultadas).not.toContain("crm_whatsapp_templates");
  });

  it("mensagem ainda enviando não busca nada", () => {
    render(<ChatMessageContent message={{ ...base, status: "sending" }} />);
    expect(screen.getByText(/Enviando o modelo agendamentovca/)).toBeInTheDocument();
    expect(tabelasConsultadas).toEqual([]);
  });
});

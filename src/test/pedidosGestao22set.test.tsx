/**
 * Pedidos da gestão de 21/09/2026:
 *  - motivo obrigatório ao desqualificar;
 *  - lead criado pela conciliação do Dontus não conta como lead novo;
 *  - o quadro não pode reaproveitar cache depois de um lead mudar numa conversa.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { contaComoLeadNovo, FILTRO_LEAD_NOVO } from "@/lib/leadNovo";
import { ehEtapaDesqualificado } from "@/lib/desqualificacao";
import { avisarQueLeadMudou, cacheDoKanbanVale } from "@/lib/kanbanFresco";
import MotivoDesqualificacaoDialog from "@/components/crm/MotivoDesqualificacaoDialog";

describe("lead novo", () => {
  it("lead da conciliação (source kommo) não é novo; sem origem é", () => {
    expect(contaComoLeadNovo({ source: "kommo" })).toBe(false);
    expect(contaComoLeadNovo({ source: null })).toBe(true);
    expect(contaComoLeadNovo({ source: "facebook_ad" })).toBe(true);
  });
  it("filtro do banco mantém quem não tem origem", () => {
    expect(FILTRO_LEAD_NOVO).toBe("source.is.null,source.neq.kommo");
  });
});

describe("etapa Desqualificado", () => {
  it("reconhece o nome com e sem acento/caixa", () => {
    expect(ehEtapaDesqualificado("Desqualificado")).toBe(true);
    expect(ehEtapaDesqualificado(" DESQUALIFICADOS ")).toBe(true);
    expect(ehEtapaDesqualificado("Qualificado")).toBe(false);
    expect(ehEtapaDesqualificado(null)).toBe(false);
  });
});

describe("cache do Kanban", () => {
  it("cache salvo antes de um lead mudar deixa de valer", async () => {
    const salvo = Date.now();
    expect(cacheDoKanbanVale(salvo)).toBe(true);
    await new Promise((r) => setTimeout(r, 2));
    avisarQueLeadMudou();
    expect(cacheDoKanbanVale(salvo)).toBe(false);
    await new Promise((r) => setTimeout(r, 2));
    expect(cacheDoKanbanVale(Date.now())).toBe(true);
  });
});

describe("diálogo do motivo", () => {
  it("só confirma com um motivo escolhido; 'Outro' exige texto", () => {
    const onConfirmar = vi.fn();
    render(<MotivoDesqualificacaoDialog open nomeDoLead="Ana" onCancelar={() => {}} onConfirmar={onConfirmar} />);
    const botao = screen.getByRole("button", { name: "Desqualificar" });
    expect(botao).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Outro" }));
    expect(botao).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Descreva o motivo"), { target: { value: "Número de outra cidade" } });
    expect(botao).not.toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Sem interesse" }));
    fireEvent.click(botao);
    expect(onConfirmar).toHaveBeenCalledWith("Sem interesse");
  });

  it("'Outro' grava o texto junto", () => {
    const onConfirmar = vi.fn();
    render(<MotivoDesqualificacaoDialog open onCancelar={() => {}} onConfirmar={onConfirmar} />);
    fireEvent.click(screen.getByRole("radio", { name: "Outro" }));
    fireEvent.change(screen.getByPlaceholderText("Descreva o motivo"), { target: { value: "  Engano  " } });
    fireEvent.click(screen.getByRole("button", { name: "Desqualificar" }));
    expect(onConfirmar).toHaveBeenCalledWith("Outro: Engano");
  });
});

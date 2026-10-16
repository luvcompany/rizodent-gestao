/**
 * "Responder por" (SeletorNumeroEnvio) e o rótulo do número.
 *
 * 09/10/2026 (item 10): nada de número desativado, troca conferida no banco e o
 * selo "Vai sair por" do compositor reconsultado.
 * 14/10/2026 (0037, a conversa segue o paciente): a lista vem do banco
 * (opcoes_numero_resposta) — números da equipe do lead e, com a janela de 24h
 * aberta, o de outra equipe em que o paciente escreveu — e a escolha fica no
 * lead por definir_numero_resposta ("Automático" = null).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Opcao = {
  numero_id: string;
  display_name: string | null;
  phone_e164: string | null;
  motivo: "equipe" | "janela";
  janela_ate: string | null;
  escolhido: boolean;
};

let opcoes: Opcao[] = [];
let erroAoDefinir: unknown = null;
const definicoes: { p_lead: string; p_numero: string | null }[] = [];
const toastErro = vi.fn();
const toastOk = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (nome: string, args: { p_lead: string; p_numero?: string | null }) => {
      if (nome === "opcoes_numero_resposta") return Promise.resolve({ data: opcoes, error: null });
      if (nome === "definir_numero_resposta") {
        definicoes.push({ p_lead: args.p_lead, p_numero: args.p_numero ?? null });
        return Promise.resolve({ data: null, error: erroAoDefinir });
      }
      return Promise.resolve({ data: null, error: { message: `rpc inesperada ${nome}` } });
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastErro(...a), success: (...a: unknown[]) => toastOk(...a) } }));
// Select nativo no lugar do Radix (o Radix não abre no jsdom).
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select aria-label="Responder por" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

import SeletorNumeroEnvio from "@/components/chat/SeletorNumeroEnvio";
import { rotuloDoNumero, telefoneDoNumero } from "@/lib/numeroWhatsapp";

const EQUIPE: Opcao[] = [
  { numero_id: "oficial", display_name: "Whatsapp - Comercial", phone_e164: null, motivo: "equipe", janela_ate: null, escolhido: false },
  { numero_id: "comercial2", display_name: "Rizodent - Comercial 2", phone_e164: "+557781085179", motivo: "equipe", janela_ate: null, escolhido: false },
];

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <SeletorNumeroEnvio leadId="lead-1" atual={null} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { invalidar, onChange, seletor: () => screen.getByLabelText("Responder por") as HTMLSelectElement };
}

beforeEach(() => {
  opcoes = EQUIPE.map((o) => ({ ...o }));
  erroAoDefinir = null;
  definicoes.length = 0;
  toastErro.mockReset();
  toastOk.mockReset();
});

describe("rótulo do número", () => {
  it("mostra o telefone como está gravado, sem completar o 9º dígito", () => {
    expect(telefoneDoNumero("+557781085179")).toBe("(77) 8108-5179");
    expect(telefoneDoNumero("+5577981085179")).toBe("(77) 98108-5179");
    expect(telefoneDoNumero(null)).toBe("");
  });
  it("junta nome e telefone com ·", () => {
    expect(rotuloDoNumero({ display_name: "Rizodent - Comercial 2", phone_e164: "+557781085179" })).toBe("Rizodent - Comercial 2 · (77) 8108-5179");
    expect(rotuloDoNumero({ display_name: "Whatsapp - Comercial", phone_e164: null })).toBe("Whatsapp - Comercial");
    expect(rotuloDoNumero({ display_name: " ", phone_e164: "+557781085179" })).toBe("(77) 8108-5179");
  });
});

describe("Responder por", () => {
  it("lista Automático e os números do banco, com nome · telefone", async () => {
    const { seletor } = montar();
    await screen.findByLabelText("Responder por");
    const rotulos = Array.from(seletor().options).map((o) => o.textContent);
    expect(rotulos).toEqual(["Automático", "Whatsapp - Comercial", "Rizodent - Comercial 2 · (77) 8108-5179"]);
    expect(seletor().value).toBe("auto");
  });

  it("número de outra equipe com janela aberta aparece com o horário em que a janela fecha", async () => {
    const ate = new Date(2026, 9, 16, 9, 47).toISOString();
    opcoes.push({ numero_id: "closer", display_name: "Closer", phone_e164: "+557781294026", motivo: "janela", janela_ate: ate, escolhido: false });
    const { seletor } = montar();
    await screen.findByLabelText("Responder por");
    const rotulos = Array.from(seletor().options).map((o) => o.textContent);
    expect(rotulos[0]).toBe("Automático (onde o paciente escreveu, até 09:47)");
    expect(rotulos).toContain("Closer · (77) 8129-4026 — paciente escreveu aqui (até 09:47)");
  });

  it("mostra o número escolhido no lead", async () => {
    opcoes[1].escolhido = true;
    const { seletor } = montar();
    await waitFor(() => expect(seletor().value).toBe("comercial2"));
  });

  it("escolher um número grava no lead, avisa o chat e reconsulta o número de envio", async () => {
    const { seletor, invalidar, onChange } = montar();
    await screen.findByLabelText("Responder por");
    fireEvent.change(seletor(), { target: { value: "comercial2" } });
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Resposta vai sair por esse número"));
    expect(definicoes).toEqual([{ p_lead: "lead-1", p_numero: "comercial2" }]);
    expect(onChange).toHaveBeenCalledWith("comercial2");
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["envio-do-lead"] });
  });

  it("voltar para Automático grava null", async () => {
    opcoes[1].escolhido = true;
    const { seletor, onChange } = montar();
    await waitFor(() => expect(seletor().value).toBe("comercial2"));
    fireEvent.change(seletor(), { target: { value: "auto" } });
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Número de resposta automático"));
    expect(definicoes).toEqual([{ p_lead: "lead-1", p_numero: null }]);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("recusa do banco aparece em PT-BR e o valor volta", async () => {
    erroAoDefinir = { code: "42501", message: "Este número não pode responder este lead agora (a janela de 24h dele fechou ou ele é de outra equipe)." };
    const { seletor, onChange, invalidar } = montar();
    await screen.findByLabelText("Responder por");
    fireEvent.change(seletor(), { target: { value: "comercial2" } });
    await waitFor(() =>
      expect(toastErro).toHaveBeenCalledWith("Não foi possível trocar o número", {
        description: "Este número não pode responder este lead agora (a janela de 24h dele fechou ou ele é de outra equipe).",
      }),
    );
    expect(toastOk).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(invalidar).not.toHaveBeenCalled();
    await waitFor(() => expect(seletor().value).toBe("auto"));
  });

  it("sem nenhum número disponível, não mostra o seletor", async () => {
    opcoes = [];
    montar();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText("Responder por")).toBeNull();
  });
});

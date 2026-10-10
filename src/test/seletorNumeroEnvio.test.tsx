/**
 * "Enviar por" (SeletorNumeroEnvio) e o rótulo do número (item 10, 09/10/2026).
 *
 * Antes: o seletor listava número desativado, oferecia "Padrão" ao closer e à
 * recepção (o padrão é da central), trocava sem conferir se alguma linha mudou
 * (RLS devolve sucesso com 0 linhas) e o selo "Vai sair por" do compositor
 * continuava mostrando o número antigo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let papel: string | null = "crc";
let resultadoUpdate: { data: { id: string }[] | null; error: unknown } = { data: [{ id: "lead-1" }], error: null };
const chamadas: { tabela: string; valores: unknown; colunas?: string }[] = [];
const toastErro = vi.fn();
const toastOk = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => ({
      update: (valores: unknown) => ({
        eq: () => ({
          select: (colunas: string) => {
            chamadas.push({ tabela, valores, colunas });
            return Promise.resolve(resultadoUpdate);
          },
        }),
      }),
    }),
    rpc: vi.fn(),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userRole: papel }) }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastErro(...a), success: (...a: unknown[]) => toastOk(...a) } }));
// Select nativo no lugar do Radix (o Radix não abre no jsdom).
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select aria-label="Enviar por" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
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

const NUMEROS = [
  { id: "oficial", display_name: "Whatsapp - Comercial", phone_e164: null, is_active: true },
  { id: "comercial2", display_name: "Rizodent - Comercial 2", phone_e164: "+557781085179", is_active: true },
  { id: "contingencia", display_name: "Whatsapp Contingência", phone_e164: "+557781281211", is_active: false },
];

function montar(atual: string | null = null) {
  const qc = new QueryClient();
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <SeletorNumeroEnvio leadId="lead-1" atual={atual} numeros={NUMEROS} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { invalidar, onChange, seletor: screen.getByLabelText("Enviar por") as HTMLSelectElement };
}

beforeEach(() => {
  papel = "crc";
  resultadoUpdate = { data: [{ id: "lead-1" }], error: null };
  chamadas.length = 0;
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

describe("Enviar por", () => {
  it("lista só números ativos, com nome · telefone, e a opção Padrão para a central", () => {
    const { seletor } = montar();
    const rotulos = Array.from(seletor.options).map((o) => o.textContent);
    expect(rotulos).toContain("Padrão (número padrão de envio)");
    expect(rotulos).toContain("Rizodent - Comercial 2 · (77) 8108-5179");
    expect(rotulos).toContain("Whatsapp - Comercial");
    expect(rotulos.some((r) => r?.includes("Contingência"))).toBe(false);
    expect(seletor.value).toBe("padrao");
  });

  it.each(["closer", "recepcao"])("esconde a opção Padrão para %s", (p) => {
    papel = p;
    const { seletor } = montar("comercial2");
    expect(Array.from(seletor.options).map((o) => o.value)).not.toContain("padrao");
    expect(seletor.value).toBe("comercial2");
  });

  it("troca com .select('id'), avisa o chat e reconsulta o número de envio", async () => {
    const { seletor, invalidar, onChange } = montar();
    fireEvent.change(seletor, { target: { value: "comercial2" } });
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Número de envio alterado"));
    expect(chamadas).toEqual([{ tabela: "crm_leads", valores: { whatsapp_number_id: "comercial2" }, colunas: "id" }]);
    expect(onChange).toHaveBeenCalledWith("comercial2");
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["envio-do-lead"] });
  });

  it("0 linhas alteradas é erro (não finge sucesso) e volta o valor", async () => {
    resultadoUpdate = { data: [], error: null };
    const { seletor, invalidar, onChange } = montar();
    fireEvent.change(seletor, { target: { value: "comercial2" } });
    await waitFor(() => expect(toastErro).toHaveBeenCalled());
    expect(toastOk).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(invalidar).not.toHaveBeenCalled();
    await waitFor(() => expect(seletor.value).toBe("padrao"));
  });

  it("erro do banco aparece em PT-BR (mensagemDeErro)", async () => {
    resultadoUpdate = { data: null, error: { code: "42501", message: "Você não tem acesso a este número de WhatsApp." } };
    const { seletor } = montar();
    fireEvent.change(seletor, { target: { value: "comercial2" } });
    await waitFor(() =>
      expect(toastErro).toHaveBeenCalledWith("Não foi possível trocar o número", {
        description: "Você não tem acesso a este número de WhatsApp.",
      }),
    );
  });

  it("lead carimbado com número desativado fica sem valor (pede para escolher outro)", () => {
    const { seletor } = montar("contingencia");
    expect(seletor.value).toBe("");
  });
});

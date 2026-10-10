/**
 * Número padrão de envio pela RPC definir_numero_padrao (item 10, 09/10/2026).
 *
 * Antes: 2 UPDATEs soltos (zera todos, marca um) — se o 2º falhasse o cliente
 * ficava sem padrão; dava para "desmarcar" o padrão e marcar número de closer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let numero: { id: string; is_default: boolean; mundo: string | null } | null = null;
let erroRpc: unknown = null;
const rpc = vi.fn(async () => ({ data: "n1", error: erroRpc }));
const updates: unknown[] = [];
const toast = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  const encadeia = () => q;
  Object.assign(q, {
    select: encadeia, eq: encadeia, like: encadeia, neq: encadeia, order: encadeia,
    update: (v: unknown) => { updates.push(v); return q; },
    maybeSingle: () => Promise.resolve({ data: numero, error: null }),
    then: (ok: (r: unknown) => void) => ok({ data: [], error: null }),
  });
  return { supabase: { from: () => q, rpc: (...a: unknown[]) => rpc(...(a as [])) , functions: { invoke: vi.fn() } } };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { PadraoEnvioSwitch, PadraoEnvioWhatsapp } from "@/components/whatsapp/WhatsappSaude";

const comQuery = (el: JSX.Element) => <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>;

beforeEach(() => {
  numero = null;
  erroRpc = null;
  rpc.mockClear();
  updates.length = 0;
  toast.mockReset();
});

describe("número padrão de envio", () => {
  it("marcar como padrão chama a RPC (uma transação), nunca UPDATE solto", async () => {
    numero = { id: "n1", is_default: false, mundo: "crc" };
    render(comQuery(<PadraoEnvioSwitch phoneNumberId="123" />));
    const caixa = await screen.findByRole("checkbox");
    fireEvent.click(caixa);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("definir_numero_padrao", { p_numero: "n1" }));
    expect(updates).toEqual([]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Número padrão de envio definido" }));
  });

  it("o padrão atual não se desmarca: troca-se marcando outro", async () => {
    numero = { id: "n1", is_default: true, mundo: "crc" };
    render(comQuery(<PadraoEnvioSwitch phoneNumberId="123" />));
    const caixa = await screen.findByRole("checkbox");
    expect(caixa).toBeChecked();
    expect(caixa).toBeDisabled();
    expect(screen.getByText(/Para trocar, marque outro número da central como padrão/)).toBeInTheDocument();
  });

  it("número de closer/recepção não oferece ser padrão", async () => {
    numero = { id: "n2", is_default: false, mundo: "closer" };
    const { container } = render(comQuery(<PadraoEnvioWhatsapp phoneNumberId="999" />));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("recusa do banco aparece com a frase dele", async () => {
    numero = { id: "n1", is_default: false, mundo: "crc" };
    erroRpc = { code: "42501", message: "O número padrão precisa ser da equipe central (CRC/SDR)" };
    render(comQuery(<PadraoEnvioWhatsapp phoneNumberId="123" />));
    fireEvent.click(await screen.findByRole("button", { name: /Usar como padrão de envio/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Não foi possível alterar o número padrão",
        description: "O número padrão precisa ser da equipe central (CRC/SDR)",
        variant: "destructive",
      }),
    );
  });
});

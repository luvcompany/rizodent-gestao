import { createContext, useContext } from "react";
import type { TenantAdmin } from "./types";

/** Cliente aberto em /admin/clientes/:id. Quem provê é o ClienteLayout. */
export interface ClienteAtual {
  tenant: TenantAdmin;
  /** Recarrega o cliente do banco (depois de salvar algo nele). */
  recarregar: () => void;
}

export const ClienteAtualContext = createContext<ClienteAtual | null>(null);

/** Cliente da página atual. Lança erro fora do ClienteLayout. */
export function useClienteAtual(): ClienteAtual {
  const ctx = useContext(ClienteAtualContext);
  if (!ctx) {
    throw new Error("useClienteAtual precisa estar dentro do ClienteAtualContext (ClienteLayout).");
  }
  return ctx;
}

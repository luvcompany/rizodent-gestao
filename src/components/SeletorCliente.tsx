// Versão CRClin do seletor de cliente do v2.
//
// No v2 um usuário pode ter papel em vários clientes e troca o ativo pela RPC
// trocar_cliente_ativo. O CRClin tem um cliente só e essa RPC não existe aqui:
// o seletor do v2, por desenho, já não aparecia com um cliente só — esta versão
// só deixa isso explícito e não chama o banco. Mesma interface do v2.
import type { useQueryClient } from "@tanstack/react-query";

export type ClienteDoUsuario = {
  tenant_id: string;
  nome: string;
  slug: string;
  logo_url: string | null;
  papel: string | null;
  ativo: boolean;
};

export function enderecoDoCliente(slug: string) {
  return `/${slug}/`;
}

export const ROTA_TODOS_OS_CLIENTES = "/crm/todos";

export async function trocarClienteEAbrir(
  _queryClient: ReturnType<typeof useQueryClient>,
  _tenantId: string,
  slugReserva: string,
  destino = "/",
  navegar: (url: string) => void = (url) => window.location.assign(url),
): Promise<boolean> {
  const base = enderecoDoCliente(slugReserva);
  navegar(destino === "/" ? base : base.replace(/\/$/, "") + destino);
  return true;
}

export function SeletorCliente(_props: { navegar?: (url: string) => void }) {
  return null;
}

export default SeletorCliente;

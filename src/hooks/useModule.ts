import { useCallback, useMemo } from "react";
import { useTenantConfig, type TenantConfig } from "@/hooks/useTenantConfig";
import { ehModuloEssencial, type ModuloKey } from "@/lib/modulos";

// Módulos ligados para o cliente do usuário logado.
//
// Contrato: `ligado` é `undefined` até a config chegar — NUNCA `false` antes de
// resolver. Quem esconde menu ou redireciona rota só age com `false` explícito
// (use podeMostrar()). Lição da corrida do papel no boot: guard que decide por
// negação com valor ainda nulo expulsa o usuário.

function ligadoNaConfig(config: TenantConfig | null, key: ModuloKey): boolean {
  // Essenciais não têm interruptor (desligar /crm causaria redirecionamento
  // sem fim para a home do crc/gerente).
  if (ehModuloEssencial(key)) return true;
  // Sem config (usuário sem cliente) ou chave que o servidor não mandou: não
  // há base para negar. A negação de verdade fica no servidor.
  const valor = config?.modules[key];
  return typeof valor === "boolean" ? valor : true;
}

export function useModule(key: ModuloKey): { ligado: boolean | undefined; resolvido: boolean } {
  const { config, resolvido } = useTenantConfig();
  return {
    ligado: resolvido ? ligadoNaConfig(config, key) : undefined,
    resolvido,
  };
}

export function useModulos(): { ligado: (key: ModuloKey) => boolean | undefined; resolvido: boolean } {
  const { config, resolvido } = useTenantConfig();
  const ligado = useCallback(
    (key: ModuloKey): boolean | undefined => (resolvido ? ligadoNaConfig(config, key) : undefined),
    [config, resolvido],
  );
  return useMemo(() => ({ ligado, resolvido }), [ligado, resolvido]);
}

/**
 * true enquanto o estado é desconhecido (undefined), para o menu não piscar e
 * ninguém ser expulso de uma tela durante o carregamento. Só `false` esconde.
 */
export function podeMostrar(ligado: boolean | undefined): boolean {
  return ligado !== false;
}

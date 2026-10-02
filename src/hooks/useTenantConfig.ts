import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MODULO_KEYS, type ModuloKey } from "@/lib/modulos";
import { validarHorario, type Horario } from "@/lib/horarioComercial";

// Configuração do cliente (tenant) do usuário logado: segmento, vocabulário,
// fuso, horário comercial e módulos ligados. Vem da RPC get_my_tenant_config()
// (SECURITY DEFINER, resolve o tenant por current_tenant_id() no servidor).
//
// Regra de ouro (lição da corrida do papel no boot): quem consome isto só pode
// NEGAR algo depois que `resolvido` for true. Enquanto a config não chegou, os
// valores são "desconhecidos", nunca "desligados".

export interface TenantVocabulary {
  pessoa: string;
  pessoa_plural: string;
  servico: string;
  servico_plural: string;
  unidade: string;
  unidade_plural: string;
  profissional: string;
  especialidades: string[];
  servicos_interesse: string[];
  receita_recorrente_label: string | null;
}

export interface TenantConfig {
  tenant_id: string | null;
  segment: string | null;
  vocabulary: TenantVocabulary;
  timezone: string | null;
  /**
   * Horário comercial do PRÓPRIO cliente (tenants.business_hours), fonte única
   * de rodízio, ponto, envios automáticos, IA e relatórios. null = o servidor
   * não mandou (versão antiga da RPC) ou veio fora do formato.
   */
  businessHours: Horario | null;
  /** false = horário padrão ainda não confirmado pela clínica; null = desconhecido. */
  businessHoursConfirmado: boolean | null;
  /** Só as chaves que o servidor mandou; chave ausente = desconhecida. */
  modules: Partial<Record<ModuloKey, boolean>>;
}

/** Termos neutros, usados enquanto a config não chega ou quando falta um campo. */
export const VOCABULARIO_NEUTRO: Readonly<TenantVocabulary> = Object.freeze({
  pessoa: "Paciente",
  pessoa_plural: "Pacientes",
  servico: "Procedimento",
  servico_plural: "Procedimentos",
  unidade: "Clínica",
  unidade_plural: "Clínicas",
  profissional: "Profissional",
  especialidades: [],
  servicos_interesse: [],
  receita_recorrente_label: null,
});

function texto(valor: unknown, padrao: string): string {
  if (typeof valor !== "string") return padrao;
  const t = valor.trim();
  return t ? t : padrao;
}

function textoOuNulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t ? t : null;
}

function listaDeTextos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of valor) {
    if (typeof item !== "string") continue;
    const t = item.trim().replace(/\s+/g, " ");
    if (!t || vistos.has(t)) continue;
    vistos.add(t);
    saida.push(t);
  }
  return saida;
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

/** Converte o jsonb da RPC num objeto tipado, preenchendo o que faltar. */
export function normalizarTenantConfig(bruto: unknown): TenantConfig | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const obj = bruto as Record<string, unknown>;
  const voc = comoObjeto(obj.vocabulary);
  const mods = comoObjeto(obj.modules);

  const modules: Partial<Record<ModuloKey, boolean>> = {};
  for (const key of MODULO_KEYS) {
    const v = mods[key];
    if (typeof v === "boolean") modules[key] = v;
  }

  const horario = validarHorario(obj.business_hours);

  return {
    tenant_id: textoOuNulo(obj.tenant_id),
    segment: textoOuNulo(obj.segment),
    timezone: textoOuNulo(obj.timezone),
    businessHours: horario.ok ? horario.valor : null,
    businessHoursConfirmado: typeof obj.business_hours_confirmado === "boolean" ? obj.business_hours_confirmado : null,
    vocabulary: {
      pessoa: texto(voc.pessoa, VOCABULARIO_NEUTRO.pessoa),
      pessoa_plural: texto(voc.pessoa_plural, VOCABULARIO_NEUTRO.pessoa_plural),
      servico: texto(voc.servico, VOCABULARIO_NEUTRO.servico),
      servico_plural: texto(voc.servico_plural, VOCABULARIO_NEUTRO.servico_plural),
      unidade: texto(voc.unidade, VOCABULARIO_NEUTRO.unidade),
      unidade_plural: texto(voc.unidade_plural, VOCABULARIO_NEUTRO.unidade_plural),
      profissional: texto(voc.profissional, VOCABULARIO_NEUTRO.profissional),
      especialidades: listaDeTextos(voc.especialidades),
      servicos_interesse: listaDeTextos(voc.servicos_interesse),
      receita_recorrente_label: textoOuNulo(voc.receita_recorrente_label),
    },
    modules,
  };
}

async function carregarTenantConfig(): Promise<TenantConfig | null> {
  const { data, error } = await (supabase.rpc as any)("get_my_tenant_config");
  if (error) throw error;
  return normalizarTenantConfig(data);
}

export function useTenantConfig(): {
  config: TenantConfig | null;
  carregando: boolean;
  /** true só depois que a RPC respondeu com sucesso para o usuário atual. */
  resolvido: boolean;
  erro: unknown;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ["tenant-config", userId],
    queryFn: carregarTenantConfig,
    enabled: !!userId,
    // 60 s de validade e releitura ao focar a aba: o admin religa um módulo e o
    // menu volta quando o usuário volta para a aba, sem novo login.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  // Resolvido = já existe uma resposta para ESTE usuário. Uma releitura que
  // falhe depois não desfaz isso (o react-query mantém o último dado bom).
  const resolvido = !!userId && query.data !== undefined;
  return {
    config: resolvido ? query.data ?? null : null,
    carregando: !!userId && query.isPending,
    resolvido,
    erro: query.error,
  };
}

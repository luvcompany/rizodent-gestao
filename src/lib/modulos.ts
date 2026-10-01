// Módulos do cliente (tenant) e o mapa rota → módulo usado pelo menu e pelos
// guards de rota do CRM.
//
// As chaves são as mesmas do catálogo public.modules e do objeto `modules`
// devolvido pela RPC get_my_tenant_config().

export const MODULO_KEYS = [
  "conversas",
  "funil",
  "agenda",
  "pacientes",
  "ligacoes",
  "modelos",
  "automacoes",
  "campanhas",
  "ia",
  "relatorios",
  "rodizio_sdr",
  "ponto",
  "capi",
  "dontus",
] as const;

export type ModuloKey = (typeof MODULO_KEYS)[number];

export function ehModuloKey(valor: unknown): valor is ModuloKey {
  return typeof valor === "string" && (MODULO_KEYS as readonly string[]).includes(valor);
}

/**
 * Módulos essenciais: não têm interruptor. São a home do crc/gerente (/crm),
 * a caixa de conversas e o cadastro de pacientes; desligar qualquer um deles
 * deixaria o usuário num redirecionamento sem fim (a home redireciona para ela
 * mesma). Por isso o front os trata SEMPRE como ligados, mesmo que o banco
 * diga o contrário.
 */
export const MODULOS_ESSENCIAIS: readonly ModuloKey[] = ["conversas", "funil", "pacientes"];

export function ehModuloEssencial(key: ModuloKey): boolean {
  return MODULOS_ESSENCIAIS.includes(key);
}

export interface RotaDeModulo {
  prefixo: string;
  /** true: casa só o caminho exato (sem subrotas). */
  exato?: boolean;
  /** null: a rota é explicitamente livre de módulo (não herda do prefixo pai). */
  modulo: ModuloKey | null;
}

/**
 * A ORDEM IMPORTA: a primeira entrada que casar vence, então o prefixo mais
 * específico vem antes do mais genérico. O prefixo casa o caminho exato ou uma
 * subrota ("/crm/modelos" casa "/crm/modelos/x", mas não "/crm/modelosx").
 */
export const ROTAS_DE_MODULO: ReadonlyArray<RotaDeModulo> = [
  { prefixo: "/crm/conversas", modulo: "conversas" },
  { prefixo: "/crm/conversa", modulo: "conversas" },
  { prefixo: "/crm", exato: true, modulo: "funil" },
  { prefixo: "/crm/calendario", modulo: "agenda" },
  { prefixo: "/crm/ligacoes", modulo: "ligacoes" },
  { prefixo: "/crm/modelos", modulo: "modelos" },
  { prefixo: "/crm/respostas-rapidas", modulo: "modelos" },
  { prefixo: "/crm/automacoes", modulo: "automacoes" },
  { prefixo: "/crm/bots", modulo: "automacoes" },
  { prefixo: "/crm/campanhas", modulo: "campanhas" },
  { prefixo: "/crm/ia-config", modulo: "ia" },
  { prefixo: "/crm/relatorios", modulo: "relatorios" },
  { prefixo: "/crm/metricas", modulo: "relatorios" },
  { prefixo: "/relatorios", modulo: "relatorios" },
  { prefixo: "/marketing", modulo: "relatorios" },
  // Equipe: cada subrota tem dono próprio. "Pesquisa de satisfação" não é do
  // rodízio de SDRs e não depende de módulo nenhum.
  { prefixo: "/crm/equipe/ponto", modulo: "ponto" },
  { prefixo: "/crm/equipe/relatorio-sdr", modulo: "rodizio_sdr" },
  { prefixo: "/crm/equipe/pesquisa", modulo: null },
  { prefixo: "/crm/equipe", exato: true, modulo: "rodizio_sdr" },
  { prefixo: "/pacientes", modulo: "pacientes" },
  { prefixo: "/atendimento", modulo: "pacientes" },
  { prefixo: "/procedimentos", modulo: "pacientes" },
  { prefixo: "/crm/closer/pacientes", modulo: "pacientes" },
];

function normalizarCaminho(pathname: string): string {
  let p = String(pathname ?? "").trim();
  // Aceita também um caminho com query ou hash.
  const corte = p.search(/[?#]/);
  if (corte !== -1) p = p.slice(0, corte);
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.toLowerCase();
}

/**
 * Módulo que controla a rota, ou null se a rota não depende de módulo.
 * Recebe o pathname JÁ SEM o basename do cliente (/<slug>).
 */
export function moduloDaRota(pathname: string): ModuloKey | null {
  const caminho = normalizarCaminho(pathname);
  for (const rota of ROTAS_DE_MODULO) {
    const casa = rota.exato
      ? caminho === rota.prefixo
      : caminho === rota.prefixo || caminho.startsWith(`${rota.prefixo}/`);
    if (casa) return rota.modulo;
  }
  return null;
}

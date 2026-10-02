/**
 * Quem abre a tela de I.A (/crm/ia-config) e o que dizer a quem não abre.
 *
 * Espelho do menu (CrmLayout.buildCrmNavItems) e do ProtectedRoute: SDR,
 * closer e recepção têm menu próprio, sem a I.A, e a rota os devolve para a
 * casa deles. Os avisos do chat (sugestão da IA, painel de análise) só levam
 * o atalho "Abrir I.A" e o caminho "I.A → …" para quem chega lá; os outros
 * recebem uma frase que diz a quem pedir.
 */

const PAPEIS_SEM_TELA_DE_IA = new Set(["sdr", "closer", "recepcao"]);

/** O papel tem a tela de I.A no menu. Papel ainda desconhecido = não. */
export function abreTelaDeIa(papel: string | null | undefined): boolean {
  return !!papel && !PAPEIS_SEM_TELA_DE_IA.has(papel);
}

/** Pulos da IA que se resolvem na tela de I.A (códigos fixos do P11). */
export const PULOS_DA_TELA_DE_IA = new Set(["copilot_disabled", "no_kb", "no_config", "feature_off"]);

const PULO_SEM_TELA: Record<string, string> = {
  copilot_disabled: "O copiloto da IA está desligado nesta clínica.",
  no_kb: "A IA ainda não tem a base de conhecimento para sugerir respostas.",
  no_config: "A assistente de IA está desativada nesta clínica.",
  feature_off: "Esta função da IA está desligada nesta clínica.",
};

/** Frase de um pulo da IA para quem não abre a tela de I.A. */
export function motivoDoPuloSemTelaDeIa(pulo: string): string {
  const frase = PULO_SEM_TELA[pulo] ?? "A IA não está configurada para isso nesta clínica.";
  return `${frase} Peça à gestão da clínica para configurar a IA.`;
}

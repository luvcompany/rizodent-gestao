// desfechoLabel — fonte ÚNICA do rótulo (e da cor) do desfecho de um
// agendamento de crm_appointments, por papel de usuário.
//
// POR QUE ESTE ARQUIVO EXISTE
// O dono foi explícito: a SDR não pode ler "Não contratado" em lugar nenhum da
// interface. Quem decide contrato é o pagamento (Dontus) / o administrador, não
// ela. Só que, no banco, o "compareceu" da SDR é gravado como
// status = 'not_contracted' (é o estado neutro: compareceu e ainda não há
// contrato). Sem este arquivo, ela marca "Compareceu" e a tela responde
// "Não contratado" — parece que ela perdeu a venda, e não é isso.
//
// A REGRA (decisão D3, corrigida em 10/09 depois da revisão)
// O desfecho de venda — 'contracted' x 'not_contracted' — é revelado SOMENTE a
// papel positivamente reconhecido como de gestão: crc, gerente, superadmin,
// posvenda, closer, recepcao. Todo o resto lê "Compareceu": a SDR, um papel novo
// que ninguém ensinou a este arquivo e, principalmente, o papel AINDA NÃO
// RESOLVIDO no boot (null / undefined / string vazia).
//
// Por que não "todo mundo menos a SDR", que era a versão anterior: aquilo decide
// por afirmação e, com papel desconhecido, o default é ENTREGAR o segredo. Este
// projeto já levou o incidente da "corrida do papel no boot" (guard que decidia
// com userRole nulo expulsava o closer da própria home) — e aqui o erro simétrico
// é pior, porque vaza informação em vez de negar tela: durante o instante em que
// o AuthContext ainda não resolveu o papel (roleResolved = false, papel lido do
// cache ou nulo), a tela da SDR escreveria "Não contratado".
// O custo de inverter: um gestor pode ler "Compareceu" por uma fração de segundo
// até o papel chegar — inofensivo, o dado dele volta no render seguinte. Vazar
// para a SDR não é inofensivo, e não tem render seguinte que desfaça.
//
// A cor e o ícone seguem a MESMA regra: se a cor variasse (verde x vermelho), a
// interface entregaria pela cor a informação que o rótulo esconde.
//
// PROCEDÊNCIA DOS TEXTOS E DAS CORES (nada aqui foi inventado)
//   • textos: src/components/chat/AppointmentConfirmBar.tsx (o antigo
//     TERMINAL_LABEL: no_show "Falta", rescheduled "Remarcada", cancelled
//     "Cancelada", contracted "Contratado", not_contracted "Não contratado") e
//     src/pages/recepcao/RecepcaoHome.tsx (confirmed "Confirmado"). A única
//     exceção é 'pending', que essas telas não rotulam: usamos "Pendente", o
//     texto que CrmDashboard.tsx e CrmMetricas.tsx já usam.
//   • cores: as classes do calendário (src/pages/CrmCalendario.tsx), com UMA
//     ressalva importante — o calendário NÃO pinta por status em todos os casos.
//     O roxo dele sai do ramo `(appt as any).is_rescheduled`, a FLAG derivada de
//     rescheduled_from_id, e não de status = 'rescheduled'; o calendário não tem
//     ramo para esse status (uma consulta 'rescheduled' que não seja filha de
//     outra cai no estilo neutro de lá). Aqui o roxo está amarrado ao status
//     'rescheduled', que é o que este helper recebe — é decisão deste arquivo,
//     não uma cópia do que o calendário mostra para aquele status.

/** Papel do usuário logado — normalmente o `userRole` do useAuth (compatível com AppRole). */
export type PapelUsuario = string | null | undefined;

/** Status possíveis de crm_appointments.status. */
export type StatusAgendamento =
  | "pending"
  | "confirmed"
  | "no_show"
  | "rescheduled"
  | "cancelled"
  | "contracted"
  | "not_contracted";

/** Os dois status que significam "o paciente compareceu" (régua de reportKit.kpiAgendamentos). */
const DESFECHOS_DE_COMPARECIMENTO = ["contracted", "not_contracted"] as const;

/** O que quem não é da gestão lê nos dois casos acima. */
export const ROTULO_COMPARECEU = "Compareceu";

/**
 * Os papéis que PODEM ler contrato — a lista é positiva de propósito (ver o
 * cabeçalho): quem não está aqui não lê, e isso inclui papel nulo, vazio,
 * desconhecido e o papel que ainda não chegou no boot.
 *
 * 'sdr' nunca entra nesta lista (pedido literal do dono). Os papéis operacionais
 * que entram — recepcao e closer — leem contrato porque atendem o paciente já do
 * lado do fechamento; posvenda e crc/gerente/superadmin são a gestão do ciclo.
 *
 * 'crc_legacy' (do enum app_role, papel legado que nem aparece em TENANT_ROLES)
 * ficou FORA de propósito: ninguém o atribui hoje e, se algum usuário antigo
 * ainda o tiver, ele lê "Compareceu" — perde detalhe, nunca vaza. Se o dono
 * quiser que ele leia contrato, é só acrescentar aqui, num lugar só.
 */
const PAPEIS_QUE_LEEM_DESFECHO_DE_VENDA = new Set([
  "crc",
  "gerente",
  "superadmin",
  "posvenda",
  "closer",
  "recepcao",
]);

/** Rótulos por status — o que um papel de gestão enxerga. */
const ROTULO_POR_STATUS: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  no_show: "Falta",
  rescheduled: "Remarcada",
  cancelled: "Cancelada",
  contracted: "Contratado",
  not_contracted: "Não contratado",
};

/** Classes Tailwind por status (ver a ressalva do 'rescheduled' no cabeçalho). */
const COR_POR_STATUS: Record<string, string> = {
  pending: "bg-primary/10 text-foreground border border-border",
  confirmed: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30",
  no_show: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/50",
  rescheduled: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30",
  cancelled: "bg-muted text-muted-foreground border border-border line-through",
  contracted: "bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 border border-emerald-500/50",
  not_contracted: "bg-red-500/20 text-red-700 dark:text-red-300 border border-red-500/50",
};

/** Cor única do "Compareceu" — igual para 'contracted' e 'not_contracted'. */
const COR_COMPARECEU = COR_POR_STATUS.contracted;

/** Cor de quando não sabemos o status (nunca deve acontecer: a coluna é NOT NULL). */
const COR_DESCONHECIDA = COR_POR_STATUS.pending;

/** Normaliza status/papel vindos de fora (defensivo contra espaço/caixa). */
function normaliza(valor: string | null | undefined): string {
  return (valor ?? "").trim().toLowerCase();
}

/**
 * true SOMENTE para papel reconhecido como de gestão do ciclo de venda — o
 * único que lê "Contratado"/"Não contratado". Papel nulo, vazio ou desconhecido
 * devolve false (o segredo não tem default aberto).
 */
export function papelLeDesfechoDeVenda(papel: PapelUsuario): boolean {
  return PAPEIS_QUE_LEEM_DESFECHO_DE_VENDA.has(normaliza(papel));
}

/**
 * A pergunta que a interface precisa fazer: "preciso esconder o contrato deste
 * usuário?". É o complemento de papelLeDesfechoDeVenda — use ESTA para decidir
 * sigilo (rótulo, cor, ícone, contador), nunca a igualdade com 'sdr'.
 */
export function escondeDesfechoDeVenda(papel: PapelUsuario): boolean {
  return !papelLeDesfechoDeVenda(papel);
}

/**
 * true quando o papel é, literalmente, o da pré-vendedora.
 *
 * NÃO USE PARA DECIDIR SIGILO: ela responde false para papel nulo/desconhecido
 * (é uma afirmação sobre o papel, não uma trava), e foi assim que o vazamento
 * apareceu. Para esconder contrato, use escondeDesfechoDeVenda().
 * Serve para o oposto: ligar algo que é exclusivo da SDR.
 *
 * DÍVIDA ABERTA (10/09/2026): src/pages/CrmCalendario.tsx ainda decide o sigilo
 * com ela em três pontos (legenda, emoji do card e o contador do rodapé do dia),
 * então lá o papel nulo do boot vê 🤝/❌ e os dois contadores separados. O
 * conserto é trocar essas três chamadas por escondeDesfechoDeVenda(userRole) —
 * ficou fora desta rodada porque aquele arquivo não estava aberto para edição.
 */
export function ehPapelSdr(papel: PapelUsuario): boolean {
  return normaliza(papel) === "sdr";
}

/**
 * true para os status que significam "o paciente compareceu": 'contracted' e
 * 'not_contracted'. Mesma régua do relatório (reportKit.kpiAgendamentos):
 * 'rescheduled' NÃO é comparecimento, é agendamento substituído.
 */
export function desfechoEhComparecimento(status: string | null | undefined): boolean {
  const s = normaliza(status);
  return (DESFECHOS_DE_COMPARECIMENTO as readonly string[]).includes(s);
}

/**
 * Rótulo do desfecho para mostrar na tela.
 *
 * - 'contracted' | 'not_contracted' → "Compareceu", a menos que o papel esteja
 *   positivamente reconhecido como de gestão (decisão D3);
 * - qualquer outro caso → o texto que o sistema já usa hoje;
 * - status vazio/nulo → "—";
 * - status desconhecido → o próprio valor cru (mesmo fallback do
 *   AppointmentConfirmBar), para o defeito aparecer em vez de virar "Pendente".
 */
export function rotuloDesfecho(status: string | null | undefined, papel: PapelUsuario): string {
  const s = normaliza(status);
  if (!s) return "—";
  if (desfechoEhComparecimento(s) && escondeDesfechoDeVenda(papel)) return ROTULO_COMPARECEU;
  return ROTULO_POR_STATUS[s] ?? s;
}

/**
 * Classes Tailwind (fundo + texto + borda) para o rótulo acima. Pensado para
 * <Badge className={corDesfecho(...)}> ou para uma <span> no calendário.
 *
 * Para quem não lê contrato, 'contracted' e 'not_contracted' devolvem a MESMA
 * classe — senão a cor contaria o que o rótulo esconde.
 */
export function corDesfecho(status: string | null | undefined, papel: PapelUsuario): string {
  const s = normaliza(status);
  if (!s) return COR_DESCONHECIDA;
  if (desfechoEhComparecimento(s) && escondeDesfechoDeVenda(papel)) return COR_COMPARECEU;
  return COR_POR_STATUS[s] ?? COR_DESCONHECIDA;
}

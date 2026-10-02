// Singular e plural em PT-BR para contadores da interface (SDR-20).
//
// Antes cada tela escrevia `${n} conversas` / `${n} leads` fixo e o usuário lia
// "Ver as outras 1 conversas", "1 leads", "1 agendamentos". Aqui fica a regra
// única: 1 (e -1) = singular; qualquer outro número, inclusive 0, = plural
// ("0 agendamentos", como se fala).

/** A palavra certa para a quantidade: plural(1, "lead", "leads") → "lead". */
export function plural(n: number, singular: string, plural: string): string {
  return Math.abs(n) === 1 ? singular : plural;
}

/** Número + palavra: contagem(3, "tarefa", "tarefas") → "3 tarefas". */
export function contagem(n: number, singular: string, pluralForma: string): string {
  return `${n} ${plural(n, singular, pluralForma)}`;
}

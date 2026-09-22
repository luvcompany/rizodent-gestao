/**
 * Sinal de "o quadro ficou velho".
 *
 * O Kanban guarda o quadro em cache (memória 5 min e localStorage 15 min) para
 * voltar instantâneo de uma conversa. Só que, com a conversa aberta, o Kanban
 * não está montado e não ouve o Realtime: o que muda ali — desfecho da
 * consulta, troca de etapa — nunca chegava ao cache. Ao voltar, o card
 * aparecia na coluna antiga.
 *
 * Relato de 21/09/2026: a SDR marcou "Não compareceu", o banco moveu o lead
 * para Não compareceu na hora e o quadro continuou mostrando o card em
 * Agendado. Ela arrastava de novo à mão, achando que o botão não funcionava.
 *
 * Quem muda um lead fora do quadro chama `avisarQueLeadMudou()`; o Kanban só
 * usa cache salvo DEPOIS do último aviso.
 */
let mudouEm = 0;

export function avisarQueLeadMudou(): void {
  mudouEm = Date.now();
}

export function cacheDoKanbanVale(salvoEm: number): boolean {
  return salvoEm > mudouEm;
}

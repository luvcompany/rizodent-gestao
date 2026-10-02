/**
 * Aviso de "dados mudaram" entre telas.
 *
 * Painéis e listas guardam cache (até 5 min). Depois de gravar um pagamento,
 * tratamento ou paciente, quem gravou chama `invalidarPaineis()` e as telas
 * inscritas recarregam na hora, sem esperar o cache vencer.
 *
 * Sem JSX de propósito: pode ser usado em libs, hooks e telas.
 */

let versao = 0;
const inscritos = new Set<() => void>();

/** Avisa todas as telas inscritas de que os dados mudaram. */
export function invalidarPaineis(): void {
  versao += 1;
  for (const fn of [...inscritos]) {
    try {
      fn();
    } catch {
      // Uma tela que falha ao recarregar não pode impedir as outras.
    }
  }
}

/** Inscreve `fn` e devolve a função que cancela a inscrição. */
export function aoInvalidarPaineis(fn: () => void): () => void {
  inscritos.add(fn);
  return () => {
    inscritos.delete(fn);
  };
}

/** Sobe 1 a cada invalidação — serve como chave de dependência. */
export function versaoDosPaineis(): number {
  return versao;
}

/**
 * Recarga única após publicação.
 *
 * Quando uma aba antiga tenta baixar um pedaço de código que não existe mais
 * (publicamos uma versão nova), o jeito de voltar é recarregar. Mas recarregar
 * em laço deixa o app inutilizável, então guardamos o horário da última recarga
 * no sessionStorage e só repetimos depois de 60 s.
 */
const CHAVE = "crm:recarga-apos-publicacao";
const JANELA_MS = 60_000;

export function recarregarUmaVez(): boolean {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    const anterior = bruto ? Number(bruto) : NaN;
    const agora = Date.now();
    if (Number.isFinite(anterior) && agora - anterior < JANELA_MS) return false;
    sessionStorage.setItem(CHAVE, String(agora));
  } catch {
    // Sem sessionStorage (aba privada, storage bloqueado): não recarrega.
    return false;
  }
  window.location.reload();
  return true;
}

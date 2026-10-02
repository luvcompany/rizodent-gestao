/**
 * Assinatura nas mensagens (profiles.signature_enabled): o nome de quem
 * responde, em negrito do WhatsApp, na primeira linha da mensagem.
 *
 * Fonte única do formato para a prévia (EditProfileDialog, Configurações) e
 * para o envio (ChatInput, que hoje monta `*${nome}:*\n${texto}` — o mesmo
 * formato; ao mexer lá, usar `comAssinatura`). Antes a prévia mostrava
 * `*Nome*` e o envio mandava `*Nome:*` (X-3).
 */
export function cabecalhoDaAssinatura(nome: string): string {
  return `*${nome.trim()}:*`;
}

export function comAssinatura(nome: string, texto: string): string {
  return `${cabecalhoDaAssinatura(nome)}\n${texto}`;
}

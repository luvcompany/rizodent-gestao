// Detecta e formata mensagens de "call_permission_reply" (respostas do WhatsApp
// quando o cliente aceita ou recusa a solicitação de permissão de ligação).

export type CallPermissionReply = {
  response: "accept" | "reject";
  is_permanent?: boolean;
  expiration_timestamp?: number;
};

export function parseCallPermissionReply(content?: string | null): CallPermissionReply | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj?.type !== "call_permission_reply") return null;
    const inner = obj.call_permission_reply || {};
    if (inner.response !== "accept" && inner.response !== "reject") return null;
    return {
      response: inner.response,
      is_permanent: !!inner.is_permanent,
      expiration_timestamp: inner.expiration_timestamp,
    };
  } catch {
    return null;
  }
}

export function formatCallPermissionReply(reply: CallPermissionReply): string {
  if (reply.response === "reject") return "📞 Cliente recusou receber ligações";
  if (reply.is_permanent) return "📞 Cliente autorizou ligações permanentemente";
  return "📞 Cliente autorizou receber ligações";
}

// Texto legível para o preview da lista de conversas (senão vaza JSON cru quando a
// última mensagem é uma resposta/pedido de permissão de ligação). Retorna null se
// o conteúdo não for um desses casos — aí o chamador usa o texto original.
export function formatCallPermissionPreview(content?: string | null): string | null {
  const reply = parseCallPermissionReply(content);
  if (reply) return formatCallPermissionReply(reply);
  const t = (content || "").trim();
  if (t.startsWith("{") && t.includes("call_permission_request")) {
    return "📞 Solicitação de permissão de ligação enviada";
  }
  return null;
}

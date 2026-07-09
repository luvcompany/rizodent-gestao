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

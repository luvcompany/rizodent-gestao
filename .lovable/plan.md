## Erro amigável quando o lead não permite ligação

Hoje qualquer erro da Graph API vira um `Signaling error: Edge Function returned a non-2xx status code` porque o `supabase.functions.invoke` engole o corpo em respostas 4xx. Vou tratar o código `138006` (`No approved call permission`) como um caso de negócio, não como erro técnico.

### 1. `supabase/functions/whatsapp-call-signaling/index.ts`

No bloco `if (!graphRes.ok)` (linha ~235), antes de retornar 4xx genérico:

- Extrair `graphJson?.error?.code` e `error_subcode`.
- Mapear códigos conhecidos para um `code` interno:
  - `138006` → `no_call_permission`
  - (deixar aberto para futuros: `138007` etc.)
- Para códigos mapeados, responder **HTTP 200** com body `{ ok: false, code: "no_call_permission", user_message: "Este contato ainda não autorizou receber ligações pelo WhatsApp." }` e ainda atualizar `whatsapp_calls` com `status='failed'` + `error_message`.
- Demais erros: manter o retorno 4xx/5xx atual.

Motivo do 200: `functions.invoke` só popula `data` quando o status é 2xx; usar 200 garante que o frontend leia o `code`.

### 2. `src/lib/whatsapp-call-session.ts`

Nos dois `invoke` (`connect` e `accept/pre_accept`), depois de checar `error`, checar também:

```ts
if ((data as any)?.ok === false) {
  const err: any = new Error((data as any).user_message || (data as any).code);
  err.code = (data as any).code;
  this.cleanup();
  throw err;
}
```

Manter o comportamento atual para `data.error`.

### 3. `src/contexts/WhatsappCallContext.tsx`

No `catch` de `initiate` (linha 288-289) e `accept` (199-200):

```ts
if (e?.code === "no_call_permission") {
  toast.error("Este contato ainda não autorizou receber ligações pelo WhatsApp Business.", {
    description: "Peça para ele responder à solicitação de permissão de chamada e tente novamente.",
  });
} else {
  toast.error(`Falha ao iniciar chamada: ${e?.message ?? e}`);
}
```

### Fora do escopo

- Enviar automaticamente o template de permissão de ligação (`call_permission_request`) — pode virar próximo passo.
- UI persistente indicando "sem permissão" no header da conversa.

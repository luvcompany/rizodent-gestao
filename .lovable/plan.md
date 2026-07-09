# Corrigir 404 ao finalizar OAuth de Instagram/WhatsApp

## Causa
O secret `FRONTEND_URL` foi salvo com um path (ex.: `https://crclin.com.br/crm/integracoes`). Os edge functions `instagram-oauth-callback` e `whatsapp-oauth-callback` concatenam `${FRONTEND_URL}/oauth-close?...`, gerando `crclin.com.br/crm/integracoes/oauth-close` — rota inexistente → 404. A página `/oauth-close` (que já posta `window.opener.postMessage` e chama `window.close()`) só existe na raiz do domínio.

## Mudanças

### 1. `supabase/functions/instagram-oauth-callback/index.ts`
Em `popupResponse`, normalizar `FRONTEND_URL` para usar **somente o origin** (protocolo + host), descartando qualquer path:

```ts
function resolveOrigin(): string {
  try {
    return new URL(FRONTEND_URL || "https://crclin.com.br").origin;
  } catch {
    return "https://crclin.com.br";
  }
}

function popupResponse(channel, status, count = 0) {
  const base = resolveOrigin();
  const qs = new URLSearchParams({ channel, status, count: String(count) });
  return Response.redirect(`${base}/oauth-close?${qs.toString()}`, 302);
}
```

### 2. `supabase/functions/whatsapp-oauth-callback/index.ts`
Aplicar a mesma normalização de origin no `popupResponse` desta função.

### 3. Adicionar `/oauth-close` também no `TenantApp`
Blindagem para o caso de futuros deploys em subdomínio (`luv.crclin.com.br`), onde o `main.tsx` entra em modo tenant e a rota de root não é servida. Registrar `<Route path="/oauth-close" element={<OAuthClose />} />` dentro de `TenantApp` (fora do bloco autenticado).

## Verificação
1. Rodar de novo o fluxo "Configurar Instagram" na conta LUV — o popup deve exibir "✅ Conectado com sucesso!" e fechar em ~800ms.
2. Rodar Embedded Signup do WhatsApp com uma conta nova — mesmo comportamento.
3. Confirmar que a página principal recebe o `postMessage({ type: "oauth_result" })` e atualiza a lista de integrações sem F5.

## Fora do escopo
- Não altero o secret `FRONTEND_URL` (o código passa a ignorar path indesejado, deixando o secret intocado).
- Não mudo o handler do webhook, nem os `subscribed_fields` (esse é o plano anterior sobre recebimento de mensagens).

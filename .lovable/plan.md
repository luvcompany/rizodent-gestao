## Problema

Os envios de mensagens (texto, áudio, arquivos) estão voltando 401 da edge function `send-whatsapp-message`. Os logs mostram:

```
[send-whatsapp-message] Unauthorized: token len=802, apikey len=208, serviceKey len=41
```

A `serviceKey` no ambiente tem **41 caracteres** (formato novo `sb_secret_…` da rotação de chaves do Supabase), enquanto o frontend continua mandando o JWT antigo (208 chars no `apikey`, 802 no `Bearer`). A validação atual da função:

1. Compara o token recebido literalmente com `SUPABASE_SERVICE_ROLE_KEY` → não bate (formatos diferentes).
2. Cai no `anonClient.auth.getUser(token)` que, com o `SUPABASE_ANON_KEY` também no novo formato, está falhando silenciosamente e retornando 401.

Resultado: nenhum envio pelo chat funciona, mesmo que o JWT do usuário seja válido (REST normal continua respondendo 200).

## Correção

Trocar a validação manual de JWT por `supabase.auth.getClaims(token)`, que é o padrão recomendado quando o projeto está com o sistema de signing-keys (resolve o JWT via JWKS, independente do formato do anon/service key).

### Mudanças em `supabase/functions/send-whatsapp-message/index.ts`

1. Manter o bypass por `SUPABASE_SERVICE_ROLE_KEY` (para chamadas internas legítimas).
2. Substituir o bloco `auth.getUser(token)` + fallback de `apikey` por:
   - Validar com `supabase.auth.getClaims(token)`.
   - Se inválido, retornar 401.
3. Manter os logs de aviso para diagnóstico futuro.

### Verificação de regressão

Não mexer em outras funções neste passo — `instagram-send-message`, `broadcast-engine`, `transcribe-audio`, etc., usam o mesmo padrão e podem ter o mesmo problema, mas o usuário só reclamou de envio de mensagens. Depois que confirmar que voltou, posso fazer um sweep nas demais.

### Fora de escopo

- Não tocar em RLS, storage policies, nem nas migrações recentes (foi confirmado que o problema é só na autenticação da edge function, não na policy do bucket que ajustamos antes).
- Erro Meta "An unknown error has occurred" que aparece em algumas linhas dos logs é distinto (problema com algum template/mídia específica). Investigo separadamente se persistir após este fix.

## Detalhe técnico

Trecho atual (linhas 156-186) será reescrito para:

```ts
const authHeader = req.headers.get("Authorization") || "";
const token = authHeader.replace("Bearer ", "");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const apiKeyHeader = req.headers.get("apikey") || "";

const isServiceKey = !!serviceRoleKey &&
  (token === serviceRoleKey || apiKeyHeader === serviceRoleKey);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  serviceRoleKey,
);

if (!isServiceKey) {
  if (!token) return 401 "Missing authorization header";
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return 401 "Unauthorized";
}
```

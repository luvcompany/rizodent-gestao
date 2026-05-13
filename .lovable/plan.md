# Renovação automática dos tokens do Instagram Lite

## O que será feito

1. **Criar Edge Function `instagram-token-refresh`**
   - Arquivo: `supabase/functions/instagram-token-refresh/index.ts`
   - Lê todas as contas em `ig_accounts` com `active = true` cujo `token_expires_at` esteja nos próximos 7 dias.
   - Para cada conta, chama `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...` e atualiza `access_token`, `token_expires_at` e `updated_at` na tabela.
   - Retorna um JSON com o resultado de cada conta (renovado, erro, exceção).
   - Inclui CORS e validação básica para chamadas via HTTP.
   - Usa `SUPABASE_SERVICE_ROLE_KEY` para ignorar RLS na atualização.

2. **Agendar execução semanal via `pg_cron` + `pg_net`**
   - Habilitar (se ainda não estiverem) as extensões `pg_cron` e `pg_net`.
   - Criar o job `instagram-token-refresh` com schedule `0 8 * * 1` (toda segunda 08:00 UTC = 05:00 Brasília).
   - O job dispara `net.http_post` para a URL da função, com `Authorization: Bearer <anon key>` (necessário para invocar Edge Functions; a função em si usa o service role internamente).
   - O agendamento será criado via `supabase--insert` (e não migration), porque contém URL e key específicos do projeto e não devem rodar em remixes.

## Detalhes técnicos

- **Tabela usada:** `ig_accounts` (já existe, criada na migration anterior).
- **Campo de renovação:** o endpoint `refresh_access_token` retorna `{ access_token, token_type, expires_in }` — `expires_in` em segundos (~60 dias). A nova `token_expires_at` é calculada como `now() + expires_in`.
- **Pré-requisito do token:** só funciona com tokens longos do tipo Instagram Graph API (Long-Lived). Tokens já expirados não podem ser renovados — nesse caso a função registra erro e segue para o próximo.
- **Segurança:** a função roda com `verify_jwt = false` (padrão Lovable) mas só executa operações via service role; o cron envia o header `Authorization: Bearer` para passar o gateway.
- **Logs:** cada renovação imprime `✅` ou `❌` no log da função, visível em Edge Function Logs.

## Estrutura final

```text
supabase/functions/
└── instagram-token-refresh/
    └── index.ts        ← novo
```

Cron job (no banco):
```text
cron.job  →  'instagram-token-refresh'  schedule '0 8 * * 1'
```

## Após a aprovação

Vou criar o arquivo da função e, em seguida, agendar o cron job. Não precisa adicionar nenhum secret novo — `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_URL` já estão disponíveis automaticamente nas Edge Functions.

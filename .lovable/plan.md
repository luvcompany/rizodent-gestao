## Problema

O bot de follow-up (e todas as automações por tempo) parou de disparar porque os crons internos do banco estão recebendo **401 Unauthorized** ao chamar as Edge Functions:

- Cron `invoke-automation-engine-every-minute` → chama `automation-engine` com a **anon key**, mas a função só aceita `SERVICE_ROLE_KEY` (`supabase/functions/automation-engine/index.ts`, linhas 26‑28).
- Cron `followup-engine-cron` (a cada 5 min) → mesma falha em `supabase/functions/followup-engine/index.ts` (linhas 14‑15).
- Cron `bot-engine-check-timeouts` → envia `trigger: "check_timeouts"`, que **não existe** no `bot-engine`. Esse cron é redundante (a lógica de timeout vive no `automation-engine`).

Consequências observadas no banco agora:
- 271 execuções do bot "Follow ‑ UP" em `waiting_reply`, **143 com `timeout_at` já vencido** (parado em `msg1`).
- Fila `crm_followup_queue` sem processamento.

## Correção

### 1. Liberar a checagem de auth nas duas Edge Functions internas

Aceitar qualquer um dos seguintes na header `Authorization` ou `apikey`:
- `SERVICE_ROLE_KEY` (chamadas server-to-server)
- `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` (cron via `pg_net`)

Aplicar em:
- `supabase/functions/automation-engine/index.ts`
- `supabase/functions/followup-engine/index.ts`

Padrão (idêntico ao já usado em `bot-engine`):

```ts
const auth = req.headers.get("authorization") || "";
const apiKey = req.headers.get("apikey") || "";
const token = auth.replace("Bearer ", "");
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
const pub = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const allowed = [service, anon, pub].filter(Boolean);
if (!allowed.includes(token) && !allowed.includes(apiKey)) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
}
```

Risco mínimo: as funções não recebem dados sensíveis do cliente; só varrem filas/timeouts internos.

### 2. Migração: limpar cron órfão e reagendar com service role

```sql
-- remove cron sem handler
SELECT cron.unschedule('bot-engine-check-timeouts');

-- recria automation-engine e followup-engine usando SERVICE_ROLE
-- (defesa em profundidade, mesmo após correção do step 1)
SELECT cron.unschedule('invoke-automation-engine-every-minute');
SELECT cron.schedule(
  'invoke-automation-engine-every-minute', '* * * * *',
  $$ SELECT net.http_post(
       url := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/automation-engine',
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)
       ),
       body := '{}'::jsonb
     ); $$
);
```

Como `current_setting('app.settings.service_role_key')` exige configuração extra no Postgres, o caminho prático é manter o anon key no cron e confiar na correção do step 1. **Recomendado: aplicar apenas o step 1 + remover o cron órfão.**

Migração final (mínima):
```sql
SELECT cron.unschedule('bot-engine-check-timeouts');
```

### 3. Reanimar as 143 execuções já travadas

Forçar `timeout_at = now()` para que o próximo tick do `automation-engine` (a cada 1 min, processa 10 por vez) avance todas:

```sql
UPDATE bot_executions
   SET timeout_at = now()
 WHERE status = 'waiting_reply'
   AND timeout_at IS NOT NULL
   AND timeout_at < now() + interval '5 minutes';
```

## Validação

Após aplicar:
1. Aguardar 1‑2 minutos e checar `supabase--edge_function_logs` em `automation-engine` — devem aparecer linhas `[AUTOMATION-ENGINE] Bot timeout fired ...`.
2. Conferir queda de `bot_executions` em `waiting_reply` com `timeout_at < now()`.
3. Verificar novos `bot_execution_logs` para a "Follow ‑ UP" avançando para `msg2`/etapas seguintes e `move_stage` para Nutrição.

## Detalhes técnicos

**Arquivos editados:**
- `supabase/functions/automation-engine/index.ts` — substituir checagem de auth (linhas 26‑28).
- `supabase/functions/followup-engine/index.ts` — substituir checagem de auth (linhas 13‑15).

**Migração SQL:**
- `cron.unschedule('bot-engine-check-timeouts')`.
- `UPDATE bot_executions ...` para destravar a fila atual (executar **uma vez** após o deploy das funções).

Sem mudanças de schema, sem mudanças no front-end, sem alteração nos fluxos dos bots.

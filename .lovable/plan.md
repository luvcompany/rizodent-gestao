# Corrigir os erros recorrentes na fila de automações

## Diagnóstico (confirmado com queries)

Últimas 24 h em `crm_automation_queue` (tenant Rizodent):

| Erro | Ocorrências | Origem |
|---|---|---|
| `Rate limit exceeded for trace X. Retry after Yms` | 140 | 429 do Edge Runtime quando o `automation-queue-worker` chama `bot-engine`/`send-whatsapp-message` em rajada |
| `lead blocked` | 4 | Lead marcado `is_blocked=true` chega no worker e o `throw new Error("lead blocked")` marca como `failed` |
| `bot-engine 502` | 1 | Transiente |

Todas as 140 falhas de rate-limit vieram de **uma única rajada 11:00–11:04 UTC**. O worker hoje trata 429 como falha terminal (não relê o `Retry-After` do corpo do erro), então dezenas de itens que só precisavam esperar ~40 s foram descartados.

## Auditoria de triggers

- Nenhum trigger do schema `public` está desabilitado (`pg_trigger.tgenabled != 'O'` retorna 0 linhas).
- `pg_net`: 1759 requisições 200 nas últimas 24 h e **487 timeouts de 5 s**, todos vindos dos triggers de notificação para o dashboard externo Rizodent Pulse. Não bloqueiam o CRM (execução assíncrona), mas mostram que o endpoint externo está intermitentemente lento/indisponível — reportado para você decidir se quer aumentar o timeout ou trocar o host.

## Mudanças de código

### 1. `supabase/functions/automation-queue-worker/index.ts` — tratar 429 como transiente

- No `catch` do `processOne`, detectar `Rate limit exceeded` e extrair `Retry after Xms` do texto.
- Se for 429:
  - Reagendar: `status='pending'`, `scheduled_at = now() + retryAfter + jitter (500-1500 ms)`, `error_message` guardando o motivo do último adiamento.
  - Limitar a 5 reagendamentos por item, usando um contador embutido no `error_message` (`retry #N/5`) — evita loop infinito sem precisar de migration.
  - Passado o limite: marca `failed` normalmente.
- Reduzir a rajada: baixar `PARALLEL` (hoje ~5) para **3** e aumentar o `setTimeout` entre chunks de 400 ms para **800 ms**. Combinado com o retry, cortamos o rate-limit sem alongar significativamente o processamento.

### 2. `supabase/functions/automation-queue-worker/index.ts` — tratar `lead blocked` como cancelamento

- Antes do `switch(actionType)`, se `lead.is_blocked`, marcar o item como `status='cancelled'` com `error_message='lead bloqueado — automação ignorada'` e contar em `stats.cancelled` (novo campo). Não conta como falha.

### 3. `supabase/functions/automation-engine/index.ts` — pular enfileiramento de leads bloqueados

- Nos loops que enfileiram (`before_scheduled`, `no_response`, `progressive_reengagement`, `lead_stale`, `no_show`, `time_window`), adicionar `is_blocked=false` no filtro do `SELECT` de leads elegíveis. Impede que os 4 casos por dia sequer entrem na fila.

## O que **não** muda

- Nenhuma migration de schema.
- Nenhuma alteração de lógica de negócio das automações (etapas, condições, templates permanecem iguais).
- Triggers do dashboard externo permanecem como estão até você decidir sobre os timeouts.

## Verificação após deploy

1. `psql -c "SELECT status, count(*) FROM crm_automation_queue WHERE updated_at > now() - interval '1 hour' GROUP BY status"` — esperar `failed` cair a ~0 e ver `cancelled` aparecer para leads bloqueados.
2. Redeploy manual de `automation-queue-worker` e `automation-engine`.
3. Monitorar logs por 1 h para confirmar que itens 429 reaparecem como `sent` após o retry.

## Resposta rápida à sua pergunta sobre triggers

**Nenhum gatilho do banco está desabilitado ou quebrado.** Os únicos avisos são timeouts (5 s) nas notificações HTTP para o dashboard externo Rizodent Pulse — assíncronas e sem impacto no CRM. Se quiser, posso aumentar o timeout ou tornar o POST fire-and-forget num plano separado.

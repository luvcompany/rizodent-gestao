
## Diagnóstico

A métrica "Consegui agendar" está **subestimada**. Hoje o sistema mostra **1**, mas existem **3 leads** que estão na etapa "Agendado" hoje no Funil Principal (Daiane, Ailton e Isabel). Apenas 1 deles (Daiane) tem registro em `crm_lead_stage_history` — os outros 2 foram movidos para "Agendado" hoje sem que o histórico fosse gravado.

A métrica do relatório lê **somente** a tabela `crm_lead_stage_history`, então tudo que move o lead sem gravar nessa tabela some do gráfico.

## Causa raiz: pontos do código que mudam `stage_id` sem gravar histórico

1. `supabase/functions/whatsapp-webhook/index.ts` — 3 lugares (linhas 89, 714, 766): automações `move_stage`, retorno de follow-up e `cold_lead_return` atualizam `stage_id` sem inserir em `crm_lead_stage_history`.
2. `supabase/functions/automation-engine/index.ts` — 2 lugares (linhas 168, 252): triggers `no_response` e `before_scheduled` chamam `update stage_id` sem histórico.
3. `src/pages/CrmCalendario.tsx` — linha 758: ao registrar resultado do agendamento, há um caminho que só atualiza `stage_id` sem gravar histórico.
4. `supabase/functions/bot-engine/index.ts` — linha 879: insere histórico mas **sem** `from_stage_id` nem `entered_at` explícito (funciona, mas inconsistente).

## Solução

### A) Corrigir todos os pontos que movem stage para também gravar histórico
Padronizar um helper `moveLeadToStage(leadId, newStageId)` que:
1. Lê `stage_id` atual.
2. Atualiza `crm_leads.stage_id` + `updated_at`.
3. Fecha entrada aberta em `crm_lead_stage_history` (`exited_at = now()`).
4. Insere nova linha com `from_stage_id`, `stage_id`, `entered_at = now()`.

Aplicar nos 4 arquivos acima. Para edge functions, helper inline em cada arquivo (já que são isolados).

### B) Backfill dos leads históricos sem registro
Migration única que, para cada lead em `crm_leads` sem entrada aberta correspondente em `crm_lead_stage_history`, insere uma linha usando `updated_at` como `entered_at`. Isso recupera os agendamentos perdidos (incluindo Ailton e Isabel de hoje).

### C) Trigger de banco como rede de segurança
Criar trigger `AFTER UPDATE OF stage_id ON crm_leads` que:
- Fecha histórico aberto da etapa anterior.
- Insere nova linha com `from_stage_id`, `stage_id`, `entered_at = now()`.

Assim, mesmo se algum código novo esquecer de gravar histórico, o banco grava sozinho. Também simplifica o código aplicativo (poderia até remover as inserções manuais, mas vamos manter por enquanto e adicionar `ON CONFLICT DO NOTHING` na lógica para evitar duplicatas).

## Arquivos afetados

- `supabase/functions/whatsapp-webhook/index.ts` — adicionar histórico em 3 pontos.
- `supabase/functions/automation-engine/index.ts` — adicionar histórico em 2 pontos.
- `supabase/functions/bot-engine/index.ts` — completar `from_stage_id` e `entered_at`.
- `src/pages/CrmCalendario.tsx` — corrigir caminho sem histórico.
- Nova migration:
  - Trigger `crm_leads_stage_history_trg` em `crm_leads`.
  - Backfill para leads existentes sem histórico aberto.

## Resultado esperado
Após o fix + backfill, o card "Consegui agendar" de hoje passará de **1 para 3** (Daiane, Ailton, Isabel), e daqui em diante toda movimentação de etapa — independente da origem (Kanban, chat, automação, bot, webhook, calendário) — alimentará a métrica corretamente.



# Plano: Implementar backend para todos os gatilhos e ações de automação

## Resumo
Os 7 novos gatilhos e 4 novas ações existem apenas na UI. Este plano implementa o processamento real de cada um.

## Arquitetura

Dois mecanismos de execução:

1. **Gatilhos reativos (tempo real)** — processados no momento do evento:
   - `keyword_response` → interceptado no webhook de mensagem recebida
   - `cold_lead_return` → interceptado no webhook de mensagem recebida
   - `after_appointment_confirmed` → interceptado quando status do agendamento muda

2. **Gatilhos periódicos (cron/scheduled)** — processados por uma edge function chamada periodicamente:
   - `progressive_reengagement` → verifica camadas de tempo por lead
   - `lead_stale` → verifica leads sem movimentação há N dias
   - `no_show` → verifica consultas passadas sem check-in
   - `time_window` → libera ações enfileiradas quando entrar na janela

## O que será feito

### 1. Migração: tabela de fila de automação
Criar `crm_automation_queue` para enfileirar ações pendentes (usado por `time_window` e sequências):

| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | PK |
| automation_id | uuid | FK para crm_automations |
| lead_id | uuid | FK para crm_leads |
| action_type | text | Ação a executar |
| action_config | jsonb | Config da ação |
| scheduled_at | timestamptz | Quando deve disparar |
| status | text | pending / sent / cancelled |
| layer_index | int | Índice da camada (reengajamento) |

### 2. Atualizar `automationUtils.ts` — novas ações
Adicionar processamento para: `send_audio`, `send_file`, `add_tag`, `notify_owner` e `combo` (executa array de sub-ações).

### 3. Atualizar `whatsapp-webhook/index.ts` — gatilhos reativos
No ponto onde uma mensagem inbound é processada:
- Buscar automações ativas do tipo `keyword_response` na etapa atual do lead; se a mensagem contiver alguma das palavras-chave, executar a ação.
- Buscar automações do tipo `cold_lead_return`; se o lead estiver em etapa marcada como "fria"/arquivada, executar a ação (mover + notificar).

### 4. Nova edge function `automation-engine/index.ts`
Função periódica (chamada por cron externo ou manualmente) que processa:

- **`progressive_reengagement`**: Para cada automação ativa desse tipo, verificar leads na etapa associada que não responderam. Criar entradas na fila para cada camada de tempo. Se o lead respondeu desde a última camada, cancelar as pendentes.
- **`lead_stale`**: Buscar leads com `updated_at` ou `last_message_at` mais antigo que N dias. Executar ação e opcionalmente mover de etapa.
- **`no_show`**: Buscar agendamentos passados com status != "compareceu". Disparar sequência de reagendamento.
- **`time_window`**: Verificar itens na fila com `scheduled_at` passado. Se dentro da janela de horário configurada, executar; senão, reagendar para próxima janela.

### 5. Gatilho `after_appointment_confirmed`
No fluxo onde o agendamento é confirmado (via chat ou UI), chamar `executeStageAutomations` com o trigger type correto, iniciando a sequência de lembretes na fila.

### 6. Configurar cron para `automation-engine`
Adicionar chamada periódica (a cada 5 min) via `pg_cron` ou instrução para o usuário configurar um cron externo.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| Migração SQL | Criar tabela `crm_automation_queue` + habilitar RLS |
| `src/lib/automationUtils.ts` | Adicionar ações: send_audio, send_file, add_tag, notify_owner, combo |
| `supabase/functions/whatsapp-webhook/index.ts` | Adicionar verificação de keyword_response e cold_lead_return no fluxo inbound |
| `supabase/functions/automation-engine/index.ts` | Nova função para processar gatilhos periódicos |
| `src/pages/CrmCalendario.tsx` ou fluxo de agendamento | Disparar automação after_appointment_confirmed |

## Ordem de execução
1. Migração do banco (tabela de fila)
2. Atualizar automationUtils.ts (novas ações)
3. Criar automation-engine (gatilhos periódicos)
4. Atualizar whatsapp-webhook (gatilhos reativos)
5. Integrar gatilho de agendamento confirmado


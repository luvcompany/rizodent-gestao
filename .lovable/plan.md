## Problemas a resolver

### 1) Transferência de lead Pós-venda → CRC não restaura pipeline/etapa anterior

Hoje a função `transfer-lead` só faz auto-move quando o destino é `posvenda` (move para o pipeline da pós-venda). No caminho contrário (pós-venda → crc/gerente), o lead fica preso no pipeline da Pós-venda, e o usuário CRC não consegue vê-lo no Kanban (a pós-venda tem `allowed_roles=['posvenda']`, então o CRC perde acesso).

**Correção:** quando o destino for `crc` ou `gerente` e o lead estiver hoje em um pipeline restrito a `posvenda`, buscar no `crm_lead_stage_history` a última etapa do lead em um pipeline acessível ao CRC (ou seja, em pipeline cujo `allowed_roles` contenha `crc`, ou seja NULL). Se encontrada, mover o lead de volta para esse `pipeline_id`/`stage_id` (fechando entrada atual do histórico e abrindo nova). Se não houver histórico em pipeline de CRC, fallback: Funil Principal → primeira etapa.

### 2) Agendamento manual não move o lead em algumas etapas/pipelines

Em `src/components/chat/AppointmentConfirmBar.tsx` (`moveLeadToScheduledStage`), a busca da etapa "Agendado" é feita **apenas dentro do pipeline atual do lead**. Pipelines como **Nutrição**, **Pós-venda**, **Não Compareceu** e **Não contratados** não possuem etapa "Agendado", então o lead não se move.

**Correção:** quando o pipeline atual não tiver etapa de "Agendado" (nem "Reagendado" no modo reagendar), mover o lead para o **Funil Principal** do mesmo tenant, etapa **Agendado** (ou **Reagendado** no modo reagendar). Fazer cross-pipeline move: atualizar `pipeline_id`+`stage_id`, fechar histórico, inserir novo, e postar a mensagem de sistema.

### 3) Lead `557398534691` (e similares)

Esse telefone exato não está mais no banco (provavelmente já foi movido para Pós-venda e/ou sumiu da visão do CRC por causa de RLS do pipeline Pós-venda). Vou:
- Rodar uma query que identifica **todos** os leads atualmente em pipelines com `allowed_roles=['posvenda']` que **nunca passaram pela etapa "Contratado"** (consultando `crm_lead_stage_history`).
- Para esses leads, mover para a última etapa registrada no Funil Principal (se houver histórico), ou para a primeira etapa do Funil Principal como fallback. Reatribuir ao usuário `rizodent`.
- Registrar uma mensagem de sistema em cada lead explicando o movimento.

## Detalhes técnicos

**Arquivos a alterar:**
- `supabase/functions/transfer-lead/index.ts` — adicionar bloco "reverse posvenda → CRC" usando `crm_lead_stage_history` + `crm_pipelines.allowed_roles`.
- `src/components/chat/AppointmentConfirmBar.tsx` — em `moveLeadToScheduledStage`, fallback cross-pipeline para Funil Principal quando o pipeline atual não tem etapa Agendado/Reagendado. Atualizar `pipeline_id` no UPDATE e mensagem de sistema "Movido para Funil Principal • Agendado".

**Migração de dados (one-off, via insert tool):**
```sql
-- Para cada lead em pipeline Pós-venda que nunca entrou em "Contratado":
UPDATE crm_leads SET pipeline_id=<funil principal>, stage_id=<última etapa CRC ou Novo Lead>,
  assigned_to='<rizodent user_id>', updated_at=now()
WHERE id IN (...);
-- + fechar/abrir crm_lead_stage_history + insert messages system
```

## Perguntas

1. Confirmar: quando o pipeline atual não tem "Agendado" (ex.: Nutrição, Pós-venda), o agendamento manual deve mover o lead para **Funil Principal → Agendado**? (alternativa: não mover e apenas registrar o agendamento.)
2. Para o item 3, devo aplicar a varredura retroativa **a todos** os leads de Pós-venda sem passagem por "Contratado", ou somente ao `557398534691`?

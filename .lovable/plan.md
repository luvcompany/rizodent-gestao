
## Plano de Implementação

### 1. Seletor de Funil ao mudar etapa na conversa
- Ao mudar a etapa do lead no chat, mostrar primeiro a lista de funis e depois as etapas daquele funil (como na imagem enviada)

### 2. Melhorias no bloco "Criar Tarefa" do bot
- Opções de agendamento: horário específico, primeiro horário do dia seguinte, em X horas, em X dias, em X dias às X horas

### 3. Exclusão de tarefas no Calendário
- Adicionar botão de excluir tarefas na página de calendário

### 4. Tabela de Agendamentos (migration)
- Criar tabela `crm_appointments` com campos: lead_id, scheduled_date, scheduled_time, status (pending_confirmation, confirmed, completed, cancelled, no_show), notes, task_id (referência à tarefa que gerou), confirmed_by, confirmed_at

### 5. Fluxo de Confirmação de Agendamento
- Na conversa do lead, quando existir uma tarefa de confirmação pendente, mostrar um botão "Confirmar Agendamento"
- Ao confirmar: tarefa é concluída automaticamente + agendamento é criado na tabela `crm_appointments`

### 6. Aba "Agendamentos" no Calendário
- Nova aba na página de calendário que mostra apenas agendamentos (não tarefas), organizados por dia e horário

### 7. Dashboard CRM (`/crm/dashboard`)
- Nova página com:
  - Tarefas do dia (pendentes e atrasadas)
  - Agendamentos do dia (com filtro de data)
  - Quantidade de confirmações pendentes
  - KPIs resumidos (leads novos, conversões, etc.)

### 8. Notificações de tarefas
- Sistema de notificação no horário definido da tarefa (browser notification ou toast)

### Ordem de execução
1. Migration (tabela crm_appointments)
2. Seletor de funil na conversa
3. Exclusão de tarefas no calendário
4. Fluxo de confirmação de agendamento
5. Aba de agendamentos no calendário
6. Dashboard CRM
7. Melhorias no bloco criar tarefa do bot
8. Notificações de tarefas

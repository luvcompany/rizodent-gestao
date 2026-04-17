

## Resposta direta (sem mudanças de código)

O usuário está perguntando **por que o valor estava errado antes** e **o que foi corrigido**. Isso é uma pergunta de explicação, não uma tarefa de implementação. Não preciso de plano nem de mudanças.

### Por que estava errado antes

Tanto o **Dashboard do CRM** quanto o **Kanban** somavam o faturamento usando `crm_leads.value` ou filtravam pagamentos pelo `paciente_id` "primário" do lead. Isso causava 3 tipos de perda:

1. **Pacientes secundários ignorados** — quando 2 pessoas (ex: LAIANA e NAIRANE) compartilham o mesmo número de WhatsApp, elas ficam vinculadas ao mesmo lead via `crm_lead_pacientes`, mas só uma é marcada como `is_primary`. A consulta antiga só pegava os pagamentos da primária e descartava os da secundária.
2. **Pacientes sem lead no CRM** — pacientes antigos cadastrados direto no Painel de Pacientes (sem passar pelo CRM) não tinham `crm_leads` associado, então seus pagamentos não entravam na conta.
3. **`crm_leads.value` desatualizado** — esse campo guardava o valor histórico do lead, não a soma real dos pagamentos do mês.

### O que foi corrigido

1. **Dashboard CRM (`CrmDashboard.tsx`)** — passou a somar **diretamente** todos os registros da tabela `pagamentos` no período, sem filtrar por `paciente_id` do lead. Fonte da verdade = tabela de pagamentos.
2. **Kanban (`CrmKanban.tsx`)** — criei o `leadMonthValueMap`, que cruza `pagamentos` do mês com a tabela `crm_lead_pacientes` para somar **todos os pacientes vinculados** (primário + secundários) de cada lead.
3. **Backfill de leads retroativos** (migration anterior) — criei `crm_leads` na etapa "Contratado" para os 81 pacientes do mês que tinham pagamento mas não estavam no CRM, herdando cidade/origem do cadastro do paciente.
4. **Junction `crm_lead_pacientes`** — passou a ser a fonte oficial de "quem está vinculado a este lead", permitindo múltiplos pacientes por número.

### Resultado
Agora os 3 lugares (Dashboard principal do sistema, Dashboard CRM, Kanban Contratado) batem no mesmo número, porque todos partem da mesma fonte: soma real de `pagamentos` do período, considerando todos os pacientes ligados a cada lead.


---
name: CRM Reports
description: Relatórios contam AGENDAMENTOS por scheduled_date (não leads distintos), alinhado ao calendário
type: feature
---

Regra de ouro dos Relatórios:

- Métricas de agendamento usam `crm_appointments.scheduled_date` no período (igual ao calendário). Contagem por agendamento, NÃO por lead distinto. Um lead com 2 appts conta 2.
- Compareceram = status IN ('contracted','not_contracted')
- Contrataram = status='contracted'
- Faltas = status='no_show'
- Pendentes = status IN ('pending','confirmed')
- Métricas de atividade (criação): usam created_at no período — separadas dos KPIs de calendário.
- NUNCA filtrar agendamentos pelo pipeline ATUAL do lead: leads são movidos de funil (ex: "Não contratados", "Pós-venda") e seus agendamentos/desfechos sumiriam do relatório. Agendamentos contam globalmente, igual ao calendário.
- Contratos diretos: leads na etapa Contratado sem appt 'contracted' no período → recorrentes do sistema antigo, ficam fora das taxas.

Arquivos: src/pages/CrmRelatorios.tsx, src/components/relatorios/OrigemConversaoTab.tsx.

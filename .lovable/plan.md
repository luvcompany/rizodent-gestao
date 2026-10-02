# Relatórios do zero: aba "Agendamentos"

As abas "Origem dos leads" e "Funis" saem da tela. Os componentes delas continuam no código, só deixam de aparecer. Por enquanto, Relatórios fica só com a aba "Agendamentos".

## Filtro de período
Botões rápidos: Hoje, Ontem, Esta semana, Semana passada, Este mês, Mês passado. Também dá para escolher um dia específico ou um intervalo personalizado no calendário. Começa em "Este mês". A semana vai de segunda a domingo, no horário de Brasília.

## Cartões (todos contam leads, e cada lead conta uma vez só)
1. **Leads que chegaram**: leads criados no período.
2. **Agendados**: leads com a primeira consulta marcada para uma data dentro do período.
3. **Compareceram**: agendados que vieram, fechando ou não.
4. **Faltas**: agendados que faltaram. Um lead que faltou mais de uma vez conta como uma falta só.
5. **Remarcados**: leads com consulta remarcada para dentro do período. Se o lead já foi contado em "Agendados" no mesmo período, entra só aqui.
6. **Remarcados que compareceram**.
7. **Faltas dos remarcados**: também sem repetir o mesmo lead.
8. **Cancelamentos**: leads que avisaram que não iam e não remarcaram. Isso é diferente de falta.

## Bloco "No geral" (do período escolhido)
Junta as primeiras consultas e as remarcações, contando cada lead uma vez:
- leads agendados, sem contar a remarcação como um novo agendamento;
- comparecimentos;
- faltas;
- cancelamentos.

Para cada lead, vale o resultado da última consulta dele no período. Assim, quem faltou e depois veio na remarcação conta como "compareceu", e não também como falta.

Clicar em um cartão abre a lista dos leads daquele número, para conferir.

## Visual
Segue o padrão do CRM: cartões brancos com número grande e ícone em quadrado de cor suave. Verde para compareceu, vermelho para falta, roxo para remarcado, cinza para cancelado e a cor da clínica para os agendados. Funciona no notebook e no celular.

## Detalhes técnicos
- Fontes: `crm_leads.created_at` para os leads que chegaram, e `crm_appointments` filtrado por `scheduled_date` no período e pelo tenant atual.
- Mapeamento: `is_rescheduled=false` é primeira consulta, `true` é remarcação. `contracted` e `not_contracted` contam como compareceu, `no_show` como falta e `cancelled` como cancelamento. `rescheduled` não conta como resultado; o que vale é a consulta nova. `confirmed` conta como agendado ainda sem resultado.
- A contagem é por `lead_id` distinto. Para "Remarcados", saem os leads que já estão em "Agendados" no período. No "No geral", vale a última consulta de cada lead no período.
- A conta é feita em uma função do banco (SECURITY INVOKER, respeita as permissões de cada usuário), que devolve os números e os ids dos leads, sem o limite de 1.000 linhas da tela.
- Novo `src/pages/CrmRelatorios.tsx` com o componente `RelatorioAgendamentos`; as outras abas ficam fora do Tabs.

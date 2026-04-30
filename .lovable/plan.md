# Unificar dados do Dashboard — Funil de Atendimentos

## Diagnóstico

As duas seções da imagem mostram a mesma informação mas vêm de fontes diferentes:

- **Card "CRM — Leads & Agendamentos"** (em cima): usa `crm_appointments` filtrando por `scheduled_date` no período (corrigido no turno anterior). Por isso mostra `24 Agendados` e `2 Faltaram` corretamente.
- **"Funil de Atendimentos"** (em baixo): usa a tabela `leads_diarios` (lançamento manual diário do CRC). Quando o período filtrado não tem registros manuais lançados, todos os campos ficam zerados.

Daí a inconsistência: dados reais em cima, zeros em baixo.

## Correção

Unificar **as 3 abas do Funil** (`Agendamentos`, `Reagendados`, `Conversão Total`) para usarem a mesma fonte do card CRM (`crm_appointments` filtrado pelo período via `scheduled_date`), acabando com a divergência.

### Aba "Agendamentos" (não-reagendados)
- Agendados = appointments do período onde `is_rescheduled = false`
- Compareceram = status `contracted` + `not_contracted`
- Contrataram = status `contracted`
- Não Contrataram = Compareceram − Contrataram
- Faltaram = status `no_show`

### Aba "Reagendados"
- Mesma lógica, mas filtrando `is_rescheduled = true`

### Aba "Conversão Total"
- Mantém como está (já usa `crmLeadsCount` + `crmAgendados` + `pacientesPagantesPeriodo`, que já são consistentes com o card de cima).

## Resultado esperado

Os números do funil de baixo passam a bater exatamente com os do card CRM de cima — fim das inconsistências. O lançamento manual em `leads_diarios` continua sendo usado para o gráfico "Leads Novos Diários" como fallback, mas não impacta mais o funil.

## Arquivo afetado

- `src/pages/Dashboard.tsx` — substituir o cálculo de `funnelDataAgendamentos` e `funnelDataReagendados` para derivar de `crmFiltered.apptsDosAgendados` separados por flag `is_rescheduled`.

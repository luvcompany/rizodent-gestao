---
name: Regra de Dias Úteis
description: Pesos por dia da semana usados em faturamento, previsibilidade e relatórios
type: feature
---
Regra única (src/lib/businessDays.ts e supabase/functions/_shared/reporting.ts):
- Domingo = 0
- Feriado (dashboard_holidays) = 0
- Sábado = 1 (meio expediente operacional, mas conta como dia inteiro no faturamento)
- Seg-Sex = 1

Não usar 0,5 para sábado — decisão do produto em Jul/2026.

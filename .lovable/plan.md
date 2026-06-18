# Corrigir bug de timezone no Relatório

## Causa
Em `src/pages/CrmRelatorios.tsx`, o filtro do campo `scheduled_date` (tipo `date` puro) usa `range.end.toISOString().slice(0,10)`. Como `endOfDay(15/06)` em BRT (UTC−3) é `15/06 23:59:59 -03:00`, o `toISOString()` retorna `2026-06-16T02:59:59Z` e `slice(0,10)` vira **`"2026-06-16"`**. Resultado: a query `lte(scheduled_date, "2026-06-16")` inclui o dia 16 inteiro — exatamente os 10 agendamentos extras que apareceram quando o período era 15/06–15/06.

## Mudanças

1. Em `src/pages/CrmRelatorios.tsx`, substituir a helper `dateOnly(iso)` por `localDateOnly(d: Date)` que formata a data em horário local:
   ```ts
   const localDateOnly = (d: Date) =>
     `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
   ```
2. Trocar as 4 ocorrências (linhas ~141–142 e ~1049–1050) para:
   ```ts
   const startDate = localDateOnly(range.start);
   const endDate   = localDateOnly(range.end);
   ```
   Filtros que usam `created_at` continuam com `startISO`/`endISO` (timestamps com fuso) — esses já estão corretos.
3. Auditar `src/pages/CrmCalendario.tsx` e `src/components/relatorios/OrigemConversaoTab.tsx` e aplicar o mesmo padrão caso reproduzam o bug em campos `date`.

## Validação
- Período **15/06 — 15/06** no Funil Principal deve mostrar **16 agendamentos, 1 contratado, 5 não contratados, 10 faltas** (igual ao calendário).
- Período **15/06 — 21/06** deve mostrar 60 agendamentos (semana cheia, incluindo os confirmados dos dias 17–20).

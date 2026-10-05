# SDR report: count every rescheduled visit, plus a "Remarcou mais de uma vez" report

## Why Sandro and Vanusa don't show on 03/10
- **Sandro (Bia):** his first visit was on 03/10. On that day it was moved to 10/10.
- **Vanusa (Kelly):** she had 25/09 (moved), 29/09 (missed), 03/10 (moved again) and 05/10.
- Both 03/10 visits are saved as **"remarcada"**, not as missed visits.
- Today the Agendados, Remarcados and Geral cards **leave out every visit that was moved**. A visit only counts on its new date. So both disappear from 03/10.
- On the "Consultas do dia" tab they already show on 03/10 as "Remarcado".

## What changes
1. **Agendados and Remarcados count every date.** Each visit counts on its own day, even if it was moved later:
   - Vanusa: 25/09 "Remarcou", 29/09 "Faltou", 03/10 "Remarcou", 05/10 by its result.
   - Sandro: 03/10 in Agendados as "Remarcou", 10/10 in Remarcados.
   - Both cards get a **"Remarcou"** box (purple). Nothing that exists today is removed.
   - Within one block, a lead counts at most once per day.
2. **Geral counts each lead once.** If a lead has several visits in the period, only the last result counts. This removes the duplicates from people who rescheduled more than once.
3. **New report on the SDR reports page: "Remarcou mais de uma vez".**
   - It lists the leads that moved their visit 2 or more times, respecting the period filter and the SDR.
   - Each lead shows its full history: the date of every visit, what happened in each one (remarcou, faltou, cancelou, compareceu, pendente) and which SDR gets credit.
   - Clicking a lead opens its conversation, like the other lists.
   - SDRs only see their own leads; managers see everyone.
   - The table scrolls inside its own card on the phone.

## Check before delivering
- 03/10 shows Sandro (Bia) and Vanusa (Kelly) as "Remarcou".
- 05/10 shows Vanusa again, and 10/10 shows Sandro.
- Geral for September and October counts each lead only once, and the result boxes add up to the total.
- Vanusa shows up in the new report with her 4 dates.

## Technical details
- Rewrite `relatorio_sdr_blocos`:
  - Drop the `status <> 'rescheduled'` filter from Agendados and Remarcados, and add the keys `agd_remarcou` and `rem_remarcou`.
  - In Geral, apply `DISTINCT ON lead` with the last visit in the period.
- New function `relatorio_sdr_multi_remarcacoes(p_de, p_ate)`:
  - SECURITY DEFINER, limited to the logged-in user's clinic; an SDR only sees herself.
  - Returns a lead with an ordered array of visits, when the lead has 2 or more visits moved or created after the first one.
- Front end:
  - Add the "Remarcou" item in `BlocosSdr.tsx`.
  - New component in `src/components/relatorios/` plus a new tab/section in `CrmRelatorioSdr.tsx` and `SdrMeuDesempenho.tsx`, following the visual standard.

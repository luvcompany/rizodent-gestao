## Objetivo
Na aba **Ações por dia** (Relatórios), permitir agregar os KPIs (Pessoas que falaram, Agendamentos criados, Reagendamentos e Taxa de conversão) por um período além do dia único: **Últimos 7 dias**, **Últimos 14 dias**, **Este mês** e **Mês passado**, mantendo a opção atual de escolher um dia específico no calendário.

## Mudanças (apenas em `src/pages/CrmRelatorios.tsx`, componente `AcoesPorDiaTab`)

### 1. Novo controle de período
Adicionar um seletor ao lado do campo "Dia" com 5 opções:
- **Dia específico** (comportamento atual, com o calendário) — padrão
- **Últimos 7 dias** (hoje-6d → hoje)
- **Últimos 14 dias** (hoje-13d → hoje)
- **Este mês** (1º dia do mês atual → hoje)
- **Mês passado** (1º ao último dia do mês anterior)

Nas opções agregadas, o botão do calendário fica desabilitado e o rótulo mostra o intervalo (ex.: "10/07 – 16/07/2026").

### 2. Ajuste no fetch
Hoje o efeito carrega o **mês** de `selectedDate`. Passa a carregar o **intervalo necessário** em America/Bahia:
- Modo "dia": mês da `selectedDate` (igual hoje, para preservar o card "Média Diária — mês").
- Modo 7/14 dias / mês passado: intervalo exato da janela.
- Modo "este mês": mês atual.

### 3. Ajuste nos KPIs do card "Ações de …"
- Título: "Ações de DD/MM/YYYY" no modo dia; nos outros modos, rótulo do preset ("Ações dos últimos 7 dias (DD/MM – DD/MM)", "Ações de julho/2026", "Ações de junho/2026" etc.).
- Legenda "neste dia" vira "neste período" quando aplicável.
- **Pessoas que falaram**: `lead_id` distintos com mensagem inbound cujo `dayKeyBahia(created_at)` cai no intervalo.
- **Agendamentos criados**: appts com `is_rescheduled !== true` cujo `created_at` cai no intervalo.
- **Reagendamentos**: idem com `is_rescheduled === true`.
- **Taxa de conversão**: interseção `leads que falaram no período ∩ leads que criaram agendamento (não reagendado) no período`, dividido por leads que falaram no período. Mesma semântica do card diário, agora agregada.

### 4. Card "Média Diária do mês"
Sem mudança de fórmula. Só é renderizado no modo "Dia específico" (nos demais modos fica oculto para não misturar com a janela agregada).

## Fora do escopo
- Não altero outras abas, backend, edge functions, migrations, nem o componente `DateRangeFilter` global.
- Não mudo a semântica de nenhum KPI existente; apenas expando a janela de agregação.

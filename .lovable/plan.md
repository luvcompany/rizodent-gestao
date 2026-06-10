# Refazer TODA a aba Relatórios (as 4 abas) usando o calendário como fonte da verdade

## Diagnóstico (confirmado no banco)

O calendário está certo e o relatório está errado. Verifiquei direto no banco de dados:

| Período | Agendamentos | Contrataram | Não contrataram | Faltas | Pendentes |
|---|---|---|---|---|---|
| 01–06/jun | 65 | 11 | 13 | 41 | 0 |
| 08–14/jun | 60 | 3 | 4 | 19 | 34 |

Esses números batem milimetricamente com o calendário (65 + 60, 14 contratados). O relatório atual erra por dois motivos:

1. **Conta leads, não agendamentos** — um lead com 2 agendamentos vira "1", e o calendário mostra "2".
2. **Mistura dois critérios de data** — usa a data de *criação* do agendamento em uns cards e a data *marcada* em outros, gerando números que não batem entre si nem com o calendário.

Esses mesmos erros contaminam as 4 abas: Visão Geral, Origem & Conversão, Ações por Dia e Antecedência de Agendamento.

## Solução: reescrever as 4 abas com UMA regra única

**Regra de ouro:** todo número de agendamento usa exatamente a mesma consulta do calendário — agendamentos com `data marcada` dentro do período selecionado, contados individualmente (não por lead).

### Aba 1 — Visão Geral (reescrita completa)

**KPIs do período:**
- Agendamentos no período (= soma do calendário)
- Compareceram (contratados + não contratados)
- Contrataram
- Faltas (no_show)
- Pendentes/confirmados (ainda sem desfecho)
- Taxa de comparecimento = compareceram ÷ (agendamentos com desfecho)
- Taxa de contratação = contrataram ÷ compareceram

**Atendimento diário:** tabela por dia — leads que conversaram, leads novos, agendamentos marcados para o dia e desfechos. Cada linha bate com a coluna do calendário.

**Funil do período:** Conversaram (leads com mensagem recebida) → Agendaram (agendamentos criados no período = ação da equipe) → Compareceram → Contrataram (pelo desfecho dos agendamentos com data no período). Rótulos claros, sem percentuais cruzando critérios diferentes.

**Resultado dos agendados:** quebra semanal espelhando o calendário — total, contratados (verde), não contratados (laranja), faltas (vermelho), pendentes (cinza).

**Contratos diretos (informativo, separado):** leads na etapa Contratado sem agendamento (recorrentes do sistema antigo) — fora de todas as taxas.

### Aba 2 — Origem & Conversão (corrigida)
Mantém a análise por origem (anúncio, orgânico, etc.), mas "agendou/compareceu/contratou" passam a usar a regra de ouro: desfecho dos agendamentos do lead, com a mesma definição de período. Os totais da aba devem somar os mesmos números da Visão Geral.

### Aba 3 — Ações por Dia (corrigida)
Atividade da equipe por dia: mensagens enviadas/recebidas e agendamentos *criados* no dia (ação real do atendente), claramente separado dos agendamentos *marcados para* o dia (que pertencem ao calendário). Hoje os dois conceitos estão misturados.

### Aba 4 — Antecedência de Agendamento (corrigida)
Tempo entre a criação do agendamento e a data marcada, calculado por agendamento (não por lead), apenas sobre os agendamentos do período.

### Validação obrigatória antes de entregar
Depois de implementar, comparo lado a lado os números de cada aba com consultas diretas no banco para as duas semanas de junho (65 / 60 / 14 contratados) e só concluo quando bater 100% — incluindo a consistência entre abas (totais da Origem & Conversão = totais da Visão Geral).

## Detalhes técnicos

- `src/pages/CrmRelatorios.tsx`: reescrita completa das 4 abas. Busca de agendamentos por `scheduled_date` no período (query idêntica à do `CrmCalendario.tsx`), contagem por agendamento. Remoção dos memos que misturam `created_at` e `scheduled_date`.
- `src/components/relatorios/OrigemConversaoTab.tsx`: reescrita com a mesma definição de agendado/compareceu/contratou.
- Nenhuma mudança no banco de dados.

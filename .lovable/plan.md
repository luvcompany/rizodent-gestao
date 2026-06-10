# Refazer a aba Relatórios com dados milimetricamente precisos

## O que está errado hoje

O card "Distribuição por Etapa" mostra leads pela **etapa atual** (`stage_id`), comparando cada etapa contra a primeira do funil. Isso gera %s impossíveis (Recuperado 215%, Agendado 142%) e mistura etapas paralelas (Follow-Up, Recuperado, Desqualificado) com marcos reais da jornada.

Além disso, contratações de **pacientes recorrentes** (que já vieram do sistema antigo e nunca passaram por Agendado no CRM atual) entram nas métricas e inflam a taxa de conversão. O usuário quer ver **só** quem percorreu o fluxo real: chegou → conversou → agendou → compareceu → contratou.

## Regra de "contratação válida" (a chave de tudo)

Um lead **só conta como contratado** no relatório se:

1. Tem `crm_appointments` com `status = 'contracted'` **E**
2. Esse appointment foi criado no CRM (existe na tabela) — ou seja, o lead **passou por Agendado**.

Leads que estão na etapa "Contratado" mas **não têm appointment** = recorrentes do sistema antigo → **excluídos** de todas as métricas de conversão. Aparecem só num card separado "Contratos diretos (sem agendamento)" para transparência.

## Nova jornada (funil de 5 marcos, coorte = leads criados no período)

```text
Leads no período
        ↓
  Conversaram comigo  (responderam — ao menos 1 inbound)
        ↓
       Agendaram      (≥1 appointment criado, qualquer status)
        ↓
    Compareceram      (status do appointment ∈ contracted | not_contracted)
        ↓
      Contrataram     (status = contracted, vindo de agendamento)
```

Cada etapa é **subconjunto estrito** da anterior → %s sempre ≤ 100%, leitura honesta de gargalo.

Métricas derivadas exibidas ao lado:
- **Faltaram** = Agendaram − Compareceram (status = `no_show` ou agendamento passado sem desfecho).
- **Não contrataram** = Compareceram − Contrataram.
- **Reagendaram** = appointments com `is_rescheduled = true` na coorte (informativo, não entra no funil).

## Métricas diárias (novo card "Atendimento Diário")

Para a pergunta "quantos leads falam comigo diariamente e quantos consigo agendar":

| Coluna | Definição |
|---|---|
| Dia | Cada dia do período |
| Leads que conversaram | leads distintos com ao menos 1 inbound naquele dia (independente de quando entraram) |
| Leads novos | leads criados naquele dia |
| Agendamentos criados | `crm_appointments` criados naquele dia (vinculados a leads do funil) |
| Taxa de agendamento | Agendamentos / Leads que conversaram |

Visualização: tabela + mini-gráfico de barras (linha conversaram vs linha agendaram). Total e média no rodapé.

## Card "Resultado dos Agendados" (coorte do período)

Quebra dos appointments dos leads da coorte:

- Total agendados
- Compareceram (verde) + Faltaram (vermelho) + Pendentes/futuros (cinza)
- Dos que compareceram: Contrataram vs Não contrataram (% conversão de comparecimento)
- Taxa final: Contratados / Agendados (a métrica que importa)

## Card "Contratos diretos (sem agendamento)" — informativo

Lista isolada de leads com etapa = Contratado **mas sem appointment**. Mostra apenas contagem + lista colapsável. Deixa claro: "Estes leads não passaram pelo fluxo atual do CRM e ficam fora das taxas de conversão acima."

## O que mantenho da aba atual

- Filtro de Funil + Período (sticky no topo).
- Cards: Tempo até Agendamento, Tempo de Resposta, Inativos, Fantasmas, Total por Cidade — todos já usam coorte correta, só vou realinhar para usar a mesma definição de "contratado" (com appointment) onde aplicável.
- Aba "Origem & Conversão" — já correta, só ajusto a definição de contratado para bater com a nova regra.
- Abas "Ações por Dia" e "Antecedência de Agendamento" — sem mudança.

## O que removo

- Card antigo "Distribuição por Etapa" com %s > 100% e o bloco "Conversão entre etapas consecutivas" baseado em etapa atual.
- Card "Agenda no Período" filtrado por `scheduled_date` (mistura coortes de meses diferentes) → substituído pelo "Resultado dos Agendados" preso à coorte do período.

## Arquivos afetados

- `src/pages/CrmRelatorios.tsx` — reescrever os memos de funil, adicionar memo de série diária, novo card de jornada, novo card de atendimento diário, novo card de contratos diretos, remover blocos antigos.
- `src/components/relatorios/OrigemConversaoTab.tsx` — pequeno ajuste na definição de `contractedLeadIds` para exigir appointment + status contracted (não só pagamento).
- Sem mudanças de backend, schema ou edge function — tudo é cálculo no frontend usando `crm_leads`, `crm_lead_stage_history`, `crm_appointments` e `messages` (já carregados).

## Validação após implementar

Vou rodar uma consulta de conferência no banco (este mês, Funil Principal) e mostrar os números esperados ao usuário antes de fechar, para garantir que o card bate com a realidade:
- Total coorte / Conversaram / Agendaram / Compareceram / Contrataram (válidos) / Contratos diretos (recorrentes).

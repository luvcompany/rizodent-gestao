

## Plano: Funil de Ações do Dia (Movimentações de Etapa por Hoje)

### Objetivo
Adicionar um **segundo funil** logo abaixo do funil atual ("Distribuição por Etapa") em `CrmRelatorios.tsx`, mostrando **quantos leads foram movidos para cada etapa hoje** — independente de quando o lead entrou no CRM.

### Diferença entre os dois funis
- **Funil atual (Distribuição)**: foto da coorte do período (onde os leads do período estão agora).
- **Funil novo (Ações do Dia)**: quantas movimentações ocorreram **hoje** para cada etapa do funil selecionado, contando leads novos E antigos.

### Fonte de dados
Tabela `crm_lead_stage_history`:
- `entered_at` entre `startOfDay(today)` e `endOfDay(today)`
- `stage_id` pertence ao `selectedPipeline`
- Contagem distinta de `lead_id` por `stage_id`

Adicionalmente, exibir 1 KPI acima do funil:
- **Pessoas que falaram comigo hoje**: leads distintos com pelo menos 1 mensagem inbound (`messages.direction='inbound'`) com `created_at = hoje`.

### Layout (logo após "Distribuição por Etapa")
```text
┌──────────────────────────────────────────────────┐
│ Ações do Dia — [data de hoje]                    │
│ Movimentações de etapa feitas hoje               │
├──────────────────────────────────────────────────┤
│ [KPI] X pessoas falaram comigo hoje              │
│                                                   │
│ [Funil visual]                                    │
│   Agendado:        12                             │
│   Relacionamento:   8                             │
│   Follow-up:       10                             │
│   Desqualificado:  10                             │
│   ...                                             │
└──────────────────────────────────────────────────┘
```

Reutiliza o componente `DashboardFunnel` já usado na página, mantendo cores das etapas (`stage.color`).

### Implementação técnica
1. Em `CrmRelatorios.tsx`, adicionar query para `crm_lead_stage_history` filtrada por:
   - `entered_at >= startOfDay(now)` e `<= endOfDay(now)`
   - `stage_id IN (stages do pipeline selecionado)`
2. Agregar `count(distinct lead_id)` por `stage_id`.
3. Para o KPI de "falaram comigo hoje": query em `messages` com `direction='inbound'`, `created_at` no dia, joinando com `crm_leads.pipeline_id = selectedPipeline`. Contar `distinct lead_id`.
4. Adicionar bloco JSX entre o funil de distribuição atual e a seção "Agenda por Etapa".

### Arquivo a editar
- `src/pages/CrmRelatorios.tsx`

### Observação
O bloco usa **sempre "hoje"** (ignora o filtro de período do topo), pois é explicitamente um relatório do dia. Indicar isso no subtítulo do bloco.


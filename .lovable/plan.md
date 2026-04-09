

# Plano: Relatórios Interativos + Integração dos 3 Funis

## Objetivo
Tornar cada número, gráfico e card nos relatórios clicável, navegando para a lista filtrada de leads correspondente. Integrar os 3 funis (principal, não contratados, remarcações) de forma harmônica nos relatórios.

## Abordagem Técnica

### 1. Navegação Clicável (Drill-down)
Ao clicar em qualquer métrica do relatório, o usuário é redirecionado para `/crm/conversas` com query params que filtram a lista automaticamente. Exemplos:

```text
Clique em "42 Agendaram"    → /crm/conversas?stage=agendado&pipeline=xxx
Clique em "19 Contrataram"  → /crm/conversas?stage=contratado&pipeline=xxx
Clique em "5 Remarcaram"    → /crm/conversas?appointment_status=rescheduled
Clique em "Leads Fantasma"  → /crm/conversas?ghost=true
Clique em etapa no gráfico  → /crm/conversas?stage_id=uuid
Clique em atendente         → /crm/conversas?assigned_to=uuid
Clique em "Inativos"        → /crm/conversas?inactive_days=3
```

### 2. Atualizar CrmConversas para ler query params
O componente `CrmConversas` já possui `ConversationFilters` com filtros por funil, etapa, tags e período. Precisamos:
- Ler `searchParams` da URL ao montar
- Pré-selecionar os filtros correspondentes (pipeline, stage, etc.)
- Adicionar filtros especiais: `ghost=true` (leads sem msgs inbound), `appointment_status`, `inactive_days`

### 3. Integração dos 3 Funis nos Relatórios
Quando "Todos os Funis" estiver selecionado, exibir:
- **Visão cruzada**: card por funil com métricas-resumo (leads, agendados, contratados) — já existe parcialmente
- **Fluxo entre funis**: quantos leads do funil principal foram para "Não Contratados" e quantos de lá foram para "Remarcações"
- **Métricas por funil em paralelo**: comparação lado a lado (funil principal vs recuperação vs remarcações)
- Os cards de pipeline já são clicáveis para filtrar — manter e expandir

### 4. Seção "Fluxo entre Funis"
Nova seção que mostra a movimentação entre pipelines:
- Quantos leads saíram do funil principal e entraram no de "Não Contratados"
- Quantos do "Não Contratados" foram recuperados (voltaram ou agendaram no funil de remarcações)
- Cada número clicável para ver a lista

## Arquivos Afetados

| Arquivo | Ação |
|---|---|
| `src/pages/CrmRelatorios.tsx` | Adicionar `onClick` + `navigate()` em todos os cards, barras do funil, linhas de tabela, gráficos |
| `src/pages/CrmConversas.tsx` | Ler `useSearchParams`, pré-aplicar filtros, adicionar filtros especiais (ghost, inactive) |
| `src/components/chat/ConversationFilters.tsx` | Verificar se aceita valores iniciais via props |

## Detalhes de Implementação

### Etapa 1 — CrmConversas: aceitar filtros via URL
- Usar `useSearchParams` para ler `pipeline`, `stage_id`, `ghost`, `assigned_to`, `appointment_status`, `inactive_days`
- Ao montar, inicializar os filtros do `ConversationFilters` com os valores da URL
- Filtrar a lista de leads conforme os params especiais (ghost = leads sem mensagens inbound)

### Etapa 2 — CrmRelatorios: tornar tudo clicável
- Cada step do funil de conversão → click navega para conversas filtradas por etapa
- Cards KPI (Leads Fantasma, Inativos) → click navega com filtro correspondente
- Agendamentos (Compareceram, Remarcaram, Faltaram) → click filtra por status de agendamento
- Distribuição por etapa (pizza + lista) → click filtra por stage_id
- Tempo médio por etapa (barras) → click filtra por stage_id
- Tabela de atendentes → click filtra por assigned_to
- Leads inativos (já tem tabela, adicionar link para conversa individual)
- Estilo: cursor-pointer + hover effect nos elementos clicáveis

### Etapa 3 — Seção de Fluxo entre Funis
- Calcular leads que mudaram de pipeline usando `crm_lead_stage_history` (from_stage em pipeline A → stage em pipeline B)
- Exibir diagrama simplificado com setas e números
- Cada número clicável




# Plano: Abas de Relatório + Correções de Visualização

## Problemas Identificados

1. **Etapas duplicadas no "Tempo Médio por Etapa"**: Quando "Todos os Funis" está selecionado, etapas com o mesmo nome em pipelines diferentes aparecem duplicadas sem distinção.
2. **Score de Leads**: Não tem paginação, não é clicável, e está posicionado antes de seções mais relevantes.
3. **Faltam relatórios de Bots, Follow-ups, Templates, Cidades e Origens**.

## Solução: Organizar em Abas (Tabs)

Reestruturar `CrmRelatorios.tsx` com abas no topo:

```text
[ Operação ] [ Bots ] [ Follow-ups ] [ Origens & Cidades ]
```

### Aba 1 — Operação (conteúdo atual, com ajustes)
- **Etapas duplicadas**: Quando "Todos os Funis" estiver selecionado, agrupar etapas com mesmo nome (somando leads e fazendo média ponderada dos tempos). Alternativa: adicionar prefixo do funil no label (ex: "Principal > Conversando").
- **Score de Leads**: Mover para o final da aba. Adicionar paginação (10 por página com seletor 10/30/50/100). Cada lead clicável navegando para `/crm/conversas?lead_id=UUID`. Score atualiza automaticamente ao carregar a página via RPC batch.
- Restante do conteúdo mantido (Funil, KPIs, Agendamentos, Fantasma, Gráficos, Atendentes, Fluxo entre Funis, Inativos).

### Aba 2 — Bots
Dados das tabelas `bot_executions` e `bot_execution_logs`:
- **Resumo**: Total de execuções no período, completadas, canceladas, em andamento.
- **Taxa de conclusão por bot**: Quantos leads chegaram até o final do fluxo vs quantos pararam no meio.
- **Node drop-off**: Em qual nó do bot os leads mais abandonam (usando `bot_execution_logs` para ver o último nó registrado por execução).
- **Ranking de bots**: Lista dos bots com execuções, taxa de conclusão, e média de nós percorridos.
- Clicável — cada bot navega para o editor.

### Aba 3 — Follow-ups & Templates
Dados das tabelas `crm_followup_queue`, `crm_followup_configs`, `crm_whatsapp_templates` e `messages`:
- **Follow-ups**: Total enviados, taxa de resposta (leads que responderam após follow-up), follow-ups por etapa.
- **Templates**: Quais templates WhatsApp foram mais usados, taxa de resposta por template (mensagem outbound com template → lead respondeu inbound depois).
- **Ranking de conversão por template**: Template que mais gerou avanço de etapa ou agendamento.
- Clicável — cada linha navega para conversas filtradas.

### Aba 4 — Origens & Cidades
Dados de `crm_leads.source`, `crm_leads.nome_anuncio`, e paciente/lead geolocalização:
- **Por Origem (source)**: Tabela com leads, agendamentos, conversões, taxa de conversão — por fonte.
- **Por Anúncio (nome_anuncio)**: Mesma análise por anúncio individual.
- **Por Cidade**: Usar campo `source` ou dados de `pacientes.cidade` via `paciente_id` — leads, agendamentos, conversões por cidade.
- Cada linha clicável para drill-down na lista de conversas.

## Detalhes Técnicos

### Correção de etapas duplicadas
Quando `selectedPipelineId === "all"`, prefixar o nome da etapa com o nome do pipeline:
```typescript
const label = selectedPipelineId === "all" 
  ? `${pipeline.name} > ${stage.name}` 
  : stage.name;
```

### Paginação do Score
```typescript
const [scorePage, setScorePage] = useState(1);
const [scorePageSize, setScorePageSize] = useState(10);
const paginatedScores = scoreLeads.slice((scorePage-1)*scorePageSize, scorePage*scorePageSize);
const totalPages = Math.ceil(scoreLeads.length / scorePageSize);
```

### Dados de Bots (nova query)
```typescript
const [botExecs] = await supabase.from("bot_executions")
  .select("id, bot_id, status, started_at, completed_at, bots(name)");
const [botLogs] = await supabase.from("bot_execution_logs")
  .select("execution_id, node_id, action, created_at");
```

### Dados de Follow-ups (nova query)
```typescript
const [followupQueue] = await supabase.from("crm_followup_queue")
  .select("id, lead_id, status, attempt_count, config_id, created_at");
```

### Dados de Templates (calcular via messages)
Identificar mensagens outbound que contêm referência a template (via `type` ou conteúdo) e correlacionar com resposta inbound subsequente do mesmo lead.

## Arquivo Afetado
| Arquivo | Ação |
|---|---|
| `src/pages/CrmRelatorios.tsx` | Adicionar sistema de Tabs, corrigir duplicatas, paginar scores, criar 3 novas seções de relatório |




# Plano: Relatórios Operacionais Completos do CRM

## Objetivo
Transformar a página de relatórios em um painel operacional completo que responda todas as perguntas que um gestor de clínica precisa: quanto tempo leva para agendar, quantos agendaram, quantos contrataram, quantos são "leads fantasma", performance por atendente com tempo de primeira resposta, e funil de conversão com números absolutos e taxas.

## O que já temos
- Tempo médio por etapa (gráfico de barras)
- Conversão por etapa (% entre etapas)
- Tempo de resposta médio (atendente e lead)
- Leads inativos (filtro configurável)
- Score de leads
- Produtividade por atendente (msgs enviadas, leads atendidos, agendados)
- Filtro por funil
- Distribuição por etapa (pizza)

## O que FALTA (gaps reais para a operação)

### 1. Filtro por período (mês/semana/customizado)
Hoje os relatórios mostram dados de "todos os tempos". O gestor precisa filtrar por mês para saber: "Em março, quantos leads agendaram?"

### 2. Funil de Conversão com números absolutos
Falta a visão clássica em cascata:
```text
Leads Entraram → Responderam → Agendaram → Compareceram → Contrataram
     100            68             42            31              19
                   68%            62%           74%             61%
```

### 3. Leads Fantasma (só clicaram no anúncio)
Leads que nunca enviaram uma mensagem sequer (0 msgs inbound). Segmentados por origem/anúncio para saber qual anúncio gera leads que não respondem.

### 4. Relatório de Agendamentos do Mês
- Total agendados no período
- Compareceram (status `completed`/`contratou`/`nao_contratou`)
- Remarcaram (status `rescheduled`)
- Faltaram (status `missed`/`faltou`)
- Taxa de presença

### 5. Performance por Atendente expandida
- Tempo médio de **primeira resposta** (tempo entre lead entrar e atendente mandar 1ª msg)
- Taxa de conversão individual (leads que chegaram em "Contratado" / leads atribuídos)

### 6. Tempo total do funil (Lead → Contrato)
Média de dias desde `created_at` até chegar na etapa final (Contratado).

### 7. Coluna `first_inbound_at` em `crm_leads`
Necessária para calcular "leads fantasma" e "tempo de primeira resposta do lead" de forma precisa, sem varrer toda a tabela de mensagens.

---

## Etapas de Implementação

### Etapa 1 — Migration
- Adicionar coluna `first_inbound_at` (timestamptz, nullable) em `crm_leads`
- Adicionar coluna `from_stage_id` (uuid, nullable) em `crm_lead_stage_history` para rastrear origem da movimentação

### Etapa 2 — Gravar `first_inbound_at`
- Atualizar `whatsapp-webhook/index.ts`: ao receber mensagem inbound, se `first_inbound_at` for null, setar o timestamp
- Backfill: criar lógica no frontend (botão admin) ou migration com subquery para preencher dados existentes

### Etapa 3 — Gravar `from_stage_id` nas movimentações
- Atualizar `CrmKanban.tsx` e `useChatConversation.ts` para incluir `from_stage_id` ao inserir no histórico

### Etapa 4 — Reescrever `CrmRelatorios.tsx`
Adicionar as seguintes seções (sem remover as existentes):

1. **Filtro de Período** — Seletor de mês ou intervalo customizado que filtra leads por `created_at` e mensagens/agendamentos por data
2. **Funil de Conversão Visual** — Barras horizontais em cascata com números absolutos e taxas entre cada etapa
3. **Leads Fantasma** — Card com total de leads com 0 msgs inbound + tabela agrupada por `source`/`nome_anuncio`
4. **Relatório de Agendamentos** — Cards com total, presença, falta, remarcação + taxa de presença
5. **Performance Expandida** — Colunas adicionais na tabela de atendentes: tempo de 1ª resposta, taxa de conversão
6. **Tempo Total do Funil** — KPI card mostrando média de dias lead→contrato

### Arquivos afetados
| Arquivo | Ação |
|---|---|
| Migration SQL | Adicionar `first_inbound_at` e `from_stage_id` |
| `supabase/functions/whatsapp-webhook/index.ts` | Gravar `first_inbound_at` |
| `src/pages/CrmKanban.tsx` | Gravar `from_stage_id` |
| `src/hooks/useChatConversation.ts` | Gravar `from_stage_id` |
| `src/pages/CrmRelatorios.tsx` | Adicionar seções de relatório |


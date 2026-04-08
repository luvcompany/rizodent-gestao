

## Plano: Página "Funções Extras" do CRM

Criar uma única página `/crm/extras` com abas para testar as 8 funcionalidades antes de integrá-las ao painel principal.

---

### Estrutura

Uma página com `Tabs` contendo 8 abas:

1. **Respostas Rápidas** — CRUD de snippets (título, conteúdo, mídia opcional)
2. **Score de Lead** — Visualização e recálculo manual do score dos leads
3. **Métricas por Atendente** — Tabela com tempo de resposta, leads atendidos, conversões por usuário
4. **Distribuição Automática** — Configuração de round-robin (lista de atendentes, método, pipeline)
5. **Importação em Massa** — Upload CSV, mapeamento de colunas, preview e importação
6. **Campanhas (Broadcast)** — Criar campanha com template + filtros, enviar em lote
7. **Webhook Genérico** — Exibir URL do endpoint, documentação do payload, log de entradas
8. **Notificações** — Preferências de notificação e teste de Web Push

---

### Fase 1 — Migration (banco de dados)

Uma única migration criando:

- `crm_quick_replies` (id, title, content, media_url, media_type, created_by, created_at) com RLS para autenticados
- `crm_broadcasts` (id, name, template_id, filter_pipeline_id, filter_stage_id, filter_tags, status, total_leads, sent_count, created_by, created_at, scheduled_at)
- `crm_broadcast_recipients` (id, broadcast_id, lead_id, status, sent_at, error)
- `crm_notification_preferences` (id, user_id, notify_task_due, notify_new_lead, notify_lead_reply, browser_push_enabled)
- Adicionar colunas em `crm_leads`: `score` (int default 0), `assigned_to` (uuid nullable)
- Adicionar coluna em `messages`: `sender_id` (uuid nullable) para rastrear qual atendente enviou
- RLS em todas as novas tabelas (authenticated pode SELECT, staff pode INSERT/UPDATE/DELETE)
- Realtime habilitado em `crm_broadcasts` e `crm_broadcast_recipients`

---

### Fase 2 — Edge Functions

- **`broadcast-engine`** — Processa fila de envios com throttling (usa `send-whatsapp-message` internamente)
- **`generic-lead-webhook`** — POST endpoint que aceita `{name, phone, tags[], pipeline, source}`, normaliza telefone, cria lead, aplica distribuição

---

### Fase 3 — Página e componentes

- `src/pages/CrmExtras.tsx` — Página principal com Tabs
- Cada aba como componente inline ou seção dentro do arquivo
- Rota `/crm/extras` no `App.tsx` dentro do bloco CrmLayout
- Item "Funções Extras" no menu lateral do `CrmLayout.tsx` com ícone `Beaker`/`FlaskConical`

---

### Fase 4 — Lógica por aba

**Respostas Rápidas**: Tabela listando snippets + dialog de criação/edição. Campo título + textarea conteúdo.

**Score de Lead**: Função SQL `recalculate_lead_score` (+10 resposta, +15 avanço de etapa, -1/dia inativo). Tabela mostrando top leads por score com botão "Recalcular todos".

**Métricas por Atendente**: Query cruzando `messages.sender_id` com `profiles` para calcular tempo médio de primeira resposta, total de leads, taxa de conversão. Exibição em tabela.

**Distribuição**: Form com seleção de método (round-robin/menor carga), lista de usuários elegíveis, pipeline alvo. Salva config em `crm_automations` com `action_type = 'assign_lead'`.

**Importação**: Input file CSV, parser client-side, step de mapeamento (nome, telefone, tags, pipeline, stage), preview 5 registros, botão importar com progresso.

**Broadcast**: Selecionar template aprovado + filtros (pipeline, stage, tags). Preview quantidade. Botão enviar que cria `crm_broadcasts` + `crm_broadcast_recipients` e chama edge function.

**Webhook**: Exibe URL do endpoint (`/functions/v1/generic-lead-webhook`), exemplo de payload JSON, e lista últimos leads criados via webhook (filtro `source = 'webhook'`).

**Notificações**: Toggles de preferência (tarefa vencendo, novo lead, resposta de lead). Botão "Testar notificação" que dispara Web Push de teste.

---

### Arquivos criados/editados

| Arquivo | Ação |
|---|---|
| Migration SQL | Criar tabelas e colunas |
| `src/pages/CrmExtras.tsx` | Nova página |
| `src/App.tsx` | Adicionar rota `/crm/extras` |
| `src/components/CrmLayout.tsx` | Adicionar item no menu |
| `supabase/functions/broadcast-engine/index.ts` | Nova edge function |
| `supabase/functions/generic-lead-webhook/index.ts` | Nova edge function |

### Ordem de execução
1. Migration
2. Edge functions
3. Página CrmExtras com todas as abas
4. Rota + menu lateral


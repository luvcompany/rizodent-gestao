
# Construtor de Bots — Fase 1 (MVP)

## Escopo da Fase 1
Conforme o roadmap sugerido na especificação:
- Editor canvas básico com React Flow
- Blocos de texto/mídia (mensagem de texto, imagem, áudio, arquivo, vídeo)
- Gatilho manual (operador inicia pelo chat)
- Bloco "Aguardar Resposta" com timeout
- Bloco "Condição (If/Else)" simples
- Bloco "Pausa/Delay"
- Blocos de ação CRM básicos (mover etapa, adicionar tag, adicionar nota)
- Transferir para humano

## 1. Banco de Dados (Migration)

### Tabela `bots`
- `id`, `name`, `description`, `status` (draft/published/archived)
- `flow_json` (JSONB — nodes + edges do React Flow)
- `current_version` (integer)
- `created_by` (uuid)
- `created_at`, `updated_at`

### Tabela `bot_versions`
- `id`, `bot_id`, `version` (integer), `flow_json`, `published_at`

### Tabela `bot_executions`
- `id`, `bot_id`, `bot_version_id`, `lead_id`
- `status` (active/waiting_reply/paused/completed/error)
- `current_node_id` (text)
- `variables` (JSONB — variáveis locais da sessão)
- `started_at`, `updated_at`, `completed_at`

### Tabela `bot_execution_logs`
- `id`, `execution_id`, `node_id`, `action`, `details` (JSONB), `created_at`

### Tabela `bot_stage_triggers` (preparado para Fase 2)
- `id`, `stage_id`, `bot_id`, `trigger_type` (on_enter/on_exit/on_timeout)
- `delay_minutes`, `conditions` (JSONB), `priority`, `is_active`

### RLS
- Admin/Gerente: CRUD completo em bots
- CRC: SELECT em bots, INSERT/UPDATE em executions
- Todos autenticados: SELECT em executions vinculadas

## 2. Frontend — Páginas e Componentes

### `/crm/bots` — Lista de Bots
- Cards com nome, descrição, status (badge), data
- Ações: criar, editar, duplicar, arquivar, excluir
- Filtro por status

### `/crm/bots/:id` — Editor Canvas
- **React Flow** como engine do canvas (instalar `@xyflow/react`)
- Toolbar lateral esquerda com categorias de blocos (arrastar para canvas)
- Painel de propriedades lateral direito (ao selecionar um bloco)
- Toolbar superior: nome do bot, salvar, publicar, testar, desfazer/refazer
- Minimap, controles de zoom, grid snap
- Undo/Redo com histórico (50 ações)

### Blocos da Fase 1:
| Categoria | Blocos |
|-----------|--------|
| Início | Bloco Start (nó inicial obrigatório) |
| Mensagem | Texto, Imagem+Texto, Áudio, Arquivo+Texto, Vídeo+Texto |
| Lógica | Pausa/Delay, Aguardar Resposta, Condição (If/Else) |
| Ação CRM | Mover Etapa, Adicionar/Remover Tag, Adicionar Nota |
| Controle | Transferir para Humano |

### No Chat (`CrmConversa`)
- Botão "Iniciar Bot" no painel lateral
- Indicador "Bot ativo" no header da conversa
- Botões pausar/encerrar bot

## 3. Backend — Edge Functions

### `bot-engine` (nova)
- Recebe: `{ leadId, botId, trigger, nodeId? }`
- Triggers suportados na Fase 1: `manual_start`, `continue` (após resposta do lead)
- Lógica:
  - Busca o flow_json do bot publicado
  - Cria/continua `bot_execution`
  - Executa nós sequencialmente até encontrar bloco de pausa (delay/aguardar resposta)
  - Para blocos de mensagem: usa o mesmo `send-whatsapp-message` existente
  - Para delay: agenda próxima execução (via pg_cron ou setTimeout)
  - Para aguardar resposta: salva estado e aguarda webhook
  - Registra logs em `bot_execution_logs`

### Integração no `whatsapp-webhook` (existente)
- Ao receber mensagem inbound: verifica se há `bot_execution` ativa aguardando resposta
- Se sim: chama `bot-engine` com trigger `continue`

## 4. Ordem de Implementação
1. Migration do banco de dados (tabelas + RLS)
2. Instalar `@xyflow/react`
3. Página de lista de bots (`/crm/bots`)
4. Editor canvas com blocos básicos (`/crm/bots/:id`)
5. Edge Function `bot-engine`
6. Integração no chat (iniciar/pausar/encerrar bot)
7. Integração no webhook (continuar execução)

## Fases Futuras (não nesta implementação)
- **Fase 2**: Gatilhos automáticos por etapa Kanban
- **Fase 3**: List Message, botões interativos, templates HSM, reações
- **Fase 4**: Switch, loop, goto, outro bot, webhook HTTP
- **Fase 5**: Analytics e dashboard de execuções

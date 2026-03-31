

# Auditoria do Construtor de Bots - Plano de Correção

## Problemas Identificados

### 1. Drag-and-drop dos blocos NÃO funciona
O sistema rastreia `stepPositions` mas **nunca usa essas posições para renderizar os blocos**. Os cards estão em layout `flex` (flow automático), então arrastar muda o estado mas não move nada visualmente. Para funcionar, os blocos precisariam de posicionamento absoluto com `transform: translate()`, ou alternativamente, implementar reordenação por drag (mover a posição do passo na lista).

**Solução**: Implementar reordenação por drag-and-drop dentro do card de grupo. Quando o usuário arrasta um bloco pelo `GripVertical`, ele reordena os passos dentro da sequência linear. Isso é mais intuitivo para um fluxo sequencial do que posicionamento livre.

### 2. Bot Engine não suporta todos os tipos de mídia
O `bot-engine` tem handlers para `message_text`, `message_template` e `message_audio`, mas o editor permite configurar mensagens com imagens, documentos e anexos. O `callSendWhatsapp` envia os dados, mas o mapeamento `mapToDbType` no editor não cobre todos os tipos.

**Solução**: Expandir o `bot-engine` para suportar `message_image`, `message_video`, `message_document` e garantir que o editor salve o tipo correto.

### 3. Mapeamento editor → banco incompleto
- `list_message` não tem mapeamento em `mapToDbType`
- `comment`, `reaction`, `start_bot`, `round_robin` não mapeiam para tipos do banco
- O bot-engine não tem handlers para esses tipos

**Solução**: Adicionar mapeamentos faltantes e handlers correspondentes no bot-engine.

### 4. Save do bot tem bug na resolução de next_node_id
Linha 324: `o.nextSteps[0]` é um objeto `FlowStep`, mas é usado como se fosse string para construir `"__pending__" + o.nextSteps[0].id`. Isso funciona por concatenação implícita mas é frágil.

### 5. Triggers não são salvos/carregados do banco
Os triggers são armazenados em `stage_bot_config` ao salvar, mas **não são carregados de volta** ao abrir o editor (`loadBot` não busca triggers).

**Solução**: Carregar `stage_bot_config` para o bot e popular o estado `triggers`.

### 6. Webhook → Bot Engine: mensagem de mídia não passa conteúdo útil
O webhook chama o bot-engine com `message: content || ""`, mas para áudio/imagem, `content` é vazio. O bot-engine precisa do tipo de mídia para processar corretamente.

### 7. Badge no menu lateral (questão do usuário anterior)
O código está correto mas pode haver um problema de realtime subscription. Preciso verificar se a publicação realtime está habilitada para `crm_leads`.

---

## Plano de Implementação

### Passo 1 — Corrigir drag-and-drop como reordenação
Substituir o sistema de posicionamento absoluto por reordenação sequencial. Ao arrastar um passo, ele troca de posição com o passo adjacente na lista linear.

### Passo 2 — Completar mapeamentos editor ↔ banco
Adicionar em `mapToDbType`:
- `list_message` → `message_list`
- `comment` → `comment`
- `reaction` → `reaction`
- `start_bot` → `start_bot`

### Passo 3 — Expandir bot-engine com novos tipos de nó
Adicionar handlers para: `message_image`, `message_video`, `message_document`, `message_list`, `reaction`, `comment`, `start_bot`.

### Passo 4 — Carregar triggers ao abrir o editor
No `loadBot`, buscar `stage_bot_config` onde `bot_id = botId` e popular o estado `triggers`.

### Passo 5 — Passar tipo de mídia do webhook ao bot-engine
Alterar a chamada no webhook para incluir `messageType: msgType` junto com o `message`.

### Passo 6 — Habilitar realtime para crm_leads + criar lead fictício
Garantir que a publicação realtime está ativa. Criar uma migração que insere um lead de teste com telefone fictício para validar o fluxo.

### Passo 7 — Corrigir generalSettings não sendo salvos
As configurações gerais do bot (delay, timeout) são mantidas apenas em estado local e nunca persistidas no banco. Salvar como parte do config do bot ou em uma coluna dedicada.

---

## Arquivos Afetados
- `src/pages/CrmBotEditor.tsx` — drag-and-drop, mapeamentos, carregar triggers, salvar settings
- `supabase/functions/bot-engine/index.ts` — novos handlers de nó
- `supabase/functions/whatsapp-webhook/index.ts` — passar messageType
- Migração SQL — lead fictício + realtime


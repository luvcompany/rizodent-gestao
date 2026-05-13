## Objetivo

Remover as abas **Direct** / **Comentários** do Instagram. Tudo (DMs e comentários) passa a viver dentro do mesmo chat do lead, igual ao Kommo. No chat, o usuário escolhe se responde como **Comentário** (público no post) ou como **Direct** (privado), e a resposta aparece dentro da mesma conversa.

## Comportamento alvo

- Aba "Instagram" mostra apenas a lista de conversas (sem subabas).
- Cada usuário do Instagram = 1 lead = 1 conversa, contendo DMs **e** comentários intercalados em ordem cronológica.
- Comentários aparecem como bolha especial: badge "Comentário", link "Ver post", e (no comentário recebido) botões de ação **Responder comentário**, **Curtir** e **Enviar Direct**.
- Composer abaixo tem um seletor com dois modos:
  - **Direct** (padrão) — envia DM normal.
  - **Comentário** — só fica disponível quando existe um comentário-alvo no thread (último comentário recebido, ou o que o usuário clicou em "Responder"). Envia resposta pública no post; a resposta também sobe como bolha de comentário no chat.
- Se o usuário responder por Direct e o lead responder, a conversa continua no mesmo chat (sem criar novo lead). Se depois ele clicar em um comentário antigo, pode escolher responder o comentário, curtir, etc.

## Mudanças

### 1. UI — remover subabas (`src/pages/CrmConversas.tsx`)
- Remover o `<Tabs defaultValue="direct">` interno e o `<InstagramComments />`.
- Deixar apenas `<WhatsAppConversations pipelineFilter="...instagram..." channel="instagram" />` direto dentro do `TabsContent value="instagram"`.
- Remover import de `InstagramComments` e do ícone `Star` se não usado.
- Remover/arquivar `src/components/chat/InstagramComments.tsx` (não mais referenciado).

### 2. Webhook — comentários viram parte da conversa (`supabase/functions/instagram-lite-webhook/index.ts`)
Em `persistMessage`, quando `messageType === "comment"`:
- Buscar/criar lead pelo `instagram_user_id` (mesma lógica usada hoje só para DMs).
- Continuar gravando em `instagram_messages` (mantém histórico original).
- **Adicionar** insert em `messages` com:
  - `lead_id`, `channel: "instagram"`, `direction: "inbound"`
  - `type: "comment"` (novo subtipo)
  - `content: texto do comentário`
  - `instagram_message_id: comment_id` (para dedupe)
  - `instagram_sender_id: senderId`
  - Persistir `post_id` e `comment_id` em colunas novas (ver §3) para suportar responder/curtir depois.
- Atualizar `crm_leads.last_message` / `last_inbound_at` igual às DMs.

### 3. Schema — guardar referência do comentário em `messages`
Migration: adicionar em `public.messages`:
- `instagram_comment_id text` — id do comentário original do IG.
- `instagram_post_id text` — id do post relacionado.
- Índice opcional em `instagram_comment_id`.

(Os tipos do Supabase regeneram sozinhos.)

### 4. Renderização da bolha (`src/components/chat/ChatMessageBubble.tsx` + conteúdo)
- Quando `type === "comment"`:
  - Mostrar badge "Comentário" no topo da bolha (cor diferente, ex. roxo/`bg-accent`).
  - Mostrar link "Ver post" se houver `instagram_post_id`.
  - Em comentários **inbound**, ao clicar, abrir um menu/popover com: **Responder comentário**, **Enviar Direct**, **Curtir**.
- Comentários **outbound** mantêm o badge "Comentário" para distinguir da DM.

### 5. Composer (`src/components/chat/ChatInput.tsx`)
- Quando `channel === "instagram"`, exibir um seletor compacto acima do textarea: **Direct** | **Comentário**.
- Estado `replyMode`:
  - default `"direct"`.
  - vira `"comment"` automaticamente se o usuário clicou em "Responder comentário" numa bolha (guarda `targetCommentId`).
  - botão "Comentário" só habilita quando existe `targetCommentId` resolvido (último comentário inbound do thread, ou o clicado).
- Ao enviar:
  - **Direct**: payload atual de DM.
  - **Comentário**: chamar `instagram-send-message` com `message_type: "comment"`, `comment_id: targetCommentId`, `post_id`, `instagram_account_id`, e o texto. Após sucesso, inserir também em `messages` com `type: "comment"`, `direction: "outbound"`, `instagram_comment_id` (o novo, retornado pela API se disponível) e `instagram_post_id` para a bolha aparecer no chat imediatamente.

### 6. Curtir comentário
- Adicionar ação "Curtir" no menu da bolha. Estender `instagram-send-message` (ou criar `instagram-comment-action`) para suportar `action: "like" | "unlike"` chamando `POST /{comment_id}/likes` da Graph API. Atualizar a bolha com indicador "❤ Curtido".

## Notas técnicas

- Manter `instagram_messages` intacta (não quebra histórico nem o registro de comentários antigos), só passa a duplicar comentários novos em `messages`.
- Comentários antigos (já existentes apenas em `instagram_messages`) **não** retroagem para o chat por padrão. Se o usuário quiser, posso rodar um backfill em migration separada — não incluído neste plano.
- `WhatsAppConversations` já filtra por `channel="instagram"`, então passa a listar leads que recebem só comentários sem nenhuma alteração extra.
- Deduplicação de comentários reentrantes via `instagram_comment_id` único.

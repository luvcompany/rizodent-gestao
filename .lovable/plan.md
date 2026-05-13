## Problema

A aba **Conversas → Instagram → Direct** renderiza hoje o componente `WhatsAppConversations` (passando `channel="instagram"`), e não o `InstagramConversations`. O `ChatInput` já respeita o canal (usa `instagram-send-message` quando `channel="instagram"`), mas o `useChatConversation` ainda tem **dois caminhos hardcoded** para `send-whatsapp-message`:

- **Reações** (`handleReact`, linha 409) — chama send-whatsapp-message sem checar canal.
- **Templates** (`sendTemplate`, linha 490) — chama send-whatsapp-message sem checar canal. É exatamente isso que aparece no log enviado: `[send-whatsapp] Resolved 0 component(s) for template agendados_faltantes_nmfnnn` foi disparado a partir de uma conversa do Instagram que tentou enviar um template do WhatsApp.

Outros pontos relacionados:
- `ForwardMessageDialog` também usa `send-whatsapp-message` fixo.
- Templates do WhatsApp não fazem sentido em conversas do Instagram (Direct não suporta templates HSM da Meta) — devem ficar ocultos quando o canal for Instagram.

## Mudanças

### 1. `src/hooks/useChatConversation.ts`
- Aceitar um parâmetro/contexto `channel: "whatsapp" | "instagram"` (vindo do `CrmConversas`).
- Em `handleReact`: se `channel === "instagram"`, exibir toast informativo "Reações ainda não são suportadas no Instagram Direct" e retornar (a Graph API do IG não permite enviar reactions via Send API). Caso contrário manter o fluxo WhatsApp.
- Em `sendTemplate`: se `channel === "instagram"`, bloquear com toast "Templates só estão disponíveis no WhatsApp" (templates HSM não existem no IG). Caso contrário manter o fluxo WhatsApp.
- (Opcional) Em `loadTemplates`, retornar lista vazia quando canal for Instagram, para esconder o popover.

### 2. `src/pages/CrmConversas.tsx`
- Propagar o canal correto em todos os pontos onde `useChatConversation` / componentes filhos forem usados, garantindo que dentro da aba Instagram tudo receba `channel="instagram"`.

### 3. `src/components/chat/ChatInput.tsx`
- Quando `isInstagram === true`: ocultar/desabilitar o botão de Templates e o handler de reação (já que não há suporte na Graph API IG). Manter envio de texto, imagem, vídeo e áudio (que já vão via `instagram-send-message`).

### 4. `src/components/chat/ForwardMessageDialog.tsx`
- Aceitar prop `channel` e usar `instagram-send-message` quando for Instagram. Se o componente não for usado dentro do fluxo Instagram, podemos apenas desabilitar/esconder a ação de "encaminhar" para mensagens de conversas IG.

### 5. Verificação final
- Após o ajuste, abrir a aba **Instagram → Direct**, selecionar uma conversa, enviar um texto e validar nos logs do edge function que apenas `instagram-send-message` é invocado (e nenhuma chamada a `send-whatsapp-message` ou `manage-whatsapp-templates`).

## Detalhes técnicos

- O ChatInput já tem a infraestrutura (`isInstagram`, `sendFnName`, `buildSendBody`) — não precisa redesenho, só estender para os caminhos esquecidos.
- Não vamos trocar `WhatsAppConversations` pelo novo `InstagramConversations` na aba Direct, pois o `WhatsAppConversations` é a UI rica (lead panel, follow-up, tarefas, anúncio, etc.) que já está integrada ao pipeline Instagram. O fix é cirúrgico: garantir que todo `invoke()` respeite `channel`.
- Reações e Templates do WhatsApp não têm equivalente direto na Graph API do Instagram Messaging, então o tratamento correto é bloquear no front.

## O que NÃO será feito
- Não vamos criar novos endpoints, novas tabelas, nem mexer em RLS.
- Não vamos alterar `instagram-send-message` nem `instagram-reply` (já estão funcionando).
- Não vamos remover o componente novo `InstagramConversations` (continua usado em outras telas / casos de uso).

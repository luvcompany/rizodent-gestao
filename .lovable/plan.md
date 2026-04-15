
Vou corrigir os dois problemas na raiz, em vez de tentar mais um ajuste superficial.

1. Corrigir o relógio preso no visualizador
- Revisar a normalização de status no hook `useChatConversation`.
- Tratar explicitamente os status reais que já existem no banco, especialmente `played`, além de `accepted`, `sent`, `delivered`, `read` e falhas.
- Ajustar a UI de `ChatMessageBubble` para que status válidos não caiam no `default` do relógio.
- Reforçar a reconciliação da mensagem otimista com a mensagem confirmada pelo backend para texto, áudio, imagem e documento, tanto em `CrmConversa` quanto em `CrmConversas`.
- Melhorar o match da mensagem temporária com a mensagem real usando mais sinais além de apenas `type` e ausência de `whatsapp_message_id`, para evitar ficar presa quando o backend salva com tipo/status diferente.

2. Corrigir a onda de gravação durante o áudio
- Refazer a renderização visual da gravação em `ChatInput` para garantir contraste e visibilidade no espaço exato do input.
- Desacoplar o desenho da onda da medição atual do canvas que hoje pode estar ficando invisível.
- Adicionar trilha/base visível e barras animadas com fallback mínimo, para que mesmo com volume baixo apareça atividade.
- Aplicar o mesmo comportamento nas duas telas porque ambas usam o mesmo `ChatInput`.

3. Validar o fluxo inteiro do chat
- Conferir os pontos de integração de `ChatInput` com `CrmConversa` e `CrmConversas`.
- Garantir que `onMessageSent`, `onMessageSuccess` e `onMessageError` atualizem a lista local e o cache global sem divergência.
- Verificar compatibilidade com mídias assinadas e com o retorno da função de envio.

4. Testes que vou executar após implementar
- Enviar texto e confirmar que o relógio vira check imediatamente.
- Enviar áudio e confirmar que o relógio não fica preso.
- Enviar imagem/documento e confirmar o mesmo comportamento.
- Gravar áudio e verificar que a onda aparece durante toda a gravação no local que você indicou.
- Validar isso nas duas telas: `CrmConversa` e `CrmConversas`.

Detalhes técnicos
- Achei um bug concreto: o balão de mensagem hoje só renderiza ícones corretos para `read`, `delivered` e `sent`. No banco já existem mensagens outbound com status `played`, e esse status está caindo no `default`, que mostra o relógio.
- Também há fragilidade na troca da mensagem otimista pela mensagem real: se o backend confirmar com tipo/status diferente do temporário, a UI pode continuar exibindo o item errado.
- A gravação está entrando no modo correto, mas a onda atual depende de um desenho em canvas que pode ficar visualmente “invisível”; vou tornar esse bloco visual robusto e claramente visível.

Implementação prevista
- `src/hooks/useChatConversation.ts`
- `src/components/chat/ChatMessageBubble.tsx`
- `src/components/chat/ChatInput.tsx`
- Possivelmente pequenos ajustes em `src/pages/CrmConversa.tsx` e `src/pages/CrmConversas.tsx` se eu precisar reforçar o fluxo de callbacks, mas a maior parte deve ficar centralizada no hook e no input.

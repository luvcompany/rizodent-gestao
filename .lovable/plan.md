
Vou corrigir isso pela causa real do bug, não com mais remendos.

1. Corrigir o gravador que “nem abre”
- Reestruturar `ChatInput.tsx` para existir apenas uma instância estável do gravador.
- Hoje o componente é renderizado em dois lugares diferentes e, ao trocar para `recorderActive`, ele desmonta a instância que acabou de iniciar a captura.
- Isso mata `MediaRecorder`, `stream`, `AudioContext` e cleanup roda no meio do fluxo.
- Vou manter a mesma posição visual que você quer, mas sem trocar de instância durante a gravação.

2. Corrigir o corte dos primeiros segundos do áudio
- Ajustar `AudioRecorderComposer.tsx` para separar:
  - pedido de permissão
  - inicialização do stream/encoder
  - momento em que a UI mostra “gravando”
- Em vez de “simular warmup”, vou prender o início visível/contagem ao momento real em que a captura já está pronta.
- Também vou revisar `start`, `requestData`, `stop` e o fluxo do polyfill/nativo para não perder o começo do buffer na primeira gravação.

3. Fazer a waveform aparecer de verdade no estilo esperado
- Manter a posição atual do input, sem criar bubble novo.
- Refazer a barra visual de gravação para sempre renderizar uma trilha base + barras ativas, evitando o “quadrado cinza”.
- Ajustar contraste, altura mínima, largura e distribuição das barras para ficar mais próximo do visual do Kommo, mas dentro do layout atual.
- Garantir que a waveform continue viva durante gravação, pausa e preview.

4. Manter a prévia antes do envio
- Preservar o comportamento de ouvir antes de enviar, mas sem quebrar o fluxo do campo.
- A prévia deve aparecer no mesmo espaço do composer, não como mensagem no histórico.
- Validar envio/cancelamento sem desmontar o estado do gravador.

5. Revalidar o envio e status no chat
- Confirmar que `sendRecordedAudio` continua integrando corretamente com `onMessageSent`, `onMessageSuccess` e `onMessageError`.
- Garantir que o áudio enviado saia do estado otimista e não fique preso.
- Confirmar comportamento igual em `CrmConversa` e `CrmConversas`, já que ambos usam o mesmo `ChatInput`.

Arquivos que vou corrigir
- `src/components/chat/ChatInput.tsx`
- `src/components/chat/AudioRecorderComposer.tsx`
- Se necessário, pequenos ajustes em:
  - `src/hooks/useChatConversation.ts`
  - `src/pages/CrmConversa.tsx`
  - `src/pages/CrmConversas.tsx`

O problema exato que encontrei
- O bug principal está em `ChatInput.tsx`: existem duas renderizações possíveis de `AudioRecorderComposer`.
- Quando o gravador chama `onModeChange(true)`, o pai troca de layout e desmonta justamente a instância que começou a gravar.
- Isso explica o comportamento “completamente bugado”: não abrir, cortar início, sumir waveform, falhar preview e parecer aleatório.
- O corte inicial também é compatível com atraso real do encoder/polyfill na primeira captura, então vou tratar isso no fluxo de inicialização, não só no visual.

Resultado esperado após a implementação
- Clicar no microfone abre e mantém o gravador sem travar.
- A waveform aparece no local atual, sem bubble novo.
- O começo do áudio não é mais cortado.
- Dá para ouvir antes de enviar.
- Funciona igual em `CRM Conversa` e `CRM Conversas`.

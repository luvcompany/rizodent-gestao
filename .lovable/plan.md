## Problema

Quando uma ligação entra e o usuário tem várias abas/janelas abertas, todas tocam o ringtone. Ao atender em uma, as outras continuam tocando até o servidor emitir `completed`/`rejected` — o que não acontece quando a chamada é apenas aceita em outra aba.

## Solução

Usar duas camadas de sincronização entre abas do mesmo usuário:

### 1. `BroadcastChannel` local (instantâneo, mesma origem)

Criar um canal `wa-call-sync` compartilhado entre todas as abas do navegador. Sempre que uma aba mudar o estado da chamada (aceitar, rejeitar, visualizar/interagir com o modal), ela publica uma mensagem `{ type, callId, tabId }`. As outras abas escutam e reagem:

- `accepted` / `handling` (usuário clicou em Atender ou Rejeitar em outra aba) → parar ringtone imediatamente e fechar o `IncomingWhatsappCallModal` naquela aba (voltar a `idle`), sem tentar enviar signaling à Meta.
- `dismissed` (usuário fechou modal ou navegou) → opcional, encerra o toque local.

Também emitir `handling` quando a aba ganha foco no modal (mousedown/keydown dentro do modal) para cobrir o cenário “só visualizei”.

### 2. Reforço via realtime do banco (cross-device)

Ampliar o handler `postgres_changes` em `WhatsappCallProvider` para tratar mais transições como “essa chamada não é mais minha para tocar”:

- Se `phase === "ringing"` e chega update com `status in ("accepted","connected","in-progress")` ou `event === "accept"` para a mesma `call.id` → parar ringtone e ir para `idle`. Isso cobre o caso de outra sessão (outro dispositivo/navegador) ter atendido.

### 3. Identificador de aba

Gerar um `tabId` (uuid) no `WhatsappCallProvider` e incluí-lo em toda mensagem do `BroadcastChannel`, ignorando ecos da própria aba.

## Arquivos afetados

- `src/contexts/WhatsappCallContext.tsx` — criar/gerenciar `BroadcastChannel`, publicar em `acceptCall`/`rejectCall`/`hangupCall`, consumir mensagens para forçar `idle`, ampliar filtros do handler realtime.
- `src/components/whatsapp-calls/IncomingWhatsappCallModal.tsx` — opcional: emitir `handling` ao interagir (hover/click) via callback recebido do provider, cobrindo o “visualizei em uma aba”.

## Fora de escopo

Sem alterar edge functions, tabela `whatsapp_calls` ou lógica de gravação/áudio.

## Problema

O `WhatsappCallProvider` está montado no `TenantApp` acima das rotas, então o listener realtime de ligações e o modal de chamada rodam mesmo na tela de login (`/`), fazendo o ringtone tocar sem usuário autenticado.

## Correção

Gatear o provider pelo estado de auth em `src/contexts/WhatsappCallContext.tsx`:

1. Ler `useAuth()` (user, loading) e `useTenant()` dentro do provider.
2. Se `!user` (ou `authLoading`): não abrir canal realtime, não subscrever `postgres_changes` de `whatsapp_calls`, não tocar ringtone, não renderizar `IncomingWhatsappCallModal` nem `ActiveWhatsappCallBar`. Retornar um contexto "idle" com no-ops.
3. Ao deslogar (user vira null), garantir cleanup: parar ringtone corrente, fechar `BroadcastChannel` de sync, remover channel do Supabase e resetar estado para `idle`.
4. Só (re)inicializar as subscriptions quando `user?.id` e `tenant?.id` estiverem presentes — usar esses ids como deps do `useEffect` de setup.

Nenhuma mudança em rotas, no `App.tsx` ou em outros componentes. Comportamento pós-login permanece idêntico (sync entre abas, modal, aceitar/rejeitar).

## Validação

- Abrir `/` deslogado → nenhum canal `whatsapp_calls` em Network, nenhum ringtone ao chegar chamada.
- Login → subscription inicia; chamada de teste toca normalmente.
- Logout → ringtone (se tocando) para imediatamente e subscription é removida.
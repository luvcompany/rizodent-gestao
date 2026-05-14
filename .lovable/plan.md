# Corrigir erro "Não foi possível encontrar o usuário solicitado" ao responder no Instagram

## Causa raiz

Os IDs de remetente do Instagram (IGSID / sender_id) são **escopados por conta de negócio**. Ou seja, o mesmo usuário final (`@vitorsantos_keys`) tem **um IGSID diferente** para cada conta que ele contatou (`rizodentipiau`, `rizodentguanambi`, `rizodentclinicas`).

No fluxo atual:

1. O frontend (`ChatInput.tsx`) envia corretamente `lead_id` + `instagram_account_id` (a conta que o usuário escolheu para responder).
2. A edge function `instagram-send-message` resolve o `recipient_id` lendo `crm_leads.instagram_user_id` — mas esse campo guarda **apenas um IGSID** (o da última conta que recebeu mensagem do lead).
3. Quando o usuário tenta responder por uma conta diferente daquela cujo IGSID está salvo, a Meta retorna **code 100 / subcode 2534014** ("usuário não encontrado"), porque o IGSID não pertence à conta usada para enviar.

Por isso só funciona pelo `rizodentguanambi` (foi de onde veio o último IGSID salvo no lead) e falha no `rizodentclinicas`, mesmo sendo a conta correta.

## Correção

Trocar a derivação de `recipient_id` na edge function para usar o **IGSID correto correspondente à conta de envio**, buscando na tabela `instagram_messages` o último `sender_id` inbound do lead **filtrado pela `instagram_account_id` que está sendo usada para enviar**.

### Mudanças em `supabase/functions/instagram-send-message/index.ts`

1. Após resolver `account` (já temos `account.instagram_account_id` = conta de envio), **antes** de validar `recipient_id`, sobrescrever a derivação:
   - Se `leadId` está presente e `recipient_id` ainda não foi explicitamente passado pelo cliente, buscar:
     ```
     SELECT sender_id FROM instagram_messages
     WHERE lead_id = :leadId
       AND is_outbound = false
       AND instagram_account_id = :account.instagram_account_id
       AND sender_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1
     ```
   - Usar esse `sender_id` como `recipient_id` (sobrepondo o que veio de `crm_leads.instagram_user_id`, que não é confiável em ambiente multi-conta).
2. Se nada for encontrado para essa conta específica, retornar **200** com `error_code: "no_thread_for_account"` e `user_message` claro: *"Não há histórico de DM deste lead com a conta selecionada. Selecione a conta correta no seletor acima do campo de mensagem."* (evita o 500 atual e orienta o usuário).
3. Manter o tratamento já existente do erro 100/2534014 como fallback (caso ainda ocorra por outro motivo, como bloqueio).

### Por que isso não afeta o cliente Rizodent existente

- A lógica continua idêntica para tenants com **uma única** conta IG (caso comum atual): o `sender_id` retornado é o mesmo que estaria em `crm_leads.instagram_user_id`.
- Apenas tenants/conversas com múltiplas contas IG ligadas ao mesmo lead passam a obter o IGSID correto.
- Nenhuma alteração de schema, nenhuma migração, nenhuma mudança no frontend.

## Arquivos alterados

- `supabase/functions/instagram-send-message/index.ts` (apenas a derivação do `recipient_id` + uma nova ramificação de erro amigável).

## Validação após aplicar

1. Abrir conversa do `@vitorsantos_keys`, selecionar `rizodentclinicas` no seletor de conta e enviar — deve funcionar.
2. Trocar para `rizodentguanambi` e enviar — deve continuar funcionando.
3. Conferir nos logs da função `instagram-send-message` que o `recipient_id` resolvido é diferente conforme a conta de envio.

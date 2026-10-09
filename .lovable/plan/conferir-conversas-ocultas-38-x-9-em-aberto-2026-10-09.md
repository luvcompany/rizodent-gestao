# Conferir conversas ocultas (38 x 9 em aberto)

## O que já conferi
- Agora há 18 conversas aguardando resposta no WhatsApp da clínica:
  - Pós-venda (Neiriane): 11
  - SDRs: 4
  - CRC (Rizodent): 2
  - Closer: 1
- Para quem é SDR/CRC, o balão deveria mostrar só as 6 do grupo SDR/CRC. LUV Agency e gerência veem as 18.
- As conversas abertas e já respondidas são muitas mais (Kelly 449, Bia 260, 23 sem dono). Isso pode explicar um "38" se uma tela estiver contando abertas e outra contando só as que aguardam resposta.
- Ainda não sei em qual tela aparece 38 e em qual aparece 9. Por isso a causa não está confirmada.

## O que vou fazer
1. **Abrir a tela de Conversas logada como LUV Agency e como uma SDR (Bia).** Anotar o número de cada balão (menu lateral, aba WhatsApp, aba Instagram) e quantas conversas a lista mostra no filtro "Aberto".
2. **Comparar cada número com o banco**, lead por lead, e achar quais conversas entram numa contagem e somem da lista (ou o contrário).
3. **Corrigir a causa encontrada**, para o balão e a lista usarem a mesma regra:
   - mesmo grupo (SDR/CRC, Closer, Recepção, Pós-venda separados);
   - só conversas abertas aguardando resposta;
   - mesmo número de WhatsApp permitido.
4. **Se existirem conversas realmente ocultas**, por exemplo de leads que perderam acesso quando um número foi desligado, devolver o acesso ao grupo certo, sem mover nem apagar nenhum lead.
5. **Testar de novo como LUV e como Bia:** o balão e a lista precisam bater.

## Fora do escopo
- Nenhum lead é apagado, fechado ou transferido.

## Detalhes técnicos
- Contadores: `get_crm_unread_leads_count` e `get_crm_unread_leads_count_by_channel`, que usam a RLS de `crm_leads` mais `can_access_whatsapp_number`/`can_access_pipeline`. A lista usa `isUnreadLead` em `CrmConversas.tsx` e o RPC `get_lead_for_conversation`.
- A conferência no navegador usa a tela `/rizodent/crm/conversas`.
- Procurar leads cujo `whatsapp_number_id` aponta para um número inativo ou sem permissão concedida ao grupo. Esse é o padrão do problema de ontem.

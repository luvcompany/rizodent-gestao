# Contador de "Conversas" da Kelly mostrando lead que não aparece

## O que encontrei

O lead que sobra no contador é a **Fran Oliveira**. A conversa dela foi fechada às 10:41 e ela não escreveu mais depois disso. Por isso ela não aparece na lista de conversas, mas o número do menu continua contando ela.

Na correção anterior eu ajustei uma conta parecida, mas não a que o menu "Conversas" usa de verdade. A conta do menu não sabe que a conversa foi fechada.

A **SIRLENE** também está na conta, mas ela é um caso certo: escreveu às 14:39 e ainda não teve resposta. Ela deve continuar contando até alguém responder.

## O que vou fazer

1. Fazer a conta do menu "Conversas" ignorar conversas fechadas, do mesmo jeito que a lista já faz. A conversa só volta a contar quando o lead escrever de novo.
2. Comparar a conta do menu com a lista da Kelly e da Bia, entrando como cada uma, para garantir que os dois números são iguais.
3. Se aparecer outra diferença nessa comparação (por exemplo, um lead de outro funil ou de um número que ela não acessa), corrigir na mesma hora.

Nenhum lead, mensagem ou responsável será alterado. A mudança vale na hora para todos os usuários, sem precisar publicar.

## Detalhes técnicos

- O badge em `CrmLayout.tsx` chama `get_crm_unread_leads_count()`. Essa função não tem o filtro `conversa_fechada_em`; a correção anterior entrou só em `crm_unread_leads_count()`.
- Migration: recriar `get_crm_unread_leads_count()` acrescentando `AND (l.conversa_fechada_em IS NULL OR l.last_inbound_at > l.conversa_fechada_em)`, mantendo o restante (SECURITY INVOKER, `can_access_whatsapp_number`, janela de 60 dias, `is_blocked = false`).
- Verificação: rodar a função com o JWT da Kelly e da Bia e comparar com os leads "não respondidos" que a tela de Conversas mostra para elas.

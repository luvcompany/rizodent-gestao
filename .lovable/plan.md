# Mostrar o horário da mensagem encontrada na busca

## Problema

Quando você pesquisa por um texto e a conversa aparece na lista por causa de uma mensagem antiga, o horário à direita continua sendo o da última mensagem da conversa. Você quer ver o horário exato da mensagem que casou com a busca.

## O que muda

- Na lista de conversas, quando a conversa apareceu por causa de uma mensagem encontrada na busca (o mesmo caso em que já aparece o trecho destacado), o horário à direita passa a ser o da mensagem encontrada.
- Esse horário fica com a etiqueta "Mensagem encontrada" ao passar o mouse, para não confundir com o horário da última mensagem.
- Se a mensagem encontrada for de outro dia, aparece "Ontem" ou a data, seguindo o mesmo formato já usado hoje.
- Fora da busca, nada muda: continua mostrando o horário da última mensagem.

## Detalhes técnicos

- A função de busca no banco (`buscar_leads_por_mensagem`) já devolve a coluna `quando` (data/hora da mensagem que casou); hoje o frontend descarta esse valor. Nenhuma alteração no banco é necessária.
- Em `src/pages/CrmConversas.tsx`: guardar `quando` num novo estado `messageMatchTimes` (`Map<leadId, string>`), preenchido no mesmo laço que hoje monta `messageMatchSnippets`, e limpá-lo nos mesmos pontos em que os outros estados de busca são resetados.
- No render do horário (bloco em torno da linha 1396), usar `messageMatchTimes.get(lead.id)` quando existir e o termo tiver 3+ caracteres, com fallback para `last_message_at || created_at`; ajustar o `title` conforme a origem do horário.
- Somente código de tela. Sem migrations, sem edge functions, sem publish.

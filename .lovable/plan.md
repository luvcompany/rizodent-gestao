# Cartão do anúncio só na primeira mensagem do lead

## O que encontrei
- O cartão do anúncio aparece em toda mensagem recebida que tem o registro do anúncio salvo.
- Na maioria dos leads, só a primeira mensagem tem esse registro. Nos últimos 30 dias, 63 de 933 leads de anúncio têm o registro em mais de uma mensagem.
- Isso acontece quando a Meta manda o anúncio de novo, por exemplo quando o lead clica no anúncio outra vez ou envia mensagem repetida logo depois. Um exemplo é a mensagem "No momento não tô podendo atender".
- Ainda não vi a conversa da sua tela. Se o cartão aparecer em mensagens que não têm o registro do anúncio, a causa é outra, e eu confiro isso no primeiro passo.

## O que vou fazer
1. Abrir uma conversa com o problema e confirmar em quais mensagens o cartão aparece.
2. Na conversa, mostrar o cartão do anúncio só na primeira mensagem do lead que veio de anúncio. As outras mensagens aparecem normais, só com o texto.
3. Manter os dados do anúncio no painel lateral do lead, como já está hoje.
4. Nada é apagado: os registros continuam guardados para os relatórios e para a origem do lead. Só muda o que aparece na tela.

## Detalhes técnicos
- `ChatMessageBubble.tsx` (linha 207) mostra o cartão para qualquer mensagem inbound com `ad_source_id`, `ad_source_url`, `ad_headline` ou `ad_image_url`.
- Na lista de mensagens, calcular o id da primeira mensagem inbound com dados de anúncio e passar `showAdCard` só para ela.
- Se no passo 1 o cartão aparecer em mensagens sem esses campos, procurar o caminho que copia os dados do lead para a mensagem (webhook ou carregamento) e corrigir ali.

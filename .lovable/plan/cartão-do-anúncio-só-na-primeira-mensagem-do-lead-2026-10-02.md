# Cartão do anúncio só na primeira mensagem do lead

## O que encontrei
- Na conversa da Luziene Paiva, só a primeira mensagem, de 20/09, veio de fato com o anúncio. As outras 10 mensagens que ela mandou receberam uma cópia do título, do texto e do link do anúncio, e por isso cada balão mostra o cartão.
- Essa cópia veio da correção de miniaturas que eu fiz antes: ela preencheu os dados do anúncio em todas as mensagens recebidas, e não só na primeira. O erro foi meu.
- Ao todo são 37.939 mensagens de 4.670 leads com essa cópia indevida.

## O que vou fazer
1. Limpar os dados do anúncio dessas 37.939 mensagens. Só a mensagem em que o anúncio veio de verdade continua com o cartão.
2. Antes de limpar, guardar uma cópia de segurança, para dar para desfazer.
3. Na conversa, mostrar o cartão só na primeira mensagem com anúncio de cada lead, para isso não voltar a acontecer.
4. Abrir a conversa da Luziene e conferir que o cartão aparece só na primeira mensagem dela.

Não muda nada na origem do lead, nos relatórios, na lista de anúncios nem no painel lateral, porque eles usam os dados guardados no lead.

## Detalhes técnicos
- Critério para limpar: `direction = 'inbound'`, `ad_source_id IS NULL` e algum dos campos `ad_headline`, `ad_body`, `ad_source_url`, `ad_image_url` ou `ad_account_name` preenchido. As mensagens que a Meta enviou com referral têm `ad_source_id`.
- Backup em `_bkp_messages_ad_20261002` (id + campos ad_*), depois um UPDATE que zera esses campos.
- `ChatMessageBubble`/lista: calcular o id da primeira mensagem inbound com anúncio e mostrar o cartão só nela.

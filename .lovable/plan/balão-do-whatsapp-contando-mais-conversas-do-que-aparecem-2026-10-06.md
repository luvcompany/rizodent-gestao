# Balão do WhatsApp contando mais conversas do que aparecem

## O que encontrei
Não há mensagem oculta. Conferi no banco agora: existem cerca de 21 conversas de WhatsApp da RizoDent "em aberto" (o cliente mandou a última mensagem e ninguém respondeu nem fechou). Dessas, **11 estão no funil Pós-venda** e ficam paradas desde agosto/setembro (ex.: Elielson Brito, Donara Rocha, Acácia Mattos, Paulo Jorge).

O balão conta qualquer conversa em aberto que a pessoa pode ver, de qualquer funil. A lista de Conversas, por outro lado, esconde os funis que não estão na visão atual (como o Pós-venda, para quem não é da equipe de pós-venda). Por isso o número do balão fica maior do que o que aparece na lista: a diferença é a dessas conversas do Pós-venda que ninguém respondeu.

Diagnóstico ainda a confirmar por usuário: o primeiro passo é comparar, com a conta de uma SDR e com a sua, o número do balão e a lista com o filtro "Em aberto".

## Regra (definida por você)
Cada tipo de usuário é um "mundo" separado. SDR e CRC só contam e veem as conversas do mundo delas. Leads do Pós-venda, da Closer e da Recepção não entram no balão nem na lista delas, e o contrário também vale.

## O que vou fazer
1. Confirmar a diferença: comparar, com uma conta de SDR, uma de CRC e a sua, o número do balão com a lista no filtro "Em aberto", e listar quais leads de outro mundo estão sendo contados.
2. Balão das abas WhatsApp/Instagram e do menu: SDR e CRC passam a contar só os leads do mundo delas. Ficam de fora os funis do Pós-venda e de outros papéis, e os números da Closer e da Recepção.
3. Lista de Conversas: aplicar a mesma separação, para o balão e a lista mostrarem exatamente o mesmo número.
4. Pós-venda, Closer e Recepção continuam vendo e contando os próprios leads. Gerente e Luv Agency continuam vendo tudo. Nenhum lead é apagado nem movido.
5. Conferir na tela, como SDR e como CRC, que o balão bate com a lista.

## Detalhes técnicos
- Hoje `get_crm_unread_leads_count_by_channel` / `get_crm_unread_leads_count` filtra só por tenant, `can_access_whatsapp_number`, janela de 60 dias e fechada/respondida. Não aplica `can_access_pipeline` (`allowed_roles` do funil).
- Ajuste: nos contadores, incluir `can_access_pipeline(l.pipeline_id)` e, para sdr/crc, manter só o mundo legado (`whatsapp_number_id IS NULL`). Na lista, conferir `inaccessiblePipelineIds` e o filtro por número com a mesma regra.
- Revisar `allowed_roles` do funil Pós-venda para garantir que não inclui sdr/crc.
- Não muda a regra de "em aberto", e a normalização de telefone fica como está.

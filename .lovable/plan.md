# Balão do WhatsApp contando mais conversas do que aparecem

## O que encontrei
Não há mensagem oculta. Conferi no banco agora: existem cerca de 21 conversas de WhatsApp da RizoDent "em aberto" (o cliente mandou a última mensagem e ninguém respondeu nem fechou). Dessas, **11 estão no funil Pós-venda** e ficam paradas desde agosto/setembro (ex.: Elielson Brito, Donara Rocha, Acácia Mattos, Paulo Jorge).

O balão conta qualquer conversa em aberto que a pessoa pode ver, de qualquer funil. A lista de Conversas, por outro lado, esconde os funis que não estão na visão atual (como o Pós-venda, para quem não é da equipe de pós-venda). Por isso o número do balão fica maior do que o que aparece na lista: a diferença é a dessas conversas do Pós-venda que ninguém respondeu.

Diagnóstico ainda a confirmar por usuário: o primeiro passo é comparar, com a conta de uma SDR e com a sua, o número do balão e a lista com o filtro "Em aberto".

## O que vou fazer
1. Confirmar a diferença: abrir Conversas com o filtro "Em aberto" e listar exatamente quais leads o balão conta e a lista não mostra.
2. Fazer o balão (das abas e do menu) seguir a mesma regra da lista: contar só as conversas dos funis que aparecem para aquela pessoa na tela de Conversas. Assim, clicar em "Em aberto" mostra exatamente o número do balão.
3. Nada é apagado nem escondido: as conversas do Pós-venda continuam no funil delas e contam para quem trabalha nele.
4. Conferir na tela com a conta de SDR e com a sua que o balão bate com a lista.

## Detalhes técnicos
- `get_crm_unread_leads_count_by_channel` (e `get_crm_unread_leads_count`) filtra só tenant, número de WhatsApp, janela de 60 dias e fechada/respondida; não aplica `can_access_pipeline` nem as exclusões de funil (`excludePipelines` / `inaccessiblePipelineIds`) usadas em `CrmConversas.tsx`.
- Ajuste: aplicar o mesmo filtro de funil na função (ou passar os funis excluídos como parâmetro), sem alterar a regra de "em aberto" nem a normalização de telefone.

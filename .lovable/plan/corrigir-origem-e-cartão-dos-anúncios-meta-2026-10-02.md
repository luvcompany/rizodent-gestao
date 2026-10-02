# Corrigir origem e cartão dos anúncios Meta

## Objetivo
Fazer a conversa identificar corretamente se o lead veio de anúncio do Instagram ou do Facebook e exibir, quando a Meta enviar, a miniatura, título, texto, link, nome e conta do anúncio.

## O que foi confirmado
- O recebimento de WhatsApp marca qualquer indicação de anúncio como `facebook_ad`, mesmo quando o link recebido aponta para o Instagram.
- No exemplo da Alice, o anúncio tem link do Instagram, mas o lead está salvo como Facebook; a mensagem possui título, descrição, link e ID, porém não recebeu miniatura.
- Nos últimos 90 dias, 1.561 leads marcados como Facebook têm link do Instagram; 994 leads de anúncio estão sem imagem.
- O cartão da conversa tenta descobrir a rede procurando a palavra “instagram” no ID ou na imagem e, quando não encontra, assume Facebook.
- No recebimento direto pelo Instagram, os dados do anúncio chegam ao processamento, mas apenas o ID é salvo na mensagem; por isso o cartão pode nem aparecer.

## Implementação
1. **Corrigir novos leads recebidos pela Meta**
   - Determinar Instagram/Facebook a partir dos dados reais do anúncio recebidos, usando o link/plataforma como evidência e sem confundir o canal de conversa (WhatsApp ou Direct) com a origem do anúncio.
   - Salvar a origem correta no lead desde a primeira mensagem.
   - No fluxo de Direct do Instagram, gravar na mensagem todos os dados disponíveis do anúncio, não apenas o ID.

2. **Preservar e completar os dados do anúncio**
   - Aproveitar primeiro miniatura, título, texto, link e identificadores enviados pela própria Meta.
   - Completar campos ausentes pela consulta do anúncio e pelo catálogo já existente, sempre limitado ao cliente correto.
   - Guardar a miniatura de forma estável para que o cartão não dependa apenas de um endereço temporário da Meta.

3. **Corrigir o cartão dentro da conversa**
   - Usar a origem explícita do lead/anúncio para mostrar “Anúncio do Instagram” ou “Anúncio do Facebook”, removendo a suposição automática de Facebook.
   - Exibir o cartão usando os dados da mensagem e, quando algum estiver ausente, completar com os dados já salvos no lead.
   - Manter um estado visual válido quando a miniatura não existir ou falhar, sem esconder título, descrição e link.

4. **Reparar o histórico da RizoDent**
   - Corrigir para Instagram os registros atualmente marcados como Facebook cujo link comprova origem no Instagram.
   - Preencher mensagens antigas com os dados de anúncio já existentes no lead ou no catálogo.
   - Executar o reparo de miniaturas ausentes em lotes controlados, sem alterar mensagens ou dados comerciais que não sejam de anúncio.

5. **Validar de ponta a ponta**
   - Testar casos de anúncio do Instagram abrindo conversa no WhatsApp, anúncio do Facebook no WhatsApp e Direct patrocinado do Instagram.
   - Confirmar rótulo, miniatura, título, descrição, link e conta no histórico da conversa.
   - Conferir o caso mostrado e validar que novas entradas não voltam a ser classificadas incorretamente.

## Detalhes técnicos
- Ajustar os recebimentos de WhatsApp e Instagram e publicar somente essas funções e o reparador necessário.
- Aplicar a correção histórica por migration auditável e restrita aos registros com evidência inequívoca.
- Não mudar funis, responsáveis, automações, textos das mensagens ou demais regras do CRM.

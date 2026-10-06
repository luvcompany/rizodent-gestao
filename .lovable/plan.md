# Número principal do WhatsApp (SDR e CRC) parou de enviar

## O que encontrei
- Desde as **15:38 (Bahia) de hoje**, todo envio pelo número principal (o que SDR e CRC usam) volta com o erro do WhatsApp **"The account is not registered"** (conta não registrada). São 18 mensagens e modelos que falharam até agora. O último envio que deu certo foi às 15:38.
- A última mensagem recebida nesse número foi às 15:34. Desde então não chegou mais nada, o que confirma que o número caiu do lado do WhatsApp.
- O sistema não mudou nada nesse horário. O erro vem do próprio WhatsApp (Meta): o número foi **desregistrado** da API. Isso costuma acontecer quando alguém ativa esse número num celular (no app WhatsApp ou no WhatsApp Business), troca o PIN de confirmação em duas etapas ou desconecta o número no Gerenciador do WhatsApp.
- O outro número conectado continua recebendo mensagens normalmente. Os poucos erros dele são de outros tipos, como a janela de 24 horas já vencida.

## O que vou fazer
1. Consultar no WhatsApp a situação atual do número principal: se está registrado, a qualidade e se há alguma restrição.
2. Registrar o número de novo na API usando o **PIN de 6 dígitos da confirmação em duas etapas**. Esse PIN vou pedir a você e não fica salvo no sistema.
3. Fazer um envio de teste e conferir que as mensagens voltam a sair e a chegar.
4. Listar as 18 mensagens que falharam, com o lead e o horário, para a equipe reenviar o que for preciso. Nada é reenviado automaticamente.

## O que preciso de você
- Confirmar se alguém abriu esse número num celular ou mexeu no Gerenciador do WhatsApp hoje por volta das 15:30. Se o número estiver ativo num celular, ele precisa ser desconectado de lá, senão vai cair de novo.
- Mandar o PIN de 6 dígitos da confirmação em duas etapas desse número. Se ninguém souber o PIN, ele pode ser redefinido no Gerenciador do WhatsApp.

## Detalhes técnicos
- Erro registrado em `messages.error_reason` (Meta #133010), nos envios com `whatsapp_number_id IS NULL` (número principal do tenant), a partir de 18:38 UTC.
- O novo registro usa `POST /{phone_number_id}/register` com `messaging_product=whatsapp` e o `pin`, com o token do tenant. O status é lido em `GET /{phone_number_id}?fields=status,quality_rating,code_verification_status`. Isso roda numa chamada pontual feita pelo servidor, sem mudar o código do app.
- A normalização de telefone e as demais regras não mudam.

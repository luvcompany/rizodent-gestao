# Pausar envios quando o WhatsApp cair e mostrar o status da conta

## Situação hoje
- O número principal do SDR/CRC (••9815) está desligado na Meta, mas no sistema continua marcado como "conectado".
- Nas últimas 24h, 153 mensagens falharam com "The account is not registered". As automações, o follow-up, os bots e os disparos continuam tentando enviar.
- O envio só é bloqueado quando a conexão está marcada como "desativada" à mão.

## O que vai mudar

### 1. Verificação automática do número (a cada 5 minutos)
- O sistema pergunta à Meta o estado de cada número conectado: conectado ou desconectado, qualidade (verde, amarela ou vermelha), limite de mensagens e se a conta está bloqueada ou restrita.
- O resultado fica salvo na própria conexão, com data e hora da última checagem e o motivo do problema.
- Se um envio falhar com um erro de conta, como "não registrado", conta bloqueada ou token inválido, a conexão é marcada com problema na hora, sem esperar a próxima checagem.

### 2. Pausa automática dos envios
- Enquanto a conexão estiver com problema, os envios desse número ficam em espera: automações, follow-up, bots, disparos em massa e mensagens de pesquisa.
- Nada se perde. A fila fica parada e volta a sair sozinha quando a Meta mostrar o número conectado de novo.
- Mensagens agendadas para um horário que já passou durante a queda não serão enviadas fora de hora. Elas aparecem como "não enviada por conexão" para a equipe decidir.
- Os outros números (Closer, Recepção) continuam funcionando normalmente. A pausa vale só para o número com problema.
- No chat, enviar manualmente pelo número com problema mostra um aviso claro: "WhatsApp desconectado da Meta — mensagem não enviada". Hoje aparece um erro técnico.

### 3. Status visível
- **Integrações e Conexões:** cada número ganha um selo de status. Verde "Conectado", âmbar "Qualidade baixa / Limitado" ou vermelho "Desconectado na Meta" / "Conta restrita" / "Token expirado". O selo mostra o motivo e a hora da última checagem, e há um botão "Verificar agora".
- **Aviso no topo do CRM:** quando o número do seu grupo estiver com problema, aparece uma faixa vermelha para SDR, CRC e Gerente. Ela diz, por exemplo, "WhatsApp principal desconectado da Meta — automações pausadas" e leva para a tela Integrações. Cada grupo vê só os avisos dos próprios números.

## Fora deste plano
- Religar o número ••9815 continua dependendo do código de 6 dígitos que a Meta mandou por SMS ou ligação.
- As 153 mensagens que já falharam não serão reenviadas sozinhas. Posso preparar uma lista delas para reenvio, se você quiser.

## Detalhes técnicos
- Migration: colunas em `integrations` — `health_status` (ok/warning/error), `health_reason`, `health_checked_at`, `meta_status`, `quality_rating`. Sem mudar `status`, o liga/desliga manual.
- Nova edge function `whatsapp-health-check` (cron de 5 min): `GET /{phone_number_id}?fields=status,quality_rating,messaging_limit_tier,code_verification_status,name_status` e `GET /{waba_id}?fields=account_review_status,ban_state`.
- `send-whatsapp-message`: antes de enviar, se `health_status='error'` e não for teste manual, devolve 409 `whatsapp_disconnected`. Nos erros 133010, 131031, 190 e 131042, marca a integração como `error`.
- `automation-queue-worker`, follow-up, `bot-engine`, broadcast e pesquisa: com o número em `error`, adiam o item (`deferred`, sem contar tentativa); se a janela de horário já passou, marcam `skipped_connection`.
- Frontend: selo em `CrmIntegracoes.tsx` e `MinhasConexoes.tsx`; faixa em `CrmLayout.tsx`, só com tokens semânticos (destructive/warning/success), filtrada por `can_access_integration_world`. O toast do chat trata 409.
- O botão "Verificar agora" chama a mesma função de verificação de forma manual.

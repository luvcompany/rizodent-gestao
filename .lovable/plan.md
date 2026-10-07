# Número de contingência — verificação e assumir envios

## Contexto
O número principal do SDR/CRC (+55 77 8114-7531, ••9815) está desconectado na Meta e os envios por ele estão pausados pelo bloqueio de saúde. O usuário vai conectar um número de contingência agora.

## O que o sistema já faz sozinho
- O bloqueio de envio é por número: o número novo nasce sem problema e envia normalmente.
- A checagem de saúde (cron) passa a verificar o número novo e marca "Conectado" em Integrações.

## Plano de verificação (após o usuário conectar)
1. Confirmar no banco que o número novo foi criado em `integrations` com `owner_role` correto (crc/sdr → mundo 'crc') e `health_status = 'ok'`.
2. Rodar a checagem de saúde uma vez e confirmar que a Meta responde CONNECTED para o número novo.
3. Conferir em Integrações que o número novo aparece com selo verde "Conectado" e o antigo continua com selo vermelho.
4. Fazer um envio de teste (mensagem ou template) por um lead de teste pelo número novo e confirmar entrega na Meta.
5. Confirmar que as automações/follow-ups em fila passam a sair pelo número novo (se o funil/lead estiver ligado a ele) — se as automações estiverem presas ao número antigo, apontar que é preciso trocar o número nas configurações do funil/conexão.

## Fora de escopo
- Nada muda no número antigo: ele continua pausado até ser religado na Meta (ainda aguardando o código de 6 dígitos do SMS/ligação).
- Nenhum lead é movido ou apagado.

## Detalhes técnicos
- Verificar `integrations` (key whatsapp_%, owner_role, health_status) do tenant rizodent.
- Executar a edge function `whatsapp-health-check` uma vez após a conexão.
- Envio de teste via `send-whatsapp-message` com lead de teste, depois limpar os dados de teste.

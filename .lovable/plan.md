# Remover de vez o número "Whatsapp Contingência" do sistema

## Situação confirmada

Você excluiu a integração do número de contingência (+55 77 8128-1211) na tela Integrações, mas o cadastro dele continuou ativo no sistema. Por isso ele ainda aparece:

- na lista "Enviar por:" da conversa de cada lead;
- no seletor "Número padrão de envio" da aba Integrações;
- os 12 modelos dele (agendamento, endereços, pré-agendamentos, aviso, lig2) continuam aparecendo nas listas de modelos.

## O que será feito

1. **Desativar o número no cadastro** — o "Whatsapp Contingência" deixa de constar como número ativo. Com isso ele some automaticamente de:
   - "Enviar por:" na conversa do lead;
   - seletor "Número padrão de envio" em Integrações;
   - checagem de saúde e selos de status.
2. **Remover os 12 modelos dele** da tela de Modelos (eles já não existem mais na Meta, já que a conta foi banida).
3. **Limpar as permissões** que davam acesso a esse número às usuárias (CRC, SDRs, gerência).

## O que NÃO muda

- Nenhum lead é apagado nem movido. Leads que tinham o contingência como "Enviar por:" voltam a usar o número padrão (hoje o "Rizodent - Comercial 2").
- O histórico de mensagens trocadas pelo contingência continua nas conversas, com a marca "Pelo número Whatsapp Contingência".
- Os 145 modelos do número antigo (que estavam sem número vinculado) não são tocados.
- O número "Rizodent - Comercial 2" continua como padrão de envio.

## Detalhes técnicos

- `UPDATE whatsapp_numbers SET is_active = false` no número 232255f7-a5dc-4883-b360-8fd210b26cd0 (phone_number_id 1440612142459013).
- `DELETE FROM crm_whatsapp_templates WHERE whatsapp_number_id = '232255f7-...'` (12 linhas).
- `DELETE FROM user_permission_overrides WHERE scope = 'whatsapp_number' AND resource_id = '232255f7-...'`.
- Os seletores ("Enviar por:", "Número padrão de envio") já filtram por `is_active = true` — nenhuma mudança de tela é necessária.

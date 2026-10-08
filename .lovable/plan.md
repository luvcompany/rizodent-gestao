# Auditoria: número novo, escolha de número e sincronização de modelos

## O que encontrei
1. **O número novo ("Rizodent - Comercial 2") ficou salvo pela metade.** A tela Integrações gravou a conexão, mas ele não entrou na lista oficial de números do sistema. Por isso:
   - ele não aparece em "Enviar por:", nem como "Número padrão de envio";
   - as mensagens que chegam nele não acham o número e não aparecem nas Conversas;
   - a checagem de saúde não mostra o selo dele.
   A causa é que a tela Integrações grava o número com um nome sequencial ("whatsapp_3") e não cria o cadastro dele. A tela Conexões, usada pelo closer, faz isso certo.
2. **"Enviar por:" só lista os números que estão de fato cadastrados.** Do grupo SDR/CRC, hoje só existe o de contingência, porque o principal antigo e o novo nunca entraram nesse cadastro. Por isso parecia que o número estava fixo.
3. **Modelos:** a sincronização automática está rodando (304 modelos às 17:05). O erro aparece no botão manual. Ainda não sei a causa: vou repetir a sincronização logado como a Luv Agency e ler o erro que volta.
4. **Atenção:** o número novo está na mesma conta do WhatsApp Business do número banido. Se a Meta restringiu a conta inteira, o número novo também pode ser recusado. Vou checar isso na Meta.

## O que vou fazer
1. **Toda conexão salva em Integrações vira um número completo**, como acontece em Conexões: cadastro do número, grupo do dono, ligação da conta para receber mensagens, checagem de saúde e ativação automática quando a Meta disser "conectado". Uso o identificador do próprio número, não mais "whatsapp_3".
2. **Arrumar o número novo agora:** cadastrar o número, ligar o recebimento de mensagens, rodar a checagem de saúde e sincronizar os modelos da conta dele.
3. **"Enviar por:"** passa a listar todos os números ativos do grupo de quem está usando. O número desconectado aparece com um selo vermelho, em vez de sumir.
4. **Sincronização de modelos:** achar e corrigir o erro do botão. A sincronização também passa a rodar sozinha logo depois de conectar um número.
5. **Teste completo com o número novo:** ele aparece em Integrações com selo verde e na lista "Enviar por:"; uma mensagem recebida aparece nas Conversas; um envio sai por ele; a sincronização de modelos funciona.

## Fora do escopo
- Nenhum lead é movido ou apagado.
- O número banido continua cadastrado, desligado, para as conversas antigas continuarem mostrando por qual número passaram.

## Detalhes técnicos
- `CrmIntegracoes.tsx:220` grava `key: whatsapp_${idx}`. Mudar para `whatsapp_<phone_number_id>` e fazer upsert em `whatsapp_numbers` (tenant, display_name, phone_number_id, waba_id, phone_e164, is_active). Depois, invocar `whatsapp-health-check`, que já cuida de `subscribed_apps` e de promover o número para conectado.
- Migração/dados: renomear a integração `whatsapp_3` para `whatsapp_1379479318578791`, criar a linha em `whatsapp_numbers` com `owner_role` crc e conceder o número aos usuários do grupo crc/sdr. O gatilho `trg_normalize_lead_phone` não é tocado.
- Webhook: confirmar que `whatsapp-webhook` resolve o tenant e o número pelo `phone_number_id` em `whatsapp_numbers`.
- Seletor: `numerosVisiveis` em `CrmConversas.tsx:2185` passa a usar os números ativos do grupo e mostrar o selo `SeloSaudeWhatsapp`.
- Modelos: reproduzir o erro do `manage-whatsapp-templates` (action sync) com a sessão superadmin e corrigir o que aparecer, por exemplo token da WABA nova ou integração sem `waba_id`.

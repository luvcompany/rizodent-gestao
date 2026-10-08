# Testar criação de modelos no número novo (Rizodent - Comercial 2)

## Objetivo
Confirmar que um modelo criado na tela Modelos, com "Número de WhatsApp" = Rizodent - Comercial 2 (+55 77 8108-5179), vai para a conta certa na Meta e aparece certo no sistema.

## Passos
1. Conferir que o número novo aparece no campo "Número de WhatsApp" do modal "Novo Modelo" (e que o contingência não aparece).
2. Criar um modelo de teste simples, de serviço, chamado `teste_comercial2`, com texto curto ("Olá, {{1}}! Mensagem de teste da RizoDent."), pelo número novo.
3. Confirmar no sistema que o modelo foi gravado com o número novo e que a Meta respondeu com sucesso (status "aguardando aprovação"), na conta do WhatsApp Business do número novo.
4. Rodar a sincronização de modelos e conferir que não dá erro e que o modelo de teste aparece com o número certo.
5. Se algo falhar: achar a causa (número não repassado, conta errada, token) e corrigir no mesmo ponto, sem mudar o resto da tela.
6. No fim, perguntar se você quer manter ou apagar o modelo de teste na Meta.

## Observação
O teste envia um modelo real para aprovação da Meta. Ele não é enviado para nenhum paciente.

## Detalhes técnicos
- Verificar `crm_whatsapp_templates.whatsapp_number_id` e o `waba_id` usado pela função de criação de templates (logs da função).
- Consultar a Graph API (`/{waba_id}/message_templates?name=teste_comercial2`) para confirmar a conta de destino.
- Testar a função de sincronização e ler os logs.

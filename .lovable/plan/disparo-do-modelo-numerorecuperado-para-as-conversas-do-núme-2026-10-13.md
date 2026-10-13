# Disparo do modelo "numerorecuperado" para as conversas do número 5179

## O que será feito
1. **Conferir antes de enviar**
   - Ver se o modelo `numerorecuperado` existe na conta do **Rizodent - Comercial 2 (+55 77 8108-5179)** e se a Meta já aprovou (status APPROVED). Se ainda estiver pendente ou recusado, o disparo não sai e eu aviso você.
   - Ver se o número 5179 está com status verde (conectado). Se estiver fora do ar, os envios ficam bloqueados.
   - Ver quantas variáveis o modelo tem (ex.: `{{1}}` = nome do lead) para preencher certinho.
2. **Montar a lista**
   - Só leads do grupo SDR/CRC cuja conversa está no número 5179 (número salvo no lead ou última conversa por ele).
   - Ficam de fora: leads bloqueados, com automações pausadas, sem telefone válido, leads do Closer/Recepção e leads na lixeira.
   - Antes de enviar, informo o total de leads.
3. **Enviar**
   - Disparo saindo **pelo próprio 5179**, com espaçamento entre envios para não sobrecarregar a Meta.
   - Cada mensagem fica registrada na conversa do lead.
4. **Relatório final**
   - Quantos foram enviados, quantos a Meta recusou e o motivo (ex.: número inexistente, erro de pagamento 131042).

## Detalhes técnicos
- Fonte do número: `crm_leads.whatsapp_number_id` = id de Comercial 2 em `whatsapp_numbers`, ou, quando nulo, a última mensagem com esse número; filtrado por `mundo_numero_whatsapp = crc` e pelo tenant `rizodent`.
- Modelo conferido em `crm_whatsapp_templates` pelo `waba_id` do Comercial 2.
- Envio por meio de `send-whatsapp-message` com o número forçado como saída; resultado lido com `_shared/envioWhatsapp.ts` (recusas da Meta não contam como enviadas e não são repetidas).
- Nenhum arquivo, migration ou função alterada.

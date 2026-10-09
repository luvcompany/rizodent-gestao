# Por que os modelos sumiram para as SDRs/CRC e como corrigir

## O que aconteceu
- Até 06/10, as SDRs enviaram 211 vezes os modelos de endereço pelo número antigo. Nessa época, esses modelos eram "gerais", ou seja, visíveis para todo mundo.
- Quando o número novo (Rizodent - Comercial 2) foi ligado, os modelos da conta passaram para ele. Na sincronização, o sistema tenta marcar cada modelo geral com o "dono do número".
- O Comercial 2 é usado por SDR e CRC juntas. O sistema enxergou dois donos diferentes e não conseguiu escolher um. Então marcou os modelos com o papel de quem clicou em sincronizar. Como foi a LUV Agency, ficaram como "da LUV Agency", e só a LUV passou a vê-los.
- Entre 06 e 08/10, as SDRs usaram as cópias do número de contingência. Quando a contingência foi excluída, as cópias sumiram e o problema apareceu.

São 24 modelos marcados como "da LUV Agency" na conta do número novo: 8do8_rizo, abertura_atendimento, agendamento, agendamento_hoje, antes_e_depois, boas_vindas_video, confirmacao_consulta, confirmacao_de_agenda, depoimento_1, diadospaisoferta, disparo_antes_e_depois, duvida_site, duvida_site_cidade, mensagem_coringa, mensagem_de_saudacao, novo_disparoluv, novo_numero, pedido_avaliacao_site, pedido_avaliacao_unidade, protese, resgatar_leads, resgate, teste, video_drjoao. Os 4 de endereço já foram liberados.

## O que vou fazer
1. **Devolver os 24 modelos para SDR/CRC.** Eles voltam a aparecer para as meninas, como era no número antigo. Os 11 da pós-venda continuam da pós-venda.
2. **Corrigir a regra do dono do número.** SDR e CRC passam a contar como um grupo só, então o dono do Comercial 2 vira "SDR/CRC".
3. **A sincronização nunca mais usa o papel de quem clicou.** Se o sistema não souber quem é o dono, o modelo continua geral, visível para todos. Isso vale para o botão "Sincronizar" e para a sincronização automática.
4. **Testar como SDR (Bia):** a tela Modelos e o seletor do chat mostram "agendamento", "confirmacao_consulta" e "endereco_rizodent_itabuna". Depois sincronizar como LUV e conferir que nenhum modelo volta para "LUV Agency".

## Fora do escopo
- Nenhum modelo é apagado nem alterado na Meta.
- Os modelos do closer continuam só do closer.

## Detalhes técnicos
- `supabase/functions/_shared/wabaEscopo.ts` `papelDonoDoNumero`: mapear `sdr` para `crc` antes do distinct.
- `supabase/functions/manage-whatsapp-templates/index.ts` linhas 218-220 e 342: ao carimbar um modelo existente sem dono, usar só `papelDonoDoNumero`, sem cair em `callerPrimaryRole`. O fallback continua só para modelos criados agora por quem cria.
- Dados: `update crm_whatsapp_templates set owner_role='crc' where waba_id='893372606594069' and owner_role='superadmin'` (24 linhas).
- Deploy de `manage-whatsapp-templates` e `sync-whatsapp-templates-cron`, que importa o mesmo helper.

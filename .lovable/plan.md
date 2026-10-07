# Não criar pagamentos nem leads sem telefone

## Situação hoje
- Dos 26 leads que o sistema criou sozinho a partir de pagamentos, 17 estão sem telefone (Ingrid e Caique entre eles).

## O que vou fazer
1. **Pagamentos do Dontus:** se o paciente não tem telefone, a sincronização pula o pagamento. Ele não entra no CRM e fica anotado no resumo da sincronização como "sem telefone". Quando a recepção cadastrar o telefone no Dontus, ele entra na próxima sincronização.
2. **Lead automático:** a regra que cria lead a partir de pagamento só cria se tiver telefone. Sem telefone, não cria nada.
3. **Trava no banco:** nenhum lead novo é gravado sem telefone, venha de onde vier (pagamento, importação, cadastro à mão). Leads do Instagram ficam de fora dessa trava, porque chegam sem telefone por natureza.
4. **Limpeza dos 17 já criados:** vou te mostrar a lista antes. Os que já existem com telefone em outro lead (como a Ingrid) terão o pagamento passado para o lead certo. Depois apago os sem telefone, com cópia de segurança, e só com a sua aprovação.

## Detalhes técnicos
- `dontus-sync`: pular insert em `pagamentos` quando o paciente não tem telefone normalizado; contador `sem_telefone` no resultado.
- `ensure_lead_for_pagamento`: retornar cedo quando o paciente não tem telefone.
- Gatilho BEFORE INSERT em `crm_leads`: erro quando `phone` vazio e o lead não é de Instagram. Mantém `trg_normalize_lead_phone` intacto.
- Limpeza via run_sql com backup em `deleted_leads_backup`.

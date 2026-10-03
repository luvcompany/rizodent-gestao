# Barrar pagamentos de orto fora da regra e leads criados por eles

## Regra que já existe (confirmada)
- Regra do dia: ORTODONTIA só conta como venda se no mesmo dia houver início (PANOR / APARELHO). Senão é mensalidade (recorrencia_orto = verdadeiro).
- O gatilho que cria lead automático a partir de pagamento já ignora mensalidade de orto.

## Onde ainda vaza
- Pagamento lançado à mão (recepção/tela de Pagamentos) pode entrar como orto sem passar pela regra do dia.
- O gatilho que vincula paciente a lead por telefone não olha se é mensalidade de orto e dispara aviso.
- Leads já criados no passado a partir de pagamentos que hoje são só mensalidade de orto (encontrei 7 nos últimos 60 dias).

## O que vou fazer
1. **Trava no banco** para todo pagamento novo ou editado: se o procedimento é ortodontia, aplica a mesma regra do dia; mensalidade nunca vira venda, venha do sync ou de lançamento manual.
2. **Nenhum lead nem aviso** nasce de mensalidade de orto (vinculação por telefone também passa a ignorar).
3. **Limpeza do que já sujou**: listo os leads criados só por mensalidade de orto (sem conversa, sem agendamento) e te mostro antes de apagar, com cópia de segurança.
4. Corrijo pagamentos antigos que estão como venda mas, pela regra do dia, são mensalidade — também com cópia e lista antes.

## Detalhes técnicos
- Trigger BEFORE INSERT/UPDATE em pagamentos que recalcula recorrencia_orto pela regra do dia (mesmo paciente + data com item PANOR/APARELHO).
- auto_link_paciente_to_lead_on_pagamento: retorna cedo quando recorrencia_orto = true.
- ensure_lead_for_pagamento mantém a guarda atual; ordem dos gatilhos garantida para rodar após o recálculo.
- Limpeza via run_sql com tabelas _bkp_ e RLS ativado; nada de edge function alterada.

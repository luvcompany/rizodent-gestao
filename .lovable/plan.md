# Auditoria de leads duplicados

## O que já foi confirmado
- Caso da foto: "MARIA MAGNOLIA" foi criada em 02/10 com o telefone **5577991607037** (com o 9 extra), sem origem preenchida (cadastro manual/importação/agendamento). Em 03/10 ela mandou mensagem no WhatsApp, que chega sem o 9 (**557791607037**), e o sistema não reconheceu o lead existente: criou "Mag".
- Não existe nenhuma trava no banco de dados contra telefone duplicado nem normalização automática ao salvar. A regra de "tirar o 9" só funciona em algumas telas/entradas, então caminhos que não normalizam deixam passar.
- Hoje a RizoDent e demais clínicas têm **68 grupos de possíveis duplicados (137 leads)**, comparando os últimos 8 dígitos do telefone.

## O que vou fazer
1. **Listar todos os caminhos que criam lead** (novo lead manual, importação, agendamento, WhatsApp, Instagram, webhooks, pagamentos/Dontus) e mostrar quais não normalizam o telefone.
2. **Normalizar sempre ao salvar**: regra no banco que padroniza o telefone (55 + sem o 9) em toda criação e edição, independentemente de onde vier.
3. **Bloquear duplicado na mesma clínica**: ao criar um lead com telefone que já existe, o sistema reaproveita o lead existente (WhatsApp/webhooks) ou mostra o aviso de duplicado já existente (cadastro manual).
4. **Relatório dos 68 grupos** em planilha, com nome, telefone, etapa, responsável e conversas de cada um, para você decidir.
5. **Unir os duplicados só depois da sua aprovação**: mensagens, notas, tarefas, agendamentos e pagamentos vão para o lead mais antigo; o outro fica salvo em backup.

## Detalhes técnicos
- Trigger BEFORE INSERT/UPDATE em `crm_leads` com a função de normalização existente; checar índice único parcial por `(tenant_id, phone)` após a limpeza.
- `whatsapp-webhook` e demais funções: buscar lead por telefone normalizado (com e sem 9) antes de inserir.
- Merge via `run_sql` com backup em tabela `_bkp_leads_merge_<data>`.

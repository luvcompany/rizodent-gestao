Vou corrigir a lógica do Dashboard para que “Novos contratados” seja sempre baseado na mesma fonte da aba Pacientes: pagamentos registrados como `tipo = primeiro` dentro do período filtrado.

O que será ajustado:

1. Definir uma regra única para “Novos contratados”
   - Contar pacientes distintos com pagamento `primeiro` na data/período selecionado.
   - Não depender do status do agendamento no CRM.
   - Não excluir pacientes por vínculo com lead do CRM.
   - Exemplo esperado confirmado no banco:
     - 02/05/2026: 3 pacientes distintos com `primeiro pagamento`.
     - 30/04/2026: 6 pacientes distintos com `primeiro pagamento`.

2. Aplicar essa mesma regra em todos os pontos do Dashboard
   - Card “Novos contratados” em “CRM — Leads & Agendamentos”.
   - Funil “Conversão Total” no item “Contrataram”.
   - Qualquer cálculo de conversão que use contratados no período.
   - Textos explicativos, para ficar claro que recorrentes não entram e que a fonte é pagamento do tipo “primeiro”.

3. Corrigir a divergência entre os gráficos/funis
   - O funil de “Agendamentos” continuará mostrando agendamentos/comparecimentos/faltas pelo CRM.
   - O funil de “Conversão Total” mostrará contratos pela fonte financeira real: primeiro pagamento.
   - Onde aparecer “Contrataram” como indicador de clientes novos, ele usará a mesma contagem do pagamento `primeiro`.

4. Melhorar a consistência dos filtros
   - Manter filtro por período usando `data_pagamento` para novos contratados.
   - Manter filtro por clínica usando `clinica_id` do pagamento.
   - Se houver filtro de canal, aplicar a mesma restrição já usada pelo Dashboard para pagamentos/pacientes, sem mudar a regra principal.

5. Remover a lógica que causou o erro atual
   - Retirar a restrição que conta apenas pacientes vinculados ao CRM.
   - Retirar a comparação/ajuste com status `contracted` de agendamentos para “Novos contratados”.
   - Isso evita casos onde existem 3 primeiros pagamentos no financeiro, mas o dashboard mostra 1 ou 2 por causa de dados incompletos do CRM.

Resultado esperado:
- Dia 02/05: Dashboard mostra 3 novos contratados.
- Dia 30/04: Dashboard mostra 6 novos contratados.
- Os cards e o funil deixam de divergir quando estiverem falando de “contrataram/novos contratados”.
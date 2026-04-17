

## Problemas e Solução

### 1. Vinculação de paciente não está sendo salva
**Causa**: A política RLS de UPDATE em `crm_leads` exige que o usuário seja admin/gerente OU o `assigned_to` do lead. Como todos os 287 leads estão atribuídos ao usuário central "rizodent", qualquer atendente CRC tentando vincular falha silenciosamente (o `update()` retorna sem efeito).

**Fix**: Ampliar a política de UPDATE para permitir que qualquer usuário autenticado atualize leads (mantendo SELECT como está). Adicionar também tratamento de erro mais explícito no `linkPaciente`/`createAndLinkPaciente` mostrando a mensagem real do Supabase quando 0 linhas forem afetadas.

### 2. Auto-vincular leads existentes a pacientes pelo telefone
**Lógica**: Ao abrir um lead sem `paciente_id`, buscar automaticamente em `pacientes` usando assinatura dos últimos 8 dígitos do telefone (mesma lógica já usada no busca manual). Se houver match único → vincular automaticamente. Se houver múltiplos → apenas exibir lista para o usuário escolher.

**Onde**: `LeadBudgetPanel.tsx`, dentro do `useEffect` que dispara quando `lead.paciente_id` é nulo.

### 3. Faturamento do mês no CRM Kanban / Dashboard CRM = soma de `pagamentos` reais
**Comportamento atual**: O card "Vendas concluídas (mês)" no Kanban soma `lead.value` dos leads na etapa "Contratado" cujo `updated_at` é do mês atual. Isso é impreciso pois `lead.value` é estático e não reflete pagamentos reais por mês.

**Novo comportamento**:
- Buscar todos os leads com `paciente_id` não nulo.
- Buscar `pagamentos` (campos: `paciente_id`, `valor`, `data_pagamento`) cujo `data_pagamento` esteja no mês corrente (ou no range do filtro de data se aplicado).
- Somar apenas os pagamentos dos pacientes vinculados a leads visíveis (respeitando filtros de usuário).
- Exibir como "Faturamento do mês" no Kanban, substituindo a lógica baseada em `lead.value`.
- Ao virar o mês, o valor zera automaticamente porque a query filtra por `data_pagamento` do mês atual.

**Onde**: 
- `src/pages/CrmKanban.tsx`: refatorar o cálculo de `vendasConcluidas` para fazer fetch de `pagamentos` filtrados pelo mês e somar por `paciente_id` dos leads visíveis.
- `src/pages/CrmDashboard.tsx`: adicionar um KPI equivalente "Faturamento do mês" no topo, ao lado de "Leads Hoje".

### Arquivos a alterar
1. **Migração SQL**: ajustar política RLS UPDATE em `crm_leads`.
2. **`src/components/chat/LeadBudgetPanel.tsx`**: auto-vincular paciente por telefone + tratamento de erro robusto.
3. **`src/pages/CrmKanban.tsx`**: substituir lógica de "Vendas concluídas" por soma de `pagamentos` do mês via `paciente_id`.
4. **`src/pages/CrmDashboard.tsx`**: adicionar KPI "Faturamento do mês" usando a mesma lógica.

### Diagrama do novo cálculo

```text
Lead (CRM) ──paciente_id──> Paciente
                              │
                              └──> Pagamentos (filtrar data_pagamento no mês)
                                       │
                                       └─ SUM(valor) = Faturamento do mês
```


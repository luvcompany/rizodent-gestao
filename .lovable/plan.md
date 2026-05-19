## Diagnóstico do que aconteceu

### 1. Por que "sumiram leads" para o Rizodent
- Antes da troca, o Rizodent era `admin` e a policy de SELECT do `crm_leads` liberava todos os funis via `has_role(admin)`.
- Agora ele é `crc` puro. Como o funil Pós-venda tem `allowed_roles = {posvenda}`, `can_access_pipeline()` devolve `false` para o Rizodent nesse funil → **324 leads do Pós-venda ficaram invisíveis para ele**.
- Além disso, a aba Conversas só carrega no máximo **500 leads** (`CONVERSATION_INITIAL_LIMIT = 500` em `CrmConversas.tsx`). Antes ele "via 3000" no Kanban (que agrega por funil e tem paginação interna). Os ~400 que aparecem hoje em Conversas é o limite real da lista (ordenada por `last_message_at`), agravado pela perda do Pós-venda.
- Verifiquei o banco: nenhuma `user_permission_overrides` para o Rizodent foi criada. O passo de "overrides amplos" do plano anterior não chegou a executar (apenas o swap de role + ownership rodaram).

### 2. Por que o Funil Principal perdeu faturamento do mês
- O badge "Vendas concluídas (mês)" em `CrmKanban.tsx` é calculado **somente sobre os leads atualmente carregados no funil selecionado** (`leads` state, filtrado por `pipeline_id`).
- Ao migrar os leads "Contratado" para o funil Pós-venda, os pagamentos vinculados a esses pacientes deixaram de entrar na soma quando o usuário está olhando o Funil Principal.
- O Kanban do Pós-venda também não exibe nenhum total de faturamento hoje.

### 3. Lentidão geral
- Várias páginas (Kanban, Conversas, Dashboard) disparam múltiplas queries em paralelo logo no mount, algumas sem `limit` adequado (`messages` paginado de 1000 em 1000 para "ghost", `crm_followup_queue` sem filtro por tenant, recálculo de `vendasConcluidas` re-rodando a cada mudança em `leads`).
- `App.tsx` agora importa eagerly TODAS as páginas principais, o que melhora a transição entre abas mas aumenta o bundle inicial e o tempo até interatividade no primeiro load.
- Reativos: cada `setLeads` no realtime dispara o recalc completo de pagamentos do mês.

---

## Plano de correção

### A. Restaurar acesso total do Rizodent (sem reverter a função CRC)

1. Criar `user_permission_overrides(granted = true)` para o Rizodent (`d9b27aa3-049e-4ec9-9ae3-fb160a9544fa`) no escopo `pipeline` para **todos** os pipelines do tenant Rizodent — incluindo o Pós-venda (`c7fb4a30-…`). Isso devolve os 324 leads sem afrouxar o isolamento dos demais CRCs.
2. Criar overrides amplos de `granted = true` para os recursos administrativos que o plano anterior listou e que não foram aplicados (`page:*` para Usuários, Configurações, Integrações, Bots, Automações, Modelos, Respostas Rápidas, Relatórios, Dashboard, Pacientes, Tipos de procedimento, Registro Diário, Cadastro de Leads, Marketing, Atendimento).
3. Em `CrmConversas.tsx`, aumentar `CONVERSATION_INITIAL_LIMIT` de 500 para **2000** e implementar carregamento incremental em background (segunda página em `requestIdleCallback`) para não travar o primeiro render mas garantir que o Rizodent passe a enxergar todas as conversas ativas.

### B. Corrigir faturamento do mês no Kanban

1. Reescrever o effect `vendasConcluidas`/`leadMonthValueMap` em `CrmKanban.tsx` para **buscar pagamentos do mês por `tenant_id`**, e não restrito aos leads do funil corrente:
   - Carregar `pagamentos` do mês para o tenant (uma query única filtrada por `data_pagamento` no intervalo).
   - Somar tudo em `vendasConcluidas` global (independente do funil selecionado).
   - O mapa `leadMonthValueMap` (usado para mostrar valor por etapa) continua restrito aos leads visíveis no funil.
2. Resultado: o badge "Vendas concluídas (mês)" do Funil Principal volta a refletir o faturamento total da clínica no mês — incluindo leads que já foram para Pós-venda.
3. Adicionar o mesmo `MetricBadge` "Vendas concluídas (mês)" no Kanban do Pós-venda (mesma lógica de soma global por tenant).

### C. Ganhos de performance (baixo risco, sem reverter eager imports)

1. **Memoizar e debouncear o recálculo de `vendasConcluidas`**: depender de `leads.length` + `pipeline.id` em vez do array inteiro, e adicionar `AbortController` para evitar overlap quando o realtime dispara várias updates seguidas.
2. **Encolher queries pesadas**:
   - `crm_followup_queue` em `fetchData`: adicionar `.eq('tenant_id', tenant.id)`.
   - `messages` no filtro "ghost" (`CrmConversas`): hoje pagina sem fim — limitar a últimos 90 dias.
3. **React Query**: trocar os `useEffect`+`useState` da lista inicial de Conversas/Kanban por `useQuery` com `staleTime: 60_000`, para que voltar à aba não re-busque tudo do zero (o `QueryClient` já existe no `Providers`).
4. **Indexes**: rodar `supabase--linter` e adicionar índices ausentes em `crm_leads(tenant_id, last_message_at desc)`, `messages(lead_id, created_at desc)`, `pagamentos(paciente_id, data_pagamento)` se ainda não existirem (verificar antes de criar).
5. Não mexer no eager-loading do `App.tsx` (a troca de aba sem flash branco é prioridade do usuário). O custo é só no primeiro load.

### D. Validação

- Login como Rizodent → conferir que volta a ver leads do Pós-venda no Kanban + Conversas, e mantém acesso às páginas admin.
- Funil Principal → "Vendas concluídas (mês)" volta ao valor anterior à migração.
- Kanban Pós-venda → mostra "Vendas concluídas (mês)" com o total do tenant.
- Tempo de troca de aba continua instantâneo (sem Suspense fallback).
- Conversas: lista inicial maior, sem travar render.

---

## Arquivos a editar / ações

- `supabase--insert` — popular `user_permission_overrides` para Rizodent (pipelines + páginas admin).
- `src/pages/CrmKanban.tsx` — somar `pagamentos` do mês por tenant; refatorar effect.
- `src/pages/CrmPosVendaDashboard.tsx` (ou onde está o Kanban Pós-venda — confirmar antes) — adicionar badge de faturamento mensal.
- `src/pages/CrmConversas.tsx` — aumentar limite + carregamento incremental + filtros de queries pesadas.
- Migration SQL — índices ausentes (após confirmar com linter/pg_indexes).
- Sem alterações em `App.tsx`.

## Perguntas antes de implementar

Nenhuma — tenho o suficiente. Se preferir manter o limite de Conversas em 500 e oferecer "Carregar mais" em vez de subir para 2000, me avise no momento da aprovação.

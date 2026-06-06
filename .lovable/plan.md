## Diagnóstico

O banco está pequeno (4.3k leads, 76k mensagens, 7k execuções de bot) e os índices principais existem. A lentidão vem do **frontend**:

- **Conversas**: o ajuste anterior carrega até 20.000 leads em memória, em 20 páginas sequenciais de 1.000 — a tela trava antes mesmo de renderizar.
- **Kanban**: busca todos os leads do funil sem janelamento.
- **Dashboard**: faz várias contagens no cliente em vez de uma RPC agregada.
- **Falta de cache**: cada navegação refaz as mesmas queries (não há React Query com `staleTime`/`gcTime` configurado por tela).
- **Sem virtualização**: listas longas renderizam 1k+ DOM nodes.
- **Realtime mal escopado**: subscriptions reescutam tudo e re-renderizam a árvore inteira.

## O que vou fazer (na ordem)

### 1. Conversas (CrmConversas) — o pior gargalo
- Voltar para **paginação no servidor de verdade**: 50 conversas por vez, ordenadas por `last_message_at desc`, com "carregar mais" (infinite query do React Query).
- Lista virtualizada com `@tanstack/react-virtual` — renderiza só o que está na tela.
- A contagem por etapa/funil que hoje força carregar tudo passa a vir de uma **RPC `crm_conversation_counts`** que devolve `{stage_id, total}` numa única chamada.
- Filtro de busca por nome/telefone usa a RPC `search_crm_leads` no servidor (não filtra array em memória).
- React Query com `staleTime: 30s` + `placeholderData: keepPreviousData` para troca de filtro sem flicker.

### 2. Kanban (CrmKanban)
- Cada coluna carrega só os **primeiros 30 leads** (com índice já existente `idx_crm_leads_pipeline_blocked_position`); restante via "carregar mais" por coluna.
- Contagem total da coluna vem de RPC agregada (não de `count` no client).
- Virtualização vertical por coluna.
- Cache compartilhado com Conversas via mesma query key.

### 3. Dashboard (CrmDashboard)
- Substituir as ~6 queries paralelas do cliente por **uma única RPC `crm_dashboard_metrics(date_from, date_to, user_id)`** que devolve todos os KPIs e séries em um único JSONB.
- Cache de 60s — o dashboard não precisa ser tempo real.
- Skeleton só na primeira carga; trocas de filtro usam `keepPreviousData`.

### 4. Cache e prefetch global
- Configurar `QueryClient` com defaults sensatos: `staleTime: 30_000`, `gcTime: 5min`, `refetchOnWindowFocus: false`.
- **Prefetch on hover** nos links da sidebar (Dashboard, Conversas, Kanban) — quando o usuário passa o mouse, a próxima tela já começa a buscar.
- Prefetch da lista de Conversas no login (vem pronta quando o usuário clica).

### 5. Realtime mais leve
- Escutar apenas eventos relevantes (filtro no canal) e usar `queryClient.setQueryData` para patch incremental em vez de invalidar a query inteira (que dispara refetch).

### 6. Bundle e render
- Habilitar `React.memo` nos itens de lista (ConversationListItem, KanbanCard).
- Garantir que `index.css` não está disparando re-layout em troca de tema.

## O que NÃO vou mexer

- Nenhuma regra de negócio, RLS, esquema de tabelas existentes (só adiciono as 3 RPCs novas).
- Nenhuma lógica de bot, follow-up, automações, webhooks.
- Estilos visuais permanecem iguais.

## Resultado esperado

- Conversas e Kanban abrem em **< 300ms** depois do primeiro acesso (cache); primeira carga em ~600ms.
- Dashboard abre em **< 500ms** com 1 só roundtrip ao banco.
- Trocar de aba não mostra mais "Carregando..." na maioria dos casos — usa cache + skeleton só quando realmente vazio.

## Migrations necessárias (3 RPCs `SECURITY DEFINER`)

1. `crm_conversation_counts(_filter jsonb)` → contagens por etapa/funil/canal.
2. `crm_dashboard_metrics(_from date, _to date, _user_id uuid)` → JSONB com todos os KPIs.
3. `search_crm_leads(_q text, _limit int, _offset int)` → busca paginada por nome/telefone.

Todas respeitam `current_tenant_id()` e as roles existentes (crc/gerente/superadmin/posvenda).

---

Posso começar? É uma sequência grande (provavelmente 4-5 mensagens entre migration + ajustes de cada tela). Se preferir, eu ataco primeiro **só a tela de Conversas** (que é o pior gargalo) e te mostro o ganho antes de seguir para Kanban e Dashboard.
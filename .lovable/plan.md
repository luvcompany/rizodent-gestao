## Objetivo
Deixar a tela de Conversas (lista + chat + painel lateral) abrir e rolar de forma fluida mesmo em internet fraca, sem alterar nenhuma regra de negócio.

## Diagnóstico
1. **Payload inicial gigante**: `fetchAllConversationLeads` baixa até 6.000 leads × ~30 colunas em páginas sequenciais de 1.000 (vários MB). Tudo isso *antes* de mostrar a primeira linha.
2. **Colunas demais no SELECT**: a lista usa só ~12 campos, mas o SELECT puxa também `titulo_anuncio`, `descricao_anuncio`, `link_anuncio`, `imagem_origem`, `ad_account_*`, `notes`, `value`, etc. — só usados no painel de detalhes.
3. **localStorage pesado**: serializar 6k leads em JSON trava a thread principal em celulares fracos.
4. **Sem virtualização**: a lista usa `slice(0, visibleCount)` + botão "Ver mais"; ao crescer, o DOM fica grande e o scroll engasga.
5. **Hook do chat (`useChatConversation`)**: além do realtime, mantém um **polling de 30s por lead aberto** e dispara `batchSignMediaUrls` para o histórico inteiro logo no `open` — duas chamadas extras desnecessárias em rede fraca.
6. **Painéis laterais montam cedo**: vários `lazy()` (TaskPanel, LeadBudgetPanel, LeadStageTimeline, LeadFollowUpPanel, etc.) entram no bundle inicial do leadOpen mesmo quando o usuário não abre o painel direito (no mobile, por exemplo).

## Mudanças

### 1. Enxugar a query da lista
Em `CrmConversas.tsx` e `CrmConversa.tsx`:
- Criar `LEAD_LIST_COLS` reduzido (id, name, phone, instagram_user_id, instagram_username, instagram_profile_pic_url, last_message, last_message_at, last_inbound_at, last_outbound_at, tags, source, stage_id, pipeline_id, assigned_to, paciente_id, cidade, servico_interesse).
- Manter `LEAD_SELECT_COLS` completo apenas para a query do lead selecionado (um SELECT pequeno por lead aberto), populando os campos extras em `selectedLead`.

Redução esperada: ~55–65% no tamanho de cada página.

### 2. First paint em 1 round-trip
- Mostrar a UI assim que a **primeira página (1.000 leads recentes)** chegar — `setLeads` + `setLoading(false)` imediatamente.
- Continuar buscando as páginas seguintes em background (`requestIdleCallback` quando disponível) e mesclar via `sortLeadsByLastActivity`.
- A busca server-side já cobre leads antigos ainda não carregados, então a UX não regride.

### 3. Persistência mais barata
- Gravar no `localStorage` somente os **primeiros 500 leads** (suficientes para o paint inicial offline) e adiar a gravação com `requestIdleCallback` / `setTimeout(0)`.
- Em runtime, manter o array completo só na memória.

### 4. Virtualizar a lista de conversas
- Instalar `@tanstack/react-virtual` e substituir o `visibleLeads.map(...)` por uma lista virtualizada (altura fixa de item). Remover o botão "Ver mais 50".
- Mantém DOM constante (~15-25 nós) independente da quantidade de leads → scroll fluido no celular.

### 5. Hook do chat mais leve (`useChatConversation.ts`)
- Remover o `setInterval` de 30s quando o canal realtime estiver `SUBSCRIBED`; reativar apenas se o subscribe falhar (`CHANNEL_ERROR`/`TIMED_OUT`).
- Não chamar `batchSignMediaUrls` para o histórico inteiro no open: deixar cada `ChatMessageContent` assinar sob demanda (já existe `useSignedUrl`). Isso economiza 1 chamada grande por lead aberto.
- Pular o refetch em background quando o cache tem menos de 30s.
- Adiar `repair-chat-media` de 3s para 8s e só executar se a aba estiver visível (`document.visibilityState === "visible"`).

### 6. Gating dos painéis laterais
- Só montar `LeadCustomFields`, `LeadStageTimeline`, `LeadResponseTimes`, `LeadBudgetPanel`, `TaskPanel`, `LeadFollowUpPanel`, `LeadAiAssistPanel` quando `effRightVisible === true`. No mobile, isso evita carregar tudo só por abrir uma conversa.

### 7. Índices de apoio (migration)
- Garantir `CREATE INDEX IF NOT EXISTS crm_leads_tenant_lastmsg_idx ON crm_leads (tenant_id, is_blocked, last_message_at DESC NULLS LAST);`
- Para a busca por conteúdo de mensagem: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX IF NOT EXISTS messages_content_trgm_idx ON messages USING gin (content gin_trgm_ops);` — torna o `ilike '%termo%'` rápido em vez de full scan.

## Arquivos tocados
- `src/pages/CrmConversas.tsx`
- `src/pages/CrmConversa.tsx`
- `src/hooks/useChatConversation.ts`
- `package.json` (+ `@tanstack/react-virtual`)
- 1 migration de índices

## Fora do escopo (não muda)
- Nenhuma regra de negócio, RLS, filtros, automações, layout visual, ordenação ou comportamento de busca.
- Nenhuma alteração no Kanban ou nos Relatórios.

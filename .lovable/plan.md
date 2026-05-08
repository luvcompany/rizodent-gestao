## Diagnóstico

Auditei `src/pages/CrmRelatorios.tsx` (Visão Geral + Ações por Dia + Antecedência) e `src/components/relatorios/OrigemConversaoTab.tsx`. Os "números menores que o real" têm 3 causas reais, todas reproduzíveis em qualquer funil/período:

### 🔴 Causa #1 — Limite de 1000 do Supabase em quase todas as queries

Na **Visão Geral** (`CrmRelatorios.tsx`):

- **L107** `crm_leads` é buscado **sem paginação** → no funil Principal (que tem milhares de leads), só carrega os primeiros 1000. Como `cohort = leads.filter(inRange)`, se os 1000 mais recentes não cobrem o período, faltam leads no funil, na agenda, em cidades, em fantasmas, em tempo até contratação — em tudo.
- **L120-121** `crm_lead_stage_history` e `crm_appointments` rodam em chunks de 500 leads, mas dentro de cada chunk não tem paginação interna. Um chunk de 500 leads facilmente gera >1000 linhas de histórico → entradas em etapas perdidas.
- **L126** `messages` idem — sem paginação interna por chunk.

Em **OrigemConversaoTab** o `messages` já tem paginação interna por chunk, mas `crm_appointments` e `pagamentos` ainda usam `.in()` sem range.

### 🟠 Causa #2 — `lastStage` é "última posição", não "Contratado"

**L152** `lastStage = stages[stages.length - 1]`. Se o funil tem etapas pós-contratação (ex.: "Pós-venda", "Arquivo", "Desqualificado"), o relatório **Tempo até Contratação** mede até a etapa errada e mostra `count: 0` em quase todos os períodos. Deveria detectar a etapa "Contratado" via `isContratStage`.

### 🟠 Causa #3 — Agenda só olha etapa atual, ignora histórico

**L164-177** classifica `compareceram/remarcaram/faltaram` apenas pela `stage_id` **atual** do lead. Lead que passou por "Compareceu" e foi para "Contratado" cai apenas em compareceram (OK pela regex), mas:
- Lead que passou por "Reagendado" e voltou para "Agendado" não conta como remarcou.
- Lead que faltou e foi movido para "Recuperação" some da contagem de faltaram.

O correto é cruzar com `crm_lead_stage_history` (entradas no período) para contar quem **já passou** por cada etapa.

### 🟡 Outros pontos menores

- **L149** `cohort = leads.filter(inRange(created_at))` — depois de truncar em 1000. Filtrar por `created_at` no servidor reduz o universo e elimina o problema do limite.
- **L329** `fantasmas` exige `first_inbound_at === last_inbound_at` (string compare) — frágil; melhor comparar timestamps.
- **OrigemConversaoTab L139** `funnel.scheduled = leadIdsWithAppt.size` (leads com agendamento), enquanto a label diz "agendados". OK semanticamente, só confirmar.

---

## Correções

### 1. `src/pages/CrmRelatorios.tsx`

**a) Helper de paginação universal** (no topo do arquivo):
```ts
async function fetchAllPages<T>(query: (from: number, to: number) => Promise<{ data: T[] | null }>): Promise<T[]> {
  const PAGE = 1000; const out: T[] = []; let from = 0;
  while (true) {
    const { data } = await query(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
```

**b) `crm_leads` filtrado por período E paginado** (L107). Carrega leads com `created_at` no range OU com atividade no range (`last_inbound_at`/`last_outbound_at` no range), para que os blocos "inativos", "tempo de resposta" continuem corretos com leads antigos relevantes. Estratégia mais simples e segura: duas queries paginadas (cohort do período + leads com qualquer atividade no período) e merge por id.

**c) Paginação interna nos chunks** (L117-132): para cada chunk de 500 leads, paginar `crm_lead_stage_history`, `crm_appointments` e `messages` com `range()` até esgotar.

**d) `lastStage` correto** (L152):
```ts
const contratStage = useMemo(() => stages.find(s => isContratStage(s.name)) ?? stages[stages.length - 1], [stages]);
```
Usar `contratStage` em `tempoContratacao` e na descrição "até chegar em **{nome}**".

**e) Agenda baseada em histórico** (L164): em vez de ler `stage_id` atual, montar `Set<lead_id>` para cada categoria a partir de `history` filtrado pelo período (`entered_at` no range), olhando o nome da `stage_id` correspondente. Mantém compatibilidade com leads que já avançaram.

**f) `fantasmas`**: comparar timestamps (`Date(...).getTime()`).

### 2. `src/components/relatorios/OrigemConversaoTab.tsx`

- Substituir o loop `crm_leads` (já tem paginação) por chamada ao mesmo helper.
- Adicionar paginação interna em `crm_appointments` e `pagamentos` por chunk.

### 3. Sub-aba "Ações por Dia" (`AcoesPorDiaTab`)

Já tem paginação correta — auditar só se o `leadIds` coletado mas nunca usado deve realmente sumir (já é morto). Remover o bloco morto para clareza.

### 4. Sub-aba "Antecedência" (`distribAgendamento`)

Depende do `appointments` carregado na Visão Geral — já corrigido pelo item 1c.

---

## Validação

Após o fix, vou rodar SQL de sanidade comparando:

- `SELECT count(*) FROM crm_leads WHERE pipeline_id=X AND created_at BETWEEN ...` vs número da coorte na tela.
- `SELECT count(*) FROM crm_appointments WHERE lead_id IN (...) AND created_at BETWEEN ...` vs total de agendamentos por cidade.
- `SELECT lead_id, stage_id, name FROM crm_lead_stage_history JOIN crm_stages WHERE entered_at BETWEEN ... AND name ILIKE '%compar%'` vs "Compareceram".

Relatório com os deltas antes/depois no chat.

---

## Escopo NÃO incluído

- Mudanças visuais / novos KPIs.
- Reescrita do "Origem & Conversão" (apenas paginação).
- Aba "Ações por Dia" — só remoção de código morto, sem mudar cálculo.
- Página `Relatorios.tsx` (clínica) — não foi mencionada como problemática; posso incluir se quiser.

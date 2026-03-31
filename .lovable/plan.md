

# Auditoria do CRM - Problemas e Melhorias

## Problemas Encontrados

### 1. Painéis laterais das duas telas de conversa estão diferentes
O painel direito do **CrmConversa** (Kanban) e do **CrmConversas** (lista) possuem componentes e ordem diferentes:

| Componente | CrmConversa (Kanban) | CrmConversas (Lista) |
|---|---|---|
| LeadEditPanel | Sim | Sim |
| Etapa do Funil | Sim | Sim |
| InlineTagsEditor | Sim | Sim |
| **LeadAdInfo** | **Posição: após tags** | **Posição: após custom fields** |
| LeadBudgetPanel | Sim | Sim |
| LeadResponseTimes | Sim | Sim |
| LeadStageTimeline | Sim | Sim |
| LeadCustomFields | Sim | Sim |
| **LeadAutomationPanel** | **Sim** | **Ausente** |
| **LeadFollowUpPanel** | **Sim** | **Ausente** |
| **TaskPanel** | **Ausente** | **Sim** |
| **nomeAnuncio no LeadAdInfo** | **Sim (passado)** | **Ausente (não passado)** |

**Ação:** Equalizar os painéis - ambos devem ter os mesmos componentes, na mesma ordem, com as mesmas props.

### 2. CrmConversas não busca campos de anúncio do banco
A query de leads em `CrmConversas` (linha 80) seleciona campos específicos mas não inclui `imagem_origem`, `titulo_anuncio`, `descricao_anuncio`, `link_anuncio`, `ad_id`, `nome_anuncio`. Os dados do anúncio nunca chegam ao componente.

**Ação:** Adicionar os campos de anúncio na query SELECT e no tipo `LeadConversation`.

### 3. Scroll para última mensagem pode falhar em conversas longas
O `useEffect` atual usa `requestAnimationFrame` uma única vez, mas em conversas com muitas mensagens, o DOM pode não ter renderizado todos os elementos ainda. Pode ser necessário um `setTimeout` adicional ou uso de `MutationObserver`.

**Ação:** Adicionar um fallback com `setTimeout` de ~100ms após o `requestAnimationFrame` para garantir o scroll.

### 4. Bug no CrmConversa: uso incorreto de `useState` como efeito
Linha 63 do `CrmConversa.tsx` usa `useState(() => { ... })` como se fosse `useEffect`. Isso executa a fetch durante a inicialização do state mas não é reativo a mudanças de `id`. Se o usuário navegar entre leads, o lead não atualiza.

**Ação:** Converter para `useEffect` com dependência em `id`.

### 5. Kanban drag-and-drop não registra histórico de etapa
No `CrmKanban.tsx`, o `handleDragEnd` atualiza o `stage_id` no banco mas não insere entrada em `crm_lead_stage_history` nem cria mensagem de sistema, diferente do `handleStageChange` no hook unificado.

**Ação:** Usar a mesma lógica do hook `useChatConversation.handleStageChange` ou chamá-lo diretamente.

### 6. Origem duplicada no cadastro de novo lead
O select de origem no formulário de novo lead (Kanban) não inclui `facebook_ad` e `instagram_ad` como opções, apenas "facebook" e "instagram" genéricos. Isso gera inconsistência com leads vindos do webhook.

**Ação:** Adicionar `facebook_ad` e `instagram_ad` às opções de origem.

## Melhorias Sugeridas

### 7. Indicador de "sem resposta" na lista de conversas
A lista de conversas (`CrmConversas`) não tem indicador visual claro de quais conversas aguardam resposta (como o badge do menu lateral). Adicionar um ponto/badge vermelho nos itens da lista.

### 8. Realtime no Kanban
O Kanban não tem subscription realtime - se outro usuário mover um lead ou se uma mensagem chegar, o board não atualiza automaticamente.

### 9. Polling no hook `useChatConversation` é pesado
O polling a cada 5 segundos faz uma query completa de todas as mensagens do lead. Para conversas com centenas de mensagens, isso gera tráfego desnecessário. Poderia filtrar apenas mensagens após o último `created_at` conhecido.

---

## Plano de Implementação (Priorizado)

### Passo 1 — Corrigir bug do useState no CrmConversa
Substituir `useState(() => { fetch... })` por `useEffect` com dependência em `id`.

### Passo 2 — Equalizar painéis laterais
Definir uma ordem padrão de componentes e aplicar identicamente em ambas as telas:
1. LeadEditPanel
2. Etapa do Funil
3. InlineTagsEditor
4. LeadAdInfo (com `nomeAnuncio`)
5. LeadBudgetPanel
6. TaskPanel
7. LeadResponseTimes
8. LeadStageTimeline
9. LeadCustomFields
10. LeadAutomationPanel
11. LeadFollowUpPanel
12. Notas

### Passo 3 — Corrigir query de anúncios no CrmConversas
Adicionar campos `imagem_origem, titulo_anuncio, descricao_anuncio, link_anuncio, ad_id, nome_anuncio` na query e passar `nomeAnuncio` ao `LeadAdInfo`.

### Passo 4 — Corrigir drag-and-drop do Kanban
Adicionar registro de histórico de etapa e mensagem de sistema ao mover leads via drag-and-drop.

### Passo 5 — Melhorar scroll para última mensagem
Adicionar fallback com `setTimeout` para garantir scroll em conversas longas.

### Passo 6 — Adicionar origens facebook_ad/instagram_ad no formulário
Incluir as opções de origem de anúncio no select de criação de lead.

### Passo 7 — Badge de "sem resposta" na lista de conversas
Adicionar indicador visual (ponto vermelho) nos itens da lista que aguardam resposta.


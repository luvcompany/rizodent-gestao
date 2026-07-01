## Ajustes na Edge Function `generate-reply-suggestion`

Somente backend (`supabase/functions/generate-reply-suggestion/index.ts`), sem tocar UI.

### 1. Enviar TODA a conversa (não só as últimas 60)
- Remover o `limit(60)`.
- Paginar `messages` do lead em blocos de 1000 (mesmo padrão já usado em `ai-conversation-assist`) até puxar tudo, em ordem cronológica.
- Guarda de custo: se o total ultrapassar ~400 mensagens, manter as **50 primeiras** (para preservar contexto inicial: primeira dor, origem, promessas iniciais) + **todas as últimas 350**, com um marcador `[... N mensagens antigas omitidas ...]` no meio. Assim mesmo conversas gigantes cabem no prompt sem estourar contexto.

### 2. Incluir data/hora em cada mensagem
- Ao montar o histórico enviado ao modelo, prefixar cada linha com timestamp local (America/Bahia, UTC-3) no formato `[dd/MM HH:mm]`.
- Como a AI SDK espera `role`+`content`, o timestamp entra dentro do `content` (ex.: `[27/06 15:28] Boa tarde, retornaremos as atividades somente amanhã`).
- Adicionar no system prompt uma diretriz curta: *"Cada mensagem do histórico vem prefixada com `[dia/mês hh:mm]` no fuso America/Bahia. Use isso para respeitar continuidade temporal (não retomar assunto já resolvido; se a última interação foi há muito tempo, reengaje com naturalidade)."*

### 3. Contexto que já estava faltando (mantido do plano anterior)
- Puxar `crm_conversation_notes` do lead e:
  - Injetar cada nota, ancorada por `after_message_id`, como linha `[NOTA INTERNA — não enviar ao cliente] <texto>` logo após a mensagem correspondente no histórico.
  - Notas sem âncora (ex.: observação fixada tipo *"JA É PACIENTE E DESEJA FAZER MANUTENÇÃO"*) entram em bloco próprio nos FATOS: `=== ANOTAÇÕES DA EQUIPE ===`.
- Puxar `crm_lead_stage_history` (últimas 5) e listar nos FATOS: `Etapa X → Y em dd/MM HH:mm`.
- Promover `lead.notes` para bloco próprio `=== OBSERVAÇÃO DO LEAD ===` acima dos FATOS.
- Reforçar regra "RESPEITAR O COMBINADO": se a etapa atual é desfecho (Desqualificado / Ganho / Compareceu / etc.), não retomar fluxo de agendamento do zero.

### Não vou mexer
- `AiSuggestionStrip.tsx`, modelo, RAG, aprendizado, `send-whatsapp-message`, tabelas.

### Validação
Após publicar, disparar `generate-reply-suggestion` para a "cristal" (557381824640) e conferir se:
- A sugestão referencia a observação "já é paciente e quer manutenção".
- A sugestão respeita que a equipe já mandou o telefone da recepção (73 9841-7725).
- Não sugere retomar agendamento — a etapa é *Desqualificado*.

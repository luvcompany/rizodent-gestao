
## Diagnóstico — falhas e comportamentos suspeitos encontrados

Investiguei os logs das edge functions (bot-engine, automation-engine, send-whatsapp-message, whatsapp-webhook, followup-engine, instagram-webhook), o estado do banco (filas, executions, tasks) e o lead Vitor Santos (`0c04e03a-…`, etapa atual: `Desqualificado`, source `whatsapp`, sem ad_id).

### 🔴 P0 — Rate limit em loop no automation-engine (CRÍTICO, ativo agora)

**Sintoma:** o cron do `automation-engine` está derramando dezenas de erros por minuto:
```
[AUTOMATION-ENGINE] Bot timeout error for <exec_id>: Rate limit exceeded
for trace ... Retry after ~45000ms.
```

**Causa raiz:**
1. A query em `automation-engine/index.ts:161-167` pega até **50 execuções com `timeout_at` vencido** por rodada.
2. Linhas 169-191 fazem `await fetch` sequencial para `/bot-engine` para cada uma — sem espaçamento, sem retry, sem marcar como processada antes de chamar.
3. O gateway de Edge Functions rate-limita as chamadas seguidas ao mesmo trace → falha → execução continua com `status='waiting_reply'` e `timeout_at` vencido → no próximo cron volta a entrar no batch. Loop infinito.
4. Resultado atual: **65 bot_executions travadas** (34 no bot "Follow - UP", 9 no "Disparo mães"), refazendo o batch a cada minuto.

### 🟠 P1 — Tasks vencidas há mais de 1 dia ainda `pending`
27 tarefas com `due_date` há mais de 24h e `status='pending'`. Pode ser intencional (CRC ainda vai concluir) ou indicar que o auto-close pelo `appointmentOutcome` não está rodando para alguns fluxos. Precisa amostragem.

### 🟡 P2 — Bot "Follow - UP" com timeouts sem caminho definido
Logs mostram repetidamente:
```
[bot-engine] Timeout fired for node send_text-1777992099191
but no timeout edge found, completing
```
O nó não tem aresta de `timeout` ligada, então o bot termina silenciosamente — o que é correto comportamentalmente, mas indica que o fluxo do bot está incompleto.

### 🟡 P3 — Pendências menores
- `automation-engine` chama `bot-engine` por HTTP cru com header `Authorization: Bearer ${serviceKey}`. Funciona, mas adiciona latência e não tem timeout de fetch — se o bot-engine demora, o batch inteiro empaca.
- Não há **deduplicação** entre rodadas: se a fila do minuto N não termina antes do cron N+1 disparar, ambos competem.

### ⚪ Lead Vitor Santos — pré-checagem
- Etapa: `Desqualificado` (não bate em nenhum gatilho de "Novo Lead" / "Anúncio").
- Última inbound: 06/05; última outbound: 06/05.
- Sem bot ativo, sem follow-up agendado, sem task pendente.
- Para testar ponta a ponta, vou movê-lo temporariamente para etapas com gatilhos e reverter no final.

---

## Plano de correção e validação

### Passo 1 — Resolver o loop de rate limit (`automation-engine`)
- Reduzir `limit(50)` para `limit(10)` no batch de bot timeout.
- Trocar o `for ... await fetch` sequencial por `Promise.allSettled` em **chunks de 3** com `await sleep(300ms)` entre chunks.
- Antes de invocar o bot-engine, **marcar a execução** como `processing` (campo `current_node_id = '__processing__'` ou novo flag) para não voltar ao batch no mesmo minuto.
- Adicionar `AbortSignal.timeout(15_000)` no fetch para nunca empacar o cron.
- Em caso de erro 429, **não** tentar de novo na mesma rodada — agendar para o próximo cron e logar.

### Passo 2 — Limpar as 65 execuções travadas
Migration `UPDATE bot_executions SET status='completed', completed_at=now(), timeout_at=NULL WHERE status IN ('active','waiting_reply') AND timeout_at < now() - interval '10 min'` para destravar o estado atual em uma única operação (sem chamar bot-engine).

### Passo 3 — Auditoria das tasks `pending` vencidas
Listar as 27, verificar se têm appointment vinculado com result já preenchido. Se sim, fechar via `auto_confirm_appointments_on_contracted` ou trigger equivalente. Se não, deixar como está (responsabilidade do CRC).

### Passo 4 — Testar ponta a ponta no Vitor Santos
1. Mover Vitor para a etapa **"Conversando"** → validar que automações `on_enter` rodam, mensagem do sistema aparece, follow-up é enfileirado.
2. Disparar manualmente um **template** via `send-whatsapp-message` para confirmar que envio real funciona (ele vai receber no WhatsApp).
3. Disparar manualmente o **bot-engine** com um botId publicado para confirmar execução, salvamento em `bot_executions` e timeout.
4. Mover Vitor para **"Novo Lead"** simulando origem `Anúncio` → validar gatilho `send_audio` que vinha falhando antes.
5. Limpar: voltar para `Desqualificado`, cancelar quaisquer execuções/follow-ups gerados pelo teste.
6. Reportar cada teste com ✅/❌ e link para a mensagem/registro criado.

### Passo 5 — Varredura final
Após corrigir o P0, esperar 2 minutos e re-checar:
- `bot_executions` travadas → deve estar 0.
- `crm_automation_queue` com `status='failed'` → deve ser 0.
- Logs do `automation-engine` sem `Rate limit`.

---

## Detalhes técnicos

**Arquivos a editar:**
- `supabase/functions/automation-engine/index.ts` (linhas ~161-191): batch + chunking + abort.
- Nova migration SQL para destravar bot_executions órfãs.

**Sem mudança de UI nesta passagem** — todas as correções são em edge functions e migration. Caso o teste no Vitor revele algo no front (ex: o painel do bot não atualiza após `cancelled`), abrirei follow-up.

**Riscos:**
- Mover o Vitor entre etapas vai gerar mensagens de sistema e potencialmente disparar automações reais (ex: enviar áudio). Você autorizou envios reais.
- A migration de cleanup das 65 executions é one-shot e idempotente; não afeta executions ativas legítimas.

Pronto para implementar quando você aprovar.

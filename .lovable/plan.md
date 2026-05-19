## Diagnóstico do template "boas_vindas"

### O que já confirmamos
- O template foi gravado no banco com `meta_template_id = 1766592678081514` e `status = PENDING`.
- A WABA conectada na integração é `893372606594069`.
- A Meta só retorna `meta_template_id` quando aceita a submissão; se ela tivesse rejeitado, voltaria erro e nada seria salvo.
- Logs recentes da função `manage-whatsapp-templates` já rotacionaram (não temos mais o request/response detalhado dessa criação específica).

### Hipóteses para o template "não aparecer" na Meta
1. Você está olhando uma WABA diferente no Business Manager (não a `893372606594069`).
2. Está filtrando apenas "Aprovados" — pendentes ficam em outra aba.
3. A Meta aceitou mas rejeitou logo em seguida por política (acontece em UTILITY mal-categorizado), e nosso banco ficou desatualizado porque ninguém clicou em "Sincronizar".
4. O token usado pertence a outra WABA que apenas tem `permissão` sobre a `893372606594069` — o template então aparece sob a WABA "dona" do token.

### Plano de execução

**Passo 1 — Validar com a Meta (read-only)**
- Disparar o `action: "list"` da edge function `manage-whatsapp-templates` e verificar se `boas_vindas` consta na resposta da Meta.
- Comparar `waba_id` retornado nos templates vs. o `893372606594069` da integração.

**Passo 2 — Sincronizar banco com Meta**
- O "list" já faz isso automaticamente: atualiza status (PENDING → APPROVED/REJECTED) e remove do banco templates que sumiram na Meta.
- Após sincronizar, a UI vai refletir a verdade da Meta.

**Passo 3 — Melhorar a edge function `manage-whatsapp-templates`**
- Adicionar logs persistentes em uma tabela `whatsapp_template_logs` (request payload, response Meta, http status, timestamp) toda vez que um `create` for executado, para não depender de logs voláteis da edge function.
- Retornar no response do `create` o `waba_id` usado, para a UI exibir junto do toast de sucesso ("Template enviado à WABA xxx").

**Passo 4 — Melhorias de UX em `CrmModelos.tsx`**
- Exibir tooltip claro nos status: `PENDING = "Em análise pela Meta (pode levar até 24h)"`, `REJECTED = motivo da Meta`.
- Botão "Sincronizar com Meta" mais visível e com indicação de última sincronização.
- Após criar um template, disparar `list` automaticamente em 5s para já refletir possíveis rejeições rápidas.

**Passo 5 — Recriar `boas_vindas` se a Meta confirmar que não existe**
- Se o "list" do Passo 1 retornar que o template não está na WABA: deletar localmente e refazer o `create`, agora com os logs persistentes do Passo 3 capturando exatamente o que aconteceu.

### Arquivos afetados
- `supabase/functions/manage-whatsapp-templates/index.ts` — adicionar logs persistentes + retornar `waba_id` no response.
- `src/pages/CrmModelos.tsx` — tooltip de status, botão sincronizar destacado, auto-resync pós-create.
- Nova migration: tabela `whatsapp_template_logs` (id, action, payload, response, http_status, user_id, created_at, RLS por tenant).

### Detalhes técnicos
- Tabela `whatsapp_template_logs`: usar `gen_random_uuid()`, `tenant_id` herdado via `set_tenant_id_default()` trigger, RLS permitindo SELECT a crc/gerente/superadmin do mesmo tenant.
- A função vai gravar 2 linhas por `create`: uma `request` (antes do fetch) e uma `response` (depois), garantindo trace mesmo se o fetch falhar.

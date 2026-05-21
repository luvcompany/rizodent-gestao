## Causa raiz

A tabela `crm_leads` não tem nenhum índice único em `(tenant_id, phone)`. O `whatsapp-webhook` (e o `generic-lead-webhook`) procura o lead por `tenant_id + phone` com `.maybeSingle()`. Quando esse SELECT retorna mais de uma linha, o `maybeSingle()` **falha** e devolve `lead = null` → o webhook cria mais um lead. A partir do momento em que existem 2 duplicatas, cada nova mensagem cria mais uma, formando o efeito cascata observado.

Como surgiu a primeira duplicata: corrida entre dois webhooks chegando quase simultaneamente (ou um lead já existir no banco vindo de importação/cadastro manual e o webhook não conseguir achar exatamente o mesmo `phone` — confirmado pela duplicata `(77) 99155-201` com formato diferente). Sem unique index, nada impede a segunda inserção.

Caso `557381751038` (tenant Rizodent): 17 leads duplicados. Existem também 11 outros telefones com 2–6 duplicatas no mesmo tenant.

## O que vai ser feito

### 1) Mesclar duplicatas existentes (one-off, via migration)

Para cada grupo `(tenant_id, phone)` com mais de um lead:

- Eleger o lead "canônico" = o mais antigo (`MIN(created_at)`).
- Reapontar todas as FKs `lead_id` das tabelas dependentes para o canônico: `messages`, `crm_appointments`, `crm_tasks`, `crm_lead_stage_history`, `crm_followup_queue`, `crm_automation_queue`, `crm_automation_executions`, `crm_broadcast_recipients`, `crm_conversation_notes`, `crm_notifications`, `crm_lead_custom_values`, `crm_lead_label_assignments`, `crm_lead_pacientes`, `crm_lead_instagram_identities`, `bot_executions`, `ai_conversation_analysis`, `instagram_messages`, `crm_leads_com_pagamento`.
- Atualizar no canônico: `name` (preferir o mais informativo, não `.....` nem "Lead WhatsApp"), `last_message`, `last_message_at`, `last_inbound_at`, `first_inbound_at` (mínimo entre todos), `assigned_to` (preservar do canônico se existir, senão pegar do mais recente), e copiar para o canônico campos não-nulos do mais recente quando o canônico estiver vazio (`cidade`, `servico_interesse`, `email`, `ad_*`, etc.).
- Deletar os leads duplicados restantes.
- Inserir uma `messages` system explicando a mesclagem no canônico.

### 2) Normalizar telefones antes do unique

Rodar `normalizePhone` equivalente no SQL para os ~3 registros com formato divergente, depois mesclar de novo se gerar novas colisões.

### 3) Criar índice único e prevenir futuras duplicatas

```sql
CREATE UNIQUE INDEX crm_leads_tenant_phone_uniq
  ON public.crm_leads (tenant_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';
```

### 4) Tornar a criação de lead idempotente/race-safe

Em `supabase/functions/whatsapp-webhook/index.ts` (bloco "Find or create lead by phone", linhas ~670–760) e em `supabase/functions/generic-lead-webhook/index.ts`:

- Manter o SELECT inicial.
- No INSERT, tratar erro de violação de unique (`code === '23505'`): re-SELECT pelo `tenant_id + phone` e seguir com o lead existente (sem criar nem duplicar mensagem).
- Trocar `.maybeSingle()` por `.limit(1).maybeSingle()` na busca, para tolerar (até a deduplicação rodar) qualquer remanescente sem quebrar.

Não mexer em mais nada do fluxo do webhook (sem mudanças de UI/comportamento).

## Detalhes técnicos

**Arquivos**
- Migration (uma migration consolidada): merge dos duplicados + `CREATE UNIQUE INDEX` em `(tenant_id, phone)`.
- `supabase/functions/whatsapp-webhook/index.ts`: hardening de race (try/catch 23505 + re-select).
- `supabase/functions/generic-lead-webhook/index.ts`: mesmo hardening.

**Estratégia da migration (resumo)**
```text
WITH dup AS (
  SELECT tenant_id, phone, MIN(created_at) AS keep_ts
  FROM crm_leads
  WHERE phone IS NOT NULL AND phone <> ''
  GROUP BY 1,2 HAVING COUNT(*) > 1
),
canon AS (
  SELECT l.id AS keep_id, l.tenant_id, l.phone
  FROM crm_leads l JOIN dup d
    ON l.tenant_id = d.tenant_id AND l.phone = d.phone AND l.created_at = d.keep_ts
),
victims AS (
  SELECT l.id AS old_id, c.keep_id
  FROM crm_leads l JOIN canon c
    ON l.tenant_id = c.tenant_id AND l.phone = c.phone
  WHERE l.id <> c.keep_id
)
-- UPDATE em cada tabela dependente: SET lead_id = keep_id FROM victims WHERE lead_id = old_id
-- UPDATE crm_leads canônico com merge de campos (COALESCE do mais recente)
-- DELETE FROM crm_leads WHERE id IN (SELECT old_id FROM victims)
-- INSERT messages (system) no canônico explicando a mesclagem
-- CREATE UNIQUE INDEX ...
```

## Perguntas

1. Confirma que para escolher o lead canônico devo usar **o mais antigo** (`MIN(created_at)`)? Alternativa: o que tem mais mensagens / dados preenchidos.
2. Devo mesclar **todos** os 12 grupos duplicados detectados, ou apenas o `557381751038`?

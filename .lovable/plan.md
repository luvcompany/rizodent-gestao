
# Plano de correção — Segurança e qualidade do CRM

Objetivo: fechar os vazamentos entre clínicas (multi-tenant) e os bugs altos **sem alterar comportamento visível** para quem já usa o sistema. Cada fase é independente e validável isoladamente, para podermos pausar/reverter sem afetar a operação.

---

## Fase 1 — IDOR nas Edge Functions (CRÍTICO, prioridade #1)

Criar um helper compartilhado `_shared/authz.ts` (montado via `import_map` ou copiado em cada função, conforme padrão do projeto) com:

- `requireUser(req)` → valida JWT via `supabase.auth.getClaims(token)`, retorna `{ userId, tenantId, roles }` lendo `profiles.tenant_id` + `user_roles`.
- `assertLeadInTenant(leadId, tenantId)` → consulta `tenant_of_lead(leadId)` e lança 403 se divergir.
- `assertMessageInTenant(messageId, tenantId)` → idem com `tenant_of_message`.
- `assertWhatsAppNumberInTenant` / `assertInstagramAccountInTenant`.

Aplicar em:
- `send-whatsapp-message`
- `transcribe-audio`
- `ai-conversation-assist`
- `delete-whatsapp-message`
- `instagram-send-message`

Critério "não quebrar": helper é **aditivo** (rejeita só requests cross-tenant); fluxos normais do front continuam idênticos pois o front sempre usa leads do tenant do usuário.

## Fase 2 — Webhooks (CRÍTICO + ALTO)

- **Instagram webhook**: adicionar verificação HMAC SHA-256 do header `X-Hub-Signature-256` usando `META_APP_SECRET` (mesmo padrão do `whatsapp-webhook`). Aplicar em `instagram-webhook` e `instagram-lite-webhook`.
- **Idempotência**: criar índice único parcial em `messages(whatsapp_message_id)` e `instagram_messages(instagram_message_id)` (WHERE NOT NULL), e ajustar os webhooks para `ON CONFLICT DO NOTHING`. Migração separada — antes, deduplicar registros existentes.
- **verify_token**: comparar com `timingSafeEqual`.

## Fase 3 — Escalada de privilégio e RPC vazante (CRÍTICO)

- `tenant-create-user`: aplicar allowlist de roles (`crc`, `gerente`, `posvenda`); apenas `superadmin` pode criar `superadmin` / `gerente`. Validar no servidor.
- `check_duplicate_phone`: nova migration recriando a função com filtro `tenant_id = current_tenant_id()`. Mantém assinatura → `CrmKanban.tsx` continua chamando sem mudanças.
- `ai_conversation_analysis`: trocar política `USING(true)` por `USING(tenant_id = current_tenant_id())`. Antes, preencher `tenant_id` nas linhas existentes a partir do lead.
- `crm_notifications`: corrigir `WITH CHECK(true)` para `WITH CHECK(user_id IN (SELECT id FROM profiles WHERE tenant_id = current_tenant_id()))`.

## Fase 4 — Edge Functions sem `verify_jwt` explícito (ALTO)

Auditar `supabase/config.toml`: para `automation-engine`, `bot-engine`, `followup-engine` e quaisquer cron-only, declarar explicitamente `verify_jwt = false` **e** exigir header `X-Cron-Secret` (gerado via `generate_secret`) checado em código. Funções chamadas pelo front continuam com validação JWT em código.

## Fase 5 — Automações silenciosamente quebradas (ALTO)

Em `automationUtils.ts` alinhar nomes lendo **ambos** os campos (compatibilidade retroativa) e gravando o canônico:
- `create_tag`: aceita `config.tag ?? config.tag_name`.
- `combo`: aceita `config.actions ?? config.combo_actions`.
- `notify_assignee`: adicionar `case` no executor.

Sem migração de dados — automações antigas continuam rodando.

## Fase 6 — Bugs de cálculo (ALTO/MÉDIO)

- `Relatorios.tsx:206`: `Number(p.valor) || 0`.
- `Dashboard.tsx:280`: usar dias úteis reais do mês atual em vez de fallback fixo 26.

## Fase 7 — Memory leak no chat (MÉDIO)

`ChatInput.tsx`: guardar URLs criadas em ref e `URL.revokeObjectURL` no cleanup do `useEffect` / ao remover anexo / no unmount.

## Fase 8 — Higiene de build (MÉDIO/BAIXO)

- Remover `bun.lockb` e `package-lock.json`, manter apenas `bun.lock`.
- Adicionar `.env` ao `.gitignore` (mantém arquivo local).
- CORS: restringir `Access-Control-Allow-Origin` ao domínio publicado + preview Lovable nas funções sensíveis (manter `*` apenas em webhooks públicos).
- Não passar tokens Meta em querystring (mover para header/body).

Itens **não** abordados nesta passada (registrar como follow-up, não bloqueiam segurança): vulnerabilidades npm audit, 810 lint warnings, ausência de testes, code-splitting, ordem do `@import` no `index.css`.

---

## Detalhes técnicos

**Ordem de deploy recomendada** (cada passo independente, validável):
1. Migrations da Fase 3 (RLS + função) — não afetam código existente.
2. Helper `authz.ts` + Fase 1 (deploy função por função, testando cada uma via `curl_edge_functions`).
3. Fase 2 webhooks (deduplicar dados → criar índice único → ativar HMAC).
4. Fase 4 config.toml + secret de cron.
5. Fase 5–8 (frontend/limpeza).

**Validação por fase**: `supabase--linter` após cada migration; chamadas `curl_edge_functions` com tokens de tenants diferentes para confirmar 403 cross-tenant; smoke test manual nas telas principais (Kanban, Conversa, Dashboard).

**Rollback**: cada fase = 1 commit isolado. Migrations são aditivas/substitutivas (sem `DROP` destrutivo), funções de edge têm versionamento Supabase.

---

## Perguntas antes de implementar

1. Posso seguir a ordem acima (Fases 1→8 em sequência, validando cada uma), ou prefere que eu execute **só Fase 1+2+3** agora (os CRÍTICOS) e deixe o resto para depois?
2. Confirma que **nenhum** workflow legítimo hoje envia mensagens / consulta dados entre tenants? (Se a Luv Agency como superadmin precisa cruzar tenants pelo front, o helper precisa permitir esse caso — é o comportamento que vou implementar por padrão.)

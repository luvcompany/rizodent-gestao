# Acesso por usuário a canais (WhatsApp + Instagram)

## Objetivo
Permitir que admin/superadmin escolha, em **Usuários → Permissões**, quais **números de WhatsApp** e **contas de Instagram** cada usuário pode acessar. Conversas, mensagens, leads originados nesses canais, métricas e o próprio card da integração ficam ocultos para quem não tiver permissão.

## Etapa 1 — Refatorar WhatsApp para multi-número

Hoje `tenant_meta_credentials` tem `tenant_id` como PK (1 número por clínica). Vamos separar credenciais por número.

Nova tabela **`whatsapp_numbers`**:
- `id` (uuid PK), `tenant_id`, `phone_number_id` (único), `display_name`, `waba_id`, `token`, `app_id`, `app_secret`, `verify_token`, `is_active`, `is_default`.
- Migração de dados: copiar a linha de `tenant_meta_credentials` (quando `whatsapp_enabled`) para `whatsapp_numbers` marcada como `is_default`.
- `tenant_meta_credentials` continua existindo para Instagram/Meta App; campos `whatsapp_*` ficam como legado (não removidos agora pra não quebrar edge functions — substituição será gradual).
- Atualizar `get_tenant_by_whatsapp_phone_number_id()` para consultar `whatsapp_numbers` primeiro (fallback na tabela antiga).

## Etapa 2 — Modelo de acesso por usuário

Reaproveitar `user_permission_overrides` adicionando dois novos `scope`:
- `scope = 'whatsapp_number'`, `resource_id = whatsapp_numbers.id`
- `scope = 'instagram_account'`, `resource_id = ig_accounts.id` (UUID interno, não o ig_user_id da Meta)

**Padrão (sem override)**: usuário vê **todos** os canais do seu tenant (mantém comportamento atual). Override `granted = false` esconde; `granted = true` é redundante mas permite "whitelist explícita" no futuro.

Novas funções SECURITY DEFINER:
- `can_access_whatsapp_number(_number_id uuid) → boolean`
- `can_access_instagram_account(_account_id uuid) → boolean`
- Lógica: admin/superadmin/gerente sempre `true`; demais consultam `user_override`, default `true`.

## Etapa 3 — Aplicar filtros (RLS + queries)

**Mensagens WhatsApp (`messages`)**: adicionar coluna `whatsapp_number_id` (nullable, backfill da default). Política RLS extra: SELECT exige `can_access_whatsapp_number(whatsapp_number_id)` quando não-nulo.

**Mensagens Instagram (`instagram_messages`)**: já tem `instagram_account_id` (Meta ID). Adicionar coluna `ig_account_uuid` apontando para `ig_accounts.id` (backfill por join). Política RLS extra: SELECT exige `can_access_instagram_account(ig_account_uuid)`.

**Leads (`crm_leads`)**: já tem `source`/`channel`. Adicionar colunas `whatsapp_number_id` e `ig_account_uuid` (nullable), preenchidas no webhook (já sabemos qual número/conta recebeu). RLS extra filtra leads cujo canal o usuário não acessa.

**Telas afetadas (frontend)**:
- CRM/Conversas: lista de chats já passa por RLS, então some automaticamente.
- Configurações → Integrações: filtrar lista de `ig_accounts`/`whatsapp_numbers` por `can_access_*` antes de renderizar.
- Dashboard/Relatórios: RLS já cobre, gráficos respeitam.

## Etapa 4 — UI no `UserPermissionsSheet`

Adicionar 2 abas novas ao Sheet (`src/components/usuarios/UserPermissionsSheet.tsx`):

### Aba "WhatsApp"
- Lista todos os `whatsapp_numbers` do tenant (display_name + phone_number_id mascarado).
- Cada item: switch "Acesso liberado" + badge "Herdado (padrão: liberado)" ou "Personalizado: bloqueado".
- Save → upsert/delete em `user_permission_overrides` (scope='whatsapp_number').

### Aba "Instagram"
- Lista todos os `ig_accounts` ativos do tenant (`@username` + avatar se houver).
- Mesmo padrão de switches da aba WhatsApp.

Aproveita o mesmo hook de save/invalidate já existente.

## Etapa 5 — Webhooks e envio

- **Webhook WA**: usa `phone_number_id` para resolver `whatsapp_numbers.id` → grava em `messages.whatsapp_number_id` e `crm_leads.whatsapp_number_id`.
- **Webhook IG**: já resolve `ig_accounts` → grava `ig_account_uuid` em mensagens/leads.
- **Envio**: hoje só existe 1 número, então mantém. Quando o usuário tiver acesso a múltiplos, o front passa a expor um seletor de "responder por qual número" (fora do escopo desta entrega).

---

## Detalhes técnicos

**Migração**:
```sql
-- whatsapp_numbers
CREATE TABLE public.whatsapp_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone_number_id text UNIQUE NOT NULL,
  display_name text,
  waba_id text, token text, app_id text, app_secret text, verify_token text,
  is_active boolean DEFAULT true,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE whatsapp_numbers ENABLE ROW LEVEL SECURITY;
-- RLS: tenant_id = current_tenant_id() AND can_access_whatsapp_number(id)
-- Admin/superadmin INSERT/UPDATE/DELETE

-- Backfill
INSERT INTO whatsapp_numbers (tenant_id, phone_number_id, ...)
SELECT tenant_id, whatsapp_phone_number_id, ... FROM tenant_meta_credentials WHERE whatsapp_enabled;

-- Novas colunas
ALTER TABLE messages ADD COLUMN whatsapp_number_id uuid REFERENCES whatsapp_numbers(id);
ALTER TABLE instagram_messages ADD COLUMN ig_account_uuid uuid REFERENCES ig_accounts(id);
ALTER TABLE crm_leads ADD COLUMN whatsapp_number_id uuid, ADD COLUMN ig_account_uuid uuid;

-- Backfill via JOIN nos IDs Meta existentes

-- Funções
CREATE FUNCTION can_access_whatsapp_number(_id uuid) RETURNS boolean ...;
CREATE FUNCTION can_access_instagram_account(_id uuid) RETURNS boolean ...;

-- Políticas RLS adicionais nas tabelas filtradas
```

**Arquivos frontend**:
- `src/components/usuarios/UserPermissionsSheet.tsx` (adicionar 2 TabsTrigger + TabsContent)
- `src/hooks/usePermissions.ts` (já existe — adicionar `whatsapp_number` e `instagram_account` aos scopes)
- `src/pages/Configuracoes.tsx` ou tela equivalente de Integrações: filtrar listagem por `can_access_*`

**Edge functions a atualizar**:
- `whatsapp-webhook` (ou nome equivalente): gravar `whatsapp_number_id`
- `instagram-webhook`: gravar `ig_account_uuid`
- `whatsapp-send`: aceitar `whatsapp_number_id` opcional (default = is_default do tenant)

## Riscos / Notas
- Migração de `tenant_meta_credentials` para `whatsapp_numbers` precisa cuidado para não quebrar edge functions em produção — manter ambos em paralelo por enquanto.
- Backfill de `whatsapp_number_id`/`ig_account_uuid` em `messages` antigos: pra `messages`, todas as linhas existentes recebem o número default; pra `instagram_messages` faz join via `instagram_account_id` → `ig_accounts.instagram_account_id` (Meta ID) → `ig_accounts.id`.
- Sem mudança no comportamento atual (todos veem tudo) até admin criar overrides.

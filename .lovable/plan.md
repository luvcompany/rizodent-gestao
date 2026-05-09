
# Plataforma multi-tenant CRClin — reestruturação completa

## 1. Roteamento (path + subdomínio funcionando juntos)

**Domínio raiz `crclin.com.br/`** → Landing page CRClin (hoje em `/crclin`, vira a rota `/`).

**Login do cliente** acessível por dois caminhos equivalentes:
- `crclin.com.br/{slug}` (ex: `crclin.com.br/rizodent`)
- `{slug}.crclin.com.br` (subdomínio, mantido)

**App do cliente após login** sempre prefixado pelo slug:
- `crclin.com.br/{slug}/dashboard`, `/{slug}/crm`, `/{slug}/crm/conversas`, etc.
- No subdomínio fica sem prefixo: `rizodent.crclin.com.br/dashboard`.

**Admin** continua em `crclin.com.br/admin` (somente superadmin).

```text
/                         → Landing CRClin (pública)
/admin/login              → Login admin
/admin/*                  → Painel admin (superadmin)
/{slug}                   → Login do cliente (branding do tenant)
/{slug}/dashboard         → App cliente
/{slug}/crm/*             → CRM cliente
{slug}.crclin.com.br/*    → mesma coisa, sem prefixo
```

Um `TenantResolver` (HOC + contexto) lê o slug de `params.slug` OU do subdomínio e injeta `tenant_id` em todo o contexto. Todo `Link`/`navigate` interno passa por `useTenantPath()` que prefixa automaticamente.

## 2. Login isolado por tenant (segurança crítica)

Hoje o Supabase Auth aceita qualquer email/senha válido independente do tenant. Solução:

**Edge Function `tenant-login`**:
1. Recebe `{ slug, email, password }`.
2. Resolve `tenant_id` pelo slug (RPC `get_tenant_by_slug`).
3. Confere se existe `profile` com esse email **dentro daquele tenant**. Se não, retorna 403 `tenant_mismatch` — sem nem tentar autenticar.
4. Só então chama `signInWithPassword` server-side; se OK, retorna a sessão para o frontend gravar via `supabase.auth.setSession`.
5. Registra no `access_logs` (sucesso, falha, ou tentativa cross-tenant — esta gera alerta).

Frontend nunca chama `signInWithPassword` direto na tela de cliente — sempre via essa edge function. Isso garante que descobrir senha de outro cliente não dá acesso.

**Reforço extra:** após login, `AuthContext` valida `profile.tenant_id === tenant_da_url`. Se não bater, faz `signOut` imediato.

## 3. Admin redesenhado

Layout mais limpo, baseado em cards/tabs claras. Estrutura:

**Sidebar:** Clientes · Planos · Métricas globais · Cobrança · Logs & Acesso · Configurações.

**Página do cliente (`/admin/clientes/:id`)** com tabs:
- **Visão geral** — status (ativo/pausado), plano, criado em, último acesso, KPIs do mês (mensagens enviadas/recebidas WA+Insta, leads novos, leads ativos, chamadas IA + tokens estimados, usuários ativos).
- **Usuários** — listar, adicionar, editar nome/email, redefinir senha, pausar (`is_blocked`), excluir, ver último login.
- **Branding** — nome, slug, cor primária, **upload de logomarca** (bucket `tenant-logos`), favicon.
- **Integrações** — status WhatsApp/Instagram/Meta, editar tokens, reconectar, testar webhook.
- **Acesso/Impersonar** — botão "Entrar como este cliente" que abre nova aba em `/{slug}/dashboard` com sessão impersonada (edge function `admin-impersonate` gera um magic-link de service role para um usuário admin do tenant; sessão marcada com flag visual "Modo admin").
- **Ações** — Editar, **Pausar acesso** (bloqueia todos os usuários do tenant), **Excluir** (soft-delete com confirmação dupla).

**Lista de clientes:** tabela com busca, status colorido, último acesso, mensagens do mês, botões rápidos (pausar/abrir).

## 4. Métricas e gestão

Nova tabela `tenant_usage_daily` (ou agrega das existentes):
- `messages_in`, `messages_out` — agregar de `messages` por tenant/dia.
- `leads_created` — count `crm_leads` por tenant/dia.
- `ai_calls`, `ai_tokens` — incrementar nas edge functions que usam Lovable AI (`ai-conversation-assist`, `transcribe-audio`).
- `active_users` — distinct logins de `access_logs` no dia.

Edge function cron diária consolida. Cards do admin leem direto.

## 5. Pause / bloqueio em camadas

- **Tenant pausado** (`tenants.status = 'paused'`): edge `tenant-login` recusa todos. RLS adicional bloqueia leitura.
- **Usuário pausado** (`profiles.is_blocked = true`): `tenant-login` recusa só esse user. `enforceBlockCheck` já existe — reaproveitar.
- **Cliente excluído** (`tenants.status = 'deleted'`): soft delete; dados preservados, login bloqueado.

## 6. Segurança

- Manter RLS `tenant_isolation` (já em todas as tabelas principais).
- Adicionar policy global em `profiles`/`user_roles`: admin de tenant só insere users com `tenant_id = current_tenant_id()`.
- Edge functions sensíveis (`admin-create-tenant`, `admin-impersonate`, `tenant-login`) validam `superadmin` via JWT antes de qualquer ação.
- `access_logs` ganha campo `success boolean` e `failure_reason text`. Admin vê tentativas cross-tenant para auditoria.

## 7. Fases de entrega

1. **Roteamento + landing como `/`** + `TenantResolver` + prefixo de slug em todas as rotas autenticadas.
2. **Edge function `tenant-login`** + tela de login do cliente reescrita + remoção do login direto Supabase no frontend cliente.
3. **Admin redesenhado** — lista + página de detalhe com tabs (Visão geral, Usuários, Branding).
4. **Métricas** — agregação `tenant_usage_daily` + cron + cards.
5. **Integrações no admin** + impersonação.
6. **Pausar/excluir cliente** + reforço de RLS + auditoria de logs.

## Detalhes técnicos

**Migrations necessárias:**
- `tenants`: adicionar `status` (`active|paused|deleted`), `logo_url` (já existe), `favicon_url`.
- `profiles`: garantir `is_blocked`, `last_login_at`.
- Nova `tenant_usage_daily(tenant_id, day, messages_in, messages_out, leads_created, ai_calls, ai_tokens, active_users)`.
- Policy: `profiles INSERT` com `tenant_id = current_tenant_id()` para admin não-super.
- RPC `get_tenant_branding_by_slug` (já existe `get_tenant_by_slug`).

**Edge functions novas:**
- `tenant-login` (público, valida tenant+credencial).
- `admin-impersonate` (superadmin, gera sessão).
- `admin-update-tenant` / `admin-pause-tenant` / `admin-delete-tenant`.
- `admin-tenant-metrics` (agrega on-demand para gráficos).
- `usage-aggregator-cron` (diário).

**Frontend:**
- `src/contexts/TenantContext.tsx` — passa a aceitar slug via param de rota além de subdomínio.
- `src/lib/tenantPath.ts` — helper `tenantPath('/dashboard')` → `/rizodent/dashboard`.
- `src/components/ProtectedRoute.tsx` — valida match user.tenant ↔ url.slug, faz signOut se divergir.
- `src/pages/TenantLogin.tsx` — nova, substitui `Login.tsx` para clientes.
- `src/pages/admin/*` — refatorado em `AdminClientesList`, `AdminClienteDetalhe` com tabs `OverviewTab`, `UsersTab`, `BrandingTab`, `IntegrationsTab`, `AccessTab`.

**Não muda:** estrutura interna do CRM, dados existentes, nomes de tabelas já em uso.

Posso começar pela Fase 1 (roteamento + landing na raiz) que destrava o resto, ou prefere outra ordem?

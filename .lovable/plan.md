
# Plano: CRClin White-Label

Transforma o sistema atual (hoje dedicado à Rizodent) em uma plataforma SaaS white-label chamada **CRClin**, mantendo a Rizodent como o primeiro cliente (tenant #1). A entrega é dividida em 4 fases para reduzir risco — multi-tenant em banco de dados é uma mudança grande e precisa ser feita com cuidado.

---

## Fase 1 — Landing page pública de vendas (rápida, sem risco)

Nova rota pública `/crclin` (e também acessível via `crclin.com.br` quando o domínio for conectado), totalmente separada do app atual.

**Conteúdo da landing:**
- Hero: "CRClin — CRM completo para clínicas e empresas que vivem de agendamento"
- Seções: Benefícios, Funcionalidades (Kanban, WhatsApp, Bots, Agenda, Relatórios, Pagamentos), Para quem é, Depoimentos (placeholder), FAQ
- CTA principal e botão flutuante: **"Falar no WhatsApp"** → `https://wa.me/5577981223133?text=Quero%20conhecer%20o%20CRClin`
- SEO: title, meta description, Open Graph, JSON-LD de Organization
- Identidade visual neutra (não usa o laranja Rizodent) — paleta a definir; sugiro azul/grafite para diferenciar

**O que NÃO muda:** rota `/`, login da Rizodent e todo o sistema atual continuam exatamente como estão.

---

## Fase 2 — Painel Super-Admin (você como dono da plataforma)

Nova área `/admin` protegida por uma nova role `superadmin` (apenas você). Permite operar o negócio antes mesmo do isolamento total de dados estar pronto.

**Tabelas novas:**
- `tenants` — id, slug (subdomínio), nome, logo_url, cor primária, status (ativo/suspenso/trial), plano_id, created_at, trial_ends_at
- `plans` — id, nome, preço mensal, limite de usuários, limite de leads, limite de mensagens WhatsApp/mês, recursos habilitados (jsonb)
- `tenant_subscriptions` — tenant_id, plano_id, status (ativa/atrasada/cancelada), data início, próxima cobrança, valor
- `tenant_usage` — tenant_id, mês, leads_criados, mensagens_enviadas, usuários_ativos (atualizada por trigger/cron)
- `tenant_invoices` — tenant_id, mês de referência, valor, status (paga/aberta/atrasada), data pagamento, comprovante_url

**Telas do painel super-admin:**
1. **Clientes** — lista de tenants com status, plano, MRR, último login, uso vs. limite. Ações: criar, editar, suspender, reativar, excluir
2. **Criar cliente** — wizard: dados da clínica + slug (subdomínio) + upload da logo + escolher plano + criar primeiro usuário admin (email + senha gerada) → mostra link final `https://{slug}.crclin.com.br` para enviar
3. **Planos** — CRUD de planos e limites
4. **Métricas** — uso por cliente (leads, mensagens, storage), gráficos, alertas de quem passou do limite
5. **Cobrança** — faturas em aberto, marcar como paga manualmente, gerar próxima fatura, histórico

Logo do tenant: bucket `tenant-logos` (público) com RLS adequado.

---

## Fase 3 — Multi-tenant no banco (Rizodent vira tenant #1)

A mudança mais delicada. Feita em uma migração planejada, **fora do horário de uso**.

**Passos:**
1. Criar tenant `Rizodent` na tabela `tenants` com slug `rizodent`
2. Adicionar coluna `tenant_id uuid` em **todas** as ~40 tabelas de negócio (`crm_leads`, `crm_pipelines`, `crm_stages`, `crm_tasks`, `messages`, `pacientes`, `clinicas`, `bots`, etc.) com default = id da Rizodent
3. Adicionar `tenant_id` em `profiles` e `user_roles` (cada usuário pertence a 1 tenant; superadmin = sem tenant)
4. Backfill: setar tenant_id da Rizodent em todas as linhas existentes
5. Tornar `tenant_id NOT NULL` em todas as tabelas
6. Reescrever **todas as RLS policies** para incluir `tenant_id = current_tenant_id()`, onde `current_tenant_id()` é uma função `SECURITY DEFINER` que lê o tenant do `profiles` do `auth.uid()` (evita recursão)
7. Função `has_role` passa a considerar role dentro do tenant
8. No frontend, criar `TenantContext` que carrega o tenant do usuário logado e injeta a logo/cor no `AppLayout` e `Login`
9. Edge functions (webhooks WhatsApp/Instagram, bot-engine, followup-engine, automation-engine, etc.) precisam ser revisadas para resolver e propagar o `tenant_id` correto a cada operação

---

## Fase 4 — Acesso por subdomínio

**Pré-requisito de infraestrutura:** comprar `crclin.com.br`, configurar wildcard DNS `*.crclin.com.br` apontando para a Lovable e conectar como domínio custom (Lovable suporta subdomínios, mas wildcard exige modo proxy/Cloudflare; documentar passo a passo).

**Comportamento:**
- `crclin.com.br` → landing pública (Fase 1)
- `admin.crclin.com.br` → painel super-admin
- `{slug}.crclin.com.br` → login + sistema do tenant; logo, cor, nome lidos de `tenants` pelo slug; sessão isolada
- Rizodent migra de `rizodent-gestao.lovable.app` para `rizodent.crclin.com.br` (domínio antigo pode redirecionar)

Frontend lê `window.location.hostname`, extrai o slug e carrega o branding **antes** de mostrar a tela de login (evita flash de marca errada).

---

## Detalhes técnicos relevantes

- **Senhas iniciais:** ao criar cliente, super-admin define senha temporária; usuário troca no primeiro login (forçar `must_change_password`)
- **Limites de uso:** validados em edge functions (ex: `send-whatsapp-message` checa cota antes de enviar) e em triggers de insert (ex: bloqueia novo lead acima do limite)
- **Isolamento de Storage:** buckets `chat-media` e `avatars` passam a usar prefixo `tenant_id/...` no path; policies validam o prefixo
- **Cobrança manual agora**, com estrutura pronta para integrar Stripe/Asaas em fase futura — sem implementar checkout nesta entrega
- **Memória atualizada** ao final: nova entrada `mem://tenant/architecture` documentando o modelo

---

## Ordem de execução sugerida

1. **Fase 1** (landing) — entrega imediata, você já pode começar a vender
2. **Fase 2** (painel super-admin com tabelas, mas ainda sem isolar dados) — você cadastra leads/clientes interessados
3. **Fase 3** (multi-tenant no banco) — janela de manutenção planejada
4. **Fase 4** (subdomínios) — depois do domínio comprado e DNS pronto

Confirma essa ordem? Se sim, começo pela **Fase 1** (landing `/crclin` + botão WhatsApp).

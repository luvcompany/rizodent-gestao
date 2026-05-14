# Multi-Tenant Meta Apps — WhatsApp + Instagram (Zero Downtime)

Princípio guia: **nada do que já funciona pro Rizodent pode quebrar em nenhum momento**. A migração é incremental, com fallback em todas as camadas.

## Estratégia de não-quebrar

Toda função Meta vai ter este padrão de leitura de credencial:

```text
1. Tenta resolver tenant pelo path da URL (/whatsapp-webhook/{slug})
2. Se não veio slug → tenta resolver pelo payload (phone_number_id, ig_account_id)
3. Se achou tenant → busca em tenant_meta_credentials
4. Se não achou no banco → cai nos secrets globais (Deno.env) — comportamento atual
5. Loga qual fonte foi usada (path|payload|env) pra debug
```

Resultado: **webhooks atuais do Rizodent continuam funcionando exatamente como hoje** mesmo antes de qualquer migração de dados ou mudança de URL no Meta. A migração para o banco só "ativa" quando a linha existir em `tenant_meta_credentials`.

## 1. Banco — `tenant_meta_credentials`

Migration **somente aditiva** (nada é dropado, nada é alterado em tabela existente):

```text
tenant_meta_credentials
├── tenant_id (PK, FK tenants)
├── whatsapp_app_id, whatsapp_app_secret
├── whatsapp_token, whatsapp_phone_number_id, whatsapp_waba_id
├── whatsapp_verify_token (auto-gerado)
├── whatsapp_enabled boolean default false
├── meta_app_id, meta_app_secret
├── instagram_app_secret
├── instagram_verify_token (auto-gerado)
├── instagram_redirect_uri
└── instagram_enabled boolean default false
```

- RLS: SELECT/UPDATE só `admin` daquele tenant + `superadmin`. Service role bypassa.
- Trigger `BEFORE INSERT`: gera os dois verify_tokens via `encode(gen_random_bytes(24),'hex')` se vierem nulos.
- **Não cria linha pro Rizodent automaticamente** — só quando o admin entrar na tela de Integrações e salvar (passo 5). Antes disso, fallback de env mantém tudo igual.

## 2. Webhooks com path opcional

Edge functions passam a aceitar **dois formatos de URL simultaneamente**:

```text
/functions/v1/whatsapp-webhook                    ← rota atual, continua funcionando
/functions/v1/whatsapp-webhook/{slug}             ← rota nova, multi-tenant

/functions/v1/instagram-lite-webhook              ← rota atual
/functions/v1/instagram-lite-webhook/{slug}      ← nova

/functions/v1/instagram-oauth-callback            ← atual
/functions/v1/instagram-oauth-callback/{slug}    ← nova
```

Você não precisa atualizar nada no Meta App do Rizodent — as URLs antigas continuam válidas.

## 3. Refactor cuidadoso das edge functions

Helper novo `supabase/functions/_shared/tenantCredentials.ts`:

- `getCredentialsFromRequest(req, channel)` — resolve via path → payload → env, retorna sempre um objeto com as mesmas chaves de hoje.
- `getCredentialsForTenant(tenantId, channel)` — usado por funções que enviam mensagens (sabem o lead.tenant_id).
- `getCredentialsForLead(leadId, channel)` — wrapper que olha o tenant do lead e cai no banco; se vazio, usa env.
- Cache em memória (Map TTL 60s) por tenant.

Funções afetadas (todas mantêm assinatura/payload externo idênticos):

- `whatsapp-webhook`, `send-whatsapp-message`
- `manage-whatsapp-templates`, `submit-whatsapp-template`
- `instagram-webhook`, `instagram-lite-webhook`, `instagram-oauth-callback`
- `get-instagram-app-id` (passa a aceitar `?tenant=slug`, sem slug usa env)
- `instagram-refresh-tokens`, `instagram-send-message`, `instagram-reply`
- `repair-ad-images`, `enrich-ad-accounts`, `repair-chat-media`

**Cada função é refatorada e testada isoladamente.** Se algo der errado, basta a linha no banco não existir e o fallback de env volta a valer — o reverso é trivial.

## 4. UI em `CrmIntegracoes`

Duas seções (WhatsApp / Instagram-Meta), ambas com:

- Campos editáveis: App ID, App Secret, Token, Phone Number ID, WABA ID.
- **Verify Token** e **Webhook URL** somente leitura, com botão "Copiar" (URL inclui `/{slug}` do tenant logado).
- Botão "Testar conexão" → faz GET no Graph API com o token (sem salvar nada).
- Botão "Salvar" → grava em `tenant_meta_credentials`. Antes de salvar, mostra alerta: "Após salvar, este tenant passará a usar estas credenciais. Confirme se as URLs e verify tokens já foram colados no Meta App."
- Tokens nunca voltam em texto claro pro frontend depois de salvos (mostra `••••` + botão "Substituir").
- Toggle `whatsapp_enabled` / `instagram_enabled` permite **desativar e voltar a usar env** sem deletar a linha.

Permissão: só `admin` do tenant.

## 5. Migração do Rizodent (manual e segura)

Em vez de migration automática que copia secrets pro banco, o caminho recomendado é:

1. Deploy das mudanças (rotas novas + fallback de env). **Tudo continua funcionando como antes** — Rizodent ainda usa env.
2. Admin do Rizodent abre `CrmIntegracoes`, vê os campos vazios, copia os valores dos secrets atuais (ou você fornece via formulário) e salva.
3. Ao salvar, sistema mostra a Webhook URL nova com `/rizodent` e o verify token gerado. Admin atualiza no Meta App **se quiser** — mas mesmo sem atualizar, o webhook antigo continua funcionando via fallback.
4. Quando estiver tudo ok, é possível (opcional, futuro) remover os secrets globais.

Se preferir migration automática que pré-popula, dá pra fazer: lê `Deno.env`, insere no banco. Mas o caminho manual é mais seguro porque você confirma campo a campo.

## 6. Documentação na própria tela

Bloco com passo a passo dentro de `CrmIntegracoes`: como criar app no Meta Developers, gerar token permanente do System User, configurar webhooks com a URL/verify token mostrados na tela, vincular WABA, etc.

---

## Detalhes técnicos

- Rota dinâmica em Deno: `new URL(req.url).pathname.split('/').filter(Boolean).pop()` — se for o nome da função, sem slug.
- Verify token: comparação **constant-time** pra evitar timing attack.
- Cache invalidado quando UI salva (chama um endpoint `invalidate-credential-cache` ou usa Postgres NOTIFY).
- Tokens em texto claro no banco protegidos por RLS estrita; criptografia em repouso (`pgcrypto`) fica pra um PR futuro sem mudar API.
- Logs de cada edge function passam a incluir `[tenant=slug, source=path|payload|env]` pra facilitar troubleshooting.

## Ordem de execução proposta

1. Migration `tenant_meta_credentials` + RLS + trigger.
2. Helper `_shared/tenantCredentials.ts` com fallback completo.
3. Refactor `whatsapp-webhook` + `send-whatsapp-message` (testar com Rizodent — deve continuar igual).
4. Refactor demais functions WhatsApp.
5. Refactor functions Instagram.
6. UI `CrmIntegracoes` com formulários + URLs/tokens copiáveis.
7. (Opcional) Rizodent salva no banco e migra de fato.

Cada passo é deploy-safe isoladamente.

## Fora de escopo

- Remoção dos secrets globais (fica pra depois da validação).
- Criptografia em repouso.
- UI de superadmin pra gerenciar credenciais de outros tenants.
- Backfill automático de `tenant_meta_credentials` (preferimos manual).

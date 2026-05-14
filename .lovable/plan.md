## Contexto

Você decidiu simplificar a arquitetura: em vez de cada cliente novo cadastrar seu próprio Meta App, **você vai criar UM único Meta App "developer"** e conectar todas as contas (WhatsApp + Instagram) dos novos clientes nele.

A Rizodent continua intocada, usando os secrets globais atuais (`META_APP_ID`, `WHATSAPP_TOKEN`, etc.).

## O que muda em relação ao plano anterior

**Antes (descartado):** Cada tenant preenchia App ID, App Secret, Verify Token próprios em `tenant_meta_credentials` → criava 1 app no Meta por cliente.

**Agora:** Existe apenas **2 conjuntos de credenciais Meta App globais**:
1. **App Rizodent** (atual, nos secrets `META_APP_ID` / `META_APP_SECRET` / `INSTAGRAM_VERIFY_TOKEN` / `WHATSAPP_VERIFY_TOKEN`) — usado **somente pela Rizodent**.
2. **App Novo (developer)** que você está criando agora — usado por **todos os outros tenants** (luvagency, futuros clientes…).

O que varia por tenant continua sendo apenas: **token de acesso (System User)**, **phone_number_id**, **WABA ID**, **conta do Instagram conectada via OAuth**. Isso é coisa da conta do cliente, não do app.

## Plano de implementação

### 1. Novos secrets globais para o "App Novo"

Adicionar no projeto:
- `META_APP_ID_V2` — App ID do novo app developer
- `META_APP_SECRET_V2` — App Secret do novo app
- `WHATSAPP_VERIFY_TOKEN_V2` — verify token (string que você inventa, ex: gerada no UI)
- `INSTAGRAM_VERIFY_TOKEN_V2` — idem para webhook do IG
- `INSTAGRAM_REDIRECT_URI_V2` — URL do `instagram-oauth-callback` (uma só, configurada no novo app)

Os atuais `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`, `INSTAGRAM_REDIRECT_URI` ficam como estão = **App Rizodent**.

### 2. Marcar quais tenants usam o App Novo

Adicionar coluna em `tenants`:
- `meta_app_version text default 'v2'` — `'v1'` para Rizodent, `'v2'` para todos os outros (default v2, então clientes novos já entram certo).

Migração inicial: setar `'v1'` apenas no tenant da Rizodent; demais ficam `'v2'`.

### 3. Simplificar `tenant_meta_credentials`

A tabela continua existindo, mas agora guarda **apenas o que é específico da conta do cliente**, não do app:
- `whatsapp_token`, `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_enabled`
- `instagram_enabled` (e o resto de IG sai do banco — vem da tabela `instagram_accounts` que já existe via OAuth)
- Campos `*_app_id`, `*_app_secret`, `*_verify_token`, `*_redirect_uri` deixam de ser usados (pode mantê-los na tabela, ignorados, para não ter migração destrutiva).

### 4. Reescrever `_shared/tenantCredentials.ts`

Resolução nova:
1. Descobre `tenant_id` (slug, phone_number_id ou explícito).
2. Lê `tenants.meta_app_version`.
3. Se `v1` (Rizodent) → usa secrets atuais (`META_APP_ID`, etc.). Comportamento idêntico ao de hoje.
4. Se `v2` → usa `*_V2` para app_id/secret/verify_token, e busca **token + phone_number_id** em `tenant_meta_credentials` ou `instagram_accounts` daquele tenant.

### 5. Refazer a UI `MetaAppCredentialsSection`

Para tenants `v2`, a tela mostra apenas:
- **WhatsApp:** Token (System User), Phone Number ID, WABA ID, toggle Ativar.
  - + Callback URL (já com slug) e Verify Token (vindo do secret `WHATSAPP_VERIFY_TOKEN_V2`, somente leitura, igual para todos os clientes do app novo).
- **Instagram:** botão "Conectar Instagram via OAuth" (já existe em `InstagramAccountsSection`) + Callback URL e Verify Token (do `INSTAGRAM_VERIFY_TOKEN_V2`).
- Some os campos App ID / App Secret / Redirect URI por cliente (não fazem mais sentido).

Para o tenant `v1` (Rizodent) a seção inteira fica oculta — segue exatamente como está hoje.

### 6. Webhooks

`whatsapp-webhook` e `instagram-lite-webhook` aceitam **2 verify tokens válidos** (v1 e v2) na rota `/`, e mantém a rota com slug `/<slug>` resolvendo via `tenants.meta_app_version`. Isso permite usar **uma única Callback URL por app** no Meta Developers (sem slug), porque o app novo só envia eventos de tenants v2 mesmo.

### Resultado para você no Meta Developers

No app novo você cola **uma vez**:
- WhatsApp Callback: `…/functions/v1/whatsapp-webhook` + `WHATSAPP_VERIFY_TOKEN_V2`
- Instagram Callback: `…/functions/v1/instagram-lite-webhook` + `INSTAGRAM_VERIFY_TOKEN_V2`
- Instagram OAuth Redirect: `…/functions/v1/instagram-oauth-callback`

E para cada cliente novo (luvagency, etc.) você só:
1. Adiciona o número WhatsApp dele como **System User** no seu app → cola token + phone_number_id na tela do cliente.
2. Conecta o Instagram dele clicando em "Conectar" (OAuth).

Pronto, sem mexer em mais nada.

## Pergunta antes de implementar

Confirma esses 3 pontos?
1. Pode adicionar a coluna `tenants.meta_app_version` (default `'v2'`, Rizodent fica `'v1'`).
2. Você vai me passar os 5 secrets novos (`*_V2`) via tela de secrets quando eu pedir.
3. Posso remover da UI os campos App ID / App Secret / Verify Token editáveis por cliente (eles continuam no banco mas inativos)?
# Publicações pendentes — prompts prontos para o agente do Lovable

Cada bloco é um prompt completo: cole no chat do projeto CRClin no Lovable, ou
diga ao Claude Code "pode aplicar o item N". Publicar no CRClin são sempre 3
caminhos separados (migration, redeploy de cada edge function alterada, publish
do site) e o merge no GitHub não aplica nenhum deles.

## API de Conversões da Meta — passos 1 a 3 APLICADOS em 23/09/2026 01:35 UTC

Migration aplicada (cópia do Lovable `20260923013435`; original idempotente),
`meta-capi-worker` e `whatsapp-webhook` redeployadas, site publicado
(`index-57DAMr05.js`, chunk `CrmConfiguracoes-9VKpC5L2.js`). Cron do worker
respondendo 200 de minuto em minuto. Linha de configuração da Rizodent
pré-preenchida (dataset 1616335282799813, WABA 893372606594069, código de
teste TEST85932), **desligada e sem token**. **Falta o passo 4** (o dono).

Atualização 23/09 02:20 UTC: migration `20260923110000` (event_source_url) e
worker `d31d18bf` publicados. O conjunto do CRM passou a ser o ligado à conta do
WhatsApp dos anúncios, **Rizodent Oficial Event Data (2329203107905222)**, criado
via `POST /{WABA}/dataset` porque a Meta recusa evento de mensagem em conjunto
sem WABA (2804132). O pixel do site (v2) está em categoria restrita (saúde,
análise rejeitada) e bloqueia evento de servidor — não serve para o CRM. Falta
o dono gerar o token NESSE conjunto e colar na aba (o token do Pixel 1616 não
tem acesso ao novo).

### Roteiro original (mantido para referência)


O que muda: o CRM passa a guardar o `ctwa_clid` (clique no anúncio de WhatsApp)
e a devolver à Meta os eventos LeadSubmitted / QualifiedLead (agendou) /
InitiateCheckout (compareceu) / Purchase (pagou, com valor), por cliente, via
fila `meta_capi_events` + worker de minuto em minuto. Nasce DESLIGADO: só
enfileira para tenant com `meta_capi_config.enabled = true`, que o dono liga na
aba **Configurações → Conversões Meta** (conjunto de dados + token colados lá).

### Passo 1 — migration

```
Aplicar a migration que já está no repositório (branch main), sem alterar nenhum arquivo: supabase/migrations/20260923100000_meta_capi_conversoes.sql. Ela acrescenta crm_leads.ctwa_clid/ctwa_clid_at e messages.ctwa_clid, cria as tabelas meta_capi_config e meta_capi_events (só service_role), as funções meta_capi_* (enfileirar, claim, config_ler, config_salvar, eventos_status, reenviar), 4 gatilhos trg_zz*_meta_capi_* e 2 crons (meta-capi-worker de minuto em minuto; meta-capi-limpeza diário). Nenhuma policy existente é editada e nenhuma tabela nova tem policy (acesso só por RPC). Aplique o arquivo inteiro como está; se algum comando falhar, pare e me diga o erro. Depois rode o bloco de verificação em comentário no fim do arquivo e me devolva os resultados.
```

### Passo 2 — redeploy das edge functions

```
Faça o deploy destas edge functions a partir do código atual do repositório (branch main), sem alterar nenhum arquivo: meta-capi-worker (nova) e whatsapp-webhook (passou a gravar referral.ctwa_clid em crm_leads e messages). Me diga quais subiram.
```

Ordem importa: a migration antes do webhook (a coluna `ctwa_clid` precisa
existir quando a função nova subir).

### Passo 3 — publicar o site

Deploy do main. Conferir no bundle publicado a aba "Conversões Meta"
(`grep -c "meta_capi_config_ler"` no chunk de CrmConfiguracoes).

### Passo 4 — o dono liga (aba Configurações → Conversões Meta)

1. Gerenciador de Eventos → conjunto de dados escolhido → Configurações → API de
   Conversões → **Gerar token de acesso**; colar na aba e salvar.
2. Preencher o conjunto de dados (ou usar "Achar conjunto ligado ao WhatsApp").
   A conta do WhatsApp Business do número dos anúncios precisa estar ligada ao
   conjunto de dados no Gerenciador de Eventos.
3. Preencher o código de teste, clicar "Enviar evento de teste" e conferir na
   aba Eventos de teste. Depois **apagar o código** para os envios valerem.
4. Ligar a chave.

---

## Já aplicado em 08/09/2026 (não repetir)

- **Limpeza do histórico de etapas** — `20260908030100`. Restaram 49.846 linhas,
  uma etapa aberta por lead.
- **Varredura de leads presos** — função `varre_agendado_sem_agendamento` + cron
  `varredura-agendado-sem-agendamento` (job 35, 06:00 UTC). Primeira execução
  real: 62 leads movidos, 1 sem etapa destino (GIDENALDA).
- **Folha das SDRs (agosto)** — 6 faltas viraram comparecimento e a consulta da
  CHAIANE de 24/08 foi criada (`outcome_source = 'folha-sdr'`, 7 linhas).

---

## Fase 1 do rodízio de SDRs — passos 1 a 3 APLICADOS em 08/09/2026 19:52 UTC

Migration aplicada (77 policies `sdr_`, 6 gatilhos, gestor = rizodentvca2), as
15 edge functions redeployadas e o site publicado (`index-BTbpHfAe.js`). As 512
policies antigas continuam com o hash de antes: nenhum papel atual mudou.
**Falta o passo 4** — o dono criar as 3 SDRs na aba Equipe.

### Roteiro original (mantido para referência)

### Passo 1 — migration

```
Aplicar a migration que já está no repositório (branch main), sem alterar nenhum arquivo: supabase/migrations/20260908150000_sdr_fase1_papel_e_equipe.sql. Ela cria o papel sdr no produto: funções sdr_pode_ver_lead e is_gestor_equipe, coluna crm_rodizio_config.gestor_user_id, policies novas (prefixo sdr_) isolando a SDR pelos leads dela, gatilhos trg_sdr_*, e as RPCs equipe_listar / equipe_bloquear / equipe_rodizio. Nenhuma policy existente é editada. Aplique o arquivo inteiro como está; se algum comando falhar, pare e me diga o erro. Depois rode o bloco de verificação que está em comentário no fim do arquivo e me devolva os resultados.
```

Verificação: `SELECT count(*) FROM pg_policies WHERE policyname LIKE 'sdr\_%'`
deve bater com o número declarado no rodapé da migration (75), e
`SELECT is_gestor_equipe()` deve ser falso para o usuário do Meta App Review.

O que esta migration muda para OUTROS papéis (declarado no cabeçalho dela, para
a conferência não depender de achar a justificativa enterrada):

- `admin_api_unread_leads_base(uuid)` e `match_good_examples(...)` deixam de ter
  EXECUTE para `authenticated` — só o `admin-api` e o
  `generate-reply-suggestion`, ambos em service role, as usam.
- `crm_usage_metrics` e `crm_template_usage_counts` passam a recusar o papel
  `sdr` (para os demais, corpo idêntico ao de produção).
- `is_gestor_equipe()` é **superadmin OU gestor nomeado** — sem ramo "é
  gerente", para nenhum gerente ganhar criar conta e redefinir senha de
  brinde. Para dar a aba Equipe a alguém, o superadmin nomeia:
  `UPDATE crm_rodizio_config SET gestor_user_id = '<id>' WHERE tenant_id = '<tenant>'`.
- `ad_account_map` (mapa conta de anúncio → unidade) e a ESCRITA em
  `funnel_channels` (roteamento dos leads novos) passam a ser negadas à SDR.
  Nas duas, closer e recepção continuam com a brecha aberta — registrado para a
  fase de isolamento deles.

### Passo 2 — redeploy das edge functions

```
Redeploy destas edge functions a partir do código atual do repositório (branch main), sem alterar nenhum arquivo: admin-manage-user, admin-set-user-blocked, ai-conversation-assist, api4com-dial, broadcast-engine, delete-whatsapp-message, generate-reply-suggestion, instagram-reply, instagram-send-message, manage-whatsapp-templates, record-good-example, send-whatsapp-message, transcribe-audio, transfer-lead, whatsapp-call-signaling. Todas mudaram ou dependem de supabase/functions/_shared/authz.ts e _shared/roles.ts, que também mudaram. Me diga quais subiram.
```

Sem este passo o botão "Nova SDR" devolve 403 e o escopo da SDR não vale nas
funções que rodam com service role.

### Passo 3 — publicar o site

Deploy da versão atual do main. Conferir que o bundle publicado é o mesmo hash
do build local e que a rota `/crm/equipe` existe no pacote.

### Passo 4 — criar as 3 SDRs (só o dono faz)

O admin `rizodentvca2@gmail.com` abre **Equipe** no menu e cria
`julia.rizodent@gmail.com`, `fabiola.rizodent@gmail.com` e
`bia.rizodent@gmail.com`, cada uma com uma senha temporária digitada por ele
(a usuária troca no primeiro acesso). As três nascem **fora do rodízio** — a
distribuição automática só entra na Fase 2.

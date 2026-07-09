## Problema

Ao excluir um cliente (ex.: Luv Agency), ainda sobra registro no banco:
- Linha em `tenants` marcada como `status = 'deleted'` com slug renomeado (`deleted-1783575745-luvagency`).
- Isso ocupa o slug/e-mail e atrapalha recriar o cliente depois com os mesmos dados.

Causa raiz:
1. **Falha na criação** (`admin-create-tenant`): quando algo dá errado no meio da criação, o cleanup tenta apagar a linha em `tenants`, mas se a deleção falha por FK, cai num fallback que **apenas marca como `deleted`** — deixando resíduo permanente. Foi o que ocorreu com Luv Agency.
2. **Exclusão manual** (`admin-update-tenant` → `hard_delete_tenant`): já apaga tudo corretamente (profiles, user_roles, tenants, auth.users), mas nunca chegou a ser executada nesse tenant específico.
3. E-mail do admin também pode ficar "preso" em `auth.users` se a criação falhar antes de vincular o profile ao tenant — hoje o `findUserByEmail` limpa isso na próxima tentativa, mas só se o mesmo e-mail for reutilizado.

## Solução

### 1. Limpar o resíduo atual do Luv Agency
Migration que remove definitivamente o tenant `766c90d2-713f-4a5a-b3a5-25face9cb2b1`:
- Executa `hard_delete_tenant(...)` no id.
- Deleta qualquer `auth.users` órfão retornado pela função.
- Confirma que `tenants`, `profiles`, `user_roles` não têm mais nada com esse id.

### 2. Corrigir o cleanup de criação falha (`admin-create-tenant`)
Trocar o fallback "marca como deleted" por **hard delete real**:
- Chamar `hard_delete_tenant(tenant_id)` (mesma função usada na exclusão manual), que já sabe apagar todas as tabelas dependentes na ordem correta.
- Deletar o `auth.users` do admin recém-criado (já feito, manter).
- Se `hard_delete_tenant` falhar por algum motivo inesperado, **retornar erro claro** em vez de deixar linha zumbi no banco — o superadmin precisa saber para agir.

### 3. Reforçar `hard_delete_tenant` (a função do banco)
Auditar e garantir que ela cobre 100% das tabelas com `tenant_id` (adicionar as que faltarem, como `tenant_subscriptions`, `tenant_invoices`, `tenant_usage`, `tenant_api_keys`, `whatsapp_numbers`, `whatsapp_oauth_states`, `whatsapp_template_logs`, `crm_notifications`, `crm_notification_preferences`, `crm_user_labels`, `crm_lead_label_assignments`, `crm_lead_instagram_identities`, `crm_funnel_custom_reports`, `crm_broadcasts`, `bots`, `plans` (não tem tenant_id — ignorar), `deleted_leads_backup`, `leads_diarios`, `registros_diarios_atendimento`, `pagamentos`, `tratamentos`, `ai_assistant_rules`, `ai_good_examples`, `ai_reply_suggestions`, `crm_lead_stage_history` já está, etc.).
- Verificar a lista completa via `information_schema` antes de escrever a migration, para nada escapar.
- Ao final, `RAISE EXCEPTION` se sobrar qualquer linha com aquele `tenant_id` em qualquer tabela pública — assim erros de esquema aparecem imediatamente em vez de deixar resíduo.

### 4. Limpeza de e-mails órfãos em `auth.users`
Na exclusão do tenant (tanto manual quanto no cleanup de falha), garantir que **todos** os `auth.users` que tinham `user_metadata.tenant_id` = tenant deletado sejam apagados, mesmo se o profile não existir mais. Hoje o código só apaga os usuários listados em `profiles` — se o profile já sumiu por FK, o auth.user fica órfão.

## O que **não** vai ser preservado
Cadastro do cliente (nome, slug, e-mail admin, cores, logo, subscription) — apagado definitivamente. Para "recuperar" um cliente, o caminho é restaurar do backup do banco (Cloud → Advanced settings → Export data), não deixar linhas zumbis.

## Detalhes técnicos

- Arquivos alterados:
  - `supabase/functions/admin-create-tenant/index.ts` — substituir `cleanupFailedTenant` por chamada a `hard_delete_tenant` + `auth.admin.deleteUser` do admin.
  - Migration nova — atualizar `hard_delete_tenant` com todas as tabelas + `RAISE EXCEPTION` de sanidade + limpeza do Luv Agency.
- Nenhuma mudança de UI: o botão "Excluir" no `AdminPanel` continua igual (e o cliente Rizodent segue protegido, como implementado antes).
- Após o deploy: recriar "Luv Agency" com os mesmos e-mail/slug deve funcionar sem erro.

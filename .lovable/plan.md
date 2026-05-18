## Objetivo

Trocar o role do usuário **Rizodent** (`d9b27aa3-049e-4ec9-9ae3-fb160a9544fa`) de `admin` para `posvenda`, e criar overrides em `user_permission_overrides` que preservem **exatamente os acessos atuais** ao Funil, Páginas, Ações e Instagram.

## Mudanças no banco (uma migration SQL)

### 1. Trocar o role
```sql
DELETE FROM public.user_roles
 WHERE user_id = 'd9b27aa3-049e-4ec9-9ae3-fb160a9544fa' AND role = 'admin';

INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('d9b27aa3-049e-4ec9-9ae3-fb160a9544fa', 'posvenda',
        '00000000-0000-0000-0000-000000000010');
```

### 2. Overrides de **pipelines** (7) — todos com `granted = true`
Pipelines hoje visíveis ao admin (tenant Rizodent):

| Nome | ID |
|---|---|
| Funil Principal | `a1b2c3d4-0001-4000-8000-000000000001` |
| Indicação | `93bed281-d907-423d-ab8b-f13fe10a3e4c` |
| Instagram | `c2d3e4f5-0001-4000-8000-000000000002` |
| Não Compareceu | `157ca05b-b454-47c3-bc13-9d15b518a46d` |
| Não contratados | `6e91437d-081b-4026-947b-3ab6d28d6eb5` |
| Nutrição | `a41aac6a-df13-480a-876f-0711dc093899` |
| Pós-venda | `c7fb4a30-32d1-4ba0-a7a9-583a700d825a` |

### 3. Overrides de **páginas** (8) — `scope='page'`, `granted=true`
`dashboard`, `crm`, `calendario`, `daily`, `relatorios`, `pacientes`, `usuarios`, `configuracoes`

### 4. Overrides de **ações sensíveis** (5) — `scope='action'`, `granted=true`
`delete_lead`, `transfer_lead`, `broadcast`, `edit_bot`, `view_finance`

### 5. Overrides de **Instagram** (4) — `scope='instagram_account'`, `granted=true`
| Username | ID |
|---|---|
| rizodentclinicas | `5677255e-e9ba-4a1d-992f-bc389d25097c` |
| rizodentguanambi | `f77955c2-770a-4532-af95-ee1fcccd3115` |
| rizodentipiau | `0d582a26-0fc1-422e-990a-ae1f20281e77` |
| rizodentitabuna | `60afa9fd-991f-42e2-b438-40b8d167e357` |

### 6. WhatsApp
Tabela `whatsapp_numbers` está vazia hoje — **nenhum override necessário**. Quando números forem cadastrados, o default (`can_access_whatsapp_number` retorna `true` sem override) já libera para o Rizodent.

Total: **24 linhas** em `user_permission_overrides` + 1 troca em `user_roles`.

## O que será PERDIDO (avisado anteriormente)

Estes recursos têm RLS hardcoded em `has_role(..., 'admin')` e **não são cobertos** pelo sistema de overrides atual. Após a troca, o Rizodent **não terá mais acesso a**:

- Gerenciar **bots** (criar/editar/versionar/excluir)
- Gerenciar **automações** (`crm_automations`)
- Gerenciar **campos customizados** (`crm_custom_fields`)
- Gerenciar **clínicas** e **tipos de procedimento**
- Configurar **IA assistant** (`ai_assistant_config`)
- Gerenciar **integrações META** (`tenant_meta_credentials`)
- Gerenciar **outros usuários** (`profiles`, `user_roles`, `user_permission_overrides`)
- Ver **`access_logs`**
- **Hard delete** de leads (via funções `hard_delete_*`)
- Configurar **follow-ups** (`crm_followup_configs`)
- Gerenciar **quick replies**, **broadcasts**, **templates WA**
- **Editar funis/etapas** (`crm_pipelines`, `crm_stages`)

Visualizar dados desses módulos pode continuar funcionando se RLS de SELECT for por `tenant_id`, mas **escrita/criação/exclusão será bloqueada**.

## Reversão

Se algo der errado, reverter é trivial — uma migration espelho que faz o caminho inverso (`DELETE posvenda` + `INSERT admin` + `DELETE FROM user_permission_overrides WHERE user_id = ...`).

## Detalhes técnicos

- Único arquivo: nova migration em `supabase/migrations/` com o SQL acima.
- Nenhum código frontend muda — `Usuarios.tsx` e `UserPermissionsSheet.tsx` já suportam `posvenda` e leem overrides via `usePermissions`.
- Após aplicar, validar com:
  ```sql
  SELECT scope, count(*) FROM user_permission_overrides
   WHERE user_id='d9b27aa3-049e-4ec9-9ae3-fb160a9544fa' GROUP BY scope;
  ```
  Esperado: `pipeline=7, page=8, action=5, instagram_account=4`.

## Confirmação necessária

Confirma que quer prosseguir aceitando a **perda dos acessos administrativos** listados acima? Se quiser preservar TAMBÉM bots/automações/usuários/etc., a abordagem correta seria expandir o sistema de overrides para cobrir esses scopes (trabalho bem maior) — não é o que este plano faz.

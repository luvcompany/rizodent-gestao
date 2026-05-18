## Pipeline "Pós-venda" com role dedicada

Hoje qualquer usuário autenticado do tenant lê todos os pipelines/stages — não existe restrição por role. Vamos introduzir o conceito de **pipeline restrito a uma role** sem quebrar o modelo atual.

### 1. Banco — Migração

**1.1. Nova role no enum `app_role`**
- Adicionar valor `'posvenda'` (mantém `admin`, `gerente`, `crc`, `superadmin`).

**1.2. Coluna de restrição em `crm_pipelines`**
- `allowed_roles app_role[] NULL` — quando `NULL`, comportamento atual (todos veem). Quando preenchido, só `admin`/`gerente`/`superadmin` + usuários cuja role esteja no array veem o pipeline.

**1.3. Helper `can_access_pipeline(_pipeline_id uuid)` (SECURITY DEFINER, STABLE)**
- Retorna `true` se: `superadmin`, `admin`, `gerente`, `allowed_roles IS NULL`, ou `EXISTS user_roles do usuário com role ∈ allowed_roles`.

**1.4. Ajuste de RLS**
- `crm_pipelines.SELECT`: substituir `USING true` por `can_access_pipeline(id)`.
- `crm_stages.SELECT`: adicionar `can_access_pipeline(pipeline_id)`.
- `crm_leads.SELECT`: combinar a regra existente (admin/gerente/dono/sem dono) com `can_access_pipeline(pipeline_id)` — usuário precisa atender as duas condições.
- Mesma checagem em INSERT/UPDATE/DELETE para impedir mover lead para pipeline ao qual a role não tem acesso.

**1.5. Seed (via insert tool, não migration)**
- Pipeline `Pós-venda` no tenant Rizodent com `allowed_roles = ARRAY['posvenda']::app_role[]`.
- Stage `Contato inicial`, position 0, cor a definir (sugestão `#10b981`).

### 2. Frontend

**2.1. `AuthContext`**
- Já carrega `userRole`. Nada muda; só passa a entender o valor `'posvenda'`.

**2.2. `Usuarios.tsx`**
- Adicionar opção "Pós-venda" no seletor de role ao criar/editar usuário.

**2.3. CRM Kanban / seletor de pipelines**
- A query atual de pipelines (`crm_pipelines select`) passará a já filtrar via RLS — usuário Pós-venda só vê esse pipeline.
- Garantir que o default `localStorage.lastPipelineId` faz fallback para o primeiro pipeline retornado quando o salvo não está mais visível.

**2.4. Menu/rotas**
- Usuário Pós-venda continua acessando a rota `/rizodent/crm` normalmente. Telas que ele não precisa (Dashboard, Relatórios, Configurações, Calendário, Daily, Usuários) **não são** bloqueadas nesta entrega — apenas o pipeline é restrito. Se quiser esconder essas telas para essa role, faz parte de uma matriz de permissões formal (proposta anterior, fora deste escopo).

### 3. Validações e edge cases

- Triggers existentes (`enforce_lead_tenant_consistency`, `sync_lead_pipeline_with_stage`, etc.) continuam funcionando — não dependem de role.
- `hard_delete_tenant` já remove `crm_pipelines`/`crm_stages` por tenant — nada a alterar.
- Broadcasts, automations, follow-ups e bots do tenant que filtrarem por `pipeline_id`/`stage_id` específicos do Pós-venda continuam funcionando; ninguém configurou nada para esse pipeline ainda.
- Como a regra exige `assigned_to = auth.uid() OR NULL` para CRC, um lead Pós-venda precisa ser atribuído ao usuário Pós-venda (ou ficar sem dono) para ele ver. Isso é o comportamento atual de CRC; aceitável.

### 4. Detalhes técnicos

```text
app_role
  + 'posvenda'

crm_pipelines
  + allowed_roles app_role[] NULL

functions
  + can_access_pipeline(_pipeline_id uuid) returns boolean
      SECURITY DEFINER, STABLE, search_path = public
      true se: has_role(uid,'superadmin'|'admin'|'gerente')
              OR (SELECT allowed_roles FROM crm_pipelines WHERE id=_pipeline_id) IS NULL
              OR EXISTS (SELECT 1 FROM user_roles ur
                          WHERE ur.user_id = auth.uid()
                            AND ur.role = ANY(
                              (SELECT allowed_roles FROM crm_pipelines WHERE id=_pipeline_id)
                            ))

RLS atualizadas (mantém tenant_isolation):
  crm_pipelines.SELECT  USING can_access_pipeline(id)
  crm_stages.SELECT     USING can_access_pipeline(pipeline_id)
  crm_leads.SELECT      USING (regra atual AND can_access_pipeline(pipeline_id))
  crm_leads.INSERT/UPDATE WITH CHECK (... AND can_access_pipeline(pipeline_id))
```

Confirma o nome da role como `posvenda` (sem acento/espaço, padrão do enum) e a cor da etapa para eu seguir com a implementação?

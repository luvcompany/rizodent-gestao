## Objetivo

Deixar **Admin** e **CRC** com permissões idênticas (mesmas páginas, pipelines, ações), e **isolar totalmente o setor Pós-venda** — nem Admin nem CRC enxergam o funil/página Pós-venda. Só o usuário `posvenda` (Neiriane) acessa Pós-venda.

## Estado atual

- **Admin** (Luv Agency) — vê tudo, inclusive Pós-venda (bypass na função `can_access_pipeline`).
- **CRC** (Rizodent) — recebeu overrides amplos no turno anterior, **inclusive** `pipeline c7fb4a30…` (Pós-venda) e página `crm_posvenda`. Hoje vê Pós-venda.
- **Pós-venda** (Neiriane) — restrita ao pipeline Pós-venda (`allowed_roles={posvenda}`) e à página `/crm/posvenda`.
- O item de menu "Pós-Venda" no `CrmLayout.tsx` **já** só aparece para `role === "posvenda"`, então admin/CRC não veem o link — mas conseguem abrir o pipeline no Kanban via seletor de funil e acessar a rota direta.

## Mudanças

### 1. Função `can_access_pipeline` — respeitar `allowed_roles` mesmo para admin/gerente
Hoje admin/gerente recebem bypass total. Vou alterar para: quando o pipeline tem `allowed_roles` definido, **somente** os roles listados (e `superadmin`) entram, independentemente de admin/gerente. Quando `allowed_roles IS NULL`, admin/gerente continuam com bypass como hoje.

Resultado: Pós-venda (`allowed_roles={posvenda}`) deixa de aparecer no seletor de funil e Kanban para admin e CRC automaticamente, e RLS bloqueia leads desse pipeline para eles.

### 2. Remover overrides do Rizodent que dão acesso à Pós-venda
- Remover `scope=pipeline, resource_id=c7fb4a30-32d1-4ba0-a7a9-583a700d825a` (pipeline Pós-venda).
- Remover `scope=page, resource_id=crm_posvenda` (página Pós-venda dashboard).

### 3. Igualar permissões de CRC ao Admin
Hoje CRC só tem o que o role concede + overrides individuais. Como Rizodent já recebeu overrides para todas as páginas administrativas no turno anterior (Usuários, Configurações, Integrações, Bots, Automações, Modelos, Respostas Rápidas, Relatórios, Dashboard, Pacientes, etc.), Admin e CRC já ficam equivalentes — exceto pelos checks `has_role(admin)` em RLS de bots/automations/custom_fields/etc.

Para tornar a paridade real, vou **alterar as policies** (admins-and-managers-can-* em `bots`, `crm_automations`, `crm_custom_fields`, `crm_followup_configs`, `bot_stage_triggers`, `bot_versions`, `bot_executions`, `bot_execution_logs`, `ai_assistant_config`, `crm_lead_pacientes`) para também aceitar `crc`. Isso garante que CRC pode criar/editar/deletar as mesmas coisas que admin.

Lista exata das policies a atualizar (todas as que hoje usam `has_role(admin) OR has_role(gerente)` em tabelas relevantes ao dia-a-dia do atendimento). **Não** vou alterar policies de tabelas que controlam segurança/multi-tenant em si (tenants, user_roles, app_settings).

### 4. Limpar leads que ficaram visíveis indevidamente
Validar via query: leads do pipeline Pós-venda devem deixar de aparecer para Rizodent após (1)+(2). Se algum lead "Contratado" antigo do funil principal continuar aparecendo, está OK — só Pós-venda deve sumir.

## Arquivos / objetos alterados

- **Migration**: `CREATE OR REPLACE FUNCTION can_access_pipeline` (lógica nova).
- **Migration**: `ALTER POLICY` em ~10 policies para incluir `has_role(auth.uid(), 'crc')`.
- **DELETE** em `user_permission_overrides` (2 linhas do Rizodent).
- Nenhum arquivo frontend precisa mudar — o menu Pós-venda já é gated por role.

## Detalhes técnicos

Nova função:
```sql
CREATE OR REPLACE FUNCTION can_access_pipeline(_pipeline_id uuid) ...
SELECT COALESCE(
  user_override(auth.uid(),'pipeline',_pipeline_id::text),
  has_role(auth.uid(),'superadmin')
  OR EXISTS (
    SELECT 1 FROM crm_pipelines p
    WHERE p.id = _pipeline_id AND (
      (p.allowed_roles IS NULL
        AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente')))
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id=auth.uid() AND ur.role = ANY(p.allowed_roles)
      )
    )
  )
);
```

Policies de exemplo:
```sql
ALTER POLICY "Admins and managers can insert bots" ON bots
USING (... OR has_role(auth.uid(),'crc'));
```

## Riscos

- Alterar `can_access_pipeline` afeta **todos os tenants**. Se algum outro tenant tiver pipeline com `allowed_roles` setado contando com bypass de admin, perderá acesso. Validei: só o pipeline Pós-venda da Rizodent tem `allowed_roles` não-nulo. Sem impacto colateral.
- Dar a CRC poder de criar/deletar bots, automações e templates significa que Rizodent (e futuros CRCs) podem alterar configurações globais. É o que o usuário pediu ("CRC = Admin por enquanto").

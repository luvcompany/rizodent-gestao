## Objetivo

Adicionar uma tela admin de **Opções por Usuário** que permita configurar, individualmente para cada usuário, quais funis (pipelines), páginas e ações ele pode acessar — **sem precisar mexer na role**. A role continua sendo o padrão; este painel é um conjunto de *overrides* opcionais (grants extras e denies pontuais).

Caso de uso direto: dar a um CRC específico acesso ao funil **Pós-venda**, ou tirar o acesso à página **Relatórios** de um gerente, sem criar uma role nova para cada combinação.

## Onde encaixa na UI

Novo botão **"Permissões"** na linha de cada usuário em `/rizodent/usuarios` (já existe a tabela em `src/pages/Usuarios.tsx`). Abre um modal lateral (`Sheet`) com 3 abas:

1. **Funis** — checkboxes de todos os pipelines do tenant. Marcação herda do `allowed_roles` do pipeline + role do usuário; usuário pode marcar/desmarcar para override.
2. **Páginas** — checkboxes das seções do menu (Dashboard, CRM, Calendário, Daily, Relatórios, Pacientes, Usuários, Configurações). Herda da role; pode override.
3. **Ações sensíveis** — toggles para: excluir leads, transferir leads, broadcast em massa, editar bots, ver relatórios financeiros.

Visual: badge "Herdado da role" cinza ao lado dos itens não-override; quando o admin altera, vira "Personalizado" laranja. Botão **"Voltar ao padrão da role"** limpa todos os overrides daquele usuário.

## Modelo de dados

Uma única tabela genérica `user_permission_overrides`:

```text
user_permission_overrides
  id            uuid pk
  user_id       uuid not null   (auth.users)
  scope         text not null   ('pipeline' | 'page' | 'action')
  resource_id   text not null   (uuid do pipeline, slug da página, ou nome da ação)
  granted       boolean not null (true = grant, false = deny)
  created_by    uuid
  created_at    timestamptz
  unique (user_id, scope, resource_id)
```

- `granted = true` → libera mesmo se a role base negaria.
- `granted = false` → bloqueia mesmo se a role base liberaria.
- Ausência de linha → segue a regra padrão da role.

Helper SQL `user_can(_user_id, _scope, _resource_id) returns boolean` que consulta a tabela e cai pra `has_role()`/`can_access_pipeline()` quando não há override.

`can_access_pipeline()` é atualizada para consultar `user_can(auth.uid(), 'pipeline', _pipeline_id::text)` antes da regra atual de `allowed_roles`.

## Permissões da própria tela

Só `admin` e `superadmin` podem ler/escrever em `user_permission_overrides` (RLS via `has_role`). Gerente não edita permissões.

## Frontend

- **Novo componente** `src/components/usuarios/UserPermissionsSheet.tsx` — abre via botão "Permissões".
- **Novo hook** `usePermissions()` em `src/hooks/usePermissions.ts` — carrega overrides do usuário logado + role, expõe `can(scope, resourceId)` e cacheia no React Query.
- **Refator suave** nas guardas atuais (`AuthContext.userRole`, rotas com `requiresRole`) para consultar `can()` em vez de checar role direta — só nas páginas/ações que entrarem no escopo da aba "Páginas/Ações".
- **Aba "Funis"** reaproveita `crm_pipelines` (já filtrado por tenant) e mostra cor + nome.

## Fora do escopo desta entrega

- Não cria role nova nem altera `app_role` enum.
- Não mexe em segregação de **agendamentos/tasks** por role — fica para uma próxima entrega (já discutido em mensagem anterior).
- Não cria "grupos de permissão" reutilizáveis (cada usuário é configurado isoladamente). Se a operação crescer, pode virar `permission_templates` no futuro.

## Detalhes técnicos

- Migração:
  - Cria `user_permission_overrides` com índice `(user_id, scope)`.
  - RLS: SELECT/INSERT/UPDATE/DELETE só para `admin`/`superadmin`.
  - Função `user_can(_user_id uuid, _scope text, _resource_id text) returns boolean security definer`.
  - Atualiza `can_access_pipeline()` para consultar `user_can` primeiro.
- Frontend:
  - `UserPermissionsSheet.tsx` (~250 linhas) com 3 `<Tabs>` e estado controlado.
  - `usePermissions.ts` (~80 linhas) com React Query + invalidate ao salvar.
  - `Usuarios.tsx`: adiciona botão "Permissões" na coluna de ações.
- Sem mudança em edge functions.
- Sem migração de dados (overrides começam vazios — todo mundo continua com permissão atual via role).

## Pontos a confirmar antes de implementar

1. **Lista de páginas controláveis** na aba "Páginas": confirmar se inclui só as 8 que listei ou se quer granularidade maior (ex.: "ver tabela X dentro de Relatórios").
2. **Lista de ações sensíveis**: as 5 que listei são suficientes ou tem outras (ex.: "enviar template fora do horário", "editar valor de lead")?
3. **Modal vs. página dedicada**: prefere o `Sheet` lateral (proposto) ou uma sub-rota `/usuarios/:id/permissoes` em página cheia?
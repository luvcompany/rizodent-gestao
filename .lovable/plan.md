## Análise: estão faltando leads ocultos?

Verifiquei o banco e **não há leads escondidos para usuários administradores** no momento:

- **245 leads** estão no pipeline **Pós-venda** (`allowed_roles = {posvenda}`) — corretos, todos atribuídos à Neiriane (posvenda).
- **102 leads** no pipeline **Instagram / Novo Lead** estão **sem dono (`assigned_to IS NULL`)** mas o pipeline não tem `allowed_roles` restrito, então a Rizodent (admin) os vê normalmente.
- Demais pipelines (Funil Principal, Indicação, Nutrição, Não contratados, Não Compareceu, Instagram) **não têm `allowed_roles`** → visíveis a todos os papéis com acesso.
- ZENAIDE (recuperada na conversa anterior) está em Funil Principal / Contratado, atribuída à Rizodent. OK.

Usuários atuais:
| Papel | Usuário |
|---|---|
| admin | Luv Agency, Rizodent |
| posvenda | Neiriane |
| crc | (vazio — papel sem uso) |

Conclusão: o sistema está consistente, sem leads "fantasmas". Podemos seguir com o rename.

---

## Plano: excluir CRC atual e renomear Admin → CRC

A função `admin` (com todos os acessos atuais) passará a se chamar `crc`. Depois você criará um novo papel `admin` à parte com permissões diferentes (fora do escopo desta task).

### Etapa 1 — Migração no banco

Como o enum `app_role` é referenciado por **120 políticas RLS**, várias funções e colunas (`user_roles.role`, `owner_role` em bots/broadcasts/quick_replies/templates/appointments, `crm_pipelines.allowed_roles`), faremos uma migração em transação:

```text
1. Liberar o nome 'crc':
   ALTER TYPE app_role RENAME VALUE 'crc' TO 'crc_legacy';
2. Renomear admin → crc:
   ALTER TYPE app_role RENAME VALUE 'admin' TO 'crc';
3. Recriar todas as policies/funções que faziam referência literal a
   'admin'::app_role substituindo por 'crc'::app_role
   (Postgres não atualiza o texto das policies sozinho, então o
   DROP/CREATE é obrigatório para as ~120 policies + funções
   has_role, can_access_pipeline, RPCs e triggers afetados).
4. Substituir referências a 'crc'::app_role nas mesmas policies
   por 'crc_legacy'::app_role apenas onde for necessário preservar
   a semântica "antigo CRC" (em geral, removeremos a duplicata, já
   que admin e crc passam a ser o mesmo papel).
5. Atualizar defaults de owner_role / allowed_roles que apontavam
   para 'admin' para passar a apontar para 'crc'.
```

O valor `crc_legacy` ficará no enum (Postgres não permite remover valores), mas sem nenhuma linha em `user_roles` e sem políticas dependentes — invisível na UI.

### Etapa 2 — Atualização do frontend (15 arquivos)

Substituir literais `'admin'` por `'crc'` em comparações de role nestes arquivos (somente o significado de papel, não strings tipo `/admin` em rotas):

- `src/lib/accessLog.ts`
- `src/pages/Usuarios.tsx`
- `src/pages/CrmModelos.tsx`, `CrmDashboard.tsx`, `CrmCampanhas.tsx`, `CrmRespostasRapidas.tsx`, `CrmPosVendaDashboard.tsx`, `CrmCalendario.tsx`, `CrmBots.tsx`
- `src/pages/admin/AdminLogs.tsx`, `AdminLogin.tsx` (rota `/admin` permanece — é o painel superadmin)
- `src/components/usuarios/UserPermissionsSheet.tsx`
- `src/components/crm/ShareRoleDialog.tsx`

Removerei também a opção "CRC" antiga do seletor de papéis (em Usuários e em diálogos de compartilhamento), deixando: **CRC, Gerente, Pós-venda, Superadmin**.

### Etapa 3 — Verificações pós-migração

- Confirmar via SQL que `user_roles` tem 2 usuários `crc` (Rizodent, Luv) e 1 `posvenda` (Neiriane).
- Confirmar que Rizodent continua vendo os mesmos pipelines/funis/leads (RLS preserva acesso).
- Rodar linter de segurança e o type-check do projeto.

### Memória a atualizar

`mem://auth/roles` e o Core (`app_role enum`) serão ajustados para: `crc, gerente, posvenda, superadmin` (com `crc_legacy` interno).

### Observações importantes

- A migração é **destrutiva em policies** (DROP/CREATE de ~120 políticas em uma transação). Não há perda de dados, mas o deploy precisa ser feito em momento de baixa atividade.
- Como o usuário Rizodent passa de `admin` para `crc`, todos os botões/condições que hoje checam "é admin" passarão a checar "é crc". Os acessos ficam idênticos.
- Quando você criar o novo papel `admin` depois, ele será um valor novo do enum, sem herdar nada das policies antigas — você definirá quais áreas o novo admin pode acessar.

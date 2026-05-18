## Diagnóstico

### Bug 1 — Pós-venda voltou a ver modelos do Rizodent/Admin

A migração mais recente de `owner_role` (18/05 15:12) recriou a política de RLS de `crm_whatsapp_templates` com a regra:

```
owner_role IS NULL
OR owner_role IN ('admin', 'superadmin')   ← isso libera para TODO MUNDO
OR has_role(auth.uid(), owner_role)
```

Ou seja, qualquer usuário (inclusive pós-venda) enxerga modelos cujo dono é `admin` ou `superadmin`. Foi exatamente isso que reabriu o vazamento. A regra correta é: usuário só vê modelos **compartilhados** (`owner_role IS NULL`) ou da **própria role**.

### Bug 2 — Página de Modelos abre lenta no Rizodent

O `fetchTemplates` em `src/pages/CrmModelos.tsx` faz, em sequência, em toda visita à página:

1. Carrega do banco local (rápido) ✅
2. **Sempre** chama o edge function `manage-whatsapp-templates` action `list` (que vai na API da Meta) ❌
3. Refaz o `select` do banco

Mesmo com o "local-first", a chamada à Meta dispara em background a cada navegação para `/crm/modelos` (e em cada troca de integração), o que deixa a tela travada/piscando em rede ruim, consome ciclo de CPU/RAM da instância do Cloud e ainda dispara re-renders. Já existe um botão **"Sincronizar"** manual no header — o auto-sync é redundante.

---

## Plano de correção

### 1. Migração — corrigir a política RLS de `crm_whatsapp_templates`

```sql
DROP POLICY IF EXISTS "Templates visible by role" ON public.crm_whatsapp_templates;

CREATE POLICY "Templates visible by role"
ON public.crm_whatsapp_templates FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);
```

(Removi o trecho `OR owner_role IN ('admin','superadmin')`. Admin/gerente/superadmin continuam vendo tudo pelas três primeiras linhas; demais roles só veem o que é deles ou compartilhado.)

### 2. Migração — trigger para marcar `owner_role` automaticamente em novos modelos

Já existe a função `set_owner_role_from_user()`. Falta o trigger nesta tabela:

```sql
CREATE TRIGGER trg_set_owner_role
BEFORE INSERT ON public.crm_whatsapp_templates
FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_from_user();
```

### 3. Decisão de dados — backfill dos 91 modelos existentes

Hoje todos os 91 modelos estão com `owner_role = NULL` (= compartilhados com todo mundo). Se o objetivo é **isolar de pós-venda**, precisamos backfillar. Opções:

- **(A)** Definir `owner_role = 'admin'` para todos os 91 → pós-venda não vê nenhum.
- **(B)** Deixar como está (compartilhados) e cada novo modelo passa a ser por-role via trigger. Para limpar, o admin usa o botão "Compartilhar" um a um.

Preciso confirmar essa decisão com você (pergunta abaixo).

### 4. Código — `src/pages/CrmModelos.tsx`

Remover o auto-sync com a Meta dentro do `fetchTemplates`. A função passa a apenas ler do banco local (instantâneo). A sincronização com a Meta continua disponível pelo botão **"Sincronizar"** existente no header.

```ts
const fetchTemplates = useCallback(async () => {
  setLoading(true);
  const { data } = await supabase
    .from("crm_whatsapp_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (data) setTemplates(data as WhatsAppTemplate[]);
  setLoading(false);
}, []);
```

(remove o bloco `try { ... supabase.functions.invoke("manage-whatsapp-templates", ...) }` de dentro do fetch)

---

## Resultado esperado

- Pós-venda deixa de ver modelos do admin (correção real, sem hack no client).
- Página `/crm/modelos` abre instantânea em toda navegação — sem esperar a API da Meta.
- Botão **"Sincronizar"** segue funcional para puxar atualizações da Meta sob demanda.
- Novos modelos criados já nascem com `owner_role` da role de quem criou.

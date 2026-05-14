## Problema

As mensagens do Instagram da **Luvagency** estão sendo gravadas no CRM da **Rizodent**.

A causa está na função `instagram-lite-webhook` — embora ela encontre corretamente a conta IG e o `tenant_id` correto na tabela `ig_accounts`, **nada disso é usado** ao criar o lead, gravar a mensagem ou buscar o pipeline. O resultado:

1. **Pipeline hardcoded da Rizodent** — a constante `INSTAGRAM_PIPELINE_ID = "c2d3e4f5-...-0002"` aponta para o pipeline "Instagram" da Rizodent (`tenant_id = 00000000-...-0010`). Toda mensagem nova entra nesse pipeline, independentemente da conta.
2. **Lookups de lead sem filtro de tenant** — buscas em `crm_lead_instagram_identities` e `crm_leads` ignoram tenant.
3. **Inserts sem `tenant_id` explícito** — como o webhook usa `service_role` e não preenche `tenant_id`, os registros caem no default da coluna (`00000000-...-0010` = Rizodent).
4. **Luvagency hoje não tem nenhum pipeline** cadastrado, então o lead precisa ser criado em um pipeline novo.

## O que vou alterar

### 1. `supabase/functions/instagram-lite-webhook/index.ts`

Tornar a função tenant-aware usando `ig_accounts.tenant_id`:

- Selecionar `tenant_id` junto com a conta IG.
- Resolver o pipeline do Instagram **por tenant**:
  - Procurar em `crm_pipelines` um pipeline desse tenant cujo `name` contenha "Instagram" (case-insensitive).
  - Se não existir, criar automaticamente um pipeline "Instagram" + estágios padrão (`Novo Lead`, `Em conversa`, `Agendado`, `Contratado`) para o tenant.
  - Cachear o resultado por tenant durante a invocação.
- Em `findOrCreateLead`:
  - Filtrar todas as buscas (`crm_lead_instagram_identities`, `crm_leads`) por `tenant_id`.
  - Passar `tenant_id` no insert do `crm_leads`.
- Em `persistMessage`:
  - Passar `tenant_id` no insert do `messages` (a tabela `instagram_messages` não tem coluna tenant, então não muda).

### 2. Migração SQL

Criar função SQL `ensure_instagram_pipeline(_tenant_id uuid)` que:
- Procura pipeline "Instagram" do tenant; se existir, retorna o id.
- Senão, cria pipeline + 4 estágios padrão e retorna o id.

Isso evita race conditions e centraliza a lógica.

### 3. Auditoria rápida da rota WhatsApp

A `whatsapp-webhook` já encontra o tenant via `whatsapp_config.phone_number_id`, mas vou verificar se ela passa `tenant_id` ao criar leads — se não passar, sofre do mesmo problema. Se confirmado, aplico o mesmo fix (só leitura+correção dos inserts de lead, sem mexer no resto).

## Observações

- Não vou tocar nas mensagens já gravadas erradas no tenant Rizodent. Se você quiser, faço uma migração separada para mover os leads recém-criados (filtrando por `source ILIKE 'Instagram Lite (@luv.company_)%'`) para o tenant da Luvagency.
- O pipeline criado automaticamente terá nome "Instagram" e cores padrão. Você poderá renomear/reordenar normalmente depois.

## Pergunta

Quer que eu **mova retroativamente** os leads/mensagens da Luvagency que já foram parar na Rizodent, ou só corrijo daqui para frente?
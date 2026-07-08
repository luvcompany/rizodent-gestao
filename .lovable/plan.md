## Diagnóstico

A migration anterior criou 4 políticas `RESTRICTIVE` (em `crm_pipelines`, `crm_stages`, `crm_leads` e `messages`) que usam `EXISTS (SELECT … FROM crm_pipelines …)` dentro do `USING`. Essa subconsulta é executada **respeitando o RLS** de `crm_pipelines` — que por sua vez agora tem outra política `RESTRICTIVE` (`hide_posvenda_pipelines`).

Isso torna a avaliação frágil: dependendo do contexto (cache de plano do Postgres, joins entre as tabelas, ordem de aplicação), a subconsulta pode retornar `false` para pipelines que o usuário **deveria** enxergar — como o Funil Principal. Efeito prático relatado: as etapas do Funil Principal deixam de aparecer no Kanban.

## Correção

Trocar a subconsulta inline por uma função `SECURITY DEFINER` que consulta `crm_pipelines` **ignorando RLS**, retornando apenas o booleano `is_posvenda`. Como a função roda com privilégio elevado e retorna só um `boolean`, não há vazamento de dado e o resultado é sempre consistente.

### Passos

1. **Criar helper** `public.is_posvenda_pipeline(_pipeline_id uuid) RETURNS boolean`
   - `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`
   - Retorna `COALESCE((SELECT is_posvenda FROM crm_pipelines WHERE id = _pipeline_id), false)`.

2. **Recriar as 4 políticas `RESTRICTIVE`** substituindo o `EXISTS` por chamadas à função:
   - `hide_posvenda_pipelines` em `crm_pipelines`: `is_posvenda = false OR posvenda/superadmin`.
   - `hide_posvenda_stages` em `crm_stages`: `NOT is_posvenda_pipeline(pipeline_id) OR posvenda/superadmin`.
   - `hide_posvenda_leads` em `crm_leads`: `pipeline_id IS NULL OR NOT is_posvenda_pipeline(pipeline_id) OR posvenda/superadmin`.
     - Inclui `pipeline_id IS NULL` para não sumir com leads sem funil (evita regressão).
   - `hide_posvenda_messages` em `messages`: usa outro helper `is_posvenda_lead(lead_id)` (também `SECURITY DEFINER`) para evitar dupla-lookup.

3. **Manter o restante intacto**: as políticas `PERMISSIVE` (`tenant_isolation`, `Users can view allowed pipelines`, `Users can view stages of allowed pipelines`, `Users can view assigned or own leads…`) continuam iguais. A trava do Pós-venda fica apenas nas RESTRICTIVE, que são AND-adas com as demais.

### Resultado esperado

- Usuário CRC (Rizodent) volta a enxergar todas as etapas e leads do Funil Principal e demais funis da clínica.
- Funil "Pós-venda", suas etapas, leads e mensagens continuam ocultos para quem não é `posvenda` nem `superadmin`.
- Nenhuma alteração de código no frontend.

Após a migration ser aplicada, basta o usuário recarregar a página (Ctrl+Shift+R) para limpar o cache local do Kanban.

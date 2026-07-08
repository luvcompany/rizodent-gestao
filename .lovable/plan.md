## Objetivo
Adicionar UMA rota nova, aditiva e somente leitura, ao edge function `supabase/functions/admin-api/index.ts`: `GET /reports/clientes-pagantes`. Exporta a lista de pacientes que já efetuaram algum pagamento, agregada por paciente.

## Autenticação
Reutiliza exatamente o mesmo middleware que `/leads`, `/reports/financeiro` etc. já usam nesse arquivo (`Authorization: Bearer <RIZODENT_ADMIN_API_KEY>` + resolução do `tenant_id`). Nenhuma alteração no handler de auth.

## Fontes de dados (mesmas do /reports/financeiro)
- `pagamentos` — a tabela NÃO tem `tenant_id`; o escopo por tenant é feito via `clinica_id ∈ clinicas do tenant` (padrão idêntico ao que o `/reports/financeiro` já faz).
  - Colunas usadas: `paciente_id`, `valor` (numeric), `data_pagamento` (date), `especialidade` (text, opcional), `clinica_id`.
- `pacientes` (filtrado por `tenant_id`): `id`, `nome`, `telefone`, `cidade`.
- `clinicas` (filtrado por `tenant_id`): apenas para obter os `clinica_id` válidos do tenant.

Não usamos `crm_leads` para o telefone: a coluna `pacientes.telefone` é NOT NULL e é a fonte canônica do cadastro do paciente. Assim evitamos duplicação e divergência lead↔paciente.

## Algoritmo
1. Buscar `clinicas` do tenant → array `clinicaIds`.
2. `fetchAllPaged` em `pagamentos` filtrando por `clinica_id ∈ clinicaIds` (sem filtro de data — queremos histórico completo). Selecionar apenas `paciente_id, valor, data_pagamento, especialidade`.
3. Agregar em memória por `paciente_id`:
   - `valor_total` = soma de `valor`
   - `qtd_pagamentos` = count
   - `primeira_compra` = min(`data_pagamento`)
   - `ultima_compra` = max(`data_pagamento`)
   - `servico` = especialidade com maior `valor_total` acumulado desse paciente (fallback: primeira não-nula; se todas nulas → `null`).
4. Buscar `pacientes` do tenant em blocos (`chunk` de 150 ids, mesmo padrão já usado no arquivo): `id, nome, telefone, cidade`. Pacientes que não vierem no join (ex.: pagamento órfão) são descartados — garante escopo de tenant.
5. Montar array final, aplicar telefone via `normalizePhoneE164` simples: strip não-dígitos, prefixar `+55` se faltar (implementação local no arquivo, sem tocar em `src/lib/phoneUtils`).
6. Ordenar por `valor_total` desc.
7. Aplicar `limit` (default 5000, cap 20000) e `offset` (default 0) por `URLSearchParams`.
8. Retornar `{ data, total }` onde `total` é o tamanho ANTES da paginação.

## Resposta
```json
{
  "data": [
    { "nome": "...", "telefone": "+55...", "cidade": "...", "valor_total": 0, "qtd_pagamentos": 0, "primeira_compra": "YYYY-MM-DD", "ultima_compra": "YYYY-MM-DD", "servico": "..." }
  ],
  "total": 0
}
```

## Garantias de não-regressão
- Nenhum `INSERT/UPDATE/DELETE`, nenhuma migração, nenhuma mudança de RLS.
- Nenhuma rota, helper ou constante existente é alterada — só adiciono um `if (path === "/reports/clientes-pagantes" && method === "GET")` no router e uma função nova `reportClientesPagantes(tenantId, params)`.
- Adiciono `"GET /reports/clientes-pagantes?limit=&offset="` no bloco de documentação `/` (mesma seção onde `/reports/financeiro` está listada) — puramente cosmético.
- Reuso os helpers já importados no arquivo (`fetchAllPaged`, `chunk`), sem novos imports pesados.
- Nenhuma mudança em `supabase/config.toml` (a function já está deployada com `verify_jwt = false` + validação por API key no código).

## Observações
- Sem filtro de período por design: "todos que já contrataram" é histórico completo. Se depois quiser `?from=&to=`, é aditivo também.
- Performance: o join é feito em memória, mas `pagamentos` já é paginado; o `chunk(150)` em `pacientes.in('id', ...)` é o mesmo teto usado hoje em `/reports/financeiro`.

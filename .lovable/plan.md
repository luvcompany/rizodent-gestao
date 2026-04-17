

## Objetivo

Permitir que cada pagamento seja vinculado a um **procedimento específico** dentro do orçamento, mantendo o orçamento como um valor total à parte. Em novos pagamentos, o usuário escolhe se está pagando um procedimento já existente do orçamento ou adicionando um procedimento novo (ainda não cadastrado) e registrando o pagamento dele.

## Modelo de Dados

A tabela `pagamentos` já tem `tratamento_id` (procedimento) + `orcamento_id`. Não precisa migração — só vamos passar a usá-los corretamente:
- **Orçamento** = valor total previsto (independente).
- **Tratamento** = procedimento individual (Implante, Limpeza...) vinculado ao orçamento.
- **Pagamento** = valor pago para um tratamento específico, vinculado ao orçamento.

## Mudanças em `src/pages/Atendimento.tsx`

### A) Modo "Novo Tratamento / Orçamento" (criar do zero)
Substituir os campos únicos "Valor Orçado" / "Valor Contratado" gerais por:
- **Valor Orçado total** (1 campo, nível orçamento).
- Em cada card de procedimento adicionado, um campo extra **"Valor Contratado deste procedimento (R$)"**.
- Campo somatório calculado: "Total Contratado" = soma dos valores de cada procedimento. "Não Contratado" = Orçado − Total Contratado.
- Ao salvar: cria 1 orçamento + N tratamentos. Para cada tratamento com valor > 0, cria 1 pagamento vinculado àquele `tratamento_id`.

### B) Modo "Novo Pagamento" (orçamento existente)
Substituir o input único "Valor do Pagamento" por uma lista dinâmica:
- Toggle/seletor: **"Procedimento já existente"** ou **"Novo procedimento"**.
- Se **existente**: dropdown com tratamentos do orçamento selecionado + campo "Valor a pagar".
- Se **novo**: select de tipo de procedimento + especialidade (igual ao fluxo de novo tratamento) + campo "Valor a pagar". Ao salvar, cria o `tratamento` no orçamento atual antes do pagamento.
- Botão "+ Adicionar outro pagamento" permite registrar múltiplos lançamentos no mesmo formulário (ex: implante R$2000 + limpeza R$100 no mesmo dia).
- Validação: soma dos novos pagamentos + já pagos ≤ valor orçado.
- Ao salvar: cria N pagamentos, cada um com seu `tratamento_id` correto. Marca orçamento como `concluido` se total atingir o orçado.

### C) Resumo do orçamento selecionado
No card de seleção de orçamento (já existente), exibir por procedimento o quanto já foi pago: `Implante — Pago R$ 2.000` / `Limpeza — Pago R$ 100`, para o usuário entender o estado.

## Mudanças em `src/pages/PacienteDetalhe.tsx`
Pequeno ajuste de exibição: agrupar pagamentos por `tratamento_id` dentro de cada orçamento (já é estruturalmente compatível, só formatar visualmente para deixar claro qual procedimento recebeu qual pagamento).

## Diagrama

```text
Orçamento (R$ 10.000)
├── Tratamento: Implante     → Pagamentos: R$ 2.000 (03/04) + R$ 1.000 (15/04)
├── Tratamento: Limpeza      → Pagamentos: R$ 100   (03/04)
└── Tratamento: Clareamento  → Pagamentos: (sem pagamentos ainda)
```

## Arquivos
1. `src/pages/Atendimento.tsx` — refatorar formulário de novo tratamento (valor por procedimento) e modo novo pagamento (lista dinâmica com escolha de tratamento existente ou novo).
2. `src/pages/PacienteDetalhe.tsx` — agrupar exibição de pagamentos por procedimento dentro do orçamento.


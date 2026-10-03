# Pacientes: valores zerados, seleção em massa, filtro e ações na lista

## 1. Por que aparece "R$ 0,00"
Não é pagamento zerado. Os pacientes com R$ 0,00 (Tamiles, Geni, Vinícius e outros) só têm **mensalidades de ortodontia** (ex.: R$ 90,00 em 03/10, 05/09, 08/08). A tela não soma mensalidade de orto em "Contratado", com a mesma regra do Dashboard, e por isso mostra zero.

Correção (só na exibição, a regra do Dashboard fica igual):
- Quando o paciente tiver mensalidades de orto no período, a linha mostra **"Mensalidade orto: R$ X"** (total do período) e o **último pagamento de orto**, no lugar de "Contratado: R$ 0,00".
- "Contratado" só aparece quando o valor for maior que zero.
- Nenhuma linha mostra "R$ 0,00".

## 2. Seleção e exclusão em massa
- Cada linha ganha uma caixa de seleção à esquerda.
- No topo da lista: "Selecionar todos" (só os que aparecem com a busca e os filtros atuais) e o contador "X selecionados".
- O botão **Excluir selecionados** abre uma confirmação com o número de pacientes, avisando que pagamentos e tratamentos deles também serão apagados.
- A exclusão segue a mesma ordem que a ficha do paciente já usa: pagamentos, depois tratamentos, depois paciente. Se a permissão bloquear algum, o aviso diz quantos não foram excluídos.

## 3. Filtro Recorrente / Cliente novo
- Ao lado do Período entra uma caixa **Tipo**: Todos, Recorrente ou Cliente novo, com a mesma regra da etiqueta que já aparece hoje.
- O subtítulo continua mostrando o total cadastrado.

## 4. Ações direto na lista
O botão do olho continua, e entram três ações por linha:
- **Editar**: abre um diálogo com nome, telefone e cidade e salva igual à ficha.
- **Ver conversa**: abre a conversa do lead ligado ao paciente. Só aparece quando existe esse vínculo.
- **Excluir**: confirma e exclui só aquele paciente.

No celular, as ações ficam num menu "..." para nada ficar cortado.

## Detalhes técnicos
- `src/pages/Pacientes.tsx`: somar `valorOrto`/`ultimoOrto` por paciente; estado `selecionados: Set<string>`; filtro `tipo`; buscar `crm_lead_pacientes (paciente_id, lead_id)` para o link `/crm/conversas?lead=`; `AlertDialog` para excluir; `Dialog` de edição com `update` em `pacientes`.
- Cores só por tokens (orto em `text-info`/neutro, excluir em `destructive`), checkbox e botões h-10 rounded-xl, sem rolagem horizontal em 1024 e 390.
- Sem mudança no banco.

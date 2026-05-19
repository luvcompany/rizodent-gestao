## Diagnóstico (importante)

O WhatsApp da Meta **só substitui placeholders no formato `{{1}}`, `{{2}}`, `{{3}}`** — qualquer outra coisa (como `[nome]`, `[lead.nome]`, `{nome}`) vai **literalmente** no texto enviado ao paciente.

Hoje no sistema:
- `send-whatsapp-message` reconhece somente `{{N}}` (regex `/\{\{\s*(\d+)\s*\}\}/g`)
- A posição é **fixa**:
  - `{{1}}` → Nome do lead (fallback "cliente")
  - `{{2}}` → Data e hora do próximo agendamento (dd/mm/aaaa às HH:mm)
  - `{{3}}` → Serviço de interesse
  - `{{4}}` → Telefone (fallback extra)
  - `{{5}}` → Origem (fallback extra)
- O botão atual "+ Variável" só insere `{{1}}`, `{{2}}`… numerados sequenciais, sem mostrar o que cada número significa.

**Verificação dos modelos antigos do CRC:** Se algum modelo aprovado contém `[nome]`, `[lead.nome]`, `{nome}` ou qualquer texto fora do padrão `{{N}}`, ele está sendo enviado **literalmente** (o lead recebe a palavra `[nome]` no lugar do nome). Vamos rodar uma checagem na tabela `crm_whatsapp_templates` e listar quais modelos têm esse problema, para você decidir quais reescrever/reenviar para aprovação.

> Observação adicional: a Meta normalmente rejeita templates com placeholders fora do padrão `{{N}}` no momento da submissão, mas se o template foi aprovado com texto solto entre colchetes, ele passa como texto comum — sem substituição.

## O que vamos construir

### 1. Seletor de variáveis no editor de Modelos (`src/pages/CrmModelos.tsx`)
Substituir o botão "+ Variável" por um **Popover** com a lista das variáveis disponíveis. Cada item insere o `{{N}}` correto na posição do cursor:

| Rótulo na lista              | Insere | O que o CRM preenche no envio                         |
|------------------------------|--------|--------------------------------------------------------|
| Nome do lead                 | `{{1}}` | `lead.name` (ou "cliente")                            |
| Data e hora do agendamento   | `{{2}}` | próximo agendamento confirmado/pendente               |
| Serviço de interesse         | `{{3}}` | `lead.servico_interesse` (ou "consulta")              |
| Telefone do lead             | `{{4}}` | `lead.phone`                                          |
| Origem do lead               | `{{5}}` | `lead.source`                                          |

Regras do seletor:
- Insere na posição do cursor (não só no final).
- Mostra um aviso curto abaixo do campo: *"Use o botão Variável; a Meta só reconhece `{{N}}`. Evite escrever `[nome]` manualmente."*
- Bloqueia repetição da mesma variável (Meta exige `{{1}}` antes de `{{2}}`, etc.) — se o usuário inserir fora de ordem, mostramos um toast pedindo para reorganizar.

### 2. Preview com nomes reais (não números)
No painel "Preview" à direita, renderizar `{{1}}` como `Maria Silva`, `{{2}}` como `20/05 às 14:00`, `{{3}}` como `Implante`, etc. — assim você vê exatamente como o lead vai receber. Hoje o preview mostra o texto cru com `{{1}}`.

### 3. Auditoria dos modelos atuais
Consultar `crm_whatsapp_templates` (somente leitura) e listar os modelos cujo `body_text` contém:
- `[nome]`, `[Nome]`, `{nome}`, `[lead.*]`, `[paciente]`
- ou qualquer texto entre `[...]` que não seja `{{N}}`

Vamos te mostrar a lista no chat para você decidir quais reescrever e reenviar para aprovação na Meta (os já aprovados precisarão de um novo submit, pois texto aprovado não pode ser editado).

## Arquivos alterados

- `src/pages/CrmModelos.tsx` — substituir botão "+ Variável" por Popover com lista, inserção na posição do cursor, preview com valores de exemplo, aviso visual.

## Fora do escopo deste plano
- Nenhuma mudança em Edge Functions (a resolução `{{N}}` já funciona corretamente).
- Nenhuma mudança no banco.
- A correção dos modelos antigos será feita por você (re-submit na Meta) depois que listarmos os afetados.

Posso aprovar para implementar?
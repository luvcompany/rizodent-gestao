## Objetivo

Reduzir erros recorrentes da Bia observados nas últimas 3 sugestões (Haislan, Maristela, MC João) com 3 camadas: **(A) reforço no prompt**, **(B) enriquecimento do contexto (FATOS)**, e **(C) auto-crítica antes de responder**.

Escopo: apenas backend, arquivo `supabase/functions/generate-reply-suggestion/index.ts`. Sem mudanças de UI, modelo, RAG ou tabelas novas.

---

## A. Reforço no system prompt

Adicionar novas regras ao bloco `=== ANTI-ALUCINAÇÃO ===` e criar uma seção `=== NOME DO CLIENTE ===`:

1. **Nome do cliente**
   - Usar SEMPRE `lead.name` dos FATOS. NUNCA usar @username do Instagram como nome.
   - Se `lead.name` contém prefixos/apelidos ("MC", "Dr", "Dra", "Sr", "Sra", "Pr", "Pra"), pular para o primeiro nome próprio real (ex.: "MC JOÃO" → "João").
   - Se, no meio da conversa, o próprio lead informar um nome diferente (ex.: "eu me chamo Maristela"), adotar esse nome imediatamente.

2. **Múltiplos serviços mencionados**
   - Quando o anúncio de origem for de um serviço (ex.: facetas) e o lead pergunte sobre outro (ex.: aparelho), reconhecer os DOIS temas na resposta — não substituir um pelo outro.

3. **Notas fixadas / observações do lead são prioridade máxima**
   - Se há nota como "vai viajar dia X e volta em Y", TODA data mencionada pelo lead deve ser cruzada com essa nota antes de confirmar/responder.
   - NUNCA contradizer ou ignorar nota fixada.

4. **Paciente existente**
   - Se o lead disser "já sou paciente", "já fiz aí", "já coloquei/tratei aí", "já fui atendido aí", ou similar, NÃO tratar como lead novo. Reconhecer, dizer que vai verificar no cadastro, e NÃO pedir cidade/serviço como se fosse a primeira interação.

5. **Datas ambíguas**
   - Se o lead diz "dia 20" sem mês e há nota de viagem/retorno em determinado mês, assumir o mês do retorno (ou perguntar explicitamente qual mês). NUNCA presumir que é a semana atual.

---

## B. Enriquecimento dos FATOS CONFIRMADOS

No `factsBlock`:

1. **Detectar e sinalizar paciente existente**
   - Consultar `crm_lead_pacientes` (já existe o vínculo automático por telefone) e, se houver `paciente_id` vinculado, adicionar linha:
     `Cliente é PACIENTE JÁ CADASTRADO no financeiro (nome no cadastro: X). Reconhecer, não pedir dados como se fosse novo.`

2. **Extrair primeiro nome limpo**
   - Ajustar o cálculo de `firstName` para pular prefixos comuns (MC, DR, DRA, SR, SRA, PR, PRA, PROF).

3. **Bloqueio de @username**
   - Se `lead.name` estiver vazio mas o lead vier do Instagram, injetar aviso: `NÃO use o @username como nome — trate como "Oi!" neutro até o lead dizer o nome.`

4. **Data de referência para interpretação**
   - Adicionar linha com a data de hoje por extenso: `Hoje é [quinta-feira, 02/07/2026] (America/Bahia). Use para resolver datas relativas ("dia 20" = próximo dia 20 futuro, cruzando com notas fixadas).`

---

## C. Loop de auto-crítica (opt-in leve)

Adicionar ao final do system prompt uma seção `=== CHECAGEM FINAL (obrigatória antes de responder) ===` com um checklist que o modelo deve rodar mentalmente:

```
Antes de emitir o JSON, verifique:
[ ] O nome usado bate com "Primeiro nome" dos FATOS (não é @username, não é prefixo tipo "MC")?
[ ] Se há nota fixada da equipe, minha resposta respeita/considera ela?
[ ] Se o lead disse "já sou paciente" ou similar, reconheci em vez de pedir dados do zero?
[ ] Se o anúncio é de serviço A e o lead pergunta sobre B, reconheci ambos?
[ ] Se cito data, cruzei com notas de viagem/retorno?
[ ] Respondi a última mensagem livre do lead antes de qualquer script?
Se algum item falhar, REESCREVA antes de responder.
```

Modelos atuais (Claude Sonnet, Gemini) seguem checklists inline com boa aderência, sem custo adicional relevante.

---

## D. Validação

Reabrir as 3 conversas problemáticas (Haislan, Maristela, MC João), clicar "Sugerir resposta" e conferir:

- **Haislan**: usa "Haislan" (não "@haislan_244ofc"); menciona facetas E aparelho.
- **Maristela**: reconhece que ela disse ser paciente; não pergunta cidade do zero.
- **MC João**: chama de "João"; cruza "dia 20" com a nota de viagem julho; confirma dia da semana correto.

---

## Detalhes técnicos

- Arquivo único: `supabase/functions/generate-reply-suggestion/index.ts`.
- Adicionar `SELECT paciente_id, nome (join com pacientes)` na consulta atual do lead OU nova consulta rápida a `crm_lead_pacientes` filtrando por `lead_id`.
- Helper `stripNamePrefix(name)` puro (regex simples com lista de prefixos).
- Helper `formatDateBR(date)` para "quinta-feira, 02/07/2026" no fuso America/Bahia.
- Sem alteração no `AiSuggestionStrip.tsx`, RAG, `record-good-example`, `auto-send-suggestions` ou outras Edge Functions.
- Sem alteração de modelo/provider (mantém Claude/Gemini conforme configuração atual).

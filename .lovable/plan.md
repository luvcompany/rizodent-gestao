## Parte 1 — Reajuste do lead Vitor Santos

O lead **Vitor Santos** (`0c04e03a-4670-4849-85cc-adc974294570`) já foi transferido para a Neiriane (pós-venda), mas continuou no **Funil Principal**. Vou:

1. Atualizar o lead movendo para o funil **Pós-venda** (`c7fb4a30-…`) e etapa inicial **Contato inicial** (`122caeb7-…`).
2. Inserir um registro em `crm_lead_stage_history` (saída da etapa atual + entrada na nova) para preservar o histórico.
3. Postar uma mensagem de sistema na conversa: *"📂 Lead movido para Pós-venda • Contato inicial"*.

Toda a conversa, tags, anotações e mensagens permanecem intactas — só os campos `pipeline_id` e `stage_id` mudam.

---

## Parte 2 — Recomendação: mover vs. duplicar para o Pós-venda

**Minha sugestão é mover, não duplicar.** Abaixo o raciocínio e os trade-offs.

### Por que mover (recomendado)

- **Uma conversa, uma fonte da verdade.** O WhatsApp/Instagram do paciente é único. Duplicar o card cria duas caixas separadas com a mesma conversa — quando uma mensagem nova chegar, só uma vai atualizar, gerando dessincronia e confusão sobre "qual card é o verdadeiro".
- **Sem mensagens duplicadas.** Mensagens são vinculadas por `lead_id`. Se duplicarmos o lead, teríamos que duplicar a tabela `messages` (cara, redundante) ou referenciar — e referenciar quebra o modelo atual.
- **Sem automações/follow-ups conflitantes.** Bots, follow-ups, automações por etapa são disparados por `stage_id` do lead. Dois cards = dois bots disparando ao mesmo tempo para o mesmo paciente.
- **Atribuição clara.** Um responsável por vez (CRC entrega → Pós-venda assume). Evita disputa de propriedade.
- **Histórico preservado de graça.** A tabela `crm_lead_stage_history` já registra cada passagem de etapa, então o caminho "Funil Principal → Contratado → Pós-venda → Contato inicial" fica documentado no próprio lead.

### Por que **não** duplicar

- Mensagens, notas, tarefas, agendamentos, anexos, score, ad tracking — tudo é por `lead_id`. Duplicar significa escolher: copiar tudo (storage caro e tudo congelado no tempo) ou deixar metade vazio.
- O Kanban do Funil Principal ficaria poluído com leads "concluídos" que na verdade já estão sob outra responsabilidade.
- KPIs ficariam inflados (mesmo lead contado em dois funis).

### Como implementar a regra "Contratado → Pós-venda" (Parte 3, futura)

Quando você aprovar, posso criar uma **automação no estágio "Contratado"** do Funil Principal que automaticamente:

1. Reatribui o lead para o usuário **Neiriane (Pós-venda)** (ou outro usuário pós-venda configurável).
2. Move o lead para o funil **Pós-venda** → etapa **Contato inicial**.
3. Registra mensagem de sistema na conversa.

Isso reutiliza a mesma lógica que acabamos de adicionar no `transfer-lead`, mas disparada automaticamente pelo `automation-engine` quando o lead entra em "Contratado". O cartão **some** do Funil Principal e **aparece** no Pós-venda, com toda a conversa preservada.

### Resumo visual

```text
ANTES (duplicar — ruim):
  [Funil Principal: Contratado] ──┐
                                  ├── mesma conversa WhatsApp ⚠️ duas caixas
  [Pós-venda: Contato inicial] ───┘

DEPOIS (mover — recomendado):
  [Funil Principal: Contratado] ──► [Pós-venda: Contato inicial]
       (histórico: saiu em 18/05 14:30)   (entrou em 18/05 14:30)
       conversa única, responsável único
```

---

## O que vou fazer agora (se aprovar)

- **Apenas a Parte 1**: ajustar o lead Vitor Santos manualmente (UPDATE + history + system message).
- A Parte 3 (automação no "Contratado") fica para uma próxima etapa, quando você confirmar a regra.
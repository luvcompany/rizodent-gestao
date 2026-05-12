## Problema identificado

A automação de **janela de tempo (`time_window`)** dispara o bot "Agendamento" entre **sábado 13:30** e **segunda 07:29**. No caso da imagem:

1. Sábado/domingo o lead recebeu a primeira mensagem do bot, e o bot ficou em estado `waiting_reply` (aguardando resposta).
2. Segunda às 07:41 o bot ainda enviou outra pergunta (dentro da janela, OK).
3. Segunda às 13:47 (já **fora** da janela) o lead respondeu "Oi". O webhook localizou a `bot_execution` ainda em `waiting_reply` e chamou `bot-engine` com `trigger: "continue"`, avançando o fluxo e enviando "Aguarde você será atendido no próximo dia útil...".

### Causas técnicas

- `whatsapp-webhook/index.ts` (linhas ~1059-1101): ao receber mensagem do lead, continua qualquer `bot_execution` em `waiting_reply` **sem verificar se a janela da automação que iniciou o bot ainda está aberta**.
- `automation-engine/index.ts` (linhas ~67-156): o cleanup que cancela bots de janelas expiradas só roda durante a "janela de fechamento" (`justClosed` = até ~6 min depois do fim). Se o cron atrasar ou se a execução ficar pendurada além disso, ela nunca é cancelada.
- Existem **duas automações duplicadas** apontando para o mesmo bot (start_time 13:30 e 13:35) — provavelmente criadas sem querer. Vou apontar isso ao final, mas não removo automaticamente.

## Correções

### 1. `supabase/functions/automation-engine/index.ts`
Tornar o cleanup robusto: sempre que a janela `weekly` estiver **fechada agora** (não só nos primeiros 6 min após o fechamento), cancelar todas as `bot_executions` ainda `active`/`waiting_reply` daquele `bot_id` para os leads que já receberam a automação. Manter o reset de `crm_automation_executions` apenas no `justClosed` (para não apagar dedup repetidamente).

Mudança principal:
```ts
shouldCleanup = !state.isOpen;       // antes: state.justClosed
const resetExecutions = state.justClosed;  // só limpa dedup uma vez
```

### 2. `supabase/functions/whatsapp-webhook/index.ts`
Antes de chamar `bot-engine` com `trigger: "continue"`, validar a janela:
- Buscar a automação `time_window` + `send_bot` associada ao `bot_id` da execução.
- Se a janela estiver **fechada agora**, marcar a `bot_execution` como `cancelled` e **não** continuar.
- Caso contrário, segue o fluxo normal.

Isso garante que mesmo se o cleanup do cron falhar/atrasar, a continuação nunca dispare fora da janela.

### 3. (Opcional, recomendo) Remover automação duplicada
Há 2 automações `time_window → send_bot` para o mesmo bot, com horários quase iguais (sáb 13:30 e 13:35). Vou avisar para você remover manualmente em **CRM > Automações** — não deleto sem sua confirmação.

## Validação

Após o deploy:
- Forçar uma `bot_execution` em `waiting_reply` e simular mensagem inbound com janela fechada → deve cancelar e não enviar.
- Verificar logs do `automation-engine` mostrando `cancelled N bot executions` em qualquer execução fora da janela.

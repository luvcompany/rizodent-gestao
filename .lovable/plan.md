## Problema

Quando um lead está em **Não compareceu** (ou **Reagendado**) e o usuário clica em **Reagendar** no painel da conversa, o sistema cria o agendamento corretamente, mas move o lead para a etapa **Agendado** em vez de **Reagendado**.

Causa: a função `moveLeadToScheduledStage` em `src/components/chat/AppointmentConfirmBar.tsx` sempre procura a etapa "Agendado" no pipeline atual, ignorando o fato de que `isRescheduleMode = true` (lead vindo de "Não compareceu" ou "Reagendado").

A segunda parte do pedido (botão "Compareceu / Não compareceu" 1h após o horário, e em seguida "Contratou / Não contratou") **já está implementada** no mesmo componente para qualquer agendamento com `status = "confirmed"` cujo horário tenha passado há ≥1h — independente da etapa atual. Como o reagendamento também grava `status = "confirmed"`, ele passará a aparecer automaticamente assim que o lead for movido para "Reagendado". Não precisa de código novo para isso, apenas garantir o fluxo correto da etapa.

## Solução

### 1. Mover para "Reagendado" quando for reagendamento

Em `moveLeadToScheduledStage`, quando `isRescheduleMode === true`, procurar primeiro a etapa **"Reagendado"** no pipeline atual. Caso contrário (fluxo normal), manter a busca atual por **"Agendado"**.

Lógica:
```text
if (isRescheduleMode) {
  alvo = stage cujo nome normalizado começa com "reagend"
} else {
  alvo = stage "agendado" (lógica existente, que já exclui "pré-agendado" e "reagendado")
}
```

A função passará a receber `isRescheduleMode` (já existente no estado do componente) ou ler novamente a etapa atual para decidir — vou usar o estado já calculado em `checkRescheduleMode`.

### 2. Garantir que o desfecho funcione em "Reagendado"

Verificar a função `applyAppointmentOutcome` em `src/lib/appointmentOutcome.ts`:
- **Não compareceu**: já procura etapa contendo "nao compar" — funciona em qualquer pipeline.
- **Contratou**: já procura "contratado" — funciona.
- **Não contratou**: move para pipeline "Não Contratados" — funciona.

Nenhuma mudança necessária aqui. O card "Qual o resultado?" aparece automaticamente 1h após o horário do agendamento reagendado (mesmo critério já implementado nas linhas 80–87 de `AppointmentConfirmBar.tsx`).

## Arquivo afetado

- `src/components/chat/AppointmentConfirmBar.tsx` — ajustar `moveLeadToScheduledStage` para escolher entre "Agendado" e "Reagendado" conforme `isRescheduleMode`.

## Resultado esperado

- Lead em **Não compareceu** ou **Reagendado** → clicar em **Reagendar** → cria agendamento com `is_rescheduled = true` e move o lead para a etapa **Reagendado** (não mais "Agendado").
- 1h após o horário do reagendamento, aparece o card laranja **"Qual o resultado?"** com **Compareceu / Não compareceu**, e em seguida **Contratou / Não contratou** — exatamente como já funciona para agendamentos normais.

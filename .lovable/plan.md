# Desativar automação de envio ao Pós-venda

Hoje existe uma rotina automática (cron diário seg–sex 10:00 UTC) que move leads em etapa "Contratado" para o pipeline de Pós-venda. Você quer manter **apenas o fluxo manual** via botão "Enviar para Pós-venda" (componente `SendToPosvendaButton`) que já aparece quando o lead está em Contratado.

## O que será feito

1. **Desagendar o cron job** `auto-transfer-contracted-posvenda` no Postgres (via `cron.unschedule`).
2. **Excluir a edge function** `auto-transfer-contracted-to-posvenda` (não será mais invocada).
3. **Remover a seção** `[functions.auto-transfer-contracted-to-posvenda]` do `supabase/config.toml`.
4. **Preservar intacto** o botão manual `SendToPosvendaButton` e a edge function `transfer-lead` que ele usa — esse é o único caminho que sobra para mover um lead ao Pós-venda.

## O que NÃO muda

- Botão "Enviar para Pós-venda" no chat/kanban quando o lead está em Contratado.
- Atribuição do lead transferido manualmente continua indo para o usuário pós-venda (Neiriane).
- Histórico de etapas e regras de retenção (sem status "Perdido") permanecem.
- Os 245 leads já existentes no Pós-venda ficam onde estão.

## Verificação após implementar

- Confirmar que `cron.job` não contém mais `auto-transfer-contracted-posvenda`.
- Confirmar que a função deixou de aparecer no painel de edge functions.
- Testar manualmente o botão "Enviar para Pós-venda" em um lead Contratado para garantir que o fluxo manual segue funcionando.

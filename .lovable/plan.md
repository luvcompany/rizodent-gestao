## Problema

Em `src/components/chat/ChatMessageContent.tsx` (linhas 100-128), o componente `TemplateMessageBubble` resolve o placeholder `{{2}}` (data/horário) consultando `crm_appointments` filtrando por `status in ('confirmed','pending')`.

Quando o agendamento é apagado (ou marcado como "Não compareceu", "Contratado", etc.), a query não encontra nenhum registro ativo e cai no fallback `"data e horário a confirmar"`. A mensagem original enviada ao lead já saiu com a data correta — é só a re-renderização da bolha do template no chat que perde a referência.

## Correção

Ajustar a busca para nunca exibir "data e horário a confirmar" quando existir histórico de agendamento do lead, e priorizar o agendamento mais próximo da data de envio da mensagem.

### Mudanças em `src/components/chat/ChatMessageContent.tsx`

1. Receber `messageCreatedAt` como prop opcional em `TemplateMessageBubble` (passado pelo `ChatMessageBubble`).
2. Substituir a query única por uma busca em duas etapas:
   - Buscar **todos** os agendamentos do lead (qualquer status), ordenados por `scheduled_date`/`scheduled_time`.
   - Selecionar preferencialmente: (a) o agendamento `confirmed/pending` mais próximo de `messageCreatedAt`; senão (b) o agendamento (qualquer status) cuja `scheduled_date` esteja mais próxima da data da mensagem; senão (c) o mais recente.
3. Manter o fallback `"data e horário a confirmar"` apenas quando o lead realmente nunca teve agendamento.

### Mudança em `src/components/chat/ChatMessageBubble.tsx`

Passar `messageCreatedAt={message.created_at}` ao renderizar `TemplateMessageBubble` (verificar a prop atual do componente).

## Escopo

- Apenas frontend / camada de apresentação.
- Sem migração de banco e sem alteração no envio real da mensagem (que já funciona corretamente).
- Sem mudanças em modelos, edge functions ou lógica de agendamento.
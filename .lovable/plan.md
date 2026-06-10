# Corrigir disparos enfileirados que nunca são enviados

## Diagnóstico

O gatilho funcionou: 815 leads foram enfileirados às 18:40. Porém há **924 itens presos como "pending"** na fila. O motor de automação roda a cada minuto, mas executa primeiro várias verificações pesadas (no_response, time_window, chained triggers, lead por lead) e é **encerrado por limite de tempo antes de chegar na etapa final que envia os templates da fila**. Ou seja: enfileira, mas nunca envia.

## Mudanças

### 1. Novo worker dedicado da fila (backend)
- Criar a função `automation-queue-worker` que faz APENAS uma coisa: pegar itens pendentes da fila e enviar (template/bot), em lotes, respeitando o rate limit do WhatsApp.
- Remover esse processamento da função `automation-engine` (ela continua cuidando dos gatilhos: no_response, time_window, etc.).
- Recuperar itens travados em "processing" há mais de 10 minutos (voltam para "pending").
- Evitar duplicados: se o mesmo lead + automação já tem item "sent" recente, pular.

### 2. Agendamento (banco)
- Criar um cron job para o `automation-queue-worker` rodar a cada minuto.
- Adicionar coluna `error_message` na fila para registrar o motivo exato quando um envio falhar (visibilidade real em vez de falha silenciosa).

### 3. UI — página de Automações
- **Remover o botão "⚡ Disparar agora"**.
- Manter apenas o fluxo do checkbox "Enviar para todos os leads que já estão nesta etapa", que já enfileira corretamente.
- O toast de confirmação passará a dizer "X leads enfileirados — envio em andamento" para deixar claro que o envio é processado em segundo plano (1 a 2 minutos para começar).

### 4. Backlog atual
- Os 815 leads do "disparo luv" já estão na fila e serão enviados automaticamente assim que o worker entrar no ar (sem precisar disparar de novo).
- Vou verificar se há duplicados na fila antes (mesmo lead enfileirado 2x) e limpar para ninguém receber mensagem dupla.

## Detalhes técnicos
- Nova edge function: `supabase/functions/automation-queue-worker/index.ts` (processa lotes de ~50 itens por execução, chunks paralelos de 10, com pausa entre chunks).
- Migration: `ALTER TABLE crm_automation_queue ADD COLUMN error_message text` + reset de itens "processing" antigos.
- Cron via `cron.schedule` chamando o worker a cada minuto.
- Editar `supabase/functions/automation-engine/index.ts` (remover seção 7) e `src/pages/CrmAutomacoes.tsx` (remover botão Disparar agora e função associada).

## Problema (raiz confirmada)

O cron chama o `automation-queue-worker` e o `automation-engine` a cada minuto, mas **100% das chamadas retornam 401 Unauthorized** (254 falhas só nas últimas 2h). A verificação de autorização dentro das funções compara a chave enviada pelo cron com variáveis de ambiente que não batem. Resultado: a fila acumula (1.745 itens pendentes hoje) e nada é enviado.

## Solução

### 1. Autenticação robusta com segredo dedicado de cron
- Criar um segredo `CRON_SECRET` (gerado automaticamente, sem ação sua).
- Atualizar `automation-queue-worker` e `automation-engine` para aceitar requisições com o header `x-cron-secret` correto (mantendo a service role key como fallback) e logar claramente quando a autorização falhar.
- Recriar os cron jobs para enviar esse header.

### 2. Drenagem segura do backlog
- Itens pendentes com mais de 6 horas de atraso serão marcados como `expired` (não enviados), para evitar disparar centenas de mensagens antigas de uma vez.
- Os itens recentes serão processados normalmente (60 por minuto).

### 3. Teste real com o lead 77988639272
- Esse número ainda não existe na base — vou criar o lead com o telefone normalizado (`557788639272`) no estágio que possui a automação de disparo.
- Acompanhar a fila: confirmar que o item entra como `pending`, vira `sent`, e que a mensagem aparece em `messages` com status `sent/delivered` da API do WhatsApp.
- Só dou o problema como resolvido depois desse disparo chegar de verdade.

## Detalhes técnicos
- Arquivos: `supabase/functions/automation-queue-worker/index.ts`, `supabase/functions/automation-engine/index.ts`
- Recriar `automation-queue-worker-cron` e `automation-engine-cron` com header `x-cron-secret` (via SQL direto, sem migração, pois contém segredo)
- UPDATE em `crm_automation_queue` para expirar itens com `scheduled_at < now() - 6h`
- Validação: `net._http_response` com status 200, logs `[queue-worker] fetched/done`, e a mensagem do lead de teste com status de entrega
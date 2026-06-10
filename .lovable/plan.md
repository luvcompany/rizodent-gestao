# Corrigir disparo em massa e criação/edição de funis

## Diagnóstico (já confirmado no banco e logs)

1. **Disparo "Enviar para todos"**: o salvamento da automação está falhando antes do disparo — nenhuma automação foi criada nas últimas 36h e não existe automação nas etapas "Não compareceu". As regras de acesso (RLS) de `crm_automations` permitem salvar apenas para os papéis **crc** e **gerente** — **superadmin (Luv Agency) e pós-venda ficaram de fora**. Se o teste foi feito com o usuário superadmin, o salvar falha e nada é enfileirado.
2. **Funis**: a regra restritiva de isolamento por cliente (`tenant_isolation`) em `crm_pipelines` não tem exceção para superadmin (diferente das outras tabelas), bloqueando criar/editar funis nesse perfil. O toast genérico "Erro ao criar funil" esconde a mensagem real do erro.
3. **Entregas Meta**: 48 mensagens de template nas últimas 48h falharam com erro **131049** ("healthy ecosystem engagement") — a Meta está limitando entregas de templates de marketing para alguns contatos. Isso não é bug do sistema, mas precisa ficar visível.
4. **Cron duplicado**: existem 2 agendamentos chamando o motor de automação a cada minuto, um deles com token corrompido (sempre falha em silêncio).

## Plano de correção

### 1. Migração de banco (RLS)
- `crm_automations`: recriar políticas de criar/editar/excluir incluindo `superadmin` e `gerente` (e remover a duplicação de `crc` na expressão atual).
- `crm_pipelines` e `crm_stages`: adicionar exceção `OR has_role(auth.uid(),'superadmin')` à política restritiva `tenant_isolation`, igual ao padrão já usado em `crm_automations`.
- Remover o cron duplicado com token corrompido (`invoke-automation-engine-every-minute`), mantendo apenas `automation-engine-cron`.

### 2. Frontend — `src/pages/CrmAutomacoes.tsx`
- Mostrar a mensagem real do erro (`error.message`) nos toasts de criar/editar funil e etapa (hoje é genérico).
- Adicionar botão **"Disparar agora"** em cada automação de envio (template/bot) que chama diretamente a função `enqueue-stage-automation`, desacoplando o disparo do fluxo de salvar — com feedback claro de quantos leads foram enfileirados.
- Manter o modal aberto quando o salvamento falhar, para o erro não passar despercebido.

### 3. Backend — `supabase/functions/enqueue-stage-automation`
- Adicionar logs em todas as requisições (quem chamou, automação, quantos leads enfileirados) para rastreabilidade futura.

### 4. Visibilidade de falhas da Meta
- No resultado do disparo, exibir aviso quando houver falhas 131049, explicando que a Meta limita entregas de templates de marketing por contato (não é falha do sistema).

## Validação
- Testar criação de funil e salvamento de automação com consulta direta ao banco após as mudanças.
- Disparar uma automação de teste e confirmar itens na fila (`crm_automation_queue`) e processamento pelo motor.

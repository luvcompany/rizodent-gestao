Plano para corrigir o risco de vazamento entre clientes e impedir que leads/mensagens de Luv Agency caiam na Rizodent ou vice-versa.

1. Banco de dados: transformar isolamento por cliente em regra obrigatória
- Remover os fallbacks perigosos que colocam `tenant_id` como Rizodent quando o dado vem sem cliente.
- Criar/ajustar triggers de segurança para:
  - `messages`: sempre herdar o cliente do `crm_leads` e bloquear qualquer mensagem cujo cliente não seja o mesmo do lead.
  - `crm_leads`: bloquear lead em pipeline/stage de outro cliente; se vier sem cliente, derivar do pipeline/stage correto, nunca usar Rizodent por padrão.
  - tabelas filhas com `lead_id` (`crm_tasks`, `crm_appointments`, notas, histórico, filas, execuções etc.): sempre herdar e validar o cliente do lead.
  - integrações/canais/templates/contas Instagram: exigir `tenant_id` real.
- Adicionar `tenant_id` em `instagram_messages`, porque hoje essa tabela depende de `lead_id`; comentários/linhas sem lead podem ficar visíveis de forma indevida.
- Reforçar RLS para impedir leitura/escrita fora do cliente atual, inclusive em `instagram_messages`, `integrations`, `funnel_channels`, `templates`, `ad_id_mapping` e dados de chat.
- Criar índices únicos escopados por cliente quando necessário, por exemplo anúncios/templates/contas por `tenant_id`, não globalmente.

2. WhatsApp: corrigir roteamento e envio
- No `whatsapp-webhook`, manter o roteamento pelo `phone_number_id`, mas bloquear qualquer processamento quando a integração não tiver `tenant_id` válido.
- Remover a atribuição fixa para usuário da Rizodent em leads criados por webhook; a atribuição precisa ser por cliente ou ficar nula quando não houver usuário do próprio cliente.
- Garantir que pipeline, estágio, canal, anúncios e automações usados no webhook pertençam ao mesmo cliente da integração.
- No `send-whatsapp-message`, remover fallback global de “qualquer canal ativo”; resolver credenciais somente dentro do cliente do lead.
- Buscar templates WhatsApp por `tenant_id` do lead, não só por nome.
- Em status/reação/reply, validar pelo cliente do lead/mensagem antes de atualizar.

3. Instagram: corrigir webhook antigo e envio
- Atualizar ou neutralizar o `instagram-webhook` legado, que ainda usa pipeline fixo da Rizodent e busca lead por Instagram sem escopo de cliente.
- Manter a lógica do `instagram-lite-webhook`, mas endurecer validações: conta Instagram, lead, pipeline, mensagens e comentários sempre no mesmo `tenant_id`.
- No `instagram-send-message`, resolver conta Instagram somente entre contas do cliente do lead; remover fallback “uma conta ativa total”.
- Gravar `tenant_id` também em `instagram_messages` e validar mensagens espelhadas no chat unificado.

4. Frontend do CRM: impedir cache/tela cruzada entre clientes
- Tornar caches globais da página de conversas dependentes do `tenant.id` e limpar cache quando mudar cliente/slug.
- Adicionar filtros explícitos por `tenant_id` nas consultas de leads, pipelines, perfis e buscas quando o cliente atual estiver disponível, além do RLS.
- Evitar que realtime sem filtro injete lead/mensagem de outro cliente na lista caso o usuário tenha papel amplo.
- Revisar envios do chat para sempre usar o lead selecionado já validado no cliente atual.

5. Funções internas e automações
- Criar um utilitário compartilhado para resolver `lead_id -> tenant_id` e validar que recursos usados por bots/automações/templates/stages pertencem ao mesmo cliente.
- Aplicar esse guard em `automation-engine`, `bot-engine`, broadcast, follow-up, repair/transcribe e funções auxiliares que usam service role.
- Para chamadas autenticadas, validar também que o usuário pertence ao mesmo cliente do lead, exceto superadmin.

6. Auditoria e saneamento de dados
- Rodar consultas de integridade antes e depois para confirmar:
  - mensagens com cliente diferente do lead;
  - leads em pipeline/stage de outro cliente;
  - Instagram messages sem cliente ou apontando para conta/lead de outro cliente;
  - integrações/templates/canais/anúncios sem cliente.
- Corrigir dados existentes com operações controladas, sem apagar histórico.
- Validar especificamente Luv Agency (`505236c0-8dfd-4616-a318-0cc383b94c7f`) e Rizodent (`00000000-0000-0000-0000-000000000010`).

7. Validação final
- Testar envio e recebimento WhatsApp para cada cliente.
- Testar envio e recebimento Instagram para cada cliente.
- Confirmar que uma mensagem enviada em `/luvagency/crm/conversas` fica no lead e tenant Luv Agency.
- Confirmar que usuários comuns não conseguem ler leads/mensagens/templates/integrações de outro cliente.

Achados iniciais importantes:
- Os dados principais atuais não mostraram divergência imediata entre `messages.tenant_id` e `crm_leads.tenant_id`, mas há falhas estruturais que permitem regressão.
- O webhook antigo do Instagram ainda tem pipeline fixo da Rizodent.
- O envio WhatsApp ainda tem fallback global de integração/canal.
- `instagram_messages` não tem `tenant_id`, o que é frágil para comentários e histórico legado.
- Há tabelas com `tenant_id` nullable e default Rizodent, o que é perigoso em multi-cliente.
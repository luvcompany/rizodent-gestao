-- =============================================================
-- Otimização do bot Follow-UP
-- Data: 2026-06-05
-- Mudanças:
--   1. Cortar esteira de 6 → 3 mensagens (remove msg4/msg5/msg6)
--   2. Timeout: 25h → 48h em todas as mensagens
--   3. msg3 timeout/no-response agora vai direto para Nutrição
--   4. Mover 1.240 leads frios (sem resposta 10+ dias) para Nutrição
--   5. Cancelar execuções em nós removidos (msg4/msg5/msg6)
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- PASSO 1: Atualizar o flow_json do bot (versão 4)
--          Bot ID: 2c8f2bd9-1d2d-4587-8449-be8654174e28
-- ─────────────────────────────────────────────────────────────
UPDATE public.bot_versions
SET flow_json = '{"nodes":[{"id":"start","data":{},"type":"start","dragging":false,"measured":{"width":220,"height":67},"position":{"x":-128,"y":240},"selected":false},{"id":"move_recuperado","data":{"stageId":"04ee0499-3b02-4e34-bf30-099d16315e72","description":"Mover para Recuperado (Funil Principal)"},"type":"move_stage","dragging":false,"measured":{"width":220,"height":91},"position":{"x":1120,"y":880},"selected":false},{"id":"transfer","data":{"description":"Lead respondeu - transferir para atendente"},"type":"transfer_human","dragging":false,"measured":{"width":220,"height":91},"position":{"x":1120,"y":1136},"selected":false},{"id":"move_nutricao","data":{"stageId":"2eb6f060-8204-4efd-a3df-dfd40d780c41","description":"Mover para Nutrição"},"type":"move_stage","dragging":false,"measured":{"width":220,"height":91},"position":{"x":1328,"y":256},"selected":false},{"id":"msg1","data":{"text":"","templateId":"151d63b1-11dc-46b4-aa46-fdc59dc6caf7","description":"Follow-up 1","_highlighted":false,"templateName":"follow_up_0","timeoutHours":48,"timeoutMinutes":0,"timeoutSeconds":0,"templateButtons":[{"id":"1","title":"Quero Agendar!"},{"id":"2","title":"Ainda tenho dúvidas!"}]},"type":"send_text","dragging":false,"measured":{"width":249,"height":108},"position":{"x":352,"y":256},"selected":false},{"id":"msg2","data":{"text":"","templateId":"c84753d9-82cc-4c71-b858-b488042ef9be","description":"Follow-up 2","_highlighted":false,"templateName":"follow_up_1","timeoutHours":48,"timeoutMinutes":0,"timeoutSeconds":0,"templateButtons":[{"id":"1","title":"Agendar avaliação!"},{"id":"2","title":"Tirar dúvidas!"}]},"type":"send_text","dragging":false,"measured":{"width":232,"height":108},"position":{"x":672,"y":256},"selected":false},{"id":"msg3","data":{"text":"","templateId":"d9921141-fd02-4700-8426-c963ae0ce104","description":"Follow-up 3 (com imagem)","_highlighted":false,"templateName":"follow_up_2","timeoutHours":48,"timeoutMinutes":0,"timeoutSeconds":0,"templateButtons":[{"id":"1","title":"Mais informações!"},{"id":"2","title":"Agendar avaliação!"}]},"type":"send_text","dragging":false,"measured":{"width":251,"height":108},"position":{"x":976,"y":256},"selected":false}],"edges":[{"id":"e_start","source":"start","target":"msg1"},{"id":"e_msg1_btn_1","source":"msg1","target":"move_recuperado","animated":true,"sourceHandle":"btn-1"},{"id":"e_msg1_btn_2","source":"msg1","target":"move_recuperado","animated":true,"sourceHandle":"btn-2"},{"id":"e_msg2_btn_1","source":"msg2","target":"move_recuperado","animated":true,"sourceHandle":"btn-1"},{"id":"e_msg2_btn_2","source":"msg2","target":"move_recuperado","animated":true,"sourceHandle":"btn-2"},{"id":"e_msg3_btn_1","source":"msg3","target":"move_recuperado","animated":true,"sourceHandle":"btn-1"},{"id":"e_msg3_btn_2","source":"msg3","target":"move_recuperado","animated":true,"sourceHandle":"btn-2"},{"id":"e_recuperado_transfer","source":"move_recuperado","target":"transfer"},{"id":"xy-edge__msg1no-response-msg2","type":"deletable","source":"msg1","target":"msg2","animated":true,"sourceHandle":"no-response"},{"id":"xy-edge__msg2no-response-msg3","type":"deletable","source":"msg2","target":"msg3","animated":true,"sourceHandle":"no-response"},{"id":"xy-edge__msg3no-response-move_nutricao","type":"deletable","source":"msg3","target":"move_nutricao","animated":true,"sourceHandle":"no-response"},{"id":"xy-edge__msg1reply-move_recuperado","type":"deletable","label":"Resposta","style":{"stroke":"#22c55e"},"source":"msg1","target":"move_recuperado","animated":true,"sourceHandle":"reply"},{"id":"xy-edge__msg2reply-move_recuperado","type":"deletable","label":"Resposta","style":{"stroke":"#22c55e"},"source":"msg2","target":"move_recuperado","animated":true,"sourceHandle":"reply"},{"id":"xy-edge__msg3reply-move_recuperado","type":"deletable","label":"Resposta","style":{"stroke":"#22c55e"},"source":"msg3","target":"move_recuperado","animated":true,"sourceHandle":"reply"},{"id":"xy-edge__msg1timeout-msg2","type":"deletable","label":"Timeout","style":{"stroke":"#f97316"},"source":"msg1","target":"msg2","animated":true,"sourceHandle":"timeout"},{"id":"xy-edge__msg2timeout-msg3","type":"deletable","label":"Timeout","style":{"stroke":"#f97316"},"source":"msg2","target":"msg3","animated":true,"sourceHandle":"timeout"},{"id":"xy-edge__msg3timeout-move_nutricao","type":"deletable","label":"Timeout","style":{"stroke":"#f97316"},"source":"msg3","target":"move_nutricao","animated":true,"sourceHandle":"timeout"}]}'::jsonb,
    published_at = NOW()
WHERE bot_id = '2c8f2bd9-1d2d-4587-8449-be8654174e28'
  AND version = 4;

-- ─────────────────────────────────────────────────────────────
-- PASSO 2: Cancelar execuções presas em nós removidos
--          (msg4, msg5, msg6 não existem mais no novo flow)
-- ─────────────────────────────────────────────────────────────
UPDATE public.bot_executions
SET status = 'cancelled',
    updated_at = NOW(),
    completed_at = NOW()
WHERE bot_id = '2c8f2bd9-1d2d-4587-8449-be8654174e28'
  AND current_node_id IN ('msg4', 'msg5', 'msg6')
  AND status IN ('active', 'waiting_reply');

-- ─────────────────────────────────────────────────────────────
-- PASSO 3: Cancelar execuções dos leads frios que serão movidos
--          (evita que o bot continue tentando enviar para eles)
-- ─────────────────────────────────────────────────────────────
UPDATE public.bot_executions
SET status = 'cancelled',
    updated_at = NOW(),
    completed_at = NOW()
WHERE bot_id = '2c8f2bd9-1d2d-4587-8449-be8654174e28'
  AND status IN ('active', 'waiting_reply')
  AND lead_id IN (
    SELECT l.id
    FROM public.crm_leads l
    JOIN public.crm_stages s ON s.id = l.stage_id
    JOIN public.crm_pipelines p ON p.id = s.pipeline_id
    WHERE s.name = 'Follow - Up'
      AND p.name = 'Funil Principal'
      AND (l.last_message_at < NOW() - INTERVAL '10 days'
           OR l.last_message_at IS NULL)
  );

-- ─────────────────────────────────────────────────────────────
-- PASSO 4: Mover leads frios do Follow-Up → Nutrição
--          Critério: sem resposta por 10+ dias
--          Nutrição stage_id: 2eb6f060-8204-4efd-a3df-dfd40d780c41
-- ─────────────────────────────────────────────────────────────
UPDATE public.crm_leads
SET stage_id = '2eb6f060-8204-4efd-a3df-dfd40d780c41',
    updated_at = NOW()
WHERE stage_id = (
  SELECT s.id
  FROM public.crm_stages s
  JOIN public.crm_pipelines p ON p.id = s.pipeline_id
  WHERE s.name = 'Follow - Up'
    AND p.name = 'Funil Principal'
  LIMIT 1
)
AND (last_message_at < NOW() - INTERVAL '10 days'
     OR last_message_at IS NULL);

-- ─────────────────────────────────────────────────────────────
-- VERIFICAÇÃO: quantos leads foram movidos
-- ─────────────────────────────────────────────────────────────
-- Rode após aplicar:
-- SELECT COUNT(*) FROM crm_leads WHERE stage_id = '2eb6f060-8204-4efd-a3df-dfd40d780c41';
-- SELECT COUNT(*) FROM crm_leads l JOIN crm_stages s ON s.id=l.stage_id WHERE s.name='Follow - Up';

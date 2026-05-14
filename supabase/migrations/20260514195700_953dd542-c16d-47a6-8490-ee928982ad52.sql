-- Cancela execuções travadas do bot Follow-UP nos leads da etapa Follow-Up
UPDATE bot_executions
   SET status = 'cancelled',
       completed_at = now(),
       timeout_at = NULL,
       current_node_id = NULL,
       updated_at = now()
 WHERE bot_id = '2c8f2bd9-1d2d-4587-8449-be8654174e28'
   AND status IN ('active','waiting_reply')
   AND lead_id IN (
     SELECT id FROM crm_leads WHERE stage_id = 'a0ecaa42-078f-425c-9e23-cb90eca059e7'
   );
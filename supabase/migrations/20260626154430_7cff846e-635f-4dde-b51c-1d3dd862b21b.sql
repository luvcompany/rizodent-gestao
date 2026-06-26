CREATE UNIQUE INDEX IF NOT EXISTS uniq_auto_queue_layer
  ON public.crm_automation_queue (automation_id, lead_id, layer_index)
  WHERE layer_index IS NOT NULL
    AND status IN ('pending','processing','sent');
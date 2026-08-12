ALTER TABLE public.crm_lead_stage_history
  DROP CONSTRAINT crm_lead_stage_history_from_stage_id_fkey,
  ADD CONSTRAINT crm_lead_stage_history_from_stage_id_fkey
    FOREIGN KEY (from_stage_id) REFERENCES public.crm_stages(id) ON DELETE SET NULL;

ALTER TABLE public.crm_broadcasts
  DROP CONSTRAINT crm_broadcasts_filter_stage_id_fkey,
  ADD CONSTRAINT crm_broadcasts_filter_stage_id_fkey
    FOREIGN KEY (filter_stage_id) REFERENCES public.crm_stages(id) ON DELETE SET NULL;
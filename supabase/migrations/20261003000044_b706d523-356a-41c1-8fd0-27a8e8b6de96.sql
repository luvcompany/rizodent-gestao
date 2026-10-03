CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
SET search_path = public, extensions;

CREATE INDEX IF NOT EXISTS idx_crm_leads_stage_blocked_pos ON public.crm_leads (stage_id, is_blocked, position);
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage_blocked_created ON public.crm_leads (stage_id, is_blocked, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned_blocked ON public.crm_leads (assigned_to, is_blocked);
CREATE INDEX IF NOT EXISTS idx_crm_leads_last_message_at ON public.crm_leads (last_message_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_name_trgm ON public.crm_leads USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due_date ON public.crm_tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status_due ON public.crm_tasks (status, due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_lead ON public.crm_tasks (lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_ig_account ON public.messages (tenant_id, instagram_account_id) WHERE instagram_account_id IS NOT NULL;

-- Permissões calculadas uma vez por consulta (mesma lógica): envolve chamadas sem dependência de linha em (SELECT ...)
DO $$
DECLARE r record; q text; c text;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
           WHERE schemaname='public' AND tablename IN ('crm_tasks','crm_leads','crm_appointments','crm_lead_label_assignments','crm_stages','messages','crm_pipelines')
  LOOP
    q := r.qual; c := r.with_check;
    IF q IS NOT NULL THEN
      q := regexp_replace(q, '(?<!SELECT )has_role\(auth\.uid\(\), (''[a-z_]+''::app_role)\)', '(SELECT has_role(auth.uid(), \1))', 'g');
      q := regexp_replace(q, '(?<!SELECT )current_tenant_id\(\)', '(SELECT current_tenant_id())', 'g');
    END IF;
    IF c IS NOT NULL THEN
      c := regexp_replace(c, '(?<!SELECT )has_role\(auth\.uid\(\), (''[a-z_]+''::app_role)\)', '(SELECT has_role(auth.uid(), \1))', 'g');
      c := regexp_replace(c, '(?<!SELECT )current_tenant_id\(\)', '(SELECT current_tenant_id())', 'g');
    END IF;
    IF q IS DISTINCT FROM r.qual THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', r.policyname, r.schemaname, r.tablename, q);
    END IF;
    IF c IS DISTINCT FROM r.with_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', r.policyname, r.schemaname, r.tablename, c);
    END IF;
  END LOOP;
END $$;
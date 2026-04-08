
-- 1. Quick Replies
CREATE TABLE public.crm_quick_replies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  content text NOT NULL,
  media_url text,
  media_type text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view crm_quick_replies" ON public.crm_quick_replies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert crm_quick_replies" ON public.crm_quick_replies FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_quick_replies" ON public.crm_quick_replies FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete crm_quick_replies" ON public.crm_quick_replies FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- 2. Broadcasts
CREATE TABLE public.crm_broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  template_id uuid REFERENCES public.crm_whatsapp_templates(id),
  filter_pipeline_id uuid REFERENCES public.crm_pipelines(id),
  filter_stage_id uuid REFERENCES public.crm_stages(id),
  filter_tags text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  total_leads integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  scheduled_at timestamp with time zone
);
ALTER TABLE public.crm_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view crm_broadcasts" ON public.crm_broadcasts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert crm_broadcasts" ON public.crm_broadcasts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_broadcasts" ON public.crm_broadcasts FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete crm_broadcasts" ON public.crm_broadcasts FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- 3. Broadcast Recipients
CREATE TABLE public.crm_broadcast_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  broadcast_id uuid NOT NULL REFERENCES public.crm_broadcasts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamp with time zone,
  error text
);
ALTER TABLE public.crm_broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view crm_broadcast_recipients" ON public.crm_broadcast_recipients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert crm_broadcast_recipients" ON public.crm_broadcast_recipients FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_broadcast_recipients" ON public.crm_broadcast_recipients FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete crm_broadcast_recipients" ON public.crm_broadcast_recipients FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- 4. Notification Preferences
CREATE TABLE public.crm_notification_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  notify_task_due boolean NOT NULL DEFAULT true,
  notify_new_lead boolean NOT NULL DEFAULT true,
  notify_lead_reply boolean NOT NULL DEFAULT true,
  browser_push_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own notification prefs" ON public.crm_notification_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notification prefs" ON public.crm_notification_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notification prefs" ON public.crm_notification_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- 5. Add score and assigned_to to crm_leads
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS assigned_to uuid;

-- 6. Add sender_id to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_id uuid;

-- 7. Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_broadcasts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_broadcast_recipients;

-- 8. Lead score recalculation function
CREATE OR REPLACE FUNCTION public.recalculate_lead_score(p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score integer := 0;
  v_msg_count integer;
  v_stage_changes integer;
  v_days_inactive integer;
  v_has_completed_task boolean;
BEGIN
  SELECT COUNT(*) INTO v_msg_count FROM messages WHERE lead_id = p_lead_id AND direction = 'inbound';
  v_score := v_score + (v_msg_count * 10);

  SELECT COUNT(*) INTO v_stage_changes FROM crm_lead_stage_history WHERE lead_id = p_lead_id;
  v_score := v_score + (v_stage_changes * 15);

  SELECT EXISTS(SELECT 1 FROM crm_tasks WHERE lead_id = p_lead_id AND status = 'completed') INTO v_has_completed_task;
  IF v_has_completed_task THEN v_score := v_score + 5; END IF;

  SELECT COALESCE(EXTRACT(DAY FROM now() - MAX(last_message_at))::integer, 30) INTO v_days_inactive FROM crm_leads WHERE id = p_lead_id;
  v_score := v_score - v_days_inactive;

  IF v_score < 0 THEN v_score := 0; END IF;

  UPDATE crm_leads SET score = v_score WHERE id = p_lead_id;
  RETURN v_score;
END;
$$;

-- 9. Recalculate all leads scores
CREATE OR REPLACE FUNCTION public.recalculate_all_lead_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM crm_leads LOOP
    PERFORM recalculate_lead_score(r.id);
  END LOOP;
END;
$$;

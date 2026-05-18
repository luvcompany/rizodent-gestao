-- Personal color labels (Trello-style) per user
CREATE TABLE IF NOT EXISTS public.crm_user_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid,
  name text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#6366f1',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_user_labels_user ON public.crm_user_labels(user_id);

ALTER TABLE public.crm_user_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own labels select"
  ON public.crm_user_labels FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Users manage own labels insert"
  ON public.crm_user_labels FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users manage own labels update"
  ON public.crm_user_labels FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users manage own labels delete"
  ON public.crm_user_labels FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_crm_user_labels_updated_at
  BEFORE UPDATE ON public.crm_user_labels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lead <-> label assignments (per user)
CREATE TABLE IF NOT EXISTS public.crm_lead_label_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  label_id uuid NOT NULL REFERENCES public.crm_user_labels(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_lead ON public.crm_lead_label_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_label ON public.crm_lead_label_assignments(label_id);
CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_user ON public.crm_lead_label_assignments(created_by);

ALTER TABLE public.crm_lead_label_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own label assignments"
  ON public.crm_lead_label_assignments FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Users insert own label assignments"
  ON public.crm_lead_label_assignments FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.crm_user_labels l WHERE l.id = label_id AND l.user_id = auth.uid())
  );

CREATE POLICY "Users delete own label assignments"
  ON public.crm_lead_label_assignments FOR DELETE TO authenticated
  USING (created_by = auth.uid());
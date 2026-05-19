-- Tabela para salvar relatórios de funil customizados por período
CREATE TABLE public.crm_funnel_custom_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  pipeline_id uuid REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  period_label text NOT NULL,             -- ex: "Maio 2026" ou "Semana 19"
  period_type text NOT NULL DEFAULT 'month', -- 'week' | 'month' | 'custom'
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- Valores das etapas (editáveis)
  total_leads integer NOT NULL DEFAULT 0,
  atendidos integer NOT NULL DEFAULT 0,
  agendados integer NOT NULL DEFAULT 0,
  compareceram integer NOT NULL DEFAULT 0,
  avaliados integer NOT NULL DEFAULT 0,
  fecharam integer NOT NULL DEFAULT 0,
  -- Metas (%) por etapa
  meta_atendidos numeric(5,2) DEFAULT 80,
  meta_agendados numeric(5,2) DEFAULT 60,
  meta_compareceram numeric(5,2) DEFAULT 70,
  meta_avaliados numeric(5,2) DEFAULT 80,
  meta_fecharam numeric(5,2) DEFAULT 50,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_funnel_reports_tenant_period ON public.crm_funnel_custom_reports (tenant_id, period_start DESC);
CREATE INDEX idx_funnel_reports_pipeline ON public.crm_funnel_custom_reports (pipeline_id);

ALTER TABLE public.crm_funnel_custom_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read funnel reports"
ON public.crm_funnel_custom_reports FOR SELECT
USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant members insert funnel reports"
ON public.crm_funnel_custom_reports FOR INSERT
WITH CHECK (tenant_id = current_tenant_id() AND user_id = auth.uid());

CREATE POLICY "tenant members update funnel reports"
ON public.crm_funnel_custom_reports FOR UPDATE
USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant members delete funnel reports"
ON public.crm_funnel_custom_reports FOR DELETE
USING (tenant_id = current_tenant_id());

CREATE TRIGGER update_funnel_reports_updated_at
BEFORE UPDATE ON public.crm_funnel_custom_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
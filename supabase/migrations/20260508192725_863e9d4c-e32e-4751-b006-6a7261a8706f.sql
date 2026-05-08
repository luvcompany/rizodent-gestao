
CREATE TABLE IF NOT EXISTS public.ai_assistant_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Assistente Rizodent',
  model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  system_prompt text NOT NULL DEFAULT 'Você é um assistente especializado em atendimento odontológico para a clínica Rizodent. Analise conversas de WhatsApp/Instagram entre atendentes humanos e leads/pacientes interessados em procedimentos. Sempre responda em português brasileiro, de forma clara, empática e objetiva.',
  tone text NOT NULL DEFAULT 'profissional e acolhedor',
  language text NOT NULL DEFAULT 'pt-BR',
  custom_instructions text DEFAULT '',
  enabled_features jsonb NOT NULL DEFAULT '{"summary": true, "suggestions": true, "auto_reply": false}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_assistant_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ai_assistant_config" ON public.ai_assistant_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins/managers can insert ai_assistant_config" ON public.ai_assistant_config
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins/managers can update ai_assistant_config" ON public.ai_assistant_config
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins/managers can delete ai_assistant_config" ON public.ai_assistant_config
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE TRIGGER trg_ai_assistant_config_updated
  BEFORE UPDATE ON public.ai_assistant_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ai_assistant_config (name) VALUES ('Assistente Rizodent') ON CONFLICT DO NOTHING;

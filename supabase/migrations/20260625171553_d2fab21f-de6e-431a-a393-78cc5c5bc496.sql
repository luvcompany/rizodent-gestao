
-- 1) New table: ai_reply_suggestions
CREATE TABLE public.ai_reply_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  tenant_id uuid,
  trigger_message_id uuid,
  suggested_text text NOT NULL,
  action text NOT NULL DEFAULT 'reply',
  action_reason text,
  status text NOT NULL DEFAULT 'pending',
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  CONSTRAINT ai_reply_suggestions_action_chk CHECK (action IN ('reply','handoff')),
  CONSTRAINT ai_reply_suggestions_status_chk CHECK (status IN ('pending','sent','discarded','auto_sent','superseded'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_reply_suggestions TO authenticated;
GRANT ALL ON public.ai_reply_suggestions TO service_role;

ALTER TABLE public.ai_reply_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ai_reply_suggestions"
  ON public.ai_reply_suggestions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can insert ai_reply_suggestions"
  ON public.ai_reply_suggestions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can update ai_reply_suggestions"
  ON public.ai_reply_suggestions FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins/managers can delete ai_reply_suggestions"
  ON public.ai_reply_suggestions FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

CREATE INDEX ai_reply_suggestions_lead_idx ON public.ai_reply_suggestions (lead_id);
CREATE INDEX ai_reply_suggestions_pending_idx
  ON public.ai_reply_suggestions (status, created_at)
  WHERE status = 'pending';

ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_reply_suggestions;
ALTER TABLE public.ai_reply_suggestions REPLICA IDENTITY FULL;

-- 2) Extend ai_assistant_config
ALTER TABLE public.ai_assistant_config
  ADD COLUMN IF NOT EXISTS assistant_display_name text NOT NULL DEFAULT 'Bia',
  ADD COLUMN IF NOT EXISTS knowledge_base text,
  ADD COLUMN IF NOT EXISTS copilot_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_send_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shift_start time NOT NULL DEFAULT '07:29',
  ADD COLUMN IF NOT EXISTS shift_end time NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS wait_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS recoil_hours integer NOT NULL DEFAULT 2;

-- Seed default knowledge base when null
UPDATE public.ai_assistant_config
SET knowledge_base = $kb$A Bia é atendente da clínica odontológica Rizodent (interior da Bahia; unidades em Itabuna, Guanambi, Ipiaú e Vitória da Conquista). Objetivo: acolher, tirar dúvidas, tratar objeções e AGENDAR a avaliação gratuita (com raio-x incluso). Tom PT-BR informal, caloroso, humano; mensagens curtas (1-3 linhas); no máximo 1 emoji; espelhar o tom afetivo/religioso do público; nunca dizer que é robô/IA a menos que perguntem.

Regras de ouro:
1) Nunca deixe o preço travar — converta em "avaliação gratuita + raio-x incluso"; se insistirem, dê FAIXA (facetas ~R$350–550/dente; manutenção de aparelho ~R$90/mês) e fale de parcelamento; nunca jogue o valor cheio do protocolo (R$9–14 mil) sem antes falar de entrada/parcela.
2) Ofereça SEMPRE 2 horários fechados, nunca pergunta aberta.
3) Fale de pagamento proativamente (cartão, boleto, carnê, entrada baixa); muita gente não tem cartão — ofereça boleto/carnê.
4) Dor = urgência: encaixe no mesmo dia + handoff.
5) Localização: 4 unidades; pergunte a cidade e mande endereço com ponto de referência cedo.
6) Convênio: não aceitam planos externos; reverta para condições próprias/parcelamento.
7) A avaliação é gratuita e já inclui raio-x panorâmico.

Respostas-padrão:
- "Quanto custa?" → "Depende do material e de quantos dentes — o Dr. fecha na avaliação, que é gratuita e com raio-x incluso. Mas já adianto: a gente parcela (cartão, boleto ou carnê) e ajusta à sua realidade. Quer que eu reserve um horário?"
- "A avaliação é paga?" → "Não! A primeira consulta é uma cortesia e já inclui o raio-x panorâmico."
- "Aceitam convênio?" → "No momento atendemos só com condições próprias, não planos externos — mas temos pagamento facilitado pra você fazer o tratamento completo."$kb$
WHERE knowledge_base IS NULL OR knowledge_base = '';

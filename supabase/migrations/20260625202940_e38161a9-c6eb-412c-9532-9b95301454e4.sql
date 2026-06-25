
-- 7A: ai_assistant_rules
CREATE TABLE public.ai_assistant_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  kind text NOT NULL CHECK (kind IN ('diretriz','restricao')),
  text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_assistant_rules TO authenticated;
GRANT ALL ON public.ai_assistant_rules TO service_role;

ALTER TABLE public.ai_assistant_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_rules" ON public.ai_assistant_rules
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role));

CREATE POLICY "insert_rules" ON public.ai_assistant_rules
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role));

CREATE POLICY "update_rules" ON public.ai_assistant_rules
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role));

CREATE POLICY "delete_rules" ON public.ai_assistant_rules
  FOR DELETE TO authenticated
  USING (
    (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'crc'::app_role) OR has_role(auth.uid(),'gerente'::app_role)))
    OR has_role(auth.uid(),'superadmin'::app_role)
  );

CREATE TRIGGER update_ai_assistant_rules_updated_at
  BEFORE UPDATE ON public.ai_assistant_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seeds para tenant Rizodent (primeiro tenant existente)
INSERT INTO public.ai_assistant_rules (tenant_id, kind, text)
SELECT t.id, v.kind, v.text
FROM public.tenants t
CROSS JOIN (VALUES
  ('diretriz','Sempre comece com o primeiro nome do cliente'),
  ('diretriz','Pergunte a cidade antes de enviar o endereço'),
  ('diretriz','Ao falar de preço, ofereça boleto/carnê proativamente'),
  ('diretriz','Acolha a dor do cliente antes de fazer perguntas'),
  ('restricao','Nunca diga que é uma IA nem cite limitações técnicas'),
  ('restricao','Nunca ofereça horário específico sem confirmar com a equipe'),
  ('restricao','Nunca invente endereço, nome ou cidade'),
  ('restricao','Nunca diga "bom dia" à tarde ou à noite'),
  ('restricao','Nunca jogue o valor total do tratamento sem antes falar de parcelamento')
) AS v(kind, text)
WHERE lower(t.slug) = 'rizodent' OR lower(t.name) LIKE 'rizodent%';

-- 7B: feedback em ai_reply_suggestions
ALTER TABLE public.ai_reply_suggestions
  ADD COLUMN IF NOT EXISTS final_text text,
  ADD COLUMN IF NOT EXISTS was_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outcome text;

-- 7C: pgvector + ai_good_examples
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.ai_good_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  lead_id uuid,
  context text NOT NULL,
  ideal_reply text NOT NULL,
  cidade text,
  servico text,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_good_examples TO authenticated;
GRANT ALL ON public.ai_good_examples TO service_role;

ALTER TABLE public.ai_good_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_examples" ON public.ai_good_examples
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role));

CREATE POLICY "insert_examples" ON public.ai_good_examples
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role));

CREATE POLICY "delete_examples" ON public.ai_good_examples
  FOR DELETE TO authenticated
  USING (
    (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'crc'::app_role) OR has_role(auth.uid(),'gerente'::app_role)))
    OR has_role(auth.uid(),'superadmin'::app_role)
  );

CREATE INDEX ai_good_examples_embedding_idx
  ON public.ai_good_examples USING hnsw (embedding vector_cosine_ops);

CREATE INDEX ai_good_examples_tenant_idx
  ON public.ai_good_examples (tenant_id);

-- RPC para busca por similaridade (filtrada por tenant via RLS implícito)
CREATE OR REPLACE FUNCTION public.match_good_examples(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_tenant uuid DEFAULT NULL,
  filter_cidade text DEFAULT NULL,
  filter_servico text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  context text,
  ideal_reply text,
  cidade text,
  servico text,
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.context, e.ideal_reply, e.cidade, e.servico,
         1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.ai_good_examples e
  WHERE e.embedding IS NOT NULL
    AND (filter_tenant IS NULL OR e.tenant_id = filter_tenant)
  ORDER BY
    -- prioriza mesma cidade/serviço dando boost na ordenação
    (CASE WHEN filter_cidade IS NOT NULL AND lower(e.cidade) = lower(filter_cidade) THEN 0 ELSE 1 END),
    (CASE WHEN filter_servico IS NOT NULL AND lower(e.servico) = lower(filter_servico) THEN 0 ELSE 1 END),
    e.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================================
-- 23/09/2026 — bloquear o contato também na Meta
--
-- Hoje "bloquear lead" só marca crm_leads.is_blocked: o lead some do CRClin e
-- as mensagens dele continuam chegando na conta de WhatsApp da clínica. A Meta
-- tem API de bloqueio por número (POST/DELETE /{phone_number_id}/block_users).
-- Esta tabela guarda o que foi pedido e o que a Meta respondeu — é a única
-- fonte, porque a Meta não manda webhook de bloqueio e o GET dela devolve só
-- wa_id, sem nome nem data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_bloqueios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid,
  telefone text NOT NULL,
  wa_id text,
  phone_number_id text NOT NULL,
  acao text NOT NULL CHECK (acao IN ('bloquear', 'desbloquear')),
  sucesso boolean NOT NULL,
  erro_codigo integer,
  erro_texto text,
  feito_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_bloqueios IS
  'Histórico de bloqueio/desbloqueio de contato na Meta (block_users). Escrito só pelo servidor.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_bloqueios_tenant ON public.whatsapp_bloqueios (tenant_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_bloqueios_lead ON public.whatsapp_bloqueios (lead_id);

ALTER TABLE public.whatsapp_bloqueios ENABLE ROW LEVEL SECURITY;

-- Leitura: gestão do próprio cliente. Escrita: só o servidor (service role
-- ignora RLS) — ninguém forja um bloqueio pelo navegador.
DROP POLICY IF EXISTS whatsapp_bloqueios_leitura_gestao ON public.whatsapp_bloqueios;
CREATE POLICY whatsapp_bloqueios_leitura_gestao ON public.whatsapp_bloqueios
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.has_role(auth.uid(), 'superadmin'::app_role)
    )
  );

REVOKE ALL ON public.whatsapp_bloqueios FROM PUBLIC, anon;
GRANT SELECT ON public.whatsapp_bloqueios TO authenticated;

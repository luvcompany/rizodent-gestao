-- ============================================================================
-- Horário comercial do time de atendimento (por tenant)
-- ============================================================================
-- Motivação (dono, 08/07): as métricas de "tempo de resposta" e "não respondidos"
-- usavam relógio corrido — um lead que escreve 19h ou no fim de semana entrava como
-- resposta lenta / não respondido, mesmo que o time só atenda no próximo horário
-- útil. Agora existe uma config de horário comercial que as métricas respeitam.
--
-- Formato: tenants.business_hours jsonb, chaveado por dia da semana (0=domingo ..
-- 6=sábado). Cada dia = ["HH:MM","HH:MM"] (abre, fecha) OU ausente/null = fechado.
--   NULL na coluna inteira = tenant sem horário definido → métricas usam relógio
--   corrido (comportamento antigo, sem quebrar quem não configurou).
--
-- Valores da Rizodent (resposta do dono): seg–sex 07:30–18:00, sábado 07:30–12:00
-- (meio período), domingo fechado.
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_hours jsonb;

COMMENT ON COLUMN public.tenants.business_hours IS
  'Horário comercial do atendimento por dia da semana (0=dom..6=sáb): {"1":["07:30","18:00"],...}. '
  'Dia ausente/null = fechado. Coluna null = sem horário (métricas usam relógio corrido). '
  'Usado pelas métricas de tempo de resposta / não respondidos.';

UPDATE public.tenants
SET business_hours = jsonb_build_object(
  '1', jsonb_build_array('07:30','18:00'),
  '2', jsonb_build_array('07:30','18:00'),
  '3', jsonb_build_array('07:30','18:00'),
  '4', jsonb_build_array('07:30','18:00'),
  '5', jsonb_build_array('07:30','18:00'),
  '6', jsonb_build_array('07:30','12:00')
)
WHERE id = '00000000-0000-0000-0000-000000000010'
  AND business_hours IS NULL;

-- ----------------------------------------------------------------------------
-- Escrita do horário comercial pela tela de Configurações.
-- A RLS de tenants só permite UPDATE por superadmin; esta função SECURITY DEFINER
-- deixa crc/gerente/superadmin salvar APENAS a coluna business_hours do próprio
-- tenant (sem abrir o resto da tabela).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_tenant_business_hours(p_hours jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem tenant associado';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'superadmin'::app_role)
       OR public.has_role(auth.uid(), 'crc'::app_role)
       OR public.has_role(auth.uid(), 'gerente'::app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o horário comercial';
  END IF;
  UPDATE public.tenants SET business_hours = p_hours WHERE id = v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_business_hours(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_business_hours(jsonb) TO authenticated;

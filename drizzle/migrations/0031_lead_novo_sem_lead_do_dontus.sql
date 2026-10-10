-- Lead criado pelo dontus-sync não é lead novo (pedido do dono, 09/10/2026).
--
-- Quando um pagamento do Dontus não acha lead no CRM, o dontus-sync cria o lead
-- direto em Contratado, com a origem do paciente no Dontus (facebook_ad,
-- google_ads, instagram ou kommo). Esse lead não entrou pelo atendimento: nasceu
-- do pagamento. Só o de origem kommo ficava fora da régua de lead novo (0023); os
-- de origem de anúncio contavam (2 em out/26: Luciana Nunes e Erivaldo Calheira).
--
-- A partir de agora o dontus-sync grava a tag 'criado_pelo_dontus' e
-- lead_novo_motivo devolve 'dontus' para ela.

-- Leads antigos: assinatura do dontus-sync = 1ª passagem de etapa já em
-- Contratado, gravada sem usuário (service role) junto com a criação do lead,
-- com paciente vinculado que tem pagamento importado do Dontus. Conferido em
-- 09/10/2026: 40 leads desde 23/07 (38 kommo + 2 facebook_ad) contra 47 criados
-- nos registros do sync (os demais foram apagados ou mesclados depois).
WITH primeira_etapa AS (
  SELECT DISTINCT ON (h.lead_id) h.lead_id, h.stage_id, h.entered_at, h.changed_by, h.from_stage_id
    FROM public.crm_lead_stage_history h
   ORDER BY h.lead_id, h.entered_at, h.id
)
UPDATE public.crm_leads l
   SET tags = array_append(COALESCE(l.tags, '{}'::text[]), 'criado_pelo_dontus')
  FROM primeira_etapa p
  JOIN public.crm_stages s ON s.id = p.stage_id
 WHERE p.lead_id = l.id
   AND s.name ILIKE '%contratado%'
   AND p.changed_by IS NULL
   AND p.from_stage_id IS NULL
   AND abs(extract(epoch FROM p.entered_at - l.created_at)) < 30
   AND l.created_at >= timestamptz '2026-07-01 00:00-03'
   AND lower(btrim(COALESCE(l.source, ''))) IN ('kommo', 'instagram', 'facebook_ad', 'google_ads')
   AND NOT ('criado_pelo_dontus' = ANY (COALESCE(l.tags, '{}'::text[])))
   AND EXISTS (
     SELECT 1 FROM public.crm_lead_pacientes lp
       JOIN public.pagamentos pg ON pg.paciente_id = lp.paciente_id
      WHERE lp.lead_id = l.id AND pg.dontus_key IS NOT NULL
   );

-- Mesma função da 0023 com o motivo 'dontus' depois do sintético.
CREATE OR REPLACE FUNCTION public.lead_novo_motivo(l public.crm_leads)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN NOT COALESCE(l.tenant_id = public.current_tenant_id() OR auth.role() = 'service_role', false)
      THEN 'sem_acesso'
    WHEN COALESCE(l.comment_only, false) THEN 'comentario'
    WHEN lower(btrim(COALESCE(l.source, ''))) = 'kommo' THEN 'kommo'
    WHEN lower(btrim(COALESCE(l.source, ''))) = 'retroativo' THEN 'retroativo'
    WHEN 'sintetico_pagamento' = ANY (COALESCE(l.tags, '{}'::text[])) THEN 'sintetico'
    WHEN 'criado_pelo_dontus' = ANY (COALESCE(l.tags, '{}'::text[])) THEN 'dontus'
    WHEN EXISTS (
      SELECT 1 FROM public.crm_leads o
       WHERE o.tenant_id = l.tenant_id
         AND o.id <> l.id
         AND o.created_at < l.created_at
         AND ((NULLIF(l.phone, '') IS NOT NULL AND o.phone = l.phone)
           OR (l.instagram_user_id IS NOT NULL AND o.instagram_user_id = l.instagram_user_id))
    ) THEN 'recontato'
    WHEN EXISTS (
      SELECT 1 FROM public.deleted_leads_backup d
       WHERE d.tenant_id = l.tenant_id
         AND d.original_lead_id IS DISTINCT FROM l.id
         AND d.deleted_at <= l.created_at
         AND l.created_at - d.deleted_at < interval '7 days'
         AND ((NULLIF(l.phone, '') IS NOT NULL AND d.lead_phone = l.phone)
           OR (l.instagram_user_id IS NOT NULL AND d.lead_snapshot->>'instagram_user_id' = l.instagram_user_id))
    ) THEN 'recriado'
  END;
$fn$;

REVOKE ALL ON FUNCTION public.lead_novo_motivo(public.crm_leads) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_novo_motivo(public.crm_leads) TO authenticated, service_role;

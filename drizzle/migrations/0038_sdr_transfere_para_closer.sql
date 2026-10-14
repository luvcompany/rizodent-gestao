-- SDR transfere o lead dela para o closer/recepção (14/10/2026).
--
-- A transfer-lead já aceita esse destino desde a 0036 (o lead muda de equipe
-- e não some mais), mas o seletor "Responsável" da SDR lista só o que
-- sdr_destinos_transferencia devolve — e ela devolvia só SDRs e o
-- administrador. Entram closer e recepção ativos que têm número de WhatsApp
-- conectado (sem número, a transferência seria recusada).

CREATE OR REPLACE FUNCTION public.sdr_destinos_transferencia()
 RETURNS TABLE(user_id uuid, nome text, papel text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH eu AS (
    SELECT auth.uid() AS id, public.current_tenant_id() AS tenant
  )
  SELECT p.id, p.nome, 'sdr'::text
    FROM public.profiles p, eu
   WHERE public.has_role(eu.id, 'sdr'::app_role)
     AND p.tenant_id = eu.tenant
     AND p.id <> eu.id
     AND NOT COALESCE(p.is_blocked, false)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'sdr'::app_role)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role <> 'sdr'::app_role)
  UNION ALL
  SELECT p.id, p.nome, 'gestor'::text
    FROM public.profiles p, eu
    JOIN public.crm_rodizio_config c ON c.tenant_id = eu.tenant
   WHERE public.has_role(eu.id, 'sdr'::app_role)
     AND p.id = c.gestor_user_id
     AND NOT COALESCE(p.is_blocked, false)
  UNION ALL
  SELECT p.id, p.nome, r.role::text
    FROM public.profiles p, eu, public.user_roles r
   WHERE public.has_role(eu.id, 'sdr'::app_role)
     AND p.tenant_id = eu.tenant
     AND r.user_id = p.id
     AND r.role IN ('closer'::app_role, 'recepcao'::app_role)
     AND NOT COALESCE(p.is_blocked, false)
     AND EXISTS (SELECT 1 FROM public.whatsapp_numbers w
                  WHERE w.tenant_id = eu.tenant AND w.is_active
                    AND w.mundo = r.role::text
                    AND (w.dono_user_id = p.id OR w.dono_user_id IS NULL))
  ORDER BY 3, 2;
$function$;
REVOKE ALL ON FUNCTION public.sdr_destinos_transferencia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_destinos_transferencia() TO authenticated, service_role;

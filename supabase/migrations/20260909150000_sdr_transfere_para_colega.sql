-- Rodízio de SDRs — a SDR passa a poder transferir o lead DELA.
--
-- Decisão do dono (09/09/2026): "o sdr consegue sim trocar o lead para outro
-- sdr, só que de forma alguma ela consiga 'roubar' o lead de outro sdr".
--
-- O que muda: só o DESTINO. A SDR continua sem poder puxar lead de ninguém
-- (nem lead sem dona) — isso segue travado pela RESTRICTIVE
-- sdr_escopo_crm_leads_update, pelo gatilho trg_sdr_nao_transfere_lead e pela
-- checagem da edge function transfer-lead, que é o único caminho de troca de
-- dona (roda com service role e valida: lead é dela + destino permitido).
--
-- Destinos permitidos para a SDR: outra SDR ativa (papel exclusivamente sdr,
-- não bloqueada, no rodízio ou não), o gestor da equipe (administrador) e a
-- pós-venda. Nunca closer/recepção: o lead sairia do número principal e
-- ficaria invisível para quem recebeu.
--
-- Esta RPC só existe para a tela listar os destinos: a SDR não lê user_roles
-- das colegas (RLS), então sem ela o seletor viria vazio.
CREATE OR REPLACE FUNCTION public.sdr_destinos_transferencia()
RETURNS TABLE(user_id uuid, nome text, papel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
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
  SELECT p.id, p.nome, 'posvenda'::text
    FROM public.profiles p, eu
   WHERE public.has_role(eu.id, 'sdr'::app_role)
     AND p.tenant_id = eu.tenant
     AND NOT COALESCE(p.is_blocked, false)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'posvenda'::app_role)
  ORDER BY 3, 2;
$fn$;
REVOKE ALL ON FUNCTION public.sdr_destinos_transferencia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_destinos_transferencia() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rodizio_on_mensagem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '5s'
AS $function$
DECLARE v_tenant uuid; v_modo text; v_admin uuid; l public.crm_leads;
BEGIN
  -- Resposta por botão (ex.: "Ainda tenho interesse" de um disparo) também
  -- distribui: pedido do dono em 08/10/2026.
  IF NEW.direction <> 'inbound' OR NEW.lead_id IS NULL OR NEW.instagram_comment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_tenant := COALESCE(NEW.tenant_id, (SELECT x.tenant_id FROM public.crm_leads x WHERE x.id = NEW.lead_id));
  IF v_tenant IS NULL THEN RETURN NEW; END IF;
  SELECT k.modo, k.gestor_user_id INTO v_modo, v_admin FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant;
  IF v_modo IS NULL OR v_modo = 'desligado' THEN RETURN NEW; END IF;
  SELECT * INTO l FROM public.crm_leads x WHERE x.id = NEW.lead_id;
  IF NOT FOUND OR l.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.rodizio_lead_na_fila(l, v_admin, public.rodizio_funil(l.tenant_id),
                                     public.rodizio_numero_principal(l.tenant_id), public.rodizio_etapas_entrada(l.tenant_id)) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.type, 'text') = 'text'
     AND COALESCE(NEW.content, '') ~ '^\s*\d{1,2}\s*[.!]?\s*$'
     AND EXISTS (SELECT 1 FROM public.crm_pesquisa_respostas pr
                  WHERE pr.lead_id = NEW.lead_id
                    AND pr.respondida_em IS NULL AND pr.nota IS NULL
                    AND pr.enviada_em >= now() - interval '7 days') THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.rodizio_processar_lead(NEW.lead_id, 'mensagem recebida em lead do administrador');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rodizio_on_mensagem: lead % não distribuído (%): %', NEW.lead_id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END $function$;

GRANT EXECUTE ON FUNCTION public.rodizio_on_mensagem() TO authenticated, service_role;
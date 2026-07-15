CREATE OR REPLACE FUNCTION public.propagate_lead_to_paciente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  BEGIN
    UPDATE public.pacientes p
    SET cidade       = COALESCE(NULLIF(p.cidade,''),       l.cidade),
        nome_anuncio = COALESCE(NULLIF(p.nome_anuncio,''), l.nome_anuncio),
        origem       = COALESCE(NULLIF(p.origem,''),       public.map_source_to_origem(l.source))
    FROM public.crm_leads l
    WHERE l.id = NEW.lead_id
      AND p.id = NEW.paciente_id
      AND l.tenant_id = p.tenant_id
      AND COALESCE(l.source,'') <> 'Retroativo'
      AND NOT ('sintetico_pagamento' = ANY(COALESCE(l.tags, '{}')));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_propagate_lead_to_paciente ON public.crm_lead_pacientes;
CREATE TRIGGER trg_propagate_lead_to_paciente
AFTER INSERT OR UPDATE OF is_primary ON public.crm_lead_pacientes
FOR EACH ROW EXECUTE FUNCTION public.propagate_lead_to_paciente();
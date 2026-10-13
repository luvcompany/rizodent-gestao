-- Pagamento do Dontus de paciente sem telefone não some mais (13/10/2026).
--
-- bloqueia_pagamento_sem_telefone (0004) devolvia NULL quando quem gravava
-- era o sistema (auth.uid() nulo = dontus-sync): o INSERT "dava certo", o sync
-- contava "importado" e a linha nunca existia. Em 10/10 sumiram assim
-- R$ 480 de Guanambi (Joel da Silva Santos R$ 300, Enzo Henrique R$ 137 + 43),
-- vistos só na planilha manual da equipe.
--
-- O dinheiro recebido existe no Dontus: o CRM grava e avisa para cadastrar o
-- telefone. A trava continua para quem lança à mão (recepção), que vê o erro
-- e corrige na hora. Lead sem telefone continua proibido
-- (bloqueia_lead_sem_telefone); ensure_lead_for_pagamento já trata a falha.

CREATE OR REPLACE FUNCTION public.bloqueia_pagamento_sem_telefone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pac    record;
  v_tenant uuid;
  v_aviso  uuid;
  v_lead   uuid;
BEGIN
  SELECT id, nome, telefone, tenant_id INTO v_pac FROM public.pacientes WHERE id = NEW.paciente_id;
  IF coalesce(regexp_replace(v_pac.telefone, '\D', '', 'g'), '') <> '' THEN RETURN NEW; END IF;

  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Paciente sem telefone: cadastre o telefone antes de lançar o pagamento.' USING ERRCODE = 'check_violation';
  END IF;

  -- Sistema (sync do Dontus): grava e pede o telefone. Nunca descarta.
  BEGIN
    v_tenant := coalesce(v_pac.tenant_id, (SELECT c.tenant_id FROM public.clinicas c WHERE c.id = NEW.clinica_id));
    SELECT ur.user_id INTO v_aviso
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE p.tenant_id = v_tenant AND ur.role = 'gerente'::app_role AND NOT coalesce(p.is_blocked, false)
     ORDER BY p.created_at LIMIT 1;
    IF v_aviso IS NULL THEN
      SELECT p.id INTO v_aviso FROM public.profiles p
       WHERE p.tenant_id = v_tenant AND NOT coalesce(p.is_blocked, false)
       ORDER BY p.created_at LIMIT 1;
    END IF;
    SELECT lp.lead_id INTO v_lead FROM public.crm_lead_pacientes lp
     WHERE lp.paciente_id = NEW.paciente_id ORDER BY lp.is_primary DESC LIMIT 1;
    IF v_aviso IS NOT NULL THEN
      INSERT INTO public.crm_notifications (user_id, type, title, body, lead_id, dedupe_key)
      VALUES (v_aviso, 'warning', 'Paciente sem telefone',
              format('Pagamento de %s (R$ %s em %s) entrou do Dontus, mas o paciente está sem telefone. Cadastre o telefone para ligar o pagamento ao lead certo.',
                     coalesce(v_pac.nome, 'paciente sem nome'), replace(to_char(NEW.valor, 'FM9999990.00'), '.', ','), to_char(NEW.data_pagamento, 'DD/MM/YYYY')),
              v_lead, 'pagamento_sem_telefone:' || NEW.paciente_id::text)
      ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'bloqueia_pagamento_sem_telefone: aviso não gravado (%)', SQLERRM;
  END;
  RETURN NEW;
END $function$;

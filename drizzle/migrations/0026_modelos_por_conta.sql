-- Modelos (templates) por CONTA do WhatsApp (WABA), não por número (09/10/2026).
--
-- O modelo pertence à conta (WABA): o número oficial e o "Comercial 2" estão
-- na MESMA conta e enxergam os mesmos modelos. O banco ainda tratava o modelo
-- como do número: índice único por (cliente, número, nome) e dono carimbado
-- com o papel de quem criou ('gerente' sumia da equipe; superadmin idem).
--
-- 1) Dono do modelo (set_owner_role_from_user, ramo de crm_whatsapp_templates):
--    superadmin e gerente → sem dono (todos veem); SDR → 'crc'; os demais → o
--    papel. Mesma regra de donoDoModelo (_shared/modelosDaConta.ts) e da tela.
--    Bots, transmissões, respostas rápidas, tarefas e agendamentos: iguais.
-- 2) update_whatsapp_template_sharing recusa 'gerente' e 'sdr' como dono.
-- 3) carimba_dono_do_modelo também preenche a conta (waba_id) pelo número.
-- 4) Índice único por (cliente, conta, nome, idioma) no lugar de (cliente,
--    número, nome). Conferido em 09/10: 0 duplicatas.

CREATE OR REPLACE FUNCTION public.set_owner_role_from_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.app_role;
BEGIN
  IF NEW.owner_role IS NULL AND auth.uid() IS NOT NULL THEN
    -- Modelos: mesma regra de donoDoModelo (_shared/modelosDaConta.ts).
    -- superadmin/gerente → NULL (geral); sdr → 'crc'; demais → o papel.
    IF TG_TABLE_NAME = 'crm_whatsapp_templates' THEN
      SELECT role INTO v_role
        FROM public.user_roles
       WHERE user_id = auth.uid()
       ORDER BY CASE role
         WHEN 'superadmin' THEN 1
         WHEN 'crc'        THEN 2
         WHEN 'gerente'    THEN 3
         WHEN 'posvenda'   THEN 4
         WHEN 'recepcao'   THEN 5
         WHEN 'closer'     THEN 6
         WHEN 'sdr'        THEN 7
         ELSE 99
       END
       LIMIT 1;
      IF v_role = 'sdr' THEN
        NEW.owner_role := 'crc';
      ELSIF v_role IN ('crc', 'posvenda', 'recepcao', 'closer') THEN
        NEW.owner_role := v_role;
      END IF;
      RETURN NEW;
    END IF;

    SELECT role INTO v_role
      FROM public.user_roles
     WHERE user_id = auth.uid()
     ORDER BY CASE role
       WHEN 'crc'        THEN 1
       WHEN 'posvenda'   THEN 2
       WHEN 'recepcao'   THEN 2
       WHEN 'closer'     THEN 2
       WHEN 'sdr'        THEN 2
       WHEN 'gerente'    THEN 3
       WHEN 'superadmin' THEN 99
       WHEN 'crc_legacy' THEN 99
       ELSE 99
     END
     LIMIT 1;
    IF v_role = 'sdr' THEN
      NEW.owner_role := 'crc';
    ELSIF v_role IN ('crc', 'posvenda', 'gerente', 'recepcao', 'closer') THEN
      NEW.owner_role := v_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_whatsapp_template_sharing(_template_id uuid, _owner_role app_role, _shared_roles app_role[] DEFAULT '{}'::app_role[])
 RETURNS crm_whatsapp_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _template public.crm_whatsapp_templates;
  _tenant_id uuid;
  _can_manage boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  _tenant_id := public.current_tenant_id();

  SELECT * INTO _template
  FROM public.crm_whatsapp_templates
  WHERE id = _template_id
    AND (tenant_id = _tenant_id OR public.has_role(auth.uid(), 'superadmin'::public.app_role));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;

  _can_manage :=
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'crc'::public.app_role)
        OR public.has_role(auth.uid(), 'posvenda'::public.app_role)
      )
      AND (
        _template.owner_role IS NULL
        OR public.has_role(auth.uid(), _template.owner_role)
        OR public.user_has_any_role(auth.uid(), _template.shared_roles)
      )
    );

  IF NOT _can_manage THEN
    RAISE EXCEPTION 'Sem permissão para alterar este modelo';
  END IF;

  IF _owner_role = 'superadmin'::public.app_role OR 'superadmin'::public.app_role = ANY(COALESCE(_shared_roles, '{}'::public.app_role[])) THEN
    RAISE EXCEPTION 'Superadmin não deve ser usado como visibilidade do modelo';
  END IF;

  -- Gerente vê todos os modelos e a SDR vê os do CRC: nenhum dos dois é dono.
  IF _owner_role IN ('gerente'::public.app_role, 'sdr'::public.app_role) THEN
    RAISE EXCEPTION 'Gerente e SDR não são donos de modelo: deixe sem dono (todos veem) ou escolha a equipe (CRC, Pós-venda, Closer, Recepção). A SDR vê os modelos do CRC.';
  END IF;

  UPDATE public.crm_whatsapp_templates
  SET owner_role = _owner_role,
      shared_roles = COALESCE(array_remove(_shared_roles, _owner_role), '{}'::public.app_role[]),
      updated_at = now()
  WHERE id = _template_id
  RETURNING * INTO _template;

  RETURN _template;
END;
$function$;

CREATE OR REPLACE FUNCTION public.carimba_dono_do_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.owner_role IS NULL AND NEW.whatsapp_number_id IS NOT NULL THEN
    NEW.owner_role := public.dono_restrito_do_numero(NEW.whatsapp_number_id);
  END IF;
  -- O modelo é da CONTA: sem waba_id, herda a do número.
  IF NEW.waba_id IS NULL AND NEW.whatsapp_number_id IS NOT NULL THEN
    SELECT NULLIF(btrim(w.waba_id), '') INTO NEW.waba_id
      FROM public.whatsapp_numbers w WHERE w.id = NEW.whatsapp_number_id;
  END IF;
  RETURN NEW;
END $function$;

-- Índice novo antes de derrubar o antigo (sem janela sem unicidade).
CREATE UNIQUE INDEX IF NOT EXISTS crm_whatsapp_templates_tenant_conta_nome_idioma_uniq
  ON public.crm_whatsapp_templates (tenant_id, coalesce(waba_id, whatsapp_number_id::text, ''), name, language);
DROP INDEX IF EXISTS public.crm_whatsapp_templates_tenant_number_name_uniq;

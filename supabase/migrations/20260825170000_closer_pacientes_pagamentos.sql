-- Pacientes e pagamentos DO CLOSER — universo próprio, separado do que vem do
-- Dontus para o crc. Nada aqui toca as tabelas pacientes/pagamentos/clinicas/
-- tipos_procedimento, nem as policies closer_sem_acesso_* que as bloqueiam.
--
-- Esta migração REGISTRA o que já foi aplicado em produção em 25/08/2026 e
-- acrescenta as travas que faltavam (número obrigatório e imutável). É
-- idempotente: rodar de novo não muda o que já existe.

-- ---------------------------------------------------------------- tabelas
CREATE TABLE IF NOT EXISTS public.closer_pacientes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  whatsapp_number_id uuid NOT NULL REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT,
  lead_id            uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  nome               text NOT NULL,
  telefone           text,
  email              text,
  cidade             text,
  observacoes        text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.closer_pagamentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  whatsapp_number_id uuid NOT NULL REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT,
  paciente_id        uuid NOT NULL REFERENCES public.closer_pacientes(id) ON DELETE CASCADE,
  clinica_id         uuid REFERENCES public.clinicas(id) ON DELETE SET NULL,
  valor              numeric NOT NULL CHECK (valor > 0),
  forma_pagamento    text,
  tipo               text,
  especialidade      text,
  data_pagamento     date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Bahia')::date),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Um mesmo lead pode ter VÁRIOS pacientes (família no mesmo telefone), como no crc.
DROP INDEX IF EXISTS public.closer_pacientes_lead_uniq;
CREATE INDEX IF NOT EXISTS idx_closer_pacientes_numero      ON public.closer_pacientes (whatsapp_number_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_closer_pacientes_lead_lista  ON public.closer_pacientes (lead_id, created_at) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_closer_pagamentos_numero_data ON public.closer_pagamentos (whatsapp_number_id, data_pagamento DESC);
CREATE INDEX IF NOT EXISTS idx_closer_pagamentos_paciente    ON public.closer_pagamentos (paciente_id);

-- ---------------------------------------------------------------- gatilhos
-- O número vem SEMPRE do usuário logado, nunca do navegador.
CREATE OR REPLACE FUNCTION public.closer_paciente_carimba_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_num uuid; v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_tenant := public.current_tenant_id();
  SELECT w.id INTO v_num
  FROM public.whatsapp_numbers w
  JOIN public.user_permission_overrides o
    ON o.resource_id = w.id::text AND o.scope = 'whatsapp_number' AND o.granted
  WHERE o.user_id = auth.uid() AND w.tenant_id = v_tenant AND w.is_active
  ORDER BY w.created_at
  LIMIT 1;
  IF v_num IS NULL THEN
    RAISE EXCEPTION 'Nenhum número de WhatsApp concedido a este usuário';
  END IF;
  NEW.whatsapp_number_id := v_num;
  NEW.tenant_id := v_tenant;
  NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  RETURN NEW;
END $fn$;

-- Sem isto, uma alteração poderia apagar o número da ficha — e a policy libera
-- quando o número é nulo, deixando a ficha visível para todo o cliente.
CREATE OR REPLACE FUNCTION public.closer_paciente_preserva_carimbo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  NEW.whatsapp_number_id := OLD.whatsapp_number_id;
  NEW.tenant_id          := OLD.tenant_id;
  NEW.created_by         := OLD.created_by;
  NEW.updated_at         := now();
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.closer_pagamento_herda_paciente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p record;
BEGIN
  SELECT tenant_id, whatsapp_number_id INTO p FROM public.closer_pacientes WHERE id = NEW.paciente_id;
  IF p IS NULL THEN RAISE EXCEPTION 'Paciente do closer nao encontrado'; END IF;
  NEW.tenant_id := p.tenant_id;
  NEW.whatsapp_number_id := p.whatsapp_number_id;
  IF NEW.clinica_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clinicas c WHERE c.id = NEW.clinica_id AND c.tenant_id = p.tenant_id
  ) THEN
    RAISE EXCEPTION 'Clinica nao pertence a esta conta';
  END IF;
  NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_closer_paciente_carimba_numero ON public.closer_pacientes;
CREATE TRIGGER trg_closer_paciente_carimba_numero
  BEFORE INSERT ON public.closer_pacientes
  FOR EACH ROW EXECUTE FUNCTION public.closer_paciente_carimba_numero();

DROP TRIGGER IF EXISTS trg_closer_paciente_preserva_carimbo ON public.closer_pacientes;
CREATE TRIGGER trg_closer_paciente_preserva_carimbo
  BEFORE UPDATE ON public.closer_pacientes
  FOR EACH ROW EXECUTE FUNCTION public.closer_paciente_preserva_carimbo();

DROP TRIGGER IF EXISTS trg_closer_pagamento_herda_paciente ON public.closer_pagamentos;
CREATE TRIGGER trg_closer_pagamento_herda_paciente
  BEFORE INSERT OR UPDATE ON public.closer_pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.closer_pagamento_herda_paciente();

-- ---------------------------------------------------------------- acesso
ALTER TABLE public.closer_pacientes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closer_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS closer_pacientes_tenant   ON public.closer_pacientes;
DROP POLICY IF EXISTS closer_pagamentos_tenant  ON public.closer_pagamentos;
DROP POLICY IF EXISTS closer_pacientes_numero   ON public.closer_pacientes;
DROP POLICY IF EXISTS closer_pagamentos_numero  ON public.closer_pagamentos;

CREATE POLICY closer_pacientes_tenant ON public.closer_pacientes AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY closer_pagamentos_tenant ON public.closer_pagamentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- `IS NOT NULL` é essencial: can_access_whatsapp_number(NULL) responde "pode"
-- (é assim que o mundo legado do crc funciona). Sem esta exigência, uma ficha
-- sem número ficaria aberta a todo o cliente.
CREATE POLICY closer_pacientes_numero ON public.closer_pacientes FOR ALL TO authenticated
  USING (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  WITH CHECK (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id));

CREATE POLICY closer_pagamentos_numero ON public.closer_pagamentos FOR ALL TO authenticated
  USING (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  WITH CHECK (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id));

-- ---------------------------------------------------------------- funções
-- Listas para os seletores, sem abrir as tabelas do crc (que seguem bloqueadas).
CREATE OR REPLACE FUNCTION public.closer_clinicas_do_tenant()
RETURNS TABLE(id uuid, nome text, cidade text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT c.id, c.nome, c.cidade
  FROM public.clinicas c
  WHERE c.tenant_id = public.current_tenant_id()
    AND c.ativa
    AND auth.uid() IS NOT NULL
  ORDER BY c.nome;
$fn$;

CREATE OR REPLACE FUNCTION public.closer_especialidades_do_tenant()
RETURNS TABLE(especialidade text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT DISTINCT e.nome
  FROM (
    SELECT t.especialidade AS nome FROM public.tipos_procedimento t
     WHERE t.ativo AND t.especialidade IS NOT NULL
       AND t.tenant_id = public.current_tenant_id()
    UNION
    SELECT t.especialidade_secundaria FROM public.tipos_procedimento t
     WHERE t.ativo AND t.especialidade_secundaria IS NOT NULL
       AND t.tenant_id = public.current_tenant_id()
  ) e
  WHERE auth.uid() IS NOT NULL
  ORDER BY 1;
$fn$;

-- Vincular e lançar o primeiro pagamento numa transação só.
CREATE OR REPLACE FUNCTION public.closer_vincular_paciente(
  p_lead_id uuid,
  p_nome text,
  p_telefone text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_valor numeric DEFAULT NULL,
  p_clinica_id uuid DEFAULT NULL,
  p_data_pagamento date DEFAULT NULL,
  p_tipo text DEFAULT NULL,
  p_especialidade text DEFAULT NULL,
  p_forma_pagamento text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $fn$
DECLARE v_id uuid;
BEGIN
  IF coalesce(btrim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do paciente';
  END IF;

  INSERT INTO public.closer_pacientes (lead_id, nome, telefone, cidade)
  VALUES (p_lead_id, btrim(p_nome), nullif(btrim(coalesce(p_telefone,'')),''), nullif(btrim(coalesce(p_cidade,'')),''))
  RETURNING id INTO v_id;

  IF p_valor IS NOT NULL AND p_valor > 0 THEN
    INSERT INTO public.closer_pagamentos
      (paciente_id, valor, clinica_id, data_pagamento, tipo, especialidade, forma_pagamento)
    VALUES (v_id, p_valor, p_clinica_id,
            coalesce(p_data_pagamento, (now() AT TIME ZONE 'America/Bahia')::date),
            nullif(p_tipo,''), nullif(p_especialidade,''), nullif(p_forma_pagamento,''));
  END IF;

  RETURN v_id;
END $fn$;

-- Números do Início. INVOKER de propósito: as somas passam pela RLS, então cada
-- um vê o próprio faturamento. Conta pela data do pagamento; "fechamentos" é a
-- quantidade de pacientes vinculados.
CREATE OR REPLACE FUNCTION public.closer_dashboard_metrics(p_mes date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public' AS $fn$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Bahia')::date;
  v_ini date; v_fim date;
  v_dia numeric; v_mes numeric; v_total numeric;
  v_fech_mes integer; v_fech_total integer;
  v_dias_corridos integer; v_dias_mes integer;
BEGIN
  v_ini := date_trunc('month', COALESCE(p_mes, v_hoje))::date;
  v_fim := (date_trunc('month', COALESCE(p_mes, v_hoje)) + interval '1 month - 1 day')::date;

  SELECT COALESCE(sum(valor),0) INTO v_dia FROM closer_pagamentos WHERE data_pagamento = v_hoje;
  SELECT COALESCE(sum(valor),0) INTO v_mes FROM closer_pagamentos WHERE data_pagamento BETWEEN v_ini AND v_fim;
  SELECT COALESCE(sum(valor),0) INTO v_total FROM closer_pagamentos;
  SELECT count(*) INTO v_fech_mes FROM closer_pacientes WHERE created_at::date BETWEEN v_ini AND v_fim;
  SELECT count(*) INTO v_fech_total FROM closer_pacientes;

  v_dias_mes := EXTRACT(day FROM v_fim)::int;
  v_dias_corridos := GREATEST(1, LEAST(v_dias_mes, (v_hoje - v_ini)::int + 1));

  RETURN jsonb_build_object(
    'faturamento_dia', v_dia,
    'faturamento_mes', v_mes,
    'faturamento_total', v_total,
    'previsao_mes', round((v_mes / v_dias_corridos) * v_dias_mes, 2),
    'fechamentos_mes', v_fech_mes,
    'fechamentos_total', v_fech_total,
    'referencia', jsonb_build_object('hoje', v_hoje, 'inicio', v_ini, 'fim', v_fim)
  );
END $fn$;

REVOKE ALL ON FUNCTION public.closer_clinicas_do_tenant()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.closer_especialidades_do_tenant()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.closer_dashboard_metrics(date)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.closer_vincular_paciente(uuid,text,text,text,numeric,uuid,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.closer_clinicas_do_tenant()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.closer_especialidades_do_tenant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.closer_dashboard_metrics(date)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.closer_vincular_paciente(uuid,text,text,text,numeric,uuid,date,text,text,text) TO authenticated;

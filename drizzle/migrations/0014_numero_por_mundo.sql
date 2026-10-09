-- Acesso a número de WhatsApp pelo MUNDO do número (09/10/2026).
--
-- Até aqui, ver lead/mensagem carimbados com um número exigia uma permissão
-- gravada usuário por usuário (user_permission_overrides, scope
-- 'whatsapp_number'), concedida por 6 caminhos com regras diferentes. Número
-- novo, usuário novo, troca de número e pós-venda ficavam de fora, e as
-- conversas "sumiam". Agora:
--   * cada número guarda o seu mundo (whatsapp_numbers.mundo: crc, closer,
--     recepcao, posvenda) e, para closer/recepção, o dono (dono_user_id);
--   * can_access_whatsapp_number libera pelo mundo do papel do usuário — CRC,
--     SDR e pós-venda usam os números da central; closer e recepção, o próprio;
--   * a permissão por usuário vira EXCEÇÃO configurável (granted=true libera
--     um número a mais; granted=false tira) e nenhuma rotina a grava sozinha.
-- Também: telefone canônico na busca de lead do webhook, e fim dos gatilhos
-- que moviam leads para o número de outro mundo ou ignoravam remoção de acesso.

-- 1) Mundo e dono no próprio número --------------------------------------
ALTER TABLE public.whatsapp_numbers ADD COLUMN IF NOT EXISTS mundo text;
ALTER TABLE public.whatsapp_numbers ADD COLUMN IF NOT EXISTS dono_user_id uuid;

COMMENT ON COLUMN public.whatsapp_numbers.mundo IS
  'Grupo dono do número: crc (central: CRC, SDR, pós-venda, gerência), closer, recepcao ou posvenda. Decide quem vê leads e mensagens do número.';
COMMENT ON COLUMN public.whatsapp_numbers.dono_user_id IS
  'Para números de closer/recepção: a pessoa dona do número (só ela, gerência e superadmin enxergam). NULL = todo o grupo do mundo.';

-- Mundo pelo dono da integração (mesma régua de normaliza_mundo, 0011).
UPDATE public.whatsapp_numbers w
   SET mundo = public.normaliza_mundo(i.owner_role),
       dono_user_id = CASE
         WHEN public.normaliza_mundo(i.owner_role) IN ('closer','recepcao')
          AND coalesce(i.config->>'owner_user_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         THEN (i.config->>'owner_user_id')::uuid END
  FROM public.integrations i
 WHERE w.mundo IS NULL
   AND i.tenant_id = w.tenant_id
   AND i.key LIKE 'whatsapp\_%'
   AND i.config->>'phone_number_id' = w.phone_number_id;

-- Números cuja integração já foi apagada (trocados/banidos): os do closer da
-- Rizodent (mesmo telefone +557781294026) são do closer; os demais, da central.
UPDATE public.whatsapp_numbers
   SET mundo = 'closer', dono_user_id = '2231410b-af52-4fe9-8285-d8acd1d258c9'
 WHERE id IN ('09c4519a-a1a5-4166-b260-2f8a90726dc0', '5eef312f-a475-42f5-aa00-395d2c469c43')
   AND tenant_id = '00000000-0000-0000-0000-000000000010';
UPDATE public.whatsapp_numbers SET mundo = 'crc' WHERE mundo IS NULL;

-- Número inserido por qualquer caminho herda o mundo da integração.
CREATE OR REPLACE FUNCTION public.whatsapp_numbers_define_mundo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i record;
BEGIN
  IF NEW.mundo IS NULL OR (NEW.dono_user_id IS NULL AND NEW.mundo IN ('closer','recepcao')) THEN
    SELECT x.owner_role, x.config INTO i
      FROM public.integrations x
     WHERE x.tenant_id = NEW.tenant_id AND x.key LIKE 'whatsapp\_%'
       AND x.config->>'phone_number_id' = NEW.phone_number_id
     ORDER BY (x.owner_role IS NULL) LIMIT 1;
    IF FOUND THEN
      IF NEW.mundo IS NULL THEN NEW.mundo := public.normaliza_mundo(i.owner_role); END IF;
      IF NEW.dono_user_id IS NULL AND NEW.mundo IN ('closer','recepcao')
         AND coalesce(i.config->>'owner_user_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        NEW.dono_user_id := (i.config->>'owner_user_id')::uuid;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_whatsapp_numbers_define_mundo ON public.whatsapp_numbers;
CREATE TRIGGER trg_whatsapp_numbers_define_mundo BEFORE INSERT OR UPDATE ON public.whatsapp_numbers
FOR EACH ROW EXECUTE FUNCTION public.whatsapp_numbers_define_mundo();

-- 2) Regra única de acesso --------------------------------------------------
-- O usuário logado pertence ao mundo do número?
CREATE OR REPLACE FUNCTION public.usuario_do_mundo_do_numero(_mundo text, _dono uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN coalesce(_mundo, 'crc') IN ('closer', 'recepcao') THEN
      CASE WHEN _dono IS NOT NULL THEN _dono = auth.uid()
           ELSE EXISTS (SELECT 1 FROM public.user_roles ur
                         WHERE ur.user_id = auth.uid() AND ur.role::text = _mundo) END
    WHEN _mundo = 'posvenda' THEN
      EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'posvenda'::app_role)
    ELSE
      -- Central: CRC, SDR e pós-venda (o isolamento da pós-venda vem do funil).
      EXISTS (SELECT 1 FROM public.user_roles ur
               WHERE ur.user_id = auth.uid()
                 AND ur.role IN ('crc'::app_role, 'sdr'::app_role, 'crc_legacy'::app_role, 'posvenda'::app_role))
  END
$$;

CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.whatsapp_numbers w
       WHERE w.id = _number_id
         AND w.tenant_id = public.current_tenant_id()
         -- Exceção configurada na administração vence; sem ela, vale o mundo.
         AND COALESCE(public.user_override(auth.uid(), 'whatsapp_number', _number_id::text),
                      public.usuario_do_mundo_do_numero(w.mundo, w.dono_user_id))
    );
$$;

-- Dono restrito (closer/recepção) do número, agora pelo mundo gravado.
CREATE OR REPLACE FUNCTION public.dono_restrito_do_numero(_number_id uuid)
RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN w.mundo IN ('closer', 'recepcao') THEN w.mundo::app_role END
    FROM public.whatsapp_numbers w WHERE w.id = _number_id
$$;

-- Mundo de um número para a busca/mescla de leads: lê a coluna (a integração
-- pode já ter sido apagada).
CREATE OR REPLACE FUNCTION public.mundo_numero_whatsapp(p_tenant uuid, p_number_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_number_id IS NULL THEN
      public.normaliza_mundo((SELECT i.owner_role FROM public.integrations i
                               WHERE i.tenant_id = p_tenant AND i.key = 'whatsapp_config' LIMIT 1))
    ELSE coalesce((SELECT w.mundo FROM public.whatsapp_numbers w WHERE w.id = p_number_id), 'crc')
  END
$$;

-- 3) Telefone canônico em toda busca de lead ------------------------------
CREATE OR REPLACE FUNCTION public.telefone_canonico(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;
  v := regexp_replace(p_raw, '[^0-9]', '', 'g');
  IF v = '' THEN RETURN NULL; END IF;
  IF length(v) IN (11,12) AND left(v,1) = '0' THEN v := substr(v,2); END IF;
  IF length(v) IN (12,13) AND left(v,2) = '55' THEN v := substr(v,3);
  ELSIF length(v) NOT IN (10,11) THEN RETURN v; END IF;
  IF length(v) = 11 AND substr(v,3,1) = '9' THEN v := left(v,2) || substr(v,4); END IF;
  RETURN '55' || v;
END $$;

CREATE OR REPLACE FUNCTION public.lead_whatsapp_existente(p_tenant uuid, p_phone text, p_mundo text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT l.id FROM public.crm_leads l
   WHERE l.tenant_id = p_tenant AND l.phone = public.telefone_canonico(p_phone)
     AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) = public.normaliza_mundo(p_mundo)
   ORDER BY l.created_at ASC LIMIT 1
$$;

-- 4) Conectar/atualizar integração mantém o número em dia ----------------
-- Inclui a chave legada whatsapp_config (número principal), grava mundo e dono
-- e NÃO grava mais permissão por usuário (o acesso vem do mundo).
CREATE OR REPLACE FUNCTION public.integracao_whatsapp_sincroniza_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c jsonb := NEW.config;
  pnid text := nullif(trim(NEW.config->>'phone_number_id'), '');
  v_mundo text := public.normaliza_mundo(NEW.owner_role);
  v_dono uuid;
BEGIN
  IF NEW.key NOT LIKE 'whatsapp\_%' OR pnid IS NULL OR NEW.tenant_id IS NULL OR pnid !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  IF v_mundo IN ('closer','recepcao')
     AND coalesce(c->>'owner_user_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_dono := (c->>'owner_user_id')::uuid;
  END IF;
  INSERT INTO public.whatsapp_numbers(tenant_id, phone_number_id, display_name, waba_id, token, app_id, app_secret,
                                      verify_token, is_active, mundo, dono_user_id)
  VALUES (NEW.tenant_id, pnid, nullif(c->>'display_name',''), nullif(c->>'waba_id',''),
          nullif(coalesce(c->>'access_token', c->>'token'),''), nullif(c->>'app_id',''), nullif(c->>'app_secret',''),
          nullif(c->>'webhook_verify_token',''), coalesce(NEW.status,'') <> 'disabled', v_mundo, v_dono)
  ON CONFLICT (phone_number_id) DO UPDATE SET
    display_name = coalesce(EXCLUDED.display_name, whatsapp_numbers.display_name),
    waba_id = coalesce(EXCLUDED.waba_id, whatsapp_numbers.waba_id),
    token = coalesce(EXCLUDED.token, whatsapp_numbers.token),
    app_id = coalesce(EXCLUDED.app_id, whatsapp_numbers.app_id),
    app_secret = coalesce(EXCLUDED.app_secret, whatsapp_numbers.app_secret),
    verify_token = coalesce(EXCLUDED.verify_token, whatsapp_numbers.verify_token),
    is_active = EXCLUDED.is_active,
    is_default = CASE WHEN EXCLUDED.is_active THEN whatsapp_numbers.is_default ELSE false END,
    mundo = EXCLUDED.mundo,
    dono_user_id = coalesce(EXCLUDED.dono_user_id, whatsapp_numbers.dono_user_id)
  WHERE whatsapp_numbers.tenant_id = NEW.tenant_id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.integracao_whatsapp_excluida_desativa_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pnid text;
BEGIN
  IF OLD.key NOT LIKE 'whatsapp\_%' THEN RETURN OLD; END IF;
  v_pnid := COALESCE(nullif(OLD.config->>'phone_number_id',''), substring(OLD.key from 10));
  -- Só desativa: mundo, dono e acessos ficam, para o histórico continuar visível.
  UPDATE public.whatsapp_numbers SET is_active = false, is_default = false
   WHERE phone_number_id = v_pnid AND tenant_id = OLD.tenant_id;
  RETURN OLD;
END $$;

-- 5) Carimbo de número para closer/recepção pela mesma regra --------------
CREATE OR REPLACE FUNCTION public.stamp_crm_lead_whatsapp_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_scoped_role boolean := false;
  v_number_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RETURN NEW; END IF;
  v_tenant_id := public.current_tenant_id();
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := v_tenant_id; END IF;

  -- Lead criado por retroatividade de pagamento pertence SEMPRE ao mundo legado.
  IF 'sintetico_pagamento' = ANY(COALESCE(NEW.tags, '{}'::text[])) THEN
    NEW.whatsapp_number_id := NULL;
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = v_user_id AND ur.role IN ('closer'::app_role, 'recepcao'::app_role))
    INTO v_scoped_role;

  IF NEW.whatsapp_number_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_numbers w
                    WHERE w.id = NEW.whatsapp_number_id AND w.tenant_id = NEW.tenant_id AND w.is_active = true) THEN
      RAISE EXCEPTION 'Este número de WhatsApp está desativado ou não é desta clínica.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access_whatsapp_number(NEW.whatsapp_number_id) THEN
      RAISE EXCEPTION 'Você não tem acesso a este número de WhatsApp.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF v_scoped_role THEN
    SELECT w.id INTO v_number_id
      FROM public.whatsapp_numbers w
     WHERE w.tenant_id = NEW.tenant_id AND w.is_active
       AND w.mundo IN ('closer', 'recepcao')
       AND public.can_access_whatsapp_number(w.id)
     ORDER BY w.is_default DESC, w.created_at DESC
     LIMIT 1;
    IF v_number_id IS NULL THEN
      RAISE EXCEPTION 'Nenhum número de WhatsApp conectado para você. Conecte o seu em Conexões.' USING ERRCODE = '42501';
    END IF;
    NEW.whatsapp_number_id := v_number_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.closer_paciente_carimba_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_num uuid; v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_tenant := public.current_tenant_id();
  SELECT w.id INTO v_num
    FROM public.whatsapp_numbers w
   WHERE w.tenant_id = v_tenant AND w.is_active
     AND w.mundo IN ('closer', 'recepcao')
     AND public.can_access_whatsapp_number(w.id)
   ORDER BY w.is_default DESC, w.created_at DESC
   LIMIT 1;
  IF v_num IS NULL THEN
    RAISE EXCEPTION 'Nenhum número de WhatsApp conectado para você. Conecte o seu em Conexões.' USING ERRCODE = '42501';
  END IF;
  NEW.whatsapp_number_id := v_num;
  NEW.tenant_id := v_tenant;
  NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  RETURN NEW;
END $$;

-- Trocar o número do lead ("Enviar por") só para número ativo e acessível.
CREATE OR REPLACE FUNCTION public.valida_troca_numero_do_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.whatsapp_number_id IS NULL
     OR NEW.whatsapp_number_id IS NOT DISTINCT FROM OLD.whatsapp_number_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_numbers w
                  WHERE w.id = NEW.whatsapp_number_id AND w.tenant_id = NEW.tenant_id AND w.is_active) THEN
    RAISE EXCEPTION 'Este número de WhatsApp está desativado e não pode ser usado para enviar.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_whatsapp_number(NEW.whatsapp_number_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a este número de WhatsApp.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_valida_troca_numero_do_lead ON public.crm_leads;
CREATE TRIGGER trg_valida_troca_numero_do_lead BEFORE UPDATE OF whatsapp_number_id ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.valida_troca_numero_do_lead();

-- 6) Fim das rotinas paralelas de permissão -------------------------------
-- (o acesso agora vem do mundo; essas gravavam/apagavam/escondiam por conta própria)
DROP TRIGGER IF EXISTS trg_concede_numero_aos_gerais ON public.whatsapp_numbers;
DROP TRIGGER IF EXISTS trg_concede_numeros_ao_novo_usuario ON public.user_roles;
DROP TRIGGER IF EXISTS trg_preserva_acesso_numero ON public.user_permission_overrides;
DROP TRIGGER IF EXISTS trg_realoca_leads_numero_desativado ON public.whatsapp_numbers;
DROP FUNCTION IF EXISTS public.preserva_acesso_numero_whatsapp();
DROP FUNCTION IF EXISTS public.realoca_leads_numero_desativado();

-- 7) Permissões de execução ------------------------------------------------
REVOKE ALL ON FUNCTION public.whatsapp_numbers_define_mundo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.valida_troca_numero_do_lead() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usuario_do_mundo_do_numero(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_do_mundo_do_numero(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.telefone_canonico(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telefone_canonico(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_whatsapp_existente(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_whatsapp_existente(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.mundo_numero_whatsapp(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mundo_numero_whatsapp(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mundo_do_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mundo_do_lead(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_whatsapp_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_whatsapp_number(uuid) TO authenticated, service_role;

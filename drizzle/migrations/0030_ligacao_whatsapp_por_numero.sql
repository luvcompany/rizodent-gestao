-- Ligação pelo WhatsApp: equipe do número + permissão por número (09/10/2026).
--
-- A) O CLOSER (e a recepção) NÃO ENXERGAVAM whatsapp_calls nem
--    whatsapp_call_permissions: duas policies RESTRICTIVE por papel
--    ("closer_sem_acesso_*", "recepcao_sem_acesso_*") barravam tudo. A tela
--    mostrava os botões e o servidor fazia a ligação, mas a resposta da Meta
--    (o SDP de áudio e o "atendeu") chega ao navegador pelo realtime dessa
--    tabela — para o closer não chegava nada: o celular do paciente tocava, a
--    chamada ficava em "chamando" no CRM e, se o paciente atendesse, ninguém
--    ouvia ninguém (2 tentativas reais em 10/10 01:58 UTC pelo número do
--    closer). O painel de permissões e o aviso "autorizou receber ligações"
--    também ficavam vazios para ele.
--    Agora vale a regra do resto do sistema: quem usa o número usa a ligação
--    dele (can_access_whatsapp_number, por equipe). Número sem cadastro =
--    número legado da central.
--
-- B) Permissão de ligação por NÚMERO.
--
-- A Meta guarda a permissão de ligar por número da empresa: o paciente que
-- autorizou o número oficial não autorizou o número do closer. O banco
-- guardava UMA linha por (cliente, telefone do paciente):
--   - o pedido feito pelo closer sobrescrevia a autorização dada ao oficial
--     (e vice-versa);
--   - a resposta do paciente (record_call_permission_reply) gravava o
--     phone_number_id da ÚLTIMA LIGAÇÃO do cliente, de qualquer número — a
--     autorização dada ao closer ficava registrada como se fosse do oficial.
-- Agora: uma linha por (número da empresa, telefone do paciente), e a resposta
-- usa o número em que a mensagem chegou.

-- B1) Unicidade por número (a por phone_number_id já existe).
DROP INDEX IF EXISTS public.whatsapp_call_permissions_tenant_consumer_uidx;

-- B2) A resposta do paciente vai para o número em que ela chegou.
CREATE OR REPLACE FUNCTION public.record_call_permission_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_json  jsonb;
  v_reply jsonb;
  v_resp  text;
  v_perm  boolean;
  v_exp   bigint;
  v_phone text;
  v_pnid  text;
BEGIN
  IF NEW.content IS NULL OR left(btrim(NEW.content), 1) <> '{' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_json := NEW.content::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;
  IF v_json->>'type' <> 'call_permission_reply' THEN
    RETURN NEW;
  END IF;

  v_reply := v_json->'call_permission_reply';
  v_resp  := v_reply->>'response';
  IF v_resp NOT IN ('accept', 'reject') THEN
    RETURN NEW;
  END IF;
  v_perm := COALESCE((v_reply->>'is_permanent')::boolean, false);
  v_exp  := NULLIF(v_reply->>'expiration_timestamp', '')::bigint;

  SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') INTO v_phone
  FROM public.crm_leads WHERE id = NEW.lead_id;
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN NEW;
  END IF;

  -- O número da empresa em que a resposta chegou (antes: o da última ligação
  -- do cliente, de qualquer número). Mensagem sem número = número legado.
  SELECT w.phone_number_id INTO v_pnid
    FROM public.whatsapp_numbers w
   WHERE w.id = NEW.whatsapp_number_id AND w.tenant_id = NEW.tenant_id;
  IF v_pnid IS NULL THEN
    SELECT i.config->>'phone_number_id' INTO v_pnid
      FROM public.integrations i
     WHERE i.tenant_id = NEW.tenant_id AND i.key = 'whatsapp_config';
  END IF;
  IF v_pnid IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.whatsapp_call_permissions
      (tenant_id, phone_number_id, whatsapp_number_id, consumer_phone, lead_id, status, approved_at, expires_at, raw_payload, updated_at)
    VALUES (
      NEW.tenant_id, v_pnid, NEW.whatsapp_number_id, v_phone, NEW.lead_id,
      CASE WHEN v_resp = 'accept' THEN 'approved' ELSE 'denied' END,
      CASE WHEN v_resp = 'accept' THEN now() ELSE NULL END,
      CASE WHEN v_resp = 'accept' AND NOT v_perm AND v_exp IS NOT NULL
           THEN to_timestamp(v_exp) ELSE NULL END,
      v_json, now()
    )
    ON CONFLICT (phone_number_id, consumer_phone) DO UPDATE SET
      status             = EXCLUDED.status,
      approved_at        = EXCLUDED.approved_at,
      expires_at         = EXCLUDED.expires_at,
      whatsapp_number_id = COALESCE(EXCLUDED.whatsapp_number_id, whatsapp_call_permissions.whatsapp_number_id),
      lead_id            = COALESCE(EXCLUDED.lead_id, whatsapp_call_permissions.lead_id),
      raw_payload        = EXCLUDED.raw_payload,
      updated_at         = now();
  EXCEPTION WHEN others THEN
    RAISE WARNING 'record_call_permission_reply: falha ao gravar permissao (%). Mensagem preservada.', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- B3) Reparo: linha cujo número (whatsapp_number_id) não bate com o
--     phone_number_id gravado — a resposta dada ao número do closer em
--     10/10 01:57 ficou com o phone_number_id do oficial. Só 1 linha hoje.
UPDATE public.whatsapp_call_permissions p
   SET phone_number_id = w.phone_number_id,
       updated_at      = now()
  FROM public.whatsapp_numbers w
 WHERE w.id = p.whatsapp_number_id
   AND w.tenant_id = p.tenant_id
   AND w.phone_number_id IS NOT NULL
   AND w.phone_number_id IS DISTINCT FROM p.phone_number_id
   AND NOT EXISTS (
     SELECT 1 FROM public.whatsapp_call_permissions q
      WHERE q.phone_number_id = w.phone_number_id AND q.consumer_phone = p.consumer_phone);

-- A1) Quem enxerga a ligação/permissão: quem usa o número dela.
CREATE OR REPLACE FUNCTION public.ligacao_numero_visivel(_tenant uuid, _number_id uuid, _pnid text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := _number_id;
BEGIN
  IF v_id IS NULL AND _pnid IS NOT NULL THEN
    SELECT w.id INTO v_id
      FROM public.whatsapp_numbers w
     WHERE w.tenant_id = _tenant AND w.phone_number_id = _pnid
     ORDER BY w.is_active DESC, w.created_at DESC
     LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN
    RETURN public.can_access_whatsapp_number(v_id);
  END IF;
  -- Sem número cadastrado = número legado da central (equipe crc). Nunca
  -- "visível para todos": can_access_whatsapp_number(NULL) devolve true.
  RETURN public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.usuario_do_mundo_do_numero('crc', NULL);
END
$function$;
REVOKE ALL ON FUNCTION public.ligacao_numero_visivel(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ligacao_numero_visivel(uuid, uuid, text) TO authenticated, service_role;

-- A2) Sai o bloqueio por papel; entra o escopo por número (todas as operações).
DROP POLICY IF EXISTS closer_sem_acesso_whatsapp_calls ON public.whatsapp_calls;
DROP POLICY IF EXISTS recepcao_sem_acesso_whatsapp_calls ON public.whatsapp_calls;
DROP POLICY IF EXISTS numero_escopo_whatsapp_calls ON public.whatsapp_calls;
CREATE POLICY numero_escopo_whatsapp_calls ON public.whatsapp_calls
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.ligacao_numero_visivel(tenant_id, whatsapp_number_id, phone_number_id))
  WITH CHECK (public.ligacao_numero_visivel(tenant_id, whatsapp_number_id, phone_number_id));

DROP POLICY IF EXISTS closer_sem_acesso_whatsapp_call_permissions ON public.whatsapp_call_permissions;
DROP POLICY IF EXISTS recepcao_sem_acesso_whatsapp_call_permissions ON public.whatsapp_call_permissions;
DROP POLICY IF EXISTS numero_escopo_whatsapp_call_permissions ON public.whatsapp_call_permissions;
CREATE POLICY numero_escopo_whatsapp_call_permissions ON public.whatsapp_call_permissions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.ligacao_numero_visivel(tenant_id, whatsapp_number_id, phone_number_id))
  WITH CHECK (public.ligacao_numero_visivel(tenant_id, whatsapp_number_id, phone_number_id));

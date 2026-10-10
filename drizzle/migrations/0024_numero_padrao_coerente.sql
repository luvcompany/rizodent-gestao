-- Número padrão de envio coerente (09/10/2026).
--
-- O número padrão (whatsapp_numbers.is_default) é por onde saem automações,
-- bots, follow-up e leads sem número (passo 5 de _shared/numeroDeSaida.ts e de
-- numero_de_saida_do_lead). Até aqui nada garantia que ele existisse nem que
-- fosse um só:
--   * a tela trocava o padrão com 2 UPDATEs soltos (zera todos, marca um): se
--     o 2º falhasse, o cliente ficava sem padrão; dois cliques juntos podiam
--     deixar dois;
--   * desativar ou trocar o número padrão deixava o cliente sem padrão até
--     alguém perceber;
--   * nada impedia marcar como padrão um número de closer/recepção — e o
--     padrão vale para os leads da CENTRAL (mundo crc).
-- Agora:
--   1. um padrão por cliente (índice único parcial);
--   2. número inativo nunca é padrão; padrão fora do mundo crc é recusado;
--   3. cliente que fica sem padrão ativo da central ganha o número ativo da
--      central mais recente (registrado em access_logs);
--   4. trocar o padrão é uma RPC só (definir_numero_padrao), numa transação.
--
-- Estado conferido em produção em 09/10/2026 (SELECT): 1 cliente (Rizodent),
-- 6 números, 3 ativos (2 da central), 1 padrão — ativo e do mundo crc
-- ("Whatsapp - Comercial", o oficial). O passo 0 não muda nada hoje e o índice
-- do passo 1 é criado sem conflito; o passo 0 fica para ambientes com dado torto.

-- 0) Arruma o que já existe -------------------------------------------------
UPDATE public.whatsapp_numbers
   SET is_default = false
 WHERE is_default
   AND (NOT is_active OR coalesce(mundo, 'crc') <> 'crc');

-- Mais de um padrão no mesmo cliente: fica o marcado por último.
UPDATE public.whatsapp_numbers w
   SET is_default = false
 WHERE w.is_default
   AND EXISTS (SELECT 1 FROM public.whatsapp_numbers o
                WHERE o.tenant_id = w.tenant_id
                  AND o.is_default
                  AND o.id <> w.id
                  AND (o.updated_at, o.id) > (w.updated_at, w.id));

-- 1) Um padrão por cliente -------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_numbers_um_padrao_por_tenant
  ON public.whatsapp_numbers (tenant_id)
  WHERE is_default;

-- 2) Padrão só de número ativo da central ---------------------------------
-- Roda depois de trg_whatsapp_numbers_define_mundo (ordem alfabética dos
-- gatilhos BEFORE), então NEW.mundo já está preenchido.
CREATE OR REPLACE FUNCTION public.whatsapp_numbers_padrao_coerente()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_default AND NOT NEW.is_active THEN
    NEW.is_default := false;
  END IF;
  IF NEW.is_default AND coalesce(NEW.mundo, 'crc') <> 'crc' THEN
    -- O número já era o padrão e mudou de mundo (a integração passou a ser de
    -- closer/recepção): deixa de ser padrão em silêncio — recusar aqui faria
    -- falhar o salvamento da integração. O gatilho AFTER promove outro.
    IF TG_OP = 'UPDATE' AND OLD.is_default THEN
      NEW.is_default := false;
    ELSE
      RAISE EXCEPTION 'O número padrão precisa ser da equipe central (CRC/SDR)' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_whatsapp_numbers_padrao_coerente ON public.whatsapp_numbers;
CREATE TRIGGER trg_whatsapp_numbers_padrao_coerente
  BEFORE INSERT OR UPDATE ON public.whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_numbers_padrao_coerente();

-- 3) Cliente nunca fica sem padrão (havendo número ativo da central) ------
-- Interna: chamada pelo gatilho abaixo e pela própria migration.
CREATE OR REPLACE FUNCTION public.promover_numero_padrao(p_tenant uuid, p_motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_novo record;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN NULL;
  END IF;
  -- Mesma fila de definir_numero_padrao, mas SEM esperar: quem segura a fila
  -- está trocando o padrão agora e vai deixar um. Esperar aqui (este gatilho
  -- roda com a linha do número já travada) podia virar deadlock com a RPC.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('whatsapp_numero_padrao:' || p_tenant::text, 0)) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_numbers w
              WHERE w.tenant_id = p_tenant
                AND w.is_default
                AND w.is_active
                AND coalesce(w.mundo, 'crc') = 'crc') THEN
    RETURN NULL;
  END IF;

  SELECT w.id, w.display_name, w.phone_e164
    INTO v_novo
    FROM public.whatsapp_numbers w
   WHERE w.tenant_id = p_tenant
     AND w.is_active
     AND coalesce(w.mundo, 'crc') = 'crc'
     AND coalesce(w.phone_number_id, '') <> ''
   ORDER BY w.created_at DESC, w.id DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;  -- nenhum número ativo da central: nada a promover
  END IF;

  BEGIN
    UPDATE public.whatsapp_numbers SET is_default = false
     WHERE tenant_id = p_tenant AND is_default AND id <> v_novo.id;
    UPDATE public.whatsapp_numbers SET is_default = true WHERE id = v_novo.id;
  EXCEPTION WHEN unique_violation THEN
    -- Outra transação acabou de definir o padrão deste cliente: vale o dela.
    RETURN NULL;
  END;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), p_tenant, 'tenant', 'whatsapp_numero_padrao_promovido',
          jsonb_build_object('numero_id', v_novo.id, 'nome', v_novo.display_name,
                             'telefone', v_novo.phone_e164, 'motivo', p_motivo));
  RETURN v_novo.id;
END $$;
COMMENT ON FUNCTION public.promover_numero_padrao(uuid, text) IS
  'Se o cliente está sem número padrão ativo da central (mundo crc), marca como padrão o número ativo da central mais recente e registra em access_logs. Interna (gatilho/migration).';

-- Dispara quando um número entra, é ativado/desativado ou muda de mundo. A RPC
-- de troca só mexe em is_default e não dispara este gatilho (ela zera os
-- outros e marca o escolhido em dois UPDATEs — o índice único não deixa fazer
-- isso num UPDATE só).
CREATE OR REPLACE FUNCTION public.whatsapp_numbers_garante_padrao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.promover_numero_padrao(
    NEW.tenant_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'numero_novo'
         WHEN NOT NEW.is_active THEN 'numero_desativado'
         ELSE 'numero_alterado' END);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_whatsapp_numbers_garante_padrao ON public.whatsapp_numbers;
CREATE TRIGGER trg_whatsapp_numbers_garante_padrao
  AFTER INSERT OR UPDATE OF is_active, mundo ON public.whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_numbers_garante_padrao();

-- 4) Trocar o padrão: uma chamada, uma transação ---------------------------
CREATE OR REPLACE FUNCTION public.definir_numero_padrao(p_numero uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_super  boolean;
  v_tenant uuid;
  v_num    record;
  v_antes  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida. Entre de novo.' USING ERRCODE = '42501';
  END IF;
  v_super := public.has_role(v_uid, 'superadmin'::app_role);
  IF NOT v_super
     AND NOT public.has_role(v_uid, 'gerente'::app_role)
     AND NOT public.has_role(v_uid, 'crc'::app_role) THEN
    RAISE EXCEPTION 'Seu perfil não pode trocar o número padrão de envio.' USING ERRCODE = '42501';
  END IF;

  SELECT w.tenant_id INTO v_tenant FROM public.whatsapp_numbers w WHERE w.id = p_numero;
  IF NOT FOUND OR (NOT v_super AND v_tenant IS DISTINCT FROM public.current_tenant_id()) THEN
    RAISE EXCEPTION 'Número de WhatsApp não encontrado.' USING ERRCODE = '42501';
  END IF;

  -- Uma troca de padrão por cliente por vez; depois relê o número travado (pode
  -- ter sido desativado enquanto esperava a fila).
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp_numero_padrao:' || v_tenant::text, 0));
  SELECT w.id, w.tenant_id, w.is_active, coalesce(w.mundo, 'crc') AS mundo, w.display_name
    INTO v_num
    FROM public.whatsapp_numbers w
   WHERE w.id = p_numero
     FOR UPDATE;
  IF NOT FOUND OR v_num.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Número de WhatsApp não encontrado.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_num.is_active THEN
    RAISE EXCEPTION 'Este número de WhatsApp está desativado e não pode ser o padrão de envio.' USING ERRCODE = '42501';
  END IF;
  IF v_num.mundo <> 'crc' THEN
    RAISE EXCEPTION 'O número padrão precisa ser da equipe central (CRC/SDR)' USING ERRCODE = '42501';
  END IF;

  SELECT w.id INTO v_antes
    FROM public.whatsapp_numbers w
   WHERE w.tenant_id = v_num.tenant_id AND w.is_default
   LIMIT 1;
  IF v_antes = v_num.id THEN
    RETURN v_num.id;  -- já é o padrão
  END IF;

  -- Primeiro zera, depois marca: o índice único não aceita dois padrões nem por
  -- um instante dentro do mesmo UPDATE.
  UPDATE public.whatsapp_numbers SET is_default = false
   WHERE tenant_id = v_num.tenant_id AND is_default AND id <> v_num.id;
  UPDATE public.whatsapp_numbers SET is_default = true WHERE id = v_num.id;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (v_uid, v_num.tenant_id, 'tenant', 'whatsapp_numero_padrao',
          jsonb_build_object('de', v_antes, 'para', v_num.id, 'nome', v_num.display_name));
  RETURN v_num.id;
END $$;
COMMENT ON FUNCTION public.definir_numero_padrao(uuid) IS
  'Troca o número padrão de envio do cliente (superadmin, gerente ou CRC): zera os outros e marca o escolhido na mesma transação. Só número ativo da central (mundo crc).';

-- 5) Cliente que hoje está sem padrão ganha um (no-op na Rizodent) --------
SELECT public.promover_numero_padrao(t.tenant_id, 'migracao_0024')
  FROM (SELECT DISTINCT tenant_id FROM public.whatsapp_numbers) t;

-- 6) Permissões de execução ------------------------------------------------
REVOKE ALL ON FUNCTION public.whatsapp_numbers_padrao_coerente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_numbers_garante_padrao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promover_numero_padrao(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promover_numero_padrao(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.definir_numero_padrao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_numero_padrao(uuid) TO authenticated, service_role;

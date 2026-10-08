-- Qual número de WhatsApp um disparo em massa vai usar.
-- A tela de Transmissão precisa disso ANTES de escolher o modelo: um modelo
-- aprovado na conta de outro número é recusado pela Meta em todas as mensagens
-- (send-whatsapp-message casa o modelo com a WABA do número que envia).
-- A ordem abaixo é a MESMA do servidor:
--   1) número do canal do funil escolhido (broadcast-engine exige leads do mesmo mundo);
--   2) número padrão de envio (whatsapp_numbers.is_default) — é o que vale para
--      os leads sem carimbo, inclusive no Funil Principal (canal legado);
--   3) whatsapp_config legado (número principal);
--   4) primeiro número ativo.
-- Nunca devolve token nem segredo: nome, telefone, WABA e estado de saúde.
CREATE OR REPLACE FUNCTION public.numero_de_envio_do_disparo(p_pipeline_id uuid)
 RETURNS TABLE(numero_id uuid, nome text, phone_e164 text, phone_number_id text, waba_id text, origem text, saude text, motivo text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_key text;
  v_pni text;
  r record;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  -- (1) Funil escolhido aponta para um número específico?
  IF p_pipeline_id IS NOT NULL THEN
    SELECT fc.channel_config->>'integration_key'
      INTO v_key
    FROM public.funnel_channels fc
    WHERE fc.tenant_id = v_tenant
      AND fc.pipeline_id = p_pipeline_id
      AND fc.channel_type = 'whatsapp'
    ORDER BY fc.id
    LIMIT 1;

    IF v_key IS NOT NULL AND left(v_key, 9) = 'whatsapp_' AND v_key <> 'whatsapp_config' THEN
      v_pni := substring(v_key from 10);

      SELECT n.id AS id,
             n.display_name AS display_name,
             n.phone_e164 AS phone_e164,
             n.phone_number_id AS phone_number_id,
             COALESCE(NULLIF(i.config->>'waba_id', ''), n.waba_id) AS waba_id,
             'funil' AS origem,
             i.health_status AS health_status,
             i.health_reason AS health_reason
        INTO r
      FROM public.whatsapp_numbers n
      LEFT JOIN public.integrations i
        ON i.tenant_id = n.tenant_id AND i.key = 'whatsapp_' || n.phone_number_id
      WHERE n.tenant_id = v_tenant
        AND n.phone_number_id = v_pni
        AND n.is_active
      ORDER BY n.created_at
      LIMIT 1;

      IF r.id IS NOT NULL THEN
        RETURN QUERY
          SELECT r.id, r.display_name, r.phone_e164, r.phone_number_id,
                 r.waba_id, r.origem, r.health_status, r.health_reason;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- (2) Número padrão de envio (marcado em Integrações).
  SELECT n.id AS id,
         n.display_name AS display_name,
         n.phone_e164 AS phone_e164,
         n.phone_number_id AS phone_number_id,
         COALESCE(NULLIF(i.config->>'waba_id', ''), n.waba_id) AS waba_id,
         'padrao' AS origem,
         i.health_status AS health_status,
         i.health_reason AS health_reason
    INTO r
  FROM public.whatsapp_numbers n
  LEFT JOIN public.integrations i
    ON i.tenant_id = n.tenant_id AND i.key = 'whatsapp_' || n.phone_number_id
  WHERE n.tenant_id = v_tenant
    AND n.is_active
    AND n.is_default
  ORDER BY n.created_at
  LIMIT 1;

  IF r.id IS NOT NULL THEN
    RETURN QUERY
      SELECT r.id, r.display_name, r.phone_e164, r.phone_number_id,
             r.waba_id, r.origem, r.health_status, r.health_reason;
    RETURN;
  END IF;

  -- (3) Número principal legado (whatsapp_config), quando o cliente não tem
  -- número marcado na tabela.
  SELECT NULL::uuid AS id,
         COALESCE(NULLIF(i.config->>'display_name', ''), 'Número principal') AS display_name,
         NULLIF(i.config->>'phone_e164', '') AS phone_e164,
         NULLIF(i.config->>'phone_number_id', '') AS phone_number_id,
         NULLIF(i.config->>'waba_id', '') AS waba_id,
         'principal' AS origem,
         i.health_status AS health_status,
         i.health_reason AS health_reason
    INTO r
  FROM public.integrations i
  WHERE i.tenant_id = v_tenant
    AND i.key = 'whatsapp_config'
    AND i.status IS DISTINCT FROM 'disabled'
  LIMIT 1;

  IF r.phone_number_id IS NOT NULL THEN
    RETURN QUERY
      SELECT r.id, r.display_name, r.phone_e164, r.phone_number_id,
             r.waba_id, r.origem, r.health_status, r.health_reason;
    RETURN;
  END IF;

  -- (4) Primeiro número ativo do cliente.
  SELECT n.id AS id,
         n.display_name AS display_name,
         n.phone_e164 AS phone_e164,
         n.phone_number_id AS phone_number_id,
         COALESCE(NULLIF(i.config->>'waba_id', ''), n.waba_id) AS waba_id,
         'padrao' AS origem,
         i.health_status AS health_status,
         i.health_reason AS health_reason
    INTO r
  FROM public.whatsapp_numbers n
  LEFT JOIN public.integrations i
    ON i.tenant_id = n.tenant_id AND i.key = 'whatsapp_' || n.phone_number_id
  WHERE n.tenant_id = v_tenant
    AND n.is_active
  ORDER BY n.is_default DESC NULLS LAST, n.created_at
  LIMIT 1;

  IF r.id IS NOT NULL THEN
    RETURN QUERY
      SELECT r.id, r.display_name, r.phone_e164, r.phone_number_id,
             r.waba_id, r.origem, r.health_status, r.health_reason;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.numero_de_envio_do_disparo(uuid) IS
  'Número por onde um disparo em massa vai sair no funil escolhido (mesma ordem do send-whatsapp-message). Sem credenciais.';

REVOKE EXECUTE ON FUNCTION public.numero_de_envio_do_disparo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.numero_de_envio_do_disparo(uuid) TO authenticated, service_role;
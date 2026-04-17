-- Backfill: cria leads retroativos para pacientes com pagamentos no mês corrente
-- que ainda não estão vinculados a nenhum lead via crm_lead_pacientes.
-- Stage: 'Contratado' do Funil Principal. Dados (cidade/origem) vêm do paciente.

DO $$
DECLARE
  v_pipeline_id uuid := 'a1b2c3d4-0001-4000-8000-000000000001'; -- Funil Principal
  v_stage_id    uuid := '15ee8d94-02c0-430b-89f4-96043a40c74e'; -- Contratado
  r RECORD;
  v_lead_id uuid;
  v_phone_norm text;
  v_total_pago numeric;
  v_first_pay timestamptz;
BEGIN
  FOR r IN
    SELECT
      p.id           AS paciente_id,
      p.nome         AS nome,
      p.telefone     AS telefone,
      p.cidade       AS cidade,
      p.origem       AS origem,
      p.nome_anuncio AS nome_anuncio
    FROM pacientes p
    WHERE EXISTS (
      SELECT 1 FROM pagamentos pg
      WHERE pg.paciente_id = p.id
        AND date_trunc('month', pg.data_pagamento) = date_trunc('month', CURRENT_DATE)
    )
    AND NOT EXISTS (
      SELECT 1 FROM crm_lead_pacientes clp WHERE clp.paciente_id = p.id
    )
  LOOP
    -- Normaliza telefone (mesma lógica do front: 55 + DDD + 8 dígitos)
    v_phone_norm := regexp_replace(COALESCE(r.telefone, ''), '\D', '', 'g');
    IF length(v_phone_norm) >= 12 AND left(v_phone_norm, 2) = '55' THEN
      v_phone_norm := substring(v_phone_norm from 3);
    END IF;
    IF length(v_phone_norm) = 11 AND substring(v_phone_norm from 3 for 1) = '9' THEN
      v_phone_norm := substring(v_phone_norm from 1 for 2) || substring(v_phone_norm from 4);
    END IF;
    IF v_phone_norm <> '' THEN
      v_phone_norm := '55' || v_phone_norm;
    ELSE
      v_phone_norm := NULL;
    END IF;

    -- Total pago (compõe value do lead)
    SELECT COALESCE(SUM(valor), 0), MIN(data_pagamento)
      INTO v_total_pago, v_first_pay
      FROM pagamentos WHERE paciente_id = r.paciente_id;

    -- Se já existe um lead com mesmo telefone normalizado, apenas vincula o paciente como primário
    SELECT id INTO v_lead_id
      FROM crm_leads
     WHERE phone = v_phone_norm
     LIMIT 1;

    IF v_lead_id IS NULL THEN
      -- Cria novo lead
      INSERT INTO crm_leads (
        name, phone, pipeline_id, stage_id,
        cidade, source, nome_anuncio,
        value, paciente_id,
        automation_paused, created_at, updated_at
      ) VALUES (
        r.nome, v_phone_norm, v_pipeline_id, v_stage_id,
        r.cidade, COALESCE(r.origem, 'Retroativo'), r.nome_anuncio,
        v_total_pago, r.paciente_id,
        true, COALESCE(v_first_pay, now()), now()
      ) RETURNING id INTO v_lead_id;
    END IF;

    -- Vincula paciente ao lead (primário se ainda não há nenhum primário)
    INSERT INTO crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (
      v_lead_id, r.paciente_id,
      NOT EXISTS (SELECT 1 FROM crm_lead_pacientes WHERE lead_id = v_lead_id AND is_primary = true)
    )
    ON CONFLICT (lead_id, paciente_id) DO NOTHING;
  END LOOP;
END $$;

-- Recalcula value de TODOS os leads que têm pacientes vinculados
-- para garantir que o somatório do orçamento/pago reflita todas as pessoas vinculadas
UPDATE crm_leads cl
   SET value = sub.total
  FROM (
    SELECT clp.lead_id, COALESCE(SUM(pg.valor), 0) AS total
      FROM crm_lead_pacientes clp
      LEFT JOIN pagamentos pg ON pg.paciente_id = clp.paciente_id
     GROUP BY clp.lead_id
  ) sub
 WHERE cl.id = sub.lead_id
   AND COALESCE(cl.value, 0) <> sub.total;
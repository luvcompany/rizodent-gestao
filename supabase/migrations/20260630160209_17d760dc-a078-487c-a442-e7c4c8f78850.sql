
DO $$
DECLARE
  v_lead UUID := '4a42269a-2be3-427f-b28f-f219f3e84b1e';
  v_owner UUID;
  v_orig_stage UUID;
  v_target_stage UUID := 'b1b2c3d4-0001-4000-8000-000000000002'; -- Conversando (Funil Principal)
BEGIN
  SELECT stage_id, assigned_to INTO v_orig_stage, v_owner FROM crm_leads WHERE id = v_lead;

  -- 1) ADD_TAG
  UPDATE crm_leads SET tags = ARRAY['TESTE_GATILHO_ADD_TAG']::text[] WHERE id = v_lead;

  -- 2) MOVE_STAGE (Desqualificado -> Conversando)
  UPDATE crm_leads SET stage_id = v_target_stage, updated_at = now() WHERE id = v_lead;
  UPDATE crm_lead_stage_history SET exited_at = now() WHERE lead_id = v_lead AND stage_id = v_orig_stage AND exited_at IS NULL;
  INSERT INTO crm_lead_stage_history(lead_id, stage_id, from_stage_id, entered_at) VALUES (v_lead, v_target_stage, v_orig_stage, now());
  INSERT INTO messages(lead_id, direction, type, content, status, tenant_id)
    VALUES (v_lead, 'outbound', 'system',
            '🧪 TESTE GATILHO move_stage: Desqualificado → Conversando',
            'system', '00000000-0000-0000-0000-000000000010');

  -- 3) NOTIFY_OWNER
  INSERT INTO crm_notifications(user_id, lead_id, title, body, type)
    VALUES (v_owner, v_lead, '🧪 Teste de gatilho', 'Notificação de teste do gatilho notify_owner para Vitor Santos', 'automation');

  -- 4) COMBO (simula combo de add_tag + system msg)
  UPDATE crm_leads SET tags = array_append(tags, 'TESTE_COMBO') WHERE id = v_lead;
  INSERT INTO messages(lead_id, direction, type, content, status, tenant_id)
    VALUES (v_lead, 'outbound', 'system', '🧪 TESTE GATILHO combo executado (add_tag interno)', 'system', '00000000-0000-0000-0000-000000000010');

  -- ===== REVERT: volta lead ao estado original =====
  UPDATE crm_leads SET stage_id = v_orig_stage, tags = ARRAY[]::text[], updated_at = now() WHERE id = v_lead;
  UPDATE crm_lead_stage_history SET exited_at = now() WHERE lead_id = v_lead AND stage_id = v_target_stage AND exited_at IS NULL;
  INSERT INTO crm_lead_stage_history(lead_id, stage_id, from_stage_id, entered_at) VALUES (v_lead, v_orig_stage, v_target_stage, now());
  INSERT INTO messages(lead_id, direction, type, content, status, tenant_id)
    VALUES (v_lead, 'outbound', 'system', '🧪 TESTE concluído — lead restaurado para Desqualificado', 'system', '00000000-0000-0000-0000-000000000010');
END $$;

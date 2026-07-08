-- ============================================================================
-- Correção: ensure_lead_for_pagamento com pipeline/stage CHUMBADOS
-- ----------------------------------------------------------------------------
-- Problema (definição anterior, migração 20260417211725):
--   * pipeline_id fixo 'a1b2c3d4-0001-4000-8000-000000000001' e stage_id fixo
--     '15ee8d94-02c0-430b-89f4-96043a40c74e' — ou seja, o "Funil Principal" /
--     stage "Contratado" do tenant Rizodent (00000000-0000-0000-0000-000000000010),
--     independentemente do tenant do pagamento. Em ambiente multi-tenant isso
--     poluiria o funil do Rizodent com leads de outros tenants (ou estouraria
--     em enforce_lead_tenant_consistency).
--   * tenant_id do lead não era informado (ficava por conta de triggers com
--     default para o Rizodent).
--   * O lead sintético não era identificável: nascia direto em "Contratado"
--     e se misturava aos leads reais nas métricas de funil/conversão.
--
-- O que esta migração faz (SOMENTE redefine a função — nenhum dado é alterado):
--   1. Resolve o tenant do pagamento dinamicamente: pacientes.tenant_id e,
--      em fallback, clinicas.tenant_id (a tabela pagamentos não tem tenant_id).
--   2. Resolve o stage dinamicamente: stage cujo nome (btrim) case com
--      'contratad%' em pipeline do tenant que não seja Instagram nem Pós-venda,
--      priorizando pipeline padrão (is_default DESC), stage ganho (is_won DESC),
--      pipeline mais antigo e menor posição. O padrão 'contratad%' casa
--      "Contratado"/"Contratado " e NÃO casa "Não contratado" nem um eventual
--      "Contrato enviado". Fallback: qualquer stage is_won do tenant.
--      Validado em produção (2026-07-08):
--        * tenant 00000000-...-000000000010 → 15ee8d94-02c0-430b-89f4-96043a40c74e
--          ("Contratado" do "Funil Principal") — exatamente o valor antes
--          chumbado, ou seja, comportamento preservado para o tenant atual;
--        * tenant beb96466-3c9c-4385-b8b6-03c9b9b90e2e → 2641f62c-8a54-4266-aec6-d85106ab039c
--          ("Contratado" do "Funil Principal" desse tenant, que tem is_default = false —
--          por isso o is_default sozinho não basta e existe a cadeia de fallbacks).
--   3. Marca o lead sintético de forma identificável:
--        * tag 'sintetico_pagamento' em crm_leads.tags (permite excluir/segmentar
--          nos relatórios de funil sem perder o vínculo lead↔paciente);
--        * notes em PT-BR explicando a origem (visível na UI);
--        * source continua COALESCE(pacientes.origem, 'Retroativo') — NÃO foi
--          trocado por um marcador técnico porque classifyOrigemCanonica
--          (src/lib/reportKit.ts) classifica a origem a partir de source, e
--          sobrescrevê-lo jogaria todos esses leads em "Outros".
--   4. tenant_id explícito no INSERT, coerente com o stage/pipeline escolhidos
--      (enforce_lead_tenant_consistency valida essa consistência no BEFORE INSERT).
--   5. Null-safety: crm_leads NÃO possui coluna created_by (verificado em
--      produção), então não há o que preencher; pagamentos.created_by (nullable)
--      segue sem uso. Todos os caminhos com dado faltante (tenant indeterminado,
--      nenhum stage compatível, falha no INSERT) geram RAISE WARNING com contexto
--      — nada de erro silencioso — e NUNCA bloqueiam o INSERT do pagamento.
--   6. Comportamento útil preservado: garante vínculo lead↔paciente
--      (crm_lead_pacientes) para pagamentos de pacientes ainda sem lead;
--      ON CONFLICT (lead_id, paciente_id) DO NOTHING casa com a UNIQUE existente.
--      Obs.: o trigger auto_link_lead_to_paciente (AFTER INSERT em crm_leads)
--      não duplica o vínculo porque só age quando NEW.paciente_id IS NULL.
--
-- O trigger trg_ensure_lead_for_pagamento (AFTER INSERT ON pagamentos) já
-- existe e continua apontando para esta função; não precisa ser recriado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_lead_for_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_link boolean;
  v_pac record;
  v_tenant_id uuid;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_new_lead_id uuid;
BEGIN
  -- Paciente já tem lead vinculado? Nada a fazer.
  SELECT EXISTS (
    SELECT 1 FROM crm_lead_pacientes WHERE paciente_id = NEW.paciente_id
  ) INTO v_has_link;

  IF v_has_link THEN
    RETURN NEW;
  END IF;

  SELECT id, nome, telefone, cidade, origem, tenant_id
    INTO v_pac
    FROM pacientes
   WHERE id = NEW.paciente_id;

  IF v_pac.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Tenant do pagamento: paciente e, em fallback, clínica
  -- (a tabela pagamentos não tem tenant_id próprio).
  v_tenant_id := v_pac.tenant_id;
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM clinicas WHERE id = NEW.clinica_id;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE WARNING 'ensure_lead_for_pagamento: tenant indeterminado (paciente %, clinica %, pagamento %); lead sintético não criado',
      NEW.paciente_id, NEW.clinica_id, NEW.id;
    RETURN NEW;
  END IF;

  -- Stage "Contratado" resolvido dinamicamente no tenant do pagamento:
  -- pipelines que não sejam Instagram nem Pós-venda, nome casando 'contratad%'
  -- ('Contratado'/'Contratado ' casam; 'Não contratado' não casa), priorizando
  -- pipeline padrão, stage marcado como ganho, pipeline mais antigo e posição.
  SELECT s.id, s.pipeline_id
    INTO v_stage_id, v_pipeline_id
    FROM crm_stages s
    JOIN crm_pipelines p ON p.id = s.pipeline_id
   WHERE p.tenant_id = v_tenant_id
     AND NOT p.is_instagram
     AND NOT p.is_posvenda
     AND btrim(s.name) ILIKE 'contratad%'
   ORDER BY p.is_default DESC, s.is_won DESC, p.created_at ASC, s.position ASC
   LIMIT 1;

  -- Fallback: qualquer stage marcado como ganho (is_won) do tenant.
  IF v_stage_id IS NULL THEN
    SELECT s.id, s.pipeline_id
      INTO v_stage_id, v_pipeline_id
      FROM crm_stages s
      JOIN crm_pipelines p ON p.id = s.pipeline_id
     WHERE p.tenant_id = v_tenant_id
       AND NOT p.is_instagram
       AND NOT p.is_posvenda
       AND s.is_won
     ORDER BY p.is_default DESC, p.created_at ASC, s.position ASC
     LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    RAISE WARNING 'ensure_lead_for_pagamento: tenant % não tem stage compatível com contratado/ganho; lead sintético não criado (paciente %, pagamento %)',
      v_tenant_id, NEW.paciente_id, NEW.id;
    RETURN NEW;
  END IF;

  -- Cria o lead sintético identificável e o vínculo lead↔paciente.
  -- Falha aqui não pode derrubar o INSERT do pagamento: loga WARNING e segue.
  BEGIN
    INSERT INTO crm_leads (
      name, phone, pipeline_id, stage_id, tenant_id, paciente_id,
      cidade, source, value, tags, notes
    )
    VALUES (
      v_pac.nome,
      v_pac.telefone,
      v_pipeline_id,
      v_stage_id,
      v_tenant_id,
      v_pac.id,
      v_pac.cidade,
      COALESCE(v_pac.origem, 'Retroativo'),
      0,
      ARRAY['sintetico_pagamento'],
      'Lead criado automaticamente a partir de um pagamento de paciente sem lead vinculado (não percorreu o funil).'
    )
    RETURNING id INTO v_new_lead_id;

    INSERT INTO crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (v_new_lead_id, v_pac.id, true)
    ON CONFLICT (lead_id, paciente_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ensure_lead_for_pagamento: falha ao criar lead sintético (paciente %, pagamento %, tenant %): %',
      NEW.paciente_id, NEW.id, v_tenant_id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.ensure_lead_for_pagamento() IS
'Garante lead vinculado ao paciente quando entra um pagamento sem lead prévio. '
'Resolve tenant (paciente→clínica) e stage "Contratado" dinamicamente por tenant '
'(sem UUIDs chumbados) e marca o lead sintético com a tag sintetico_pagamento '
'para que relatórios de funil possam segregá-lo. Nunca bloqueia o pagamento: '
'casos não resolvíveis geram RAISE WARNING.';

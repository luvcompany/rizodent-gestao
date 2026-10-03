DO $$
DECLARE
  r RECORD;
  manter text[] := ARRAY[
    -- chamadas pelas telas (frontend)
    'admin_all_tenants_usage','admin_platform_metrics','admin_tenant_users','admin_tenant_metrics','admin_api_unread_leads_base',
    'agenda_quantas_unidades','api4com_dial_enabled','check_duplicate_phone',
    'closer_clinicas_do_tenant','closer_dashboard_metrics','closer_especialidades_do_tenant','closer_vincular_paciente',
    'conversa_estou_aqui','conversa_fechar','conversa_reabrir',
    'crm_stages_empurrar_posicao','crm_template_usage_counts','crm_usage_metrics','crm_unread_leads_count',
    'desfecho_cruzar_para_funil_padrao',
    'equipe_bloquear','equipe_definir_horario','equipe_editar_nome','equipe_excluir_previa','equipe_horarios','equipe_listar','equipe_rodizio','equipe_redistribuir_leads','equipe_sdr_exclusiva','equipe_alvo_sdr',
    'generate_tenant_invoices',
    'get_conversation_leads','get_crm_unread_leads_count','get_crm_unread_leads_count_by_channel','get_lead_for_conversation','get_lead_stage_history_names','get_leads_for_calendar','get_tenant_by_slug','get_user_primary_role','get_my_tenant_config','get_public_branding',
    'instagram_janela_do_lead','integracoes_visiveis','is_gestor_equipe',
    'kanban_contadores',
    'meta_capi_config_ler','meta_capi_config_salvar','meta_capi_eventos_status','meta_capi_reenviar',
    'modelos_do_lead','numero_de_envio_do_lead',
    'pesquisa_config_ler','pesquisa_config_salvar','pesquisa_envio_falhou','pesquisa_oferecer',
    'pipelines_definir_ordem',
    'ponto_adiar_encerramento','ponto_encerrar','ponto_fim_expediente','ponto_meu_estado','ponto_minha_pausa','ponto_motivo_criar','ponto_motivos_ativos','ponto_motivos_listar','ponto_pausar','ponto_abrir','ponto_retomar','ponto_relatorio','ponto_resumo','ponto_sessoes','ponto_pausas','ponto_pausar_registrar','ponto_rotulo_motivo','ponto_motivo_editar','ponto_motivo_excluir','ponto_motivo_ativar','ponto_motivos_reordenar','ponto_motivo_icone_valido',
    'posvenda_padrao_do_tenant','posvenda_dashboard_metrics',
    'relatorio_agendamentos','relatorio_agendamentos_detalhe','relatorio_funis','relatorio_sdr','relatorio_sdr_blocos','relatorio_sdr_calc','relatorio_sdr_diario','relatorio_sdr_ligacoes','relatorio_sdr_minha','relatorio_sdr_reagendamentos',
    'restore_deleted_lead',
    'rodizio_definir_carencia_abertura','rodizio_definir_carencia_entrega','rodizio_definir_funis','rodizio_definir_modo','rodizio_definir_tempo_realocacao','rodizio_definir_tolerancia_corte','rodizio_distribuir_sem_resposta_agora','rodizio_estado',
    'sdr_corrigir_desfecho','sdr_destinos_transferencia','sdr_excluir_agendamento','sdr_marcar_comparecimento','sdr_entregas_pendentes','sdr_agenda_entrega_ao_gestor','sdr_entrega_lead_ao_gestor','sdr_comparecimento_entrega','sdr_etapa_oculta_entrega','sdr_pos_entrega_etapa',
    'set_tenant_business_hours','transfer_lead_to_whatsapp','update_whatsapp_template_sharing',
    'cidades_do_tenant','servicos_do_tenant','buscar_leads_por_mensagem','match_good_examples',
    'rpt_contratados','rpt_criativos_para_selecao','rpt_crm_message_activity','rpt_crm_message_period_count','rpt_crm_response_times','rpt_faturamento','rpt_faturamento_anuncio','rpt_faturamento_criativo','rpt_faturamento_origem','rpt_kpis_agendamentos','rpt_leads_inativos','rpt_origem_conversao','rpt_resolve_tenant','rpt_ticket_medio',
    'contratado_agendar','contratado_mover_agora','contratado_promove_consulta','crm_lead_revert_or_delete','crm_cleanup_contratado_sem_pagamento',
    'lead_transferir_autorizado','pacientes_whatsapp_direto','hard_delete_tenant','backup_list_tables','tenant_set_user_role','user_can',
    -- usadas nas regras de acesso (RLS) das tabelas
    'can_access_instagram_account','can_access_pipeline','can_access_whatsapp_number','closer_pode_ver_lead','current_tenant_id',
    'etapa_em_funil_meu','etapa_tem_lead','funil_do_papel_do_usuario','funil_do_papel_do_usuario_por_etapa','funil_e_instagram','funil_meu','funil_tem_lead',
    'has_role','is_posvenda_lead','is_posvenda_pipeline','recepcao_pode_ver_lead','sdr_pode_ver_lead','user_has_any_role','user_override','dono_restrito_do_numero',
    -- usadas nas regras de acesso do armazenamento (arquivos)
    'chat_media_belongs_to_current_tenant','call_recording_belongs_to_current_tenant','chat_media_object_owned_by'
  ];
BEGIN
  -- 1) Revoga de authenticated TODAS as funções não-extensão do schema public
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.objid = p.oid
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure);
  END LOOP;

  -- 2) Devolve o acesso apenas às funções que as telas e as regras de acesso usam
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (manter)
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.objid = p.oid
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure);
  END LOOP;
END $$;
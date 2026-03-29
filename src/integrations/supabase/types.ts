export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      bot_execution_logs: {
        Row: {
          action: string | null
          created_at: string | null
          execution_id: string | null
          id: string
          node_id: string | null
          result: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          execution_id?: string | null
          id?: string
          node_id?: string | null
          result?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          execution_id?: string | null
          id?: string
          node_id?: string | null
          result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_execution_logs_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "bot_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_execution_logs_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "bot_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_executions: {
        Row: {
          bot_id: string | null
          cancel_reason: string | null
          current_node_id: string | null
          finished_at: string | null
          id: string
          lead_id: string | null
          started_at: string | null
          status: string | null
          timeout_at: string | null
          waiting_for: string | null
          waiting_since: string | null
        }
        Insert: {
          bot_id?: string | null
          cancel_reason?: string | null
          current_node_id?: string | null
          finished_at?: string | null
          id?: string
          lead_id?: string | null
          started_at?: string | null
          status?: string | null
          timeout_at?: string | null
          waiting_for?: string | null
          waiting_since?: string | null
        }
        Update: {
          bot_id?: string | null
          cancel_reason?: string | null
          current_node_id?: string | null
          finished_at?: string | null
          id?: string
          lead_id?: string | null
          started_at?: string | null
          status?: string | null
          timeout_at?: string | null
          waiting_for?: string | null
          waiting_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_executions_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_executions_current_node_id_fkey"
            columns: ["current_node_id"]
            isOneToOne: false
            referencedRelation: "bot_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_node_outputs: {
        Row: {
          condition_type: string
          condition_value: string | null
          created_at: string | null
          id: string
          label: string
          next_node_id: string | null
          node_id: string | null
        }
        Insert: {
          condition_type: string
          condition_value?: string | null
          created_at?: string | null
          id?: string
          label: string
          next_node_id?: string | null
          node_id?: string | null
        }
        Update: {
          condition_type?: string
          condition_value?: string | null
          created_at?: string | null
          id?: string
          label?: string
          next_node_id?: string | null
          node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_node_outputs_next_node_id_fkey"
            columns: ["next_node_id"]
            isOneToOne: false
            referencedRelation: "bot_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_node_outputs_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "bot_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_nodes: {
        Row: {
          bot_id: string | null
          config: Json
          created_at: string | null
          id: string
          is_start_node: boolean | null
          position_x: number | null
          position_y: number | null
          type: string
        }
        Insert: {
          bot_id?: string | null
          config?: Json
          created_at?: string | null
          id?: string
          is_start_node?: boolean | null
          position_x?: number | null
          position_y?: number | null
          type: string
        }
        Update: {
          bot_id?: string | null
          config?: Json
          created_at?: string | null
          id?: string
          is_start_node?: boolean | null
          position_x?: number | null
          position_y?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_nodes_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bots: {
        Row: {
          active: boolean | null
          created_at: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      clinicas: {
        Row: {
          ativa: boolean
          cidade: string
          created_at: string
          endereco: string | null
          id: string
          nome: string
          telefone: string | null
        }
        Insert: {
          ativa?: boolean
          cidade: string
          created_at?: string
          endereco?: string | null
          id?: string
          nome: string
          telefone?: string | null
        }
        Update: {
          ativa?: boolean
          cidade?: string
          created_at?: string
          endereco?: string | null
          id?: string
          nome?: string
          telefone?: string | null
        }
        Relationships: []
      }
      crm_automations: {
        Row: {
          action_config: Json | null
          action_type: string
          created_at: string
          id: string
          is_active: boolean
          stage_id: string
          trigger_type: string
        }
        Insert: {
          action_config?: Json | null
          action_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          stage_id: string
          trigger_type?: string
        }
        Update: {
          action_config?: Json | null
          action_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          stage_id?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automations_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_custom_fields: {
        Row: {
          created_at: string
          field_type: string
          id: string
          name: string
          options: Json | null
          position: number
        }
        Insert: {
          created_at?: string
          field_type?: string
          id?: string
          name: string
          options?: Json | null
          position?: number
        }
        Update: {
          created_at?: string
          field_type?: string
          id?: string
          name?: string
          options?: Json | null
          position?: number
        }
        Relationships: []
      }
      crm_lead_custom_values: {
        Row: {
          field_id: string
          id: string
          lead_id: string
          value: string | null
        }
        Insert: {
          field_id: string
          id?: string
          lead_id: string
          value?: string | null
        }
        Update: {
          field_id?: string
          id?: string
          lead_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_custom_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "crm_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_custom_values_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_stage_history: {
        Row: {
          changed_by: string | null
          entered_at: string
          exited_at: string | null
          id: string
          lead_id: string
          stage_id: string
        }
        Insert: {
          changed_by?: string | null
          entered_at?: string
          exited_at?: string | null
          id?: string
          lead_id: string
          stage_id: string
        }
        Update: {
          changed_by?: string | null
          entered_at?: string
          exited_at?: string | null
          id?: string
          lead_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_stage_history_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          automation_paused: boolean | null
          created_at: string
          follow_up_count: number | null
          has_task: boolean
          id: string
          last_inbound_at: string | null
          last_message: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          name: string
          notes: string | null
          paciente_id: string | null
          phone: string | null
          pipeline_id: string
          position: number
          source: string | null
          stage_id: string
          tags: string[] | null
          task_overdue: boolean
          updated_at: string
          value: number | null
        }
        Insert: {
          automation_paused?: boolean | null
          created_at?: string
          follow_up_count?: number | null
          has_task?: boolean
          id?: string
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          name: string
          notes?: string | null
          paciente_id?: string | null
          phone?: string | null
          pipeline_id: string
          position?: number
          source?: string | null
          stage_id: string
          tags?: string[] | null
          task_overdue?: boolean
          updated_at?: string
          value?: number | null
        }
        Update: {
          automation_paused?: boolean | null
          created_at?: string
          follow_up_count?: number | null
          has_task?: boolean
          id?: string
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          name?: string
          notes?: string | null
          paciente_id?: string | null
          phone?: string | null
          pipeline_id?: string
          position?: number
          source?: string | null
          stage_id?: string
          tags?: string[] | null
          task_overdue?: boolean
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      crm_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          pipeline_id: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          pipeline_id: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          pipeline_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          due_date: string
          id: string
          lead_id: string
          notes: string | null
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          due_date: string
          id?: string
          lead_id: string
          notes?: string | null
          status?: string
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          due_date?: string
          id?: string
          lead_id?: string
          notes?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_whatsapp_templates: {
        Row: {
          body_text: string | null
          buttons: Json | null
          category: string
          created_at: string
          footer_text: string | null
          header_content: string | null
          header_type: string | null
          id: string
          language: string
          meta_template_id: string | null
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          body_text?: string | null
          buttons?: Json | null
          category?: string
          created_at?: string
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          body_text?: string | null
          buttons?: Json | null
          category?: string
          created_at?: string
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      funnel_channels: {
        Row: {
          channel_config: Json | null
          channel_type: string
          created_at: string | null
          id: string
          pipeline_id: string
        }
        Insert: {
          channel_config?: Json | null
          channel_type: string
          created_at?: string | null
          id?: string
          pipeline_id: string
        }
        Update: {
          channel_config?: Json | null
          channel_type?: string
          created_at?: string | null
          id?: string
          pipeline_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_channels_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          key: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          key: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          key?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads_diarios: {
        Row: {
          agendaram: number
          clinica_id: string
          compareceram: number
          contrataram: number
          created_at: string
          created_by: string | null
          data: string
          faltaram: number
          id: string
          leads_novos: number
          nao_contrataram: number
          reagendados_compareceram: number
          reagendados_contrataram: number
          remarcados: number
          updated_at: string
        }
        Insert: {
          agendaram?: number
          clinica_id: string
          compareceram?: number
          contrataram?: number
          created_at?: string
          created_by?: string | null
          data?: string
          faltaram?: number
          id?: string
          leads_novos?: number
          nao_contrataram?: number
          reagendados_compareceram?: number
          reagendados_contrataram?: number
          remarcados?: number
          updated_at?: string
        }
        Update: {
          agendaram?: number
          clinica_id?: string
          compareceram?: number
          contrataram?: number
          created_at?: string
          created_by?: string | null
          data?: string
          faltaram?: number
          id?: string
          leads_novos?: number
          nao_contrataram?: number
          reagendados_compareceram?: number
          reagendados_contrataram?: number
          remarcados?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_diarios_clinica_id_fkey"
            columns: ["clinica_id"]
            isOneToOne: false
            referencedRelation: "clinicas"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          created_at: string
          direction: string
          id: string
          lead_id: string
          media_url: string | null
          reactions: Json | null
          reply_to_message_id: string | null
          status: string
          type: string
          whatsapp_message_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          direction?: string
          id?: string
          lead_id: string
          media_url?: string | null
          reactions?: Json | null
          reply_to_message_id?: string | null
          status?: string
          type?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          direction?: string
          id?: string
          lead_id?: string
          media_url?: string | null
          reactions?: Json | null
          reply_to_message_id?: string | null
          status?: string
          type?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          created_at: string
          id: string
          paciente_id: string
          status: string
          updated_at: string
          valor_orcado: number
        }
        Insert: {
          created_at?: string
          id?: string
          paciente_id: string
          status?: string
          updated_at?: string
          valor_orcado?: number
        }
        Update: {
          created_at?: string
          id?: string
          paciente_id?: string
          status?: string
          updated_at?: string
          valor_orcado?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
        ]
      }
      pacientes: {
        Row: {
          cidade: string | null
          created_at: string
          email: string | null
          id: string
          nome: string
          nome_anuncio: string | null
          origem: string | null
          telefone: string
          updated_at: string
        }
        Insert: {
          cidade?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          nome_anuncio?: string | null
          origem?: string | null
          telefone: string
          updated_at?: string
        }
        Update: {
          cidade?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          nome_anuncio?: string | null
          origem?: string | null
          telefone?: string
          updated_at?: string
        }
        Relationships: []
      }
      pagamentos: {
        Row: {
          clinica_id: string
          created_at: string
          created_by: string | null
          data_pagamento: string
          forma_pagamento: string
          id: string
          orcamento_id: string | null
          paciente_id: string
          tipo: string
          tratamento_id: string
          valor: number
        }
        Insert: {
          clinica_id: string
          created_at?: string
          created_by?: string | null
          data_pagamento?: string
          forma_pagamento: string
          id?: string
          orcamento_id?: string | null
          paciente_id: string
          tipo?: string
          tratamento_id: string
          valor: number
        }
        Update: {
          clinica_id?: string
          created_at?: string
          created_by?: string | null
          data_pagamento?: string
          forma_pagamento?: string
          id?: string
          orcamento_id?: string | null
          paciente_id?: string
          tipo?: string
          tratamento_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_clinica_id_fkey"
            columns: ["clinica_id"]
            isOneToOne: false
            referencedRelation: "clinicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_tratamento_id_fkey"
            columns: ["tratamento_id"]
            isOneToOne: false
            referencedRelation: "tratamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cargo: string | null
          created_at: string
          email: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email: string
          id: string
          nome: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      registros_diarios_atendimento: {
        Row: {
          agendamentos_por_ligacao: number
          clinica_id: string
          created_at: string
          created_by: string | null
          data: string
          id: string
          leads_agendados_futuro: number
          leads_reagendados: number
          leads_reagendados_ligacao: number
          ligacoes_atendidas: number
          total_ligacoes: number
          updated_at: string
        }
        Insert: {
          agendamentos_por_ligacao?: number
          clinica_id: string
          created_at?: string
          created_by?: string | null
          data?: string
          id?: string
          leads_agendados_futuro?: number
          leads_reagendados?: number
          leads_reagendados_ligacao?: number
          ligacoes_atendidas?: number
          total_ligacoes?: number
          updated_at?: string
        }
        Update: {
          agendamentos_por_ligacao?: number
          clinica_id?: string
          created_at?: string
          created_by?: string | null
          data?: string
          id?: string
          leads_agendados_futuro?: number
          leads_reagendados?: number
          leads_reagendados_ligacao?: number
          ligacoes_atendidas?: number
          total_ligacoes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registros_diarios_atendimento_clinica_id_fkey"
            columns: ["clinica_id"]
            isOneToOne: false
            referencedRelation: "clinicas"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_bot_config: {
        Row: {
          active: boolean | null
          bot_id: string | null
          created_at: string | null
          id: string
          is_final_stage: boolean | null
          stage_id: string | null
          trigger_type: string | null
        }
        Insert: {
          active?: boolean | null
          bot_id?: string | null
          created_at?: string | null
          id?: string
          is_final_stage?: boolean | null
          stage_id?: string | null
          trigger_type?: string | null
        }
        Update: {
          active?: boolean | null
          bot_id?: string | null
          created_at?: string | null
          id?: string
          is_final_stage?: boolean | null
          stage_id?: string | null
          trigger_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_bot_config_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_bot_config_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: true
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      tipos_procedimento: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          especialidade: string | null
          especialidade_secundaria: string | null
          id: string
          nome: string
          updated_at: string
          valor_referencia: number | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          especialidade?: string | null
          especialidade_secundaria?: string | null
          id?: string
          nome: string
          updated_at?: string
          valor_referencia?: number | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          especialidade?: string | null
          especialidade_secundaria?: string | null
          id?: string
          nome?: string
          updated_at?: string
          valor_referencia?: number | null
        }
        Relationships: []
      }
      tratamentos: {
        Row: {
          clinica_id: string
          created_at: string
          created_by: string | null
          especialidade: string | null
          id: string
          orcamento_id: string | null
          paciente_id: string
          procedimento: string
          status: string
          updated_at: string
        }
        Insert: {
          clinica_id: string
          created_at?: string
          created_by?: string | null
          especialidade?: string | null
          id?: string
          orcamento_id?: string | null
          paciente_id: string
          procedimento: string
          status?: string
          updated_at?: string
        }
        Update: {
          clinica_id?: string
          created_at?: string
          created_by?: string | null
          especialidade?: string | null
          id?: string
          orcamento_id?: string | null
          paciente_id?: string
          procedimento?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tratamentos_clinica_id_fkey"
            columns: ["clinica_id"]
            isOneToOne: false
            referencedRelation: "clinicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tratamentos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tratamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "gerente" | "crc"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "gerente", "crc"],
    },
  },
} as const

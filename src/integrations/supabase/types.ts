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
      _internal_secrets: {
        Row: {
          created_at: string
          name: string
          value: string
        }
        Insert: {
          created_at?: string
          name: string
          value: string
        }
        Update: {
          created_at?: string
          name?: string
          value?: string
        }
        Relationships: []
      }
      access_logs: {
        Row: {
          context: string
          created_at: string
          email: string | null
          event: string
          id: string
          ip: string | null
          metadata: Json | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: string
          created_at?: string
          email?: string | null
          event?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          email?: string | null
          event?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ad_id_mapping: {
        Row: {
          ad_account_id: string | null
          ad_account_name: string | null
          ad_body: string | null
          ad_headline: string | null
          ad_id: string
          ad_name: string | null
          cidade: string | null
          created_at: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          ad_account_name?: string | null
          ad_body?: string | null
          ad_headline?: string | null
          ad_id: string
          ad_name?: string | null
          cidade?: string | null
          created_at?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          ad_account_name?: string | null
          ad_body?: string | null
          ad_headline?: string | null
          ad_id?: string
          ad_name?: string | null
          cidade?: string | null
          created_at?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_id_mapping_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assistant_config: {
        Row: {
          assistant_display_name: string
          auto_send_enabled: boolean
          copilot_enabled: boolean
          created_at: string
          custom_instructions: string | null
          enabled_features: Json
          id: string
          is_active: boolean
          knowledge_base: string | null
          language: string
          model: string
          name: string
          recoil_hours: number
          shift_end: string
          shift_start: string
          system_prompt: string
          tenant_id: string | null
          tone: string
          updated_at: string
          wait_minutes: number
        }
        Insert: {
          assistant_display_name?: string
          auto_send_enabled?: boolean
          copilot_enabled?: boolean
          created_at?: string
          custom_instructions?: string | null
          enabled_features?: Json
          id?: string
          is_active?: boolean
          knowledge_base?: string | null
          language?: string
          model?: string
          name?: string
          recoil_hours?: number
          shift_end?: string
          shift_start?: string
          system_prompt?: string
          tenant_id?: string | null
          tone?: string
          updated_at?: string
          wait_minutes?: number
        }
        Update: {
          assistant_display_name?: string
          auto_send_enabled?: boolean
          copilot_enabled?: boolean
          created_at?: string
          custom_instructions?: string | null
          enabled_features?: Json
          id?: string
          is_active?: boolean
          knowledge_base?: string | null
          language?: string
          model?: string
          name?: string
          recoil_hours?: number
          shift_end?: string
          shift_start?: string
          system_prompt?: string
          tenant_id?: string | null
          tone?: string
          updated_at?: string
          wait_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assistant_rules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          kind: string
          tenant_id: string
          text: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          tenant_id?: string
          text: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          tenant_id?: string
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_conversation_analysis: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_message_at: string | null
          lead_id: string
          message_count: number
          mode: string
          model: string | null
          question: string
          result: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string | null
          lead_id: string
          message_count?: number
          mode: string
          model?: string | null
          question?: string
          result: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string
          message_count?: number
          mode?: string
          model?: string | null
          question?: string
          result?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_good_examples: {
        Row: {
          cidade: string | null
          context: string
          created_at: string
          embedding: string | null
          id: string
          ideal_reply: string
          lead_id: string | null
          servico: string | null
          tenant_id: string
        }
        Insert: {
          cidade?: string | null
          context: string
          created_at?: string
          embedding?: string | null
          id?: string
          ideal_reply: string
          lead_id?: string | null
          servico?: string | null
          tenant_id?: string
        }
        Update: {
          cidade?: string | null
          context?: string
          created_at?: string
          embedding?: string | null
          id?: string
          ideal_reply?: string
          lead_id?: string | null
          servico?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      ai_reply_suggestions: {
        Row: {
          action: string
          action_reason: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          final_text: string | null
          id: string
          lead_id: string
          model: string | null
          outcome: string | null
          status: string
          suggested_text: string
          tenant_id: string | null
          trigger_message_id: string | null
          was_edited: boolean
        }
        Insert: {
          action?: string
          action_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          final_text?: string | null
          id?: string
          lead_id: string
          model?: string | null
          outcome?: string | null
          status?: string
          suggested_text: string
          tenant_id?: string | null
          trigger_message_id?: string | null
          was_edited?: boolean
        }
        Update: {
          action?: string
          action_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          final_text?: string | null
          id?: string
          lead_id?: string
          model?: string | null
          outcome?: string | null
          status?: string
          suggested_text?: string
          tenant_id?: string | null
          trigger_message_id?: string | null
          was_edited?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_reply_suggestions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reply_suggestions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      bot_execution_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          execution_id: string
          id: string
          node_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          execution_id: string
          id?: string
          node_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          execution_id?: string
          id?: string
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_execution_logs_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "bot_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_executions: {
        Row: {
          bot_id: string
          bot_version_id: string | null
          completed_at: string | null
          current_node_id: string | null
          id: string
          lead_id: string
          started_at: string
          status: string
          timeout_at: string | null
          updated_at: string
          variables: Json
        }
        Insert: {
          bot_id: string
          bot_version_id?: string | null
          completed_at?: string | null
          current_node_id?: string | null
          id?: string
          lead_id: string
          started_at?: string
          status?: string
          timeout_at?: string | null
          updated_at?: string
          variables?: Json
        }
        Update: {
          bot_id?: string
          bot_version_id?: string | null
          completed_at?: string | null
          current_node_id?: string | null
          id?: string
          lead_id?: string
          started_at?: string
          status?: string
          timeout_at?: string | null
          updated_at?: string
          variables?: Json
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
            foreignKeyName: "bot_executions_bot_version_id_fkey"
            columns: ["bot_version_id"]
            isOneToOne: false
            referencedRelation: "bot_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      bot_stage_triggers: {
        Row: {
          bot_id: string
          conditions: Json | null
          created_at: string
          delay_minutes: number
          id: string
          is_active: boolean
          priority: number
          stage_id: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          bot_id: string
          conditions?: Json | null
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          priority?: number
          stage_id: string
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          bot_id?: string
          conditions?: Json | null
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          priority?: number
          stage_id?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_stage_triggers_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_stage_triggers_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_versions: {
        Row: {
          bot_id: string
          flow_json: Json
          id: string
          published_at: string
          version: number
        }
        Insert: {
          bot_id: string
          flow_json: Json
          id?: string
          published_at?: string
          version: number
        }
        Update: {
          bot_id?: string
          flow_json?: Json
          id?: string
          published_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_versions_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bots: {
        Row: {
          created_at: string
          created_by: string | null
          current_version: number
          description: string | null
          flow_json: Json
          id: string
          mark_as_read: boolean
          name: string
          owner_role: Database["public"]["Enums"]["app_role"] | null
          shared_roles: Database["public"]["Enums"]["app_role"][]
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_version?: number
          description?: string | null
          flow_json?: Json
          id?: string
          mark_as_read?: boolean
          name: string
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_version?: number
          description?: string | null
          flow_json?: Json
          id?: string
          mark_as_read?: boolean
          name?: string
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
        }
        Insert: {
          ativa?: boolean
          cidade: string
          created_at?: string
          endereco?: string | null
          id?: string
          nome: string
          telefone?: string | null
          tenant_id?: string | null
        }
        Update: {
          ativa?: boolean
          cidade?: string
          created_at?: string
          endereco?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_appointments: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          is_rescheduled: boolean
          lead_cidade: string | null
          lead_id: string
          lead_name: string | null
          notes: string | null
          owner_role: Database["public"]["Enums"]["app_role"] | null
          scheduled_date: string
          scheduled_time: string
          status: string
          task_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          is_rescheduled?: boolean
          lead_cidade?: string | null
          lead_id: string
          lead_name?: string | null
          notes?: string | null
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          scheduled_date: string
          scheduled_time: string
          status?: string
          task_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          is_rescheduled?: boolean
          lead_cidade?: string | null
          lead_id?: string
          lead_name?: string | null
          notes?: string | null
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          scheduled_date?: string
          scheduled_time?: string
          status?: string
          task_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "crm_appointments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "crm_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_executions: {
        Row: {
          automation_id: string
          executed_at: string
          id: string
          lead_id: string
        }
        Insert: {
          automation_id: string
          executed_at?: string
          id?: string
          lead_id: string
        }
        Update: {
          automation_id?: string
          executed_at?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_executions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "crm_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      crm_automation_queue: {
        Row: {
          action_config: Json
          action_type: string
          appointment_id: string | null
          automation_id: string
          created_at: string
          error_message: string | null
          id: string
          layer_index: number
          lead_id: string
          scheduled_at: string
          status: string
          task_id: string | null
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          appointment_id?: string | null
          automation_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          layer_index?: number
          lead_id: string
          scheduled_at?: string
          status?: string
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          appointment_id?: string | null
          automation_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          layer_index?: number
          lead_id?: string
          scheduled_at?: string
          status?: string
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_queue_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "crm_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      crm_automations: {
        Row: {
          action_config: Json | null
          action_type: string
          created_at: string
          id: string
          is_active: boolean
          stage_id: string
          tenant_id: string | null
          trigger_type: string
        }
        Insert: {
          action_config?: Json | null
          action_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          stage_id: string
          tenant_id?: string | null
          trigger_type?: string
        }
        Update: {
          action_config?: Json | null
          action_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          stage_id?: string
          tenant_id?: string | null
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
          {
            foreignKeyName: "crm_automations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_broadcast_recipients: {
        Row: {
          broadcast_id: string
          error: string | null
          id: string
          lead_id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          broadcast_id: string
          error?: string | null
          id?: string
          lead_id: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          broadcast_id?: string
          error?: string | null
          id?: string
          lead_id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "crm_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_broadcast_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_broadcast_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      crm_broadcasts: {
        Row: {
          created_at: string
          created_by: string | null
          filter_pipeline_id: string | null
          filter_stage_id: string | null
          filter_tags: string[] | null
          id: string
          name: string
          owner_role: Database["public"]["Enums"]["app_role"] | null
          scheduled_at: string | null
          sent_count: number
          shared_roles: Database["public"]["Enums"]["app_role"][]
          status: string
          template_id: string | null
          tenant_id: string | null
          total_leads: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filter_pipeline_id?: string | null
          filter_stage_id?: string | null
          filter_tags?: string[] | null
          id?: string
          name: string
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          scheduled_at?: string | null
          sent_count?: number
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          status?: string
          template_id?: string | null
          tenant_id?: string | null
          total_leads?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filter_pipeline_id?: string | null
          filter_stage_id?: string | null
          filter_tags?: string[] | null
          id?: string
          name?: string
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          scheduled_at?: string | null
          sent_count?: number
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          status?: string
          template_id?: string | null
          tenant_id?: string | null
          total_leads?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_broadcasts_filter_pipeline_id_fkey"
            columns: ["filter_pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_broadcasts_filter_stage_id_fkey"
            columns: ["filter_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_broadcasts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "crm_whatsapp_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_broadcasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversation_notes: {
        Row: {
          after_message_id: string | null
          author_id: string | null
          content: string
          created_at: string
          id: string
          lead_id: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          after_message_id?: string | null
          author_id?: string | null
          content: string
          created_at?: string
          id?: string
          lead_id: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          after_message_id?: string | null
          author_id?: string | null
          content?: string
          created_at?: string
          id?: string
          lead_id?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_notes_after_message_id_fkey"
            columns: ["after_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "crm_conversation_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          field_type?: string
          id?: string
          name: string
          options?: Json | null
          position?: number
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          field_type?: string
          id?: string
          name?: string
          options?: Json | null
          position?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_custom_fields_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_followup_configs: {
        Row: {
          created_at: string
          disparo1_content: string | null
          disparo1_delay_minutes: number
          disparo1_template_id: string | null
          disparo1_type: string
          disparo2_content: string | null
          disparo2_delay_minutes: number
          disparo2_template_id: string | null
          disparo2_type: string
          disparos: Json | null
          id: string
          is_active: boolean
          max_attempts: number
          move_to_stage_id: string | null
          return_to_stage_id: string | null
          stage_id: string
          stop_on_stages: string[] | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          disparo1_content?: string | null
          disparo1_delay_minutes?: number
          disparo1_template_id?: string | null
          disparo1_type?: string
          disparo2_content?: string | null
          disparo2_delay_minutes?: number
          disparo2_template_id?: string | null
          disparo2_type?: string
          disparos?: Json | null
          id?: string
          is_active?: boolean
          max_attempts?: number
          move_to_stage_id?: string | null
          return_to_stage_id?: string | null
          stage_id: string
          stop_on_stages?: string[] | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          disparo1_content?: string | null
          disparo1_delay_minutes?: number
          disparo1_template_id?: string | null
          disparo1_type?: string
          disparo2_content?: string | null
          disparo2_delay_minutes?: number
          disparo2_template_id?: string | null
          disparo2_type?: string
          disparos?: Json | null
          id?: string
          is_active?: boolean
          max_attempts?: number
          move_to_stage_id?: string | null
          return_to_stage_id?: string | null
          stage_id?: string
          stop_on_stages?: string[] | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_followup_configs_disparo1_template_id_fkey"
            columns: ["disparo1_template_id"]
            isOneToOne: false
            referencedRelation: "crm_whatsapp_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_configs_disparo2_template_id_fkey"
            columns: ["disparo2_template_id"]
            isOneToOne: false
            referencedRelation: "crm_whatsapp_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_configs_move_to_stage_id_fkey"
            columns: ["move_to_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_configs_return_to_stage_id_fkey"
            columns: ["return_to_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_configs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_followup_queue: {
        Row: {
          attempt_count: number
          config_id: string
          created_at: string
          current_disparo_index: number | null
          disparo1_scheduled_at: string | null
          disparo1_sent_at: string | null
          disparo2_scheduled_at: string | null
          disparo2_sent_at: string | null
          id: string
          last_lead_message_at: string | null
          lead_id: string
          next_scheduled_at: string | null
          stage_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          config_id: string
          created_at?: string
          current_disparo_index?: number | null
          disparo1_scheduled_at?: string | null
          disparo1_sent_at?: string | null
          disparo2_scheduled_at?: string | null
          disparo2_sent_at?: string | null
          id?: string
          last_lead_message_at?: string | null
          lead_id: string
          next_scheduled_at?: string | null
          stage_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          config_id?: string
          created_at?: string
          current_disparo_index?: number | null
          disparo1_scheduled_at?: string | null
          disparo1_sent_at?: string | null
          disparo2_scheduled_at?: string | null
          disparo2_sent_at?: string | null
          id?: string
          last_lead_message_at?: string | null
          lead_id?: string
          next_scheduled_at?: string | null
          stage_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_followup_queue_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "crm_followup_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "crm_followup_queue_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_funnel_custom_reports: {
        Row: {
          agendados: number
          atendidos: number
          avaliados: number
          compareceram: number
          created_at: string
          fecharam: number
          id: string
          meta_agendados: number | null
          meta_atendidos: number | null
          meta_avaliados: number | null
          meta_compareceram: number | null
          meta_fecharam: number | null
          notes: string | null
          period_end: string
          period_label: string
          period_start: string
          period_type: string
          pipeline_id: string | null
          tenant_id: string
          total_leads: number
          updated_at: string
          user_id: string
        }
        Insert: {
          agendados?: number
          atendidos?: number
          avaliados?: number
          compareceram?: number
          created_at?: string
          fecharam?: number
          id?: string
          meta_agendados?: number | null
          meta_atendidos?: number | null
          meta_avaliados?: number | null
          meta_compareceram?: number | null
          meta_fecharam?: number | null
          notes?: string | null
          period_end: string
          period_label: string
          period_start: string
          period_type?: string
          pipeline_id?: string | null
          tenant_id?: string
          total_leads?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          agendados?: number
          atendidos?: number
          avaliados?: number
          compareceram?: number
          created_at?: string
          fecharam?: number
          id?: string
          meta_agendados?: number | null
          meta_atendidos?: number | null
          meta_avaliados?: number | null
          meta_compareceram?: number | null
          meta_fecharam?: number | null
          notes?: string | null
          period_end?: string
          period_label?: string
          period_start?: string
          period_type?: string
          pipeline_id?: string | null
          tenant_id?: string
          total_leads?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_funnel_custom_reports_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "crm_lead_custom_values_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      crm_lead_instagram_identities: {
        Row: {
          created_at: string
          id: string
          ig_account_id: string
          ig_scoped_user_id: string
          lead_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ig_account_id: string
          ig_scoped_user_id: string
          lead_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ig_account_id?: string
          ig_scoped_user_id?: string
          lead_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_instagram_identities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_instagram_identities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      crm_lead_label_assignments: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label_id: string
          lead_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          label_id: string
          lead_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label_id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "crm_user_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_pacientes: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          lead_id: string
          paciente_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          lead_id: string
          paciente_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          lead_id?: string
          paciente_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_pacientes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_pacientes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "crm_lead_pacientes_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_stage_history: {
        Row: {
          changed_by: string | null
          entered_at: string
          exited_at: string | null
          from_stage_id: string | null
          id: string
          lead_id: string
          stage_id: string
        }
        Insert: {
          changed_by?: string | null
          entered_at?: string
          exited_at?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id: string
          stage_id: string
        }
        Update: {
          changed_by?: string | null
          entered_at?: string
          exited_at?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_stage_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
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
          ad_account_id: string | null
          ad_account_name: string | null
          ad_id: string | null
          assigned_to: string | null
          automation_paused: boolean | null
          blocked_at: string | null
          blocked_by: string | null
          cidade: string | null
          created_at: string
          descricao_anuncio: string | null
          first_inbound_at: string | null
          follow_up_count: number | null
          has_task: boolean
          id: string
          ig_account_uuid: string | null
          imagem_origem: string | null
          instagram_profile_pic_url: string | null
          instagram_user_id: string | null
          instagram_username: string | null
          is_blocked: boolean
          last_inbound_at: string | null
          last_message: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          link_anuncio: string | null
          name: string
          nome_anuncio: string | null
          notes: string | null
          paciente_id: string | null
          phone: string | null
          pipeline_id: string
          position: number
          score: number
          servico_interesse: string | null
          source: string | null
          stage_id: string
          tags: string[] | null
          task_overdue: boolean
          tenant_id: string | null
          titulo_anuncio: string | null
          updated_at: string
          value: number | null
          whatsapp_number_id: string | null
        }
        Insert: {
          ad_account_id?: string | null
          ad_account_name?: string | null
          ad_id?: string | null
          assigned_to?: string | null
          automation_paused?: boolean | null
          blocked_at?: string | null
          blocked_by?: string | null
          cidade?: string | null
          created_at?: string
          descricao_anuncio?: string | null
          first_inbound_at?: string | null
          follow_up_count?: number | null
          has_task?: boolean
          id?: string
          ig_account_uuid?: string | null
          imagem_origem?: string | null
          instagram_profile_pic_url?: string | null
          instagram_user_id?: string | null
          instagram_username?: string | null
          is_blocked?: boolean
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          link_anuncio?: string | null
          name: string
          nome_anuncio?: string | null
          notes?: string | null
          paciente_id?: string | null
          phone?: string | null
          pipeline_id: string
          position?: number
          score?: number
          servico_interesse?: string | null
          source?: string | null
          stage_id: string
          tags?: string[] | null
          task_overdue?: boolean
          tenant_id?: string | null
          titulo_anuncio?: string | null
          updated_at?: string
          value?: number | null
          whatsapp_number_id?: string | null
        }
        Update: {
          ad_account_id?: string | null
          ad_account_name?: string | null
          ad_id?: string | null
          assigned_to?: string | null
          automation_paused?: boolean | null
          blocked_at?: string | null
          blocked_by?: string | null
          cidade?: string | null
          created_at?: string
          descricao_anuncio?: string | null
          first_inbound_at?: string | null
          follow_up_count?: number | null
          has_task?: boolean
          id?: string
          ig_account_uuid?: string | null
          imagem_origem?: string | null
          instagram_profile_pic_url?: string | null
          instagram_user_id?: string | null
          instagram_username?: string | null
          is_blocked?: boolean
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          link_anuncio?: string | null
          name?: string
          nome_anuncio?: string | null
          notes?: string | null
          paciente_id?: string | null
          phone?: string | null
          pipeline_id?: string
          position?: number
          score?: number
          servico_interesse?: string | null
          source?: string | null
          stage_id?: string
          tags?: string[] | null
          task_overdue?: boolean
          tenant_id?: string | null
          titulo_anuncio?: string | null
          updated_at?: string
          value?: number | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_ig_account_uuid_fkey"
            columns: ["ig_account_uuid"]
            isOneToOne: false
            referencedRelation: "ig_accounts"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "crm_leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notification_preferences: {
        Row: {
          browser_push_enabled: boolean
          created_at: string
          id: string
          notify_lead_reply: boolean
          notify_new_lead: boolean
          notify_task_due: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          browser_push_enabled?: boolean
          created_at?: string
          id?: string
          notify_lead_reply?: boolean
          notify_new_lead?: boolean
          notify_task_due?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          browser_push_enabled?: boolean
          created_at?: string
          id?: string
          notify_lead_reply?: boolean
          notify_new_lead?: boolean
          notify_task_due?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          lead_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          lead_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          lead_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          allowed_roles: Database["public"]["Enums"]["app_role"][] | null
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string | null
        }
        Insert: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][] | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tenant_id?: string | null
        }
        Update: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][] | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipelines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_quick_replies: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          media_type: string | null
          media_url: string | null
          owner_role: Database["public"]["Enums"]["app_role"] | null
          shared_roles: Database["public"]["Enums"]["app_role"][]
          tenant_id: string | null
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          tenant_id?: string | null
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          tenant_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_quick_replies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          pipeline_id: string
          position: number
          tenant_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          pipeline_id: string
          position?: number
          tenant_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          pipeline_id?: string
          position?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_stages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          owner_role: Database["public"]["Enums"]["app_role"] | null
          status: string
          tenant_id: string | null
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
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          status?: string
          tenant_id?: string | null
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
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          status?: string
          tenant_id?: string | null
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
          {
            foreignKeyName: "crm_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "crm_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_user_labels: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_whatsapp_templates: {
        Row: {
          body_text: string | null
          buttons: Json | null
          category: string
          created_at: string
          created_by_user_id: string | null
          footer_text: string | null
          header_content: string | null
          header_type: string | null
          id: string
          language: string
          meta_template_id: string | null
          name: string
          owner_role: Database["public"]["Enums"]["app_role"] | null
          shared_roles: Database["public"]["Enums"]["app_role"][]
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          body_text?: string | null
          buttons?: Json | null
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name: string
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          body_text?: string | null
          buttons?: Json | null
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          owner_role?: Database["public"]["Enums"]["app_role"] | null
          shared_roles?: Database["public"]["Enums"]["app_role"][]
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_whatsapp_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_holidays: {
        Row: {
          clinica_id: string | null
          created_at: string
          created_by: string | null
          data: string
          descricao: string | null
          id: string
          tenant_id: string | null
        }
        Insert: {
          clinica_id?: string | null
          created_at?: string
          created_by?: string | null
          data: string
          descricao?: string | null
          id?: string
          tenant_id?: string | null
        }
        Update: {
          clinica_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: string
          descricao?: string | null
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_holidays_clinica_id_fkey"
            columns: ["clinica_id"]
            isOneToOne: false
            referencedRelation: "clinicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_holidays_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_leads_backup: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          expires_at: string
          id: string
          instagram_messages_snapshot: Json
          lead_name: string | null
          lead_phone: string | null
          lead_snapshot: Json
          messages_count: number
          messages_snapshot: Json
          original_lead_id: string
          restored_at: string | null
          restored_by: string | null
          tenant_id: string | null
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          expires_at?: string
          id?: string
          instagram_messages_snapshot?: Json
          lead_name?: string | null
          lead_phone?: string | null
          lead_snapshot: Json
          messages_count?: number
          messages_snapshot?: Json
          original_lead_id: string
          restored_at?: string | null
          restored_by?: string | null
          tenant_id?: string | null
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          expires_at?: string
          id?: string
          instagram_messages_snapshot?: Json
          lead_name?: string | null
          lead_phone?: string | null
          lead_snapshot?: Json
          messages_count?: number
          messages_snapshot?: Json
          original_lead_id?: string
          restored_at?: string | null
          restored_by?: string | null
          tenant_id?: string | null
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
          tenant_id: string | null
        }
        Insert: {
          channel_config?: Json | null
          channel_type: string
          created_at?: string | null
          id?: string
          pipeline_id: string
          tenant_id?: string | null
        }
        Update: {
          channel_config?: Json | null
          channel_type?: string
          created_at?: string | null
          id?: string
          pipeline_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_channels_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_accounts: {
        Row: {
          access_token: string
          active: boolean
          created_at: string
          id: string
          ig_user_id: string
          tenant_id: string
          token_expires_at: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          access_token: string
          active?: boolean
          created_at?: string
          id?: string
          ig_user_id: string
          tenant_id: string
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          access_token?: string
          active?: boolean
          created_at?: string
          id?: string
          ig_user_id?: string
          tenant_id?: string
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      instagram_accounts: {
        Row: {
          created_at: string
          id: string
          instagram_account_id: string
          is_active: boolean
          long_lived_token_expires_at: string | null
          name: string
          page_access_token: string | null
          page_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          instagram_account_id: string
          is_active?: boolean
          long_lived_token_expires_at?: string | null
          name: string
          page_access_token?: string | null
          page_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          instagram_account_id?: string
          is_active?: boolean
          long_lived_token_expires_at?: string | null
          name?: string
          page_access_token?: string | null
          page_id?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      instagram_messages: {
        Row: {
          comment_id: string | null
          created_at: string
          id: string
          ig_account_uuid: string | null
          instagram_account_config_id: string | null
          instagram_account_id: string | null
          is_outbound: boolean
          is_read: boolean
          lead_id: string | null
          message_text: string | null
          message_type: string | null
          post_id: string | null
          replied_at: string | null
          reply_text: string | null
          sender_id: string | null
          sender_name: string | null
          sender_profile_pic: string | null
          sender_username: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          id?: string
          ig_account_uuid?: string | null
          instagram_account_config_id?: string | null
          instagram_account_id?: string | null
          is_outbound?: boolean
          is_read?: boolean
          lead_id?: string | null
          message_text?: string | null
          message_type?: string | null
          post_id?: string | null
          replied_at?: string | null
          reply_text?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_profile_pic?: string | null
          sender_username?: string | null
          status?: string
          tenant_id?: string | null
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          id?: string
          ig_account_uuid?: string | null
          instagram_account_config_id?: string | null
          instagram_account_id?: string | null
          is_outbound?: boolean
          is_read?: boolean
          lead_id?: string | null
          message_text?: string | null
          message_type?: string | null
          post_id?: string | null
          replied_at?: string | null
          reply_text?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_profile_pic?: string | null
          sender_username?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_messages_ig_account_uuid_fkey"
            columns: ["ig_account_uuid"]
            isOneToOne: false
            referencedRelation: "ig_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_messages_instagram_account_config_id_fkey"
            columns: ["instagram_account_config_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          key: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          key?: string
          status?: string
          tenant_id?: string | null
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
          ad_account_id: string | null
          ad_account_name: string | null
          ad_body: string | null
          ad_headline: string | null
          ad_image_url: string | null
          ad_source_id: string | null
          ad_source_url: string | null
          channel: string
          content: string | null
          created_at: string
          deleted_at: string | null
          direction: string
          error_reason: string | null
          id: string
          instagram_account_id: string | null
          instagram_comment_id: string | null
          instagram_message_id: string | null
          instagram_post_id: string | null
          instagram_post_permalink: string | null
          instagram_post_thumbnail: string | null
          instagram_sender_id: string | null
          lead_id: string
          media_url: string | null
          reactions: Json | null
          reply_to_message_id: string | null
          sender_id: string | null
          status: string
          tenant_id: string | null
          transcription: string | null
          type: string
          whatsapp_message_id: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          ad_account_id?: string | null
          ad_account_name?: string | null
          ad_body?: string | null
          ad_headline?: string | null
          ad_image_url?: string | null
          ad_source_id?: string | null
          ad_source_url?: string | null
          channel?: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          direction?: string
          error_reason?: string | null
          id?: string
          instagram_account_id?: string | null
          instagram_comment_id?: string | null
          instagram_message_id?: string | null
          instagram_post_id?: string | null
          instagram_post_permalink?: string | null
          instagram_post_thumbnail?: string | null
          instagram_sender_id?: string | null
          lead_id: string
          media_url?: string | null
          reactions?: Json | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          status?: string
          tenant_id?: string | null
          transcription?: string | null
          type?: string
          whatsapp_message_id?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          ad_account_id?: string | null
          ad_account_name?: string | null
          ad_body?: string | null
          ad_headline?: string | null
          ad_image_url?: string | null
          ad_source_id?: string | null
          ad_source_url?: string | null
          channel?: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          direction?: string
          error_reason?: string | null
          id?: string
          instagram_account_id?: string | null
          instagram_comment_id?: string | null
          instagram_message_id?: string | null
          instagram_post_id?: string | null
          instagram_post_permalink?: string | null
          instagram_post_thumbnail?: string | null
          instagram_sender_id?: string | null
          lead_id?: string
          media_url?: string | null
          reactions?: Json | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          status?: string
          tenant_id?: string | null
          transcription?: string | null
          type?: string
          whatsapp_message_id?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_com_pagamento"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pacientes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          clinica_id: string
          created_at: string
          created_by: string | null
          data_pagamento: string
          especialidade: string | null
          forma_pagamento: string
          id: string
          paciente_id: string
          tipo: string
          tratamento_id: string | null
          valor: number
        }
        Insert: {
          clinica_id: string
          created_at?: string
          created_by?: string | null
          data_pagamento?: string
          especialidade?: string | null
          forma_pagamento: string
          id?: string
          paciente_id: string
          tipo?: string
          tratamento_id?: string | null
          valor: number
        }
        Update: {
          clinica_id?: string
          created_at?: string
          created_by?: string | null
          data_pagamento?: string
          especialidade?: string | null
          forma_pagamento?: string
          id?: string
          paciente_id?: string
          tipo?: string
          tratamento_id?: string | null
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
      plans: {
        Row: {
          created_at: string
          features: Json
          id: string
          is_active: boolean
          lead_limit: number
          message_limit: number
          monthly_price: number
          name: string
          user_limit: number
        }
        Insert: {
          created_at?: string
          features?: Json
          id?: string
          is_active?: boolean
          lead_limit?: number
          message_limit?: number
          monthly_price?: number
          name: string
          user_limit?: number
        }
        Update: {
          created_at?: string
          features?: Json
          id?: string
          is_active?: boolean
          lead_limit?: number
          message_limit?: number
          monthly_price?: number
          name?: string
          user_limit?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          blocked_at: string | null
          blocked_by: string | null
          cargo: string | null
          created_at: string
          email: string
          id: string
          is_blocked: boolean
          last_login_at: string | null
          must_change_password: boolean
          nome: string
          signature_enabled: boolean
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          cargo?: string | null
          created_at?: string
          email: string
          id: string
          is_blocked?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          nome: string
          signature_enabled?: boolean
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          cargo?: string | null
          created_at?: string
          email?: string
          id?: string
          is_blocked?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          nome?: string
          signature_enabled?: boolean
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      tenant_invoices: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          paid_at: string | null
          receipt_url: string | null
          reference_month: string
          status: string
          tenant_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          receipt_url?: string | null
          reference_month: string
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          receipt_url?: string | null
          reference_month?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_meta_credentials: {
        Row: {
          created_at: string
          instagram_app_secret: string | null
          instagram_enabled: boolean
          instagram_redirect_uri: string | null
          instagram_verify_token: string
          meta_app_id: string | null
          meta_app_secret: string | null
          tenant_id: string
          updated_at: string
          whatsapp_app_id: string | null
          whatsapp_app_secret: string | null
          whatsapp_enabled: boolean
          whatsapp_phone_number_id: string | null
          whatsapp_token: string | null
          whatsapp_verify_token: string
          whatsapp_waba_id: string | null
        }
        Insert: {
          created_at?: string
          instagram_app_secret?: string | null
          instagram_enabled?: boolean
          instagram_redirect_uri?: string | null
          instagram_verify_token?: string
          meta_app_id?: string | null
          meta_app_secret?: string | null
          tenant_id: string
          updated_at?: string
          whatsapp_app_id?: string | null
          whatsapp_app_secret?: string | null
          whatsapp_enabled?: boolean
          whatsapp_phone_number_id?: string | null
          whatsapp_token?: string | null
          whatsapp_verify_token?: string
          whatsapp_waba_id?: string | null
        }
        Update: {
          created_at?: string
          instagram_app_secret?: string | null
          instagram_enabled?: boolean
          instagram_redirect_uri?: string | null
          instagram_verify_token?: string
          meta_app_id?: string | null
          meta_app_secret?: string | null
          tenant_id?: string
          updated_at?: string
          whatsapp_app_id?: string | null
          whatsapp_app_secret?: string | null
          whatsapp_enabled?: boolean
          whatsapp_phone_number_id?: string | null
          whatsapp_token?: string | null
          whatsapp_verify_token?: string
          whatsapp_waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_meta_credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscriptions: {
        Row: {
          amount: number
          created_at: string
          id: string
          next_billing_at: string | null
          plan_id: string | null
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          next_billing_at?: string | null
          plan_id?: string | null
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          next_billing_at?: string | null
          plan_id?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_usage: {
        Row: {
          active_users: number
          id: string
          leads_created: number
          messages_sent: number
          month: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active_users?: number
          id?: string
          leads_created?: number
          messages_sent?: number
          month: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active_users?: number
          id?: string
          leads_created?: number
          messages_sent?: number
          month?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_usage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          favicon_url: string | null
          id: string
          logo_url: string | null
          meta_app_version: string
          name: string
          primary_color: string
          secondary_color: string
          slug: string
          status: string
          tertiary_color: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          meta_app_version?: string
          name: string
          primary_color?: string
          secondary_color?: string
          slug: string
          status?: string
          tertiary_color?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          meta_app_version?: string
          name?: string
          primary_color?: string
          secondary_color?: string
          slug?: string
          status?: string
          tertiary_color?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            foreignKeyName: "tratamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          granted: boolean
          id: string
          resource_id: string
          scope: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          granted: boolean
          id?: string
          resource_id: string
          scope: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          granted?: boolean
          id?: string
          resource_id?: string
          scope?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_numbers: {
        Row: {
          app_id: string | null
          app_secret: string | null
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean
          is_default: boolean
          phone_e164: string | null
          phone_number_id: string
          tenant_id: string
          token: string | null
          updated_at: string
          verify_token: string | null
          waba_id: string | null
        }
        Insert: {
          app_id?: string | null
          app_secret?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          phone_e164?: string | null
          phone_number_id: string
          tenant_id: string
          token?: string | null
          updated_at?: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Update: {
          app_id?: string | null
          app_secret?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          phone_e164?: string | null
          phone_number_id?: string
          tenant_id?: string
          token?: string | null
          updated_at?: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Relationships: []
      }
      whatsapp_template_logs: {
        Row: {
          action: string
          created_at: string
          http_status: number | null
          id: string
          request_payload: Json | null
          response_body: Json | null
          template_name: string | null
          tenant_id: string | null
          user_id: string | null
          waba_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          http_status?: number | null
          id?: string
          request_payload?: Json | null
          response_body?: Json | null
          template_name?: string | null
          tenant_id?: string | null
          user_id?: string | null
          waba_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          http_status?: number | null
          id?: string
          request_payload?: Json | null
          response_body?: Json | null
          template_name?: string | null
          tenant_id?: string | null
          user_id?: string | null
          waba_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      crm_leads_com_pagamento: {
        Row: {
          lead_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_tenant_metrics: { Args: { _tenant_id: string }; Returns: Json }
      can_access_instagram_account: {
        Args: { _account_id: string }
        Returns: boolean
      }
      can_access_pipeline: { Args: { _pipeline_id: string }; Returns: boolean }
      can_access_whatsapp_number: {
        Args: { _number_id: string }
        Returns: boolean
      }
      chat_media_belongs_to_current_tenant: {
        Args: { _object_name: string }
        Returns: boolean
      }
      check_duplicate_phone: {
        Args: { p_phone: string }
        Returns: {
          assigned_to: string
          lead_id: string
          lead_name: string
          pipeline_name: string
          stage_name: string
        }[]
      }
      cleanup_expired_lead_backups: { Args: never; Returns: number }
      crm_unread_leads_count: { Args: never; Returns: number }
      current_tenant_id: { Args: never; Returns: string }
      debug_audio_messages: {
        Args: { p_lead_id: string; p_limit?: number }
        Returns: {
          created_at: string
          direction: string
          media_url: string
          message_status: string
        }[]
      }
      debug_automation_queue: {
        Args: { p_hours?: number }
        Returns: {
          queue_status: string
          total: number
        }[]
      }
      debug_bot_flow: {
        Args: { p_bot_id: string }
        Returns: {
          bot_name: string
          bot_status: string
          current_version: number
          flow: Json
          total_nodes: number
        }[]
      }
      debug_bot_status: {
        Args: { p_bot_id: string; p_hours?: number }
        Returns: {
          execution_status: string
          total: number
        }[]
      }
      debug_cold_leads_in_stages: {
        Args: { p_days_cold?: number }
        Returns: {
          leads_frios: number
          pipeline_name: string
          stage_name: string
          total_leads: number
        }[]
      }
      debug_find_lead: {
        Args: { p_search: string }
        Returns: {
          assigned_to_name: string
          id: string
          last_message_at: string
          name: string
          phone: string
          pipeline_name: string
          stage_name: string
          tags: string[]
        }[]
      }
      debug_followup_conversion: {
        Args: never
        Returns: {
          leads_agendaram_depois: number
          leads_contrataram_depois: number
          taxa_agendamento: number
          taxa_contratacao: number
          template_name: string
          total_leads_alcancados: number
        }[]
      }
      debug_followup_roi: {
        Args: { p_days?: number }
        Returns: {
          entregues: number
          falhas: number
          leads_responderam_24h: number
          lidos: number
          taxa_falha: number
          taxa_resposta_apos_entrega: number
          template_name: string
          total_disparos: number
        }[]
      }
      debug_lead_messages: {
        Args: { p_lead_id: string; p_limit?: number }
        Returns: {
          content_preview: string
          created_at: string
          direction: string
          error_reason: string
          message_status: string
          message_type: string
        }[]
      }
      debug_messages_failed: {
        Args: { p_hours?: number }
        Returns: {
          content_preview: string
          created_at: string
          error_reason: string
          id: string
          lead_id: string
          lead_name: string
          lead_phone: string
          message_status: string
          message_type: string
        }[]
      }
      debug_messages_stuck: {
        Args: { p_minutes?: number }
        Returns: {
          created_at: string
          id: string
          lead_name: string
          lead_phone: string
          message_status: string
          message_type: string
          minutes_ago: number
        }[]
      }
      ensure_instagram_pipeline: {
        Args: { _tenant_id: string }
        Returns: string
      }
      get_crm_unread_leads_count: { Args: never; Returns: number }
      get_crm_unread_leads_count_by_channel: {
        Args: { _channel: string }
        Returns: number
      }
      get_lead_for_conversation: {
        Args: { _lead_id: string }
        Returns: {
          ad_account_id: string | null
          ad_account_name: string | null
          ad_id: string | null
          assigned_to: string | null
          automation_paused: boolean | null
          blocked_at: string | null
          blocked_by: string | null
          cidade: string | null
          created_at: string
          descricao_anuncio: string | null
          first_inbound_at: string | null
          follow_up_count: number | null
          has_task: boolean
          id: string
          ig_account_uuid: string | null
          imagem_origem: string | null
          instagram_profile_pic_url: string | null
          instagram_user_id: string | null
          instagram_username: string | null
          is_blocked: boolean
          last_inbound_at: string | null
          last_message: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          link_anuncio: string | null
          name: string
          nome_anuncio: string | null
          notes: string | null
          paciente_id: string | null
          phone: string | null
          pipeline_id: string
          position: number
          score: number
          servico_interesse: string | null
          source: string | null
          stage_id: string
          tags: string[] | null
          task_overdue: boolean
          tenant_id: string | null
          titulo_anuncio: string | null
          updated_at: string
          value: number | null
          whatsapp_number_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_lead_stage_history_names: {
        Args: { _lead_id: string }
        Returns: {
          color: string
          id: string
          name: string
          pipeline_id: string
        }[]
      }
      get_leads_for_calendar: {
        Args: { _lead_ids: string[] }
        Returns: {
          cidade: string
          id: string
          name: string
        }[]
      }
      get_tenant_by_slug: {
        Args: { _slug: string }
        Returns: {
          id: string
          logo_url: string
          name: string
          primary_color: string
          slug: string
        }[]
      }
      get_tenant_by_whatsapp_phone_number_id: {
        Args: { _phone_number_id: string }
        Returns: string
      }
      get_tenant_meta_app_version: {
        Args: { _tenant_id: string }
        Returns: string
      }
      get_user_primary_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      hard_delete_tenant: { Args: { _tenant_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_good_examples: {
        Args: {
          filter_cidade?: string
          filter_servico?: string
          filter_tenant?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          cidade: string
          context: string
          id: string
          ideal_reply: string
          servico: string
          similarity: number
        }[]
      }
      posvenda_dashboard_metrics: { Args: never; Returns: Json }
      recalculate_all_lead_scores:
        | { Args: never; Returns: undefined }
        | { Args: { p_batch_size?: number }; Returns: number }
      recalculate_lead_score: { Args: { p_lead_id: string }; Returns: number }
      recover_stuck_bot_executions: {
        Args: never
        Returns: {
          cleared_active: number
          cleared_expired: number
          completed_orphans: number
        }[]
      }
      restore_deleted_lead: { Args: { _backup_id: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      tenant_of_lead: { Args: { _lead_id: string }; Returns: string }
      tenant_of_message: { Args: { _message_id: string }; Returns: string }
      update_whatsapp_template_sharing: {
        Args: {
          _owner_role: Database["public"]["Enums"]["app_role"]
          _shared_roles?: Database["public"]["Enums"]["app_role"][]
          _template_id: string
        }
        Returns: {
          body_text: string | null
          buttons: Json | null
          category: string
          created_at: string
          created_by_user_id: string | null
          footer_text: string | null
          header_content: string | null
          header_type: string | null
          id: string
          language: string
          meta_template_id: string | null
          name: string
          owner_role: Database["public"]["Enums"]["app_role"] | null
          shared_roles: Database["public"]["Enums"]["app_role"][]
          status: string
          tenant_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_whatsapp_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_can: {
        Args: {
          _default: boolean
          _resource_id: string
          _scope: string
          _user_id: string
        }
        Returns: boolean
      }
      user_has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      user_override: {
        Args: { _resource_id: string; _scope: string; _user_id: string }
        Returns: boolean
      }
      verify_internal_secret: {
        Args: { _name: string; _token: string }
        Returns: boolean
      }
      watchdog_reenqueue_missing_bots: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "crc" | "gerente" | "crc_legacy" | "superadmin" | "posvenda"
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
      app_role: ["crc", "gerente", "crc_legacy", "superadmin", "posvenda"],
    },
  },
} as const

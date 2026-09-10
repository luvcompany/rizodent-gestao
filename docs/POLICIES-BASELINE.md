# Baseline das policies (RLS) — CRClin

Serve para responder, em qualquer sessão futura, à pergunta "alguma policy mudou?"
sem depender de um número solto anotado em conversa.

Como conferir: rode a consulta abaixo no banco de produção e compare linha a
linha com a tabela deste arquivo. Cada linha é `schema.tabela  quantidade  md5`,
onde o md5 cobre nome, permissive, comando, USING e WITH CHECK de todas as
policies daquela tabela. Diferença em uma linha diz exatamente qual tabela olhar.

```sql
SELECT schemaname||'.'||tablename||' '||count(*)::text||' '||
       md5(string_agg(policyname||'|'||permissive||'|'||cmd||'|'||
                      COALESCE(qual,'')||'|'||COALESCE(with_check,''),
                      E'\n' ORDER BY policyname))
FROM pg_policies WHERE schemaname IN ('public','storage')
GROUP BY schemaname, tablename ORDER BY 1;
```

O escopo é `public` + `storage`. O schema `cron` tem 2 policies da própria
extensão (`cron.job`, `cron.job_run_details`) e fica de fora de propósito.

Hash agregado das 609 linhas em 10/09/2026: `e3c7549d8bbb88e2fa75d6ba17b74ad7`.

Um hash agregado sozinho não serve para investigar: quando ele muda, é a tabela
abaixo que diz onde. Guardar só o número foi o que deixou a conferência de
10/09/2026 inconclusiva.

## Baseline em 10/09/2026 (609 policies)

```
public.access_logs 9 99b56db2cd0656b7498f2d760fa47e60
public.ad_account_map 4 c977973e3675ed674ce9a6cc5908b5e2
public.ad_creative_grupo 5 92123caf694b54b25fbfb18a53489de6
public.ad_creative_override 5 cb9f3db963edef884c80a04b742676c4
public.ad_id_mapping 8 00857968ad495001bfffb67b03895f47
public.ai_assistant_config 9 3908bcedb89cfdc1903fe79444d4f8c3
public.ai_assistant_rules 8 eea07b401715831ba171e4fcb8c3b1cb
public.ai_conversation_analysis 8 d211bf9f4ab3bc9af11aa5b063ceee49
public.ai_good_examples 7 2f930a75cec1ac8baf10b689e2818e1e
public.ai_reply_suggestions 9 2a7f94c21636f4fa65ba5153c126748e
public.api4com_calls 5 cadb430915648cefa0432725bfc2acaf
public.api4com_config 4 44ee18a3b4356dfea02c329838576c1c
public.api4com_extensions 5 11427def695503ef29ebf13db18d0ed9
public.bot_execution_logs 5 b449d92a6d61ef096bd7e4da3579c281
public.bot_executions 8 2c315e9318b3229970b4b661aca41f58
public.bot_stage_triggers 5 cf20b9ffb56ffd808ab4df23b8b8852a
public.bot_versions 4 946be23289718e36565536ea7d6e14f3
public.bots 13 16bb2910212199abea42a2e554471b25
public.clinicas 7 810e8a284407bf67b9c6fb582886132b
public.closer_pacientes 3 e38a38220649237fab3ddcd5b0bee8aa
public.closer_pagamentos 3 759ea5a435fad5a925d91ec86e85d8b4
public.crm_appointments 9 6b1b759d0904e242daf35eba44ac9981
public.crm_appointments_audit 2 97aca02d474a5768acbe1138881e17e6
public.crm_automation_executions 7 0d49459dbf2a675c6e5e0f4501498757
public.crm_automation_queue 5 d6c1a5db868622f08ad2a137b66f7317
public.crm_automations 9 7deb3d48a76a619f08977e55445a0aa4
public.crm_broadcast_recipients 8 3a18d9354ceec3c2e04d3c91e97182d4
public.crm_broadcasts 9 9f29e75a1800e9acbec32563a63c20b3
public.crm_conversation_notes 9 10589df24057493126710ab460cc5552
public.crm_custom_fields 6 ecfab631ebc05f12d7128f411bc4310f
public.crm_followup_configs 6 52a8ce9d8a1ee06264d07b661820438b
public.crm_followup_queue 8 5280bd24bcb660efb13f4bbacb92119b
public.crm_funil_cleanup_log 2 be92ffab3d6a5ee14709f22fcf175dd8
public.crm_funnel_custom_reports 6 b5cce43462ea045d20b5d47e037e151f
public.crm_lead_atribuicoes 3 11e0cf6916aac56c34ead9d7c1baf616
public.crm_lead_custom_values 8 aa7b80867cc3fd99c386ff8ad9d116ed
public.crm_lead_instagram_identities 7 9e23aeaac9758b04048844d73dcc557f
public.crm_lead_label_assignments 6 bce925756ac55ef2be235bd83bbc7a90
public.crm_lead_pacientes 8 570572857d91719586b6343d479423f2
public.crm_lead_stage_history 8 c65d2ebfe01bb31b7b7710ea7d229eb7
public.crm_leads 20 fd6af26858a6698b611c9a89fca35a29
public.crm_notification_preferences 3 f0626f2e54a50ed4173a12a65a3eccc2
public.crm_notifications 8 5ad9fd0ab3390210ef9495e9e63c0695
public.crm_pesquisa_config 2 21480a8bd30726662bd3fdd9d9a38b29
public.crm_pesquisa_respostas 2 04108d6be93f0d876789f53eb84af749
public.crm_pipelines 10 0d2f58e6175423db31b97f87b441ebab
public.crm_ponto_eventos 2 5a27a4bdc4d3bb2667dcfcba295c8eec
public.crm_quick_replies 13 b529c41a964a2b7f7aed6847f2b3f545
public.crm_rodizio_config 2 7e701aaad11c746f80e37d8058fc670c
public.crm_rodizio_membros 2 bf7e63a686c546b840bd73b697955509
public.crm_stages 11 d47aa075fc3bd1ffb571cd4805b3fb0f
public.crm_stickers 4 23036507c91a9b2354cafc8e4bf55bf6
public.crm_tasks 9 d9bc8407447127b33f12066a240d6dd8
public.crm_user_labels 5 d6ce2548cb04944f3776468c1feeec03
public.crm_whatsapp_templates 15 3cbc6895293fd5e6a05b0c1c48d96b77
public.dashboard_holidays 6 7066d04e2a69d41d14cb6775074ddf5d
public.deleted_leads_backup 7 ff0411558569033cfba69afb84ef4f4e
public.dontus_conferencia 1 1aab592512f26fed41921ae4fde0522f
public.dontus_credenciais 1 7d66d8407c4a239e45f9bce44af825d0
public.dontus_dedup_runs 2 81043d02199b4a6e295faac902a8ec1b
public.dontus_paciente_seen 1 3ce5f9e2d28aceefdab30acd058071ad
public.dontus_seen_coverage 1 345cecd16e60a4b2e38bae46fdbd7276
public.dontus_sync_runs 1 ebb368a680b09e2675370364c2818dbb
public.dontus_sync_state 1 de1e7f0cb35817d1ffbfeb7910d4b1c9
public.funnel_channels 12 e9aad29919fd5e5f074e140ec9cf9b6a
public.ig_accounts 9 ef8e08416e5e89c5ce41258eb2dbbc0a
public.instagram_accounts 8 144550c6ae8ece7ef36e67b1eb91a16e
public.instagram_messages 9 828a81f42a815fbdb8d3790626da3191
public.instagram_oauth_states 4 8039dbeb2e48dda6a84974e66566446d
public.integrations 5 31608cd56530725af88f5facc3a09795
public.kommo_contatos 1 c067fe1d708a711101092d5499f86bed
public.leads_diarios 8 606d22e22638ac495be9646dbfe05303
public.messages 21 0d68eee44a6ce56d6fa847335b41b21e
public.pacientes 9 7befe859b6b90bb68ab814d6d79565e2
public.pagamentos 8 81d28d80ab452929460ea1cb7ea47e57
public.plans 2 bca137ebd2a35a06017e6a33805d67eb
public.profiles 5 82b59864bdf061f15b5ed379ad50eb39
public.registros_diarios_atendimento 8 8812244f8f4d7983313ad025e2716e4c
public.rpt_baseline_anuncio 3 65cf814a4d68af4568cf45906dfe6442
public.tenant_api_keys 9 236a3cc6148107fcd1886b0426c0eddb
public.tenant_invoices 7 9f5629a6e2b975c3626375f516569b86
public.tenant_meta_credentials 8 e4999d971445121bf401dba48a92ebde
public.tenant_subscriptions 7 52088b02c5b0db201e56bf9f22e0e760
public.tenant_usage 7 65deed914769799422c5779727530fa2
public.tenants 2 81757427f4ea12c3c7ef48812f6b461b
public.tipos_procedimento 7 a745d9965909a5a046c9c420afd048e3
public.tratamentos 8 98655be4874cabb06455793bd7514830
public.user_permission_overrides 3 6a418b0c687a9fd58dc02cc2a8d6c425
public.user_roles 4 ee1b7f93646184bcaebe173f2868449b
public.whatsapp_call_permissions 8 acb78304e151297cb11e030bc501d873
public.whatsapp_calls 9 942c61ce392ecce5ecb187cc9a6cd633
public.whatsapp_numbers 6 d4f259c3eadfb924798d230538141247
public.whatsapp_oauth_states 4 03d1d20c58fb30f79c9f652cf7683c7e
public.whatsapp_template_logs 3 a9f33569098046a34baf5e6c94ff6e81
storage.objects 16 df0690ebea9115dc2c1e58edfced8317
```

## Verificação por comportamento (vale mais que o hash)

Rodada em 10/09/2026, em transação desfeita, com três leads de teste no Funil
Principal (um da Bia, um da Júlia, um da Bia em etapa `visivel_para_sdr = false`):

| quem            | resultado |
| --------------- | --------- |
| SDR Bia         | vê o lead dela; não vê o da Júlia |
| SDR Bia         | vê o próprio lead mesmo em etapa oculta — é o que a carência de 24 h precisa |
| CRC / gestor    | vê os três |
| anon            | vê zero leads |

O isolamento das SDRs é por dona (`crm_leads.assigned_to`), não por etapa. A
policy RESTRICTIVE de `crm_stages` esconde a ETAPA, e não o lead: por isso a SDR
continua conversando com quem já compareceu enquanto o lead for dela.

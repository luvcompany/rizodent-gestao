# Architecture rules

- Scope the CRM visual system through the `crm-ui-active` body marker so Radix portals inherit CRM styling without changing `/admin`.
- Keep tenant branding derived from `--primary-h` and `--primary-s`; semantic status colors remain independent from tenant branding.
- Keep action controls derived from the tenant's separate action color; sidebar identity and charts remain derived from the tenant primary color.
- Classify Meta ad origin from explicit referral evidence, persist referral metadata on messages, and cache ad thumbnails in tenant-scoped storage so conversation cards remain accurate and durable.
- Classify an Instagram conversation by its latest inbound interaction (`comment` or `dm`) so one lead appears in exactly one Instagram inbox at a time.- Never drop or disable `trg_normalize_lead_phone` on `crm_leads` nor revoke EXECUTE on `normalize_lead_phone`; every security/cleanup migration must keep them, because phone normalization is the only thing that stops duplicate leads (with/without the 9th digit).
- Gate every WhatsApp send on `integrations.health_status` (set by `whatsapp-health-check` cron and by account-level Meta send errors) so automations pause instead of failing repeatedly while a number is down.
- Let `whatsapp-health-check` (cron + after every WhatsApp connect/save) also subscribe the token's app to the WABA (`subscribed_apps`) and promote Meta-CONNECTED numbers from `disconnected` to `connected`, so any newly connected number receives messages without manual steps.
- Resolve the outbound WhatsApp number as: lead's chosen `whatsapp_number_id`, then the tenant's `whatsapp_numbers.is_default` number, then funnel channel / legacy `whatsapp_config`; stamp every outbound message with the number actually used.
- When showing a WhatsApp number's own phone for identification (health badges, broadcast "Vai sair por:"), format the stored E.164 as-is; never reuse `formatPhoneDisplayBR`, which completes the missing 9th digit and would print a number that does not exist.
- Every WhatsApp connection saved in `integrations` (key `whatsapp_<phone_number_id>`) is mirrored into `whatsapp_numbers` and granted to its owner world by `trg_integracao_whatsapp_numero`, so a newly connected number is immediately selectable, receives messages and is health-checked.
- Deactivating a WhatsApp number (integration deleted) only sets is_active/is_default false; never delete its user_permission_overrides, because message and lead RLS uses can_access_whatsapp_number and removing grants hides the number's history and leads from its group.

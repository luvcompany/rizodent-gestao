# Architecture rules

- Scope the CRM visual system through the `crm-ui-active` body marker so Radix portals inherit CRM styling without changing `/admin`.
- Keep tenant branding derived from `--primary-h` and `--primary-s`; semantic status colors remain independent from tenant branding.
- Keep action controls derived from the tenant's separate action color; sidebar identity and charts remain derived from the tenant primary color.
- Classify Meta ad origin from explicit referral evidence, persist referral metadata on messages, and cache ad thumbnails in tenant-scoped storage so conversation cards remain accurate and durable.
- Classify an Instagram conversation by its latest inbound interaction (`comment` or `dm`) so one lead appears in exactly one Instagram inbox at a time.- Never drop or disable `trg_normalize_lead_phone` on `crm_leads` nor revoke EXECUTE on `normalize_lead_phone`; every security/cleanup migration must keep them, because phone normalization is the only thing that stops duplicate leads (with/without the 9th digit).
- Gate every WhatsApp send on `integrations.health_status` (set by `whatsapp-health-check` cron and by account-level Meta send errors) so automations pause instead of failing repeatedly while a number is down.
- Let `whatsapp-health-check` (cron + after every WhatsApp connect/save) also subscribe the token's app to the WABA (`subscribed_apps`) and promote Meta-CONNECTED numbers from `disconnected` to `connected`, so any newly connected number receives messages without manual steps.
- Resolve the outbound WhatsApp number as: lead's chosen `whatsapp_number_id`, then the tenant's `whatsapp_numbers.is_default` number, then funnel channel / legacy `whatsapp_config`; stamp every outbound message with the number actually used.

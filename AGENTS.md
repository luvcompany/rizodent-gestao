# Architecture rules

- Scope the CRM visual system through the `crm-ui-active` body marker so Radix portals inherit CRM styling without changing `/admin`.
- Keep tenant branding derived from `--primary-h` and `--primary-s`; semantic status colors remain independent from tenant branding.
- Keep action controls derived from the tenant's separate action color; sidebar identity and charts remain derived from the tenant primary color.
- Classify Meta ad origin from explicit referral evidence, persist referral metadata on messages, and cache ad thumbnails in tenant-scoped storage so conversation cards remain accurate and durable.
- Classify an Instagram conversation by its latest inbound interaction (`comment` or `dm`) so one lead appears in exactly one Instagram inbox at a time.- Never drop or disable `trg_normalize_lead_phone` on `crm_leads` nor revoke EXECUTE on `normalize_lead_phone`; every security/cleanup migration must keep them, because phone normalization is the only thing that stops duplicate leads (with/without the 9th digit).

# Architecture rules

- Scope the CRM visual system through the `crm-ui-active` body marker so Radix portals inherit CRM styling without changing `/admin`.
- Keep tenant branding derived from `--primary-h` and `--primary-s`; semantic status colors remain independent from tenant branding.
- Keep action controls derived from the tenant's separate action color; sidebar identity and charts remain derived from the tenant primary color.
- Classify Meta ad origin from explicit referral evidence, persist referral metadata on messages, and cache ad thumbnails in tenant-scoped storage so conversation cards remain accurate and durable.
- Classify an Instagram conversation by its latest inbound interaction (`comment` or `dm`) so one lead appears in exactly one Instagram inbox at a time.
- Never drop or disable `trg_normalize_lead_phone` on `crm_leads` nor revoke EXECUTE on `normalize_lead_phone`; every security/cleanup migration must keep them, because phone normalization is the only thing that stops duplicate leads (with/without the 9th digit).
- Gate every WhatsApp send on `integrations.health_status` (set by `whatsapp-health-check` cron and by account-level Meta send errors) so automations pause instead of failing repeatedly while a number is down.
- Let `whatsapp-health-check` (cron + after every WhatsApp connect/save) also subscribe the token's app to the WABA (`subscribed_apps`) and promote Meta-CONNECTED numbers from `disconnected` to `connected`, so any newly connected number receives messages without manual steps.
- An account-level error written by the send (133010/131031/131042/"not registered") must survive the health check for 6h unless the Meta proves the cause is gone (`platform_type` CLOUD_API + CONNECTED; for a locked account also a clean WABA): CONNECTED alone does not prove registration (`_shared/saudeWhatsapp.ts`).
- Resolve the outbound WhatsApp number only through `_shared/numeroDeSaida.ts`: number of the replied/reacted message, then the number the patient wrote to in the last 24h (Meta's window is per number), then the lead's `whatsapp_number_id`, then the last inbound number, then the team's `is_default` number, funnel channel, legacy `whatsapp_config` and any active number of the team — always inside the lead's world, skipping inactive/disabled numbers. Stamp every outbound message with the number actually used. Find a number's integration by `config.phone_number_id` (the official number lives under `whatsapp_config`), never only by the key `whatsapp_<id>`.
- When showing a WhatsApp number's own phone for identification (health badges, broadcast "Vai sair por:"), format the stored E.164 as-is; never reuse `formatPhoneDisplayBR`, which completes the missing 9th digit and would print a number that does not exist.

# Inviolable rules (multi-number, multi-team, multi-tenant)

Each rule below fixed a production incident. Read them before touching WhatsApp numbers, permissions, leads or migrations; a change that contradicts one of them is a bug even if it "works" for the case at hand.

## WhatsApp numbers belong to a world, not to users
- Every row of `whatsapp_numbers` has a `mundo` (`crc` = the central team: crc, sdr, crc_legacy, posvenda; `closer` / `recepcao` = owned by `dono_user_id`). `trg_whatsapp_numbers_define_mundo` fills it; it is never null.
- Who can use a number, its messages and its leads is decided only by `can_access_whatsapp_number` (superadmin and gerente see every number of the tenant; everyone else sees the numbers of their world). `user_permission_overrides` with scope `whatsapp_number` is an explicit exception set by the superadmin, never the normal path.
- Never grant, copy, preserve or reallocate number access per user in triggers, functions or edge functions (the removed `concede_numeros_*`, `preserva_acesso_numero_whatsapp` and `realoca_leads_numero_desativado` caused conversations to vanish every time a number was added or swapped). A newly connected number works for its whole world immediately: receive, send, number selector, templates, stages.
- Every WhatsApp connection saved in `integrations` (`whatsapp_<phone_number_id>` and the legacy `whatsapp_config`) is mirrored into `whatsapp_numbers` (with its world) by `trg_integracao_whatsapp_numero`; deleting the integration only sets `is_active`/`is_default` false. Leads keep their `whatsapp_number_id` (the number's history stays visible to its world).
- A lead may only be stamped with / moved to a number of its own world (`valida_troca_numero_do_lead`, `stamp_crm_lead_whatsapp_number`, `closer_paciente_carimba_numero`).
- The default number (`is_default`) is one per tenant (unique partial index), always active and of the `crc` world; change it only through the RPC `definir_numero_padrao` (never two loose UPDATEs). When a tenant is left without an active `crc` default, `trg_whatsapp_numbers_garante_padrao` promotes the most recent active `crc` number and logs it in `access_logs` (migration 0018).
- Automations, bots, follow-ups, rodízio, transfers and broadcasts decide eligibility by WORLD (`mundo_numero_whatsapp` / `_shared/mundoNumero.ts`), never by comparing number ids.

## Sending results
- Any function that calls `send-whatsapp-message` must read the result with `_shared/envioWhatsapp.ts` (`erroDoEnvio`/`conferirEnvio`/`linhaDaFila`): it answers HTTP 200 with `{ok:false}` when Meta refuses, so `resp.ok` alone records refusals as "sent". Definitive Meta refusals (`falhaDefinitiva`) are never retried in a loop.

## One phone = one lead per world
- Phone comparisons always use `telefone_canonico()` (the exact normalization of `trg_normalize_lead_phone`); never compare the raw WhatsApp `from` (Meta sends DDD 11–28 with the 9th digit and the lead is stored without it).
- Inbound lookup (messages, echoes, calls) goes through `lead_whatsapp_existente` (world-scoped, includes legacy and inactive numbers); a duplicate created in a world that already has that phone is merged by `mesclar_lead_duplicado_mesmo_mundo` (webhook + periodic sweep).

## Security
- A function meant for cron, triggers or edge functions (service role) must, in the same migration, `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`. New functions are born without EXECUTE for anon/PUBLIC (default privileges); only `get_tenant_by_slug` and `get_public_branding` are public. Never re-grant anon.
- A user with no row in `user_roles` belongs to no tenant: `current_tenant_id()` returns null and RLS shows nothing. To remove an employee, block (`profiles.is_blocked` + Auth ban) or delete the Auth user; never leave a profile without role and unblocked.
- Only the superadmin writes `user_permission_overrides` (policy "Admins manage overrides"). What each role can do is configured in the admin panel, not hard-coded in screens or functions.
- Never weaken tenant isolation (`tenant_hard_isolation_*` restrictive policies) nor the isolation between worlds.

## Migrations
- Database changes live in `drizzle/migrations` (journal + snapshot) and are recorded in `drizzle.__drizzle_migrations`. Pushing code or deploying the frontend does not apply a migration nor redeploy edge functions.

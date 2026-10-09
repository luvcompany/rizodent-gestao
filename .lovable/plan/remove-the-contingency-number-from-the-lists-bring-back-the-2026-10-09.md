# Remove the contingency number from the lists, bring back the official number and reactivate automations

## What I found

- **Contingency still appears in "Enviar por":** the list in the conversation shows every number the user can see, including deactivated ones. The contingency number is already deactivated (along with its templates and default status), but this list never filters it out. The old "Rizodent - Comercial" number has the same problem.
- **The official number (Whatsapp - Comercial, +55 77 8114-7531) is missing from the lists:** it was saved the old way, so it doesn't appear in "Enviar por" or in the default number choice. It is connected and healthy on Meta again.
- **Automations:** the automation queue has nothing stuck. 8 automations are switched off. 25 SDR/CRC leads have "Comercial 2" set in "Enviar por", so their automations would keep going out through Comercial 2.

## What will be done

1. **"Enviar por" only lists active numbers.** Deactivated numbers (Contingência, the old Rizodent - Comercial) disappear from the conversation. I'll check the other places that list numbers too (Templates, Broadcast, Triggers, Integrations, calls) so none shows a deactivated number.
2. **The official number joins the number lists.** It appears in "Enviar por", in the default number choice and in Integrations, with access for SDR/CRC and management, like the other numbers. Its message history and leads stay as they are.
3. **The official number becomes the default number.** Comercial 2 stays available, but stops being the default. Leads with no number chosen, plus automations, bots, follow-up and broadcasts, go out through the official number.
4. **The 25 leads tied to Comercial 2 go back to "Padrão".** That way they also go out through the official number. Nothing changes in their conversations.
5. **Reactivate the 8 automations that are switched off.** Before switching them on, I'll check each one's template exists on the official number's account. If a template only exists on Comercial 2 or on the contingency number, I'll tell you its name rather than switching it on with a template that doesn't work.
6. **Check:** look at "Enviar por" and the default number choice, and confirm the next automation in the queue goes out through the official number.

## What will not change

- No messages, leads or history are deleted.
- The Closer's numbers and leads are not touched.
- The rule that pauses automations when a number goes down stays in place.

## Technical details

- `useNumerosWhatsappVisiveis` (`src/contexts/WhatsappCallContext.tsx`) gets `.eq("is_active", true)` for the selector lists; any history labels that need inactive names keep a separate lookup. Audit the other `whatsapp_numbers` reads with `rg`.
- Insert a `whatsapp_numbers` row for phone_number_id 846998725169815 (tenant RizoDent, display "Whatsapp - Comercial", is_active true, is_default true), set `is_default=false` on the rest, and grant `user_permission_overrides` for the crc/sdr/gerente group the same way `trg_integracao_whatsapp_numero` does. Do not restamp existing leads that have `whatsapp_number_id` null; `mundo_numero_whatsapp` already treats both as the CRC world.
- `update crm_leads set whatsapp_number_id = null where whatsapp_number_id = '7adc0bc0-...'` (25 rows).
- For the 8 automations where `is_active = false`: compare the template names in their config against `crm_whatsapp_templates` for the official WABA, then set `is_active = true` for those that pass.
- Check send resolution in `send-whatsapp-message`: when the lead has no number, it uses the `is_default` number, which is then the official one, with `whatsapp_config` credentials.

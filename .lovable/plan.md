# Fix: message to the official number created a duplicate lead (VITOR SANTOS)

## What happened (confirmed)

- VITOR SANTOS (557788639272) already exists in the CRM as a lead for Bia in Funil Principal (created in July). That lead is tagged with the number "Rizodent - Comercial 2", because that was the last number used to talk to him.
- The test message came in today at 16:31 through the official number (+55 77 8114-7531).
- The system looks up the existing lead differently for each number. The official number is still saved the old way and isn't on the system's list of numbers. For that kind of number, the lookup only finds leads that have no number set. Vitor's lead is tagged "Comercial 2", so it wasn't found, and a new lead was created. That lead went to the "Outros" funnel and was handed to Kelly by the rotation.
- The fix from earlier (reuse the SDR/CRC group's lead) only covered numbers already on that list (contingency, Comercial 2). The official number was left out because it is saved the old way.
- There is also a Vitor lead for the Closer. It belongs to a different group and stays separate, as agreed before.

## What will be done

1. **Fix the lookup for every SDR/CRC group number, including the official one.** When a message reaches any number in the SDR/CRC group, the system will look for the lead across the whole group: leads with no number set plus leads from any of the group's numbers. It will only create a new lead if none exists. The Closer and Recepção numbers keep looking only within their own group.
2. **Apply the same rule to the other places that look up a lead by phone** inside the WhatsApp receiver (handling a lead created at the same moment, and linking calls). Then no other path can create a duplicate this way.
3. **Merge the new Vitor lead** (Kelly, "Outros") into the original lead (Bia, Funil Principal), using the same method as earlier merges. The message, history and other items move to the original lead, and the copy goes to the trash for 90 days.
4. **Check other duplicates since the official number was reconnected.** Find every lead created today by a message to the official number whose phone already existed in the SDR/CRC group, and merge them the same way. I'll tell you the names before merging if there are more than just Vitor.
5. **Record the rule** in the project's architecture notes: within one group, the same phone number is always the same lead, whatever number the person writes to.

## What will not change

- Phone number normalization (the anti-duplicate rule) stays as it is.
- The Closer's lead for Vitor is not touched.
- No changes to screens, permissions or the rotation.

## Check

- After the fix, you send another test message to the official number and to Comercial 2 from the same phone. Both should appear in the same Vitor lead, with no new lead created.

## Technical details

- File: `supabase/functions/whatsapp-webhook/index.ts`, lead lookup around lines 1350-1390. Today the `else` branch (where `waNumberId` is null, as with `whatsapp_config` / phone_number_id 846998725169815) filters `whatsapp_number_id IS NULL`. It will instead resolve the group from `matchedIntegration.owner_role`. For the crc/sdr/crc_legacy group it will use the same filter as the registered-number branch: null + the ids from `whatsapp_numbers` of every crc/sdr integration. This logic moves into a single helper reused by the two lookups (around lines 1490-1545) and by call linking (around line 308).
- The oldest lead in the group wins (`created_at asc`), as today.
- Merge using the same steps as previous merges: repoint messages, notes, tasks, appointments, stage history, labels and calls to `352cd875-...`, then soft-delete `2f787a60-...` with a backup.
- Then deploy `whatsapp-webhook`.
- Add a rule to AGENTS.md: "Inbound WhatsApp lead lookup is scoped per world (CRC/SDR shares all its numbers, legacy `whatsapp_config` included), never per individual number, so one phone maps to one lead per world."

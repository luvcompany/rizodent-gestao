// Canal de atendimento CANÔNICO do lead.
//
// Antes, "é Instagram?" era inferido de 5 formas inconsistentes espalhadas pelo
// código (instagram_user_id, UUID de pipeline hardcoded, is_instagram, string
// `source`...). Aqui centralizamos numa única regra, genérica e multi-tenant:
//
//   1. `active_channel` é a FONTE DA VERDADE quando definido (é o que a
//      transferência IG→WhatsApp grava). Vale 'whatsapp' | 'instagram'.
//   2. Sem `active_channel` (leads legados), cai na inferência confiável:
//      tem `instagram_user_id` ⇒ Instagram; senão ⇒ WhatsApp.
//
// Nunca usar UUID de pipeline hardcoded nem a string `source` como sinal de canal.

export type LeadChannel = "whatsapp" | "instagram";

type ChannelLead = {
  active_channel?: string | null;
  instagram_user_id?: string | null;
} | null | undefined;

export function getLeadChannel(lead: ChannelLead): LeadChannel {
  const ac = lead?.active_channel;
  if (ac === "whatsapp" || ac === "instagram") return ac;
  return lead?.instagram_user_id ? "instagram" : "whatsapp";
}

export function isInstagramLead(lead: ChannelLead): boolean {
  return getLeadChannel(lead) === "instagram";
}

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { destinoDoLead, destinoParaMeta, telefoneCanonico, waIdDoWamid } from "./destinoWhatsapp.ts";

// wamids reais do lead Gilma (15/10/2026).
const RECEBIDA = "wamid.HBgNNTUxMTkzMzI0NjA1NxUCABIYIEFDNTRFNTIzREUzMjNGOUE3REZDNkVDN0M1RUQ3Qzg2AA==";
const ENVIADA_FALHOU = "wamid.HBgMNTUxMTMzMjQ2MDU3FQIAERgSNTdGOUU3OUY1NEMzNEE4M0M4AA==";

Deno.test("waIdDoWamid lê o WhatsApp ID de dentro do wamid", () => {
  assertEquals(waIdDoWamid(RECEBIDA), "5511933246057");
  assertEquals(waIdDoWamid(ENVIADA_FALHOU), "551133246057");
  assertEquals(waIdDoWamid("api4com:abc"), null);
  assertEquals(waIdDoWamid("wamid.@@@"), null);
  assertEquals(waIdDoWamid(null), null);
});

Deno.test("telefoneCanonico espelha public.telefone_canonico", () => {
  assertEquals(telefoneCanonico("5511933246057"), "551133246057");
  assertEquals(telefoneCanonico("(73) 99944-5011"), "557399445011");
  assertEquals(telefoneCanonico("557399445011"), "557399445011");
  assertEquals(telefoneCanonico(""), "");
});

Deno.test("destinoParaMeta: usa o ID de onde o paciente escreveu", () => {
  assertEquals(destinoParaMeta("551133246057", "5511933246057"), "5511933246057");
  // ID de outro telefone (lead mesclado) não vale.
  assertEquals(destinoParaMeta("557399445011", "5511933246057"), "557399445011");
});

Deno.test("destinoParaMeta: DDD 11 a 28 sem histórico ganha o 9", () => {
  assertEquals(destinoParaMeta("551133246057"), "5511933246057");
  assertEquals(destinoParaMeta("552899990000"), "5528999990000");
  // DDD 31+ fica como está (a Meta resolve e muitos IDs são sem o 9).
  assertEquals(destinoParaMeta("557399445011"), "557399445011");
  assertEquals(destinoParaMeta("553133246057"), "553133246057");
  // Estrangeiro / fora do padrão: intocado.
  assertEquals(destinoParaMeta("14155550100"), "14155550100");
  assertEquals(destinoParaMeta(""), "");
});

Deno.test("destinoDoLead busca o ID no inbound do lead", async () => {
  const supa = {
    from: () => {
      const q: any = {
        select: () => q, eq: () => q, like: () => q, order: () => q,
        limit: async () => ({ data: [{ whatsapp_message_id: "api4com:x" }, { whatsapp_message_id: RECEBIDA }] }),
      };
      return q;
    },
  };
  assertEquals(await destinoDoLead(supa, "lead", "551133246057"), "5511933246057");
  assertEquals(await destinoDoLead(supa, null, "557399445011"), "557399445011");
});

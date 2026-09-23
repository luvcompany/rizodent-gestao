import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { avisarLidaEDigitando } from "./digitando.ts";

/**
 * As guardas existem para o webhook NUNCA gastar chamada nem tempo à toa —
 * e, acima de tudo, para nunca lançar dentro do caminho de entrada.
 */

Deno.test("sem credencial, sem wamid ou com id de saída: nem tenta", async () => {
  const original = globalThis.fetch;
  let chamou = false;
  globalThis.fetch = (() => {
    chamou = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    assertEquals(await avisarLidaEDigitando({ phoneNumberId: "", token: "t", wamid: "wamid.X" }), false);
    assertEquals(await avisarLidaEDigitando({ phoneNumberId: "1", token: "", wamid: "wamid.X" }), false);
    assertEquals(await avisarLidaEDigitando({ phoneNumberId: "1", token: "t", wamid: null }), false);
    // id que não é de mensagem recebida (a Meta devolveria 131009)
    assertEquals(await avisarLidaEDigitando({ phoneNumberId: "1", token: "t", wamid: "abc123" }), false);
    assertEquals(chamou, false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("Meta recusando não vira exceção — devolve false", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ error: { code: 131009 } }), { status: 400 }))) as typeof fetch;
  try {
    assertEquals(await avisarLidaEDigitando({ phoneNumberId: "1", token: "t", wamid: "wamid.ABC" }), false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("rede caindo não vira exceção — devolve false", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("boom"))) as typeof fetch;
  try {
    assertEquals(await avisarLidaEDigitando({ phoneNumberId: "1", token: "t", wamid: "wamid.ABC" }), false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("caminho feliz: um POST e true", async () => {
  const original = globalThis.fetch;
  let url = "";
  let corpo: any = null;
  globalThis.fetch = ((u: string | URL | Request, init?: RequestInit) => {
    url = String(u);
    corpo = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }) as typeof fetch;
  try {
    assertEquals(await avisarLidaEDigitando({ phoneNumberId: "999", token: "t", wamid: "wamid.ABC" }), true);
    assertEquals(url, "https://graph.facebook.com/v25.0/999/messages");
    assertEquals(corpo.status, "read");
    assertEquals(corpo.message_id, "wamid.ABC");
    assertEquals(corpo.typing_indicator.type, "text");
  } finally {
    globalThis.fetch = original;
  }
});

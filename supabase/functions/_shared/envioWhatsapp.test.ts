import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { erroDoEnvio } from "./envioWhatsapp.ts";

Deno.test("envio que saiu: null", () => {
  assertEquals(erroDoEnvio(200, JSON.stringify({ success: true, message: { id: "x" } })), null);
});

Deno.test("Meta recusou com HTTP 200 e ok:false: é falha (antes contava como enviado)", () => {
  const r = erroDoEnvio(200, JSON.stringify({ ok: false, error: "Janela de 24h expirada.", error_code: 131047 }));
  assertEquals(r, "131047 - Janela de 24h expirada.");
});

Deno.test("número desconectado: adiar", () => {
  assertEquals(
    erroDoEnvio(200, JSON.stringify({ ok: false, error: "WhatsApp desconectado", error_code: "whatsapp_disconnected" })),
    "WHATSAPP_DISCONNECTED",
  );
});

Deno.test("limite da Meta vira reenvio com espera", () => {
  const r = erroDoEnvio(200, JSON.stringify({ ok: false, error: "rate", error_code: 130429 })) ?? "";
  assertEquals(/Rate limit exceeded[^]*?Retry after (\d+)\s*ms/i.test(r), true);
});

Deno.test("erro HTTP do próprio envio", () => {
  assertEquals(erroDoEnvio(400, JSON.stringify({ error: "Lead sem telefone cadastrado" })), "400 - Lead sem telefone cadastrado");
});

import { falhaDefinitiva, linhaDaFila } from "./envioWhatsapp.ts";

Deno.test("falha definitiva: janela fechada, opt-out, sem telefone; temporária: rede", () => {
  assertEquals(falhaDefinitiva("send_template: 131047 - Janela de 24h expirada."), true);
  assertEquals(falhaDefinitiva("131050 - opt-out"), true);
  assertEquals(falhaDefinitiva("lead sem telefone — lembrete não enviado"), true);
  assertEquals(falhaDefinitiva("500 - DB insert error"), false);
});

Deno.test("linha da fila: saiu, desconectado e recusado", () => {
  assertEquals(linhaDaFila({ ok: true }).status, "sent");
  assertEquals(linhaDaFila({ ok: false, erro: "WHATSAPP_DISCONNECTED" }).status, "pending");
  assertEquals(linhaDaFila({ ok: false, erro: "131047 - Janela" }).status, "failed");
});

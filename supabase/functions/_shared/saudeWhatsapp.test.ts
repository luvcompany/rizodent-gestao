import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  e164DaMeta,
  manterErroDoEnvio,
  MOTIVO_ENVIO_CONTA_BLOQUEADA,
  MOTIVO_ENVIO_NAO_REGISTRADO,
  MOTIVO_ENVIO_PAGAMENTO,
} from "./saudeWhatsapp.ts";

const AGORA = new Date("2026-10-09T18:00:00Z").getTime();
const ha = (horas: number) => new Date(AGORA - horas * 3600 * 1000).toISOString();

const conectadoRegistrado = { health_status: "ok", meta_status: "CONNECTED", platform_type: "CLOUD_API", waba_ok: true };
const conectadoSemRegistro = { health_status: "ok", meta_status: "CONNECTED", platform_type: "NOT_APPLICABLE", waba_ok: true };

Deno.test("erro 'não registrado' do envio: CONNECTED sozinho não apaga", () => {
  const gravado = { health_status: "error", health_reason: MOTIVO_ENVIO_NAO_REGISTRADO, health_checked_at: ha(1) };
  assertEquals(manterErroDoEnvio(gravado, conectadoSemRegistro, AGORA), true);
  assertEquals(manterErroDoEnvio(gravado, { ...conectadoRegistrado, platform_type: null }, AGORA), true);
});

Deno.test("erro 'não registrado' do envio: registrado na API de nuvem apaga", () => {
  const gravado = { health_status: "error", health_reason: MOTIVO_ENVIO_NAO_REGISTRADO, health_checked_at: ha(1) };
  assertEquals(manterErroDoEnvio(gravado, conectadoRegistrado, AGORA), false);
});

Deno.test("conta bloqueada: precisa do registro E da conta (WABA) sem bloqueio", () => {
  const gravado = { health_status: "error", health_reason: MOTIVO_ENVIO_CONTA_BLOQUEADA, health_checked_at: ha(2) };
  assertEquals(manterErroDoEnvio(gravado, { ...conectadoRegistrado, waba_ok: null }, AGORA), true);
  assertEquals(manterErroDoEnvio(gravado, conectadoRegistrado, AGORA), false);
});

Deno.test("pagamento: segura as 6 h (a Meta não expõe prova)", () => {
  const gravado = { health_status: "error", health_reason: MOTIVO_ENVIO_PAGAMENTO, health_checked_at: ha(5.9) };
  assertEquals(manterErroDoEnvio(gravado, conectadoRegistrado, AGORA), true);
});

Deno.test("depois de 6 h a checagem volta a mandar", () => {
  const gravado = { health_status: "error", health_reason: MOTIVO_ENVIO_NAO_REGISTRADO, health_checked_at: ha(6) };
  assertEquals(manterErroDoEnvio(gravado, conectadoSemRegistro, AGORA), false);
});

Deno.test("erro gravado pela própria checagem ou token não é segurado", () => {
  for (const motivo of ["Desconectado da Meta", "Token expirado ou inválido", null]) {
    const gravado = { health_status: "error", health_reason: motivo, health_checked_at: ha(1) };
    assertEquals(manterErroDoEnvio(gravado, conectadoRegistrado, AGORA), false);
  }
  const ok = { health_status: "ok", health_reason: null, health_checked_at: ha(1) };
  assertEquals(manterErroDoEnvio(ok, conectadoSemRegistro, AGORA), false);
});

Deno.test("checagem que acha erro grava o dela (não segura)", () => {
  const gravado = { health_status: "error", health_reason: MOTIVO_ENVIO_NAO_REGISTRADO, health_checked_at: ha(1) };
  assertEquals(manterErroDoEnvio(gravado, { ...conectadoSemRegistro, health_status: "error" }, AGORA), false);
});

Deno.test("e164DaMeta: como a Meta exibe, sem mexer no 9º dígito", () => {
  assertEquals(e164DaMeta("+55 77 8108-5179"), "+557781085179");
  assertEquals(e164DaMeta("+55 77 98108-5179"), "+5577981085179");
  assertEquals(e164DaMeta("77 8108-5179"), "+557781085179");
  assertEquals(e164DaMeta("+1 555-010-0199"), "+15550100199");
  assertEquals(e164DaMeta(""), null);
  assertEquals(e164DaMeta(null), null);
  assertEquals(e164DaMeta("12345"), null);
});

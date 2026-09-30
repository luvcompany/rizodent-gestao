import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decidirFollowUp } from "./reguaFollowUp.ts";

const AGORA = new Date("2026-09-30T18:00:00Z").getTime();
const UMA_HORA = 60 * 60 * 1000;
const iso = (h: number) => new Date(AGORA - h * UMA_HORA).toISOString();

Deno.test("nunca respondeu, mas nós falamos há mais que o prazo: COBRA (o defeito de 30/09)", () => {
  const d = decidirFollowUp({ lastInboundAt: null, lastOutboundAt: iso(30) }, AGORA, 24 * UMA_HORA);
  assertEquals(d.cobrar, true);
  assertEquals(d.nuncaRespondeu, true);
});

Deno.test("o lead falou por último: NÃO cobra — a dívida é responder", () => {
  const d = decidirFollowUp({ lastInboundAt: iso(2), lastOutboundAt: iso(5) }, AGORA, UMA_HORA);
  assertEquals(d.cobrar, false);
  assertEquals(d.motivo, "a vez é nossa");
});

Deno.test("ninguém falou nada: NÃO cobra", () => {
  assertEquals(decidirFollowUp({ lastInboundAt: null, lastOutboundAt: null }, AGORA, UMA_HORA).cobrar, false);
});

Deno.test("respondeu antes e nós falamos depois: cobra só depois do prazo", () => {
  const estado = { lastInboundAt: iso(10), lastOutboundAt: iso(9) };
  assertEquals(decidirFollowUp(estado, AGORA, 24 * UMA_HORA).cobrar, false);
  assertEquals(decidirFollowUp(estado, AGORA, 8 * UMA_HORA).cobrar, true);
  assertEquals(decidirFollowUp(estado, AGORA, 8 * UMA_HORA).nuncaRespondeu, false);
});

Deno.test("data podre não vira cobrança", () => {
  assertEquals(decidirFollowUp({ lastInboundAt: null, lastOutboundAt: "não é data" }, AGORA, UMA_HORA).cobrar, false);
});

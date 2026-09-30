import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { botDeveParar } from "./etapaDoBot.ts";

const FOLLOWUP = "etapa-follow-up";
const CONVERSANDO = "etapa-conversando";
const RELACIONAMENTO = "etapa-relacionamento";

Deno.test("saiu para Relacionamento: PARA (caso Genilmar, 30/09)", () => {
  assertEquals(botDeveParar({ stageAtual: RELACIONAMENTO, stageDaAutomacao: FOLLOWUP }), true);
});

Deno.test("devolvido para Conversando: PARA (caso Genilson, 30/09)", () => {
  assertEquals(botDeveParar({ stageAtual: CONVERSANDO, stageDaAutomacao: FOLLOWUP }), true);
});

Deno.test("continua na etapa que o iniciou: segue", () => {
  assertEquals(botDeveParar({ stageAtual: FOLLOWUP, stageDaAutomacao: FOLLOWUP }), false);
});

Deno.test("foi o próprio bot que moveu: segue", () => {
  assertEquals(
    botDeveParar({ stageAtual: CONVERSANDO, stageDaAutomacao: FOLLOWUP, stageDoBot: CONVERSANDO }),
    false,
  );
  // mas se depois um humano move para OUTRA etapa, para
  assertEquals(
    botDeveParar({ stageAtual: RELACIONAMENTO, stageDaAutomacao: FOLLOWUP, stageDoBot: CONVERSANDO }),
    true,
  );
});

Deno.test("bot iniciado à mão não pertence a etapa nenhuma: segue", () => {
  assertEquals(botDeveParar({ stageAtual: RELACIONAMENTO, stageDaAutomacao: null }), false);
});

Deno.test("sem etapa atual não inventa cancelamento", () => {
  assertEquals(botDeveParar({ stageAtual: null, stageDaAutomacao: FOLLOWUP }), false);
});

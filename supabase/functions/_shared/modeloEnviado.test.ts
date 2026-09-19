import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatarDataDoModelo, registroDoModeloEnviado, textoAntesDoMarcador } from "./modeloEnviado.ts";

const consulta = { scheduled_date: "2026-09-21", scheduled_time: "09:00:00" };

Deno.test("data com dia da semana no lugar comum (21/09/2026 é segunda)", () => {
  assertEquals(formatarDataDoModelo(consulta, "Seu agendamento está marcado:\n\n🗓️ "), "Segunda, 21/09 às 09:00");
  assertEquals(formatarDataDoModelo({ scheduled_date: "2026-09-19", scheduled_time: "09:00" }, ""), "Sábado, 19/09 às 09:00");
});

Deno.test("'amanhã às {{2}}' só vira a hora quando a consulta É amanhã", () => {
  assertEquals(formatarDataDoModelo(consulta, "confirmar o seu atendimento de amanhã às ", "2026-09-20"), "09:00");
  assertEquals(formatarDataDoModelo(consulta, "confirmar o seu atendimento de amanhã às ", "2026-09-17"), "09:00 de segunda, 21/09");
  assertEquals(formatarDataDoModelo(consulta, "um encontro marcado aqui na clínica às", "2026-09-20"), "09:00 de segunda, 21/09");
});

Deno.test("'hoje {{2}}' / 'amanhã {{2}}' vira 'às HH:MM' só quando bate", () => {
  assertEquals(formatarDataDoModelo(consulta, "Sua consulta está marcada para hoje ", "2026-09-21"), "às 09:00");
  assertEquals(formatarDataDoModelo(consulta, "consulta agendada para amanhã ", "2026-09-20"), "às 09:00");
  assertEquals(formatarDataDoModelo(consulta, "Sua consulta está marcada para hoje ", "2026-09-19"), "às 09:00 de segunda, 21/09");
  // sem saber o dia de hoje, nunca encurta
  assertEquals(formatarDataDoModelo(consulta, "consulta agendada para amanhã "), "às 09:00 de segunda, 21/09");
});

Deno.test("palavra que só TERMINA em 'as' não é 'às'", () => {
  assertEquals(formatarDataDoModelo(consulta, "todas as "), "Segunda, 21/09 às 09:00");
  assertEquals(formatarDataDoModelo(consulta, "previsto para "), "Segunda, 21/09 às 09:00");
});

Deno.test("sem hora: nunca devolve só 'às' — cai na data completa", () => {
  const semHora = { scheduled_date: "2026-09-21", scheduled_time: null };
  assertEquals(formatarDataDoModelo(semHora, "amanhã às ", "2026-09-20"), "Segunda, 21/09");
  assertEquals(formatarDataDoModelo(semHora, ""), "Segunda, 21/09");
  assertEquals(formatarDataDoModelo(null, ""), null);
});

Deno.test("texto antes do marcador", () => {
  assertEquals(textoAntesDoMarcador("Oi {{1}}, amanhã às {{2}}.", 2), "Oi {{1}}, amanhã às ");
  assertEquals(textoAntesDoMarcador("Oi {{1}}", 2), "");
  assertEquals(textoAntesDoMarcador(null, 2), "");
});

Deno.test("registro = exatamente o que a Meta montou com os parâmetros enviados", () => {
  const modelo = {
    name: "agendamentovca",
    header_type: null,
    header_content: null,
    body_text: "Oi, {{1}}! Seu agendamento na Rizodent está marcado:\n\n🗓️ {{2}}\n🦷 Check-up",
    footer_text: null,
    buttons: [{ type: "QUICK_REPLY", text: "Sim, confirmo" }],
  };
  const componentes = [{ type: "body", parameters: [{ type: "text", text: "Vitor Santos" }, { type: "text", text: "Segunda, 21/09 às 09:00" }] }];
  const r = registroDoModeloEnviado(modelo, componentes);
  assertEquals(r.body, "Oi, Vitor Santos! Seu agendamento na Rizodent está marcado:\n\n🗓️ Segunda, 21/09 às 09:00\n🦷 Check-up");
  assertEquals(r.params, ["Vitor Santos", "Segunda, 21/09 às 09:00"]);
  assertEquals(r.nome, "agendamentovca");
  assertEquals(r.origem, "envio");
});

Deno.test("valor com '$&' ou '$1' entra literal (não é padrão de substituição)", () => {
  const r = registroDoModeloEnviado({ name: "x", body_text: "Oi {{1}}" }, [{ type: "body", parameters: [{ text: "R$ 1,00 $& $1" }] }]);
  assertEquals(r.body, "Oi R$ 1,00 $& $1");
});

Deno.test("modelo sem variável e sem componentes fica igual ao texto do modelo", () => {
  const r = registroDoModeloEnviado({ name: "boas_vindas", body_text: "Seu cafezinho já está reservado ☕", header_type: "VIDEO", header_content: "https://x/y.mp4" }, [
    { type: "header", parameters: [{ type: "video", video: { link: "https://assinado" } }] },
  ]);
  assertEquals(r.body, "Seu cafezinho já está reservado ☕");
  // o link que foi para a Meta, não o do cadastro
  assertEquals(r.header_content, "https://assinado");
  assertEquals(r.params, []);
});

Deno.test("cabeçalho de texto com variável é preenchido", () => {
  const r = registroDoModeloEnviado({ name: "x", header_type: "TEXT", header_content: "Olá {{1}}", body_text: "corpo" }, [
    { type: "header", parameters: [{ type: "text", text: "Ana" }] },
  ]);
  assertEquals(r.header_content, "Olá Ana");
});

Deno.test("mídia sem componente de cabeçalho: fica o ponteiro do cadastro", () => {
  const r = registroDoModeloEnviado({ name: "x", header_type: "IMAGE", header_content: "https://storage/a.jpg", body_text: "oi" }, []);
  assertEquals(r.header_content, "https://storage/a.jpg");
});

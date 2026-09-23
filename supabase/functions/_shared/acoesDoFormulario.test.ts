import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aplicarRespostaDoFormulario, lerRespostaDoFormulario, rotuloDoQuando } from "./acoesDoFormulario.ts";

/**
 * O que estes testes protegem: a resposta do paciente não pode virar desfecho
 * automático, e nenhuma falha pode subir para o webhook.
 */

Deno.test("lê a resposta como string JSON, e aguenta lixo", () => {
  const r = lerRespostaDoFormulario('{"presenca":"remarcar","motivo":"  trabalho  ","flow_token":"L|A","extra":"x"}');
  assertEquals(r.presenca, "remarcar");
  assertEquals(r.motivo, "trabalho");
  assertEquals(r.flowToken, "L|A");
  assertEquals(rotuloDoQuando("2026-09-25|manha"), "Sexta, 25/09 de manhã");
  assertEquals(rotuloDoQuando("2026-09-26|tarde"), "Sábado, 26/09 à tarde");
  assertEquals(rotuloDoQuando(null), null);
  assertEquals(r.extras, { extra: "x" });

  const vazio = lerRespostaDoFormulario("não é json");
  assertEquals(vazio.presenca, null);
  assertEquals(vazio.motivo, null);
  assertEquals(vazio.extras, {});
});

/** Banco de mentira: guarda o que foi chamado, sem rede. */
function bancoFalso(opcoes: { consulta?: any; etapas?: any[]; funis?: any[]; lead?: any } = {}) {
  const chamadas: any[] = [];
  const tabela = (nome: string) => {
    const estado: any = { nome, filtros: {}, chamadas };
    const api: any = {
      select: () => api,
      eq: (campo: string, valor: unknown) => { estado.filtros[campo] = valor; return api; },
      in: () => api,
      order: () => api,
      limit: () => Promise.resolve({ data: nome === "crm_appointments" ? (opcoes.consulta ? [opcoes.consulta] : []) : [] }),
      maybeSingle: () => {
        if (nome === "crm_appointments") return Promise.resolve({ data: opcoes.consulta ?? null });
        if (nome === "crm_leads") return Promise.resolve({ data: opcoes.lead ?? { pipeline_id: "p1", tenant_id: "t1", stage_id: "s0", assigned_to: "u1", name: "Ana" } });
        return Promise.resolve({ data: null });
      },
      insert: (linha: any) => { chamadas.push({ tabela: nome, op: "insert", linha }); return Promise.resolve({ data: null, error: null }); },
      update: (campos: any) => {
        chamadas.push({ tabela: nome, op: "update", campos });
        const upd: any = {
          eq: () => upd,
          select: () => Promise.resolve({ data: [{ id: "x" }] }),
        };
        return upd;
      },
      then: (ok: (r: unknown) => void) => ok({ data: nome === "crm_stages" ? (opcoes.etapas ?? []) : nome === "crm_pipelines" ? (opcoes.funis ?? []) : [] }),
    };
    return api;
  };
  return { from: (nome: string) => tabela(nome), chamadas };
}

Deno.test("confirmo: confirma a consulta pendente e anota", async () => {
  const db = bancoFalso({ consulta: { id: "a1", status: "pending", scheduled_date: "2026-09-25", scheduled_time: "09:00:00" } });
  const feito = await aplicarRespostaDoFormulario(db as any, {
    leadId: "l1",
    resposta: { presenca: "confirmo", motivo: null, quando: null, flowToken: "l1|a1" },
  });
  assertEquals(feito, "consulta confirmada");
  const atualizou = db.chamadas.find((c) => c.tabela === "crm_appointments" && c.op === "update");
  assertEquals(atualizou.campos.status, "confirmed");
});

Deno.test("desistir: NÃO dá desfecho — só anota e notifica", async () => {
  const db = bancoFalso({ consulta: { id: "a1", status: "confirmed", scheduled_date: "2026-09-25", scheduled_time: null } });
  const feito = await aplicarRespostaDoFormulario(db as any, {
    leadId: "l1",
    resposta: { presenca: "desistir", motivo: "achei caro", quando: null, flowToken: "l1|a1" },
  });
  assertEquals(feito, "desistência registrada");
  // nada de update em consulta nem em lead
  assertEquals(db.chamadas.some((c) => c.op === "update"), false);
  assertEquals(db.chamadas.some((c) => c.tabela === "crm_notifications" && c.op === "insert"), true);
});

Deno.test("remarcar sem etapa Reagendar: anota e não move", async () => {
  const db = bancoFalso({ consulta: null, etapas: [{ id: "s1", name: "Agendado" }], funis: [] });
  const feito = await aplicarRespostaDoFormulario(db as any, {
    leadId: "l1",
    resposta: { presenca: "remarcar", motivo: null, quando: "2026-09-25|manha", flowToken: null },
  });
  assertEquals(feito, "sem etapa Reagendar");
  assertEquals(db.chamadas.some((c) => c.tabela === "crm_leads" && c.op === "update"), false);
});

Deno.test("escolha desconhecida ou banco quebrado não lança", async () => {
  const db = bancoFalso();
  assertEquals(
    await aplicarRespostaDoFormulario(db as any, { leadId: "l1", resposta: { presenca: "outra", motivo: null, quando: null, flowToken: null } }),
    "escolha desconhecida: outra",
  );
  const quebrado = { from: () => { throw new Error("banco caiu"); } };
  assertEquals(
    await aplicarRespostaDoFormulario(quebrado as any, { leadId: "l1", resposta: { presenca: "confirmo", motivo: null, quando: null, flowToken: null } }),
    "erro",
  );
});

Deno.test("remarcar duas vezes: diz que já estava em espera, não 'sem etapa'", async () => {
  const db = bancoFalso({
    consulta: null,
    etapas: [{ id: "s9", name: "Reagendar" }],
    lead: { pipeline_id: "p1", tenant_id: "t1", stage_id: "s9", assigned_to: "u1", name: "Ana" },
  });
  const feito = await aplicarRespostaDoFormulario(db as any, {
    leadId: "l1",
    resposta: { presenca: "remarcar", motivo: null, quando: "2026-09-25|tarde", flowToken: null },
  });
  assertEquals(feito, "já estava em Reagendar");
  assertEquals(db.chamadas.some((c) => c.tabela === "crm_leads" && c.op === "update"), false);
});

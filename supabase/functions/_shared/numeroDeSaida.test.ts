import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { numeroDeSaida } from "./numeroDeSaida.ts";

// Retrato do tenant Rizodent em 09/10/2026 (ids encurtados).
const T = "rizodent";
const CLOSER = "user-closer";
const OFICIAL = "num-oficial";
const COMERCIAL2 = "num-comercial-2";
const CONTINGENCIA = "num-contingencia";
const CLOSER_ATIVO = "num-closer";
const CLOSER_ANTIGO = "num-closer-antigo";

function cenario(opts: {
  entradas?: { lead_id: string; whatsapp_number_id: string; created_at: string }[];
  mensagens?: { id: string; lead_id: string; whatsapp_number_id: string }[];
  comercial2Desativado?: boolean;
} = {}) {
  const tabelas: Record<string, Record<string, unknown>[]> = {
    whatsapp_numbers: [
      { id: OFICIAL, tenant_id: T, phone_number_id: "846998725169815", mundo: "crc", dono_user_id: null, is_active: true, is_default: true, token: "tk-num", created_at: "2026-10-09" },
      { id: COMERCIAL2, tenant_id: T, phone_number_id: "1379479318578791", mundo: "crc", dono_user_id: null, is_active: true, is_default: false, token: "tk-num", created_at: "2026-10-05" },
      { id: CONTINGENCIA, tenant_id: T, phone_number_id: "1440612142459013", mundo: "crc", dono_user_id: null, is_active: false, is_default: false, token: "tk-num", created_at: "2026-09-01" },
      { id: CLOSER_ATIVO, tenant_id: T, phone_number_id: "1348609001677203", mundo: "closer", dono_user_id: CLOSER, is_active: true, is_default: false, token: "tk-num", created_at: "2026-10-01" },
      { id: CLOSER_ANTIGO, tenant_id: T, phone_number_id: "1326232703900018", mundo: "closer", dono_user_id: CLOSER, is_active: false, is_default: false, token: "tk-num", created_at: "2026-08-01" },
    ],
    integrations: [
      { tenant_id: T, key: "whatsapp_config", status: "connected", owner_role: "crc", config: { phone_number_id: "846998725169815", access_token: "tk-oficial" } },
      { tenant_id: T, key: "whatsapp_1379479318578791", status: opts.comercial2Desativado ? "disabled" : "connected", owner_role: "crc", config: { phone_number_id: "1379479318578791", access_token: "tk-c2" } },
      { tenant_id: T, key: "whatsapp_1348609001677203", status: "connected", owner_role: "closer", config: { phone_number_id: "1348609001677203", access_token: "tk-closer" } },
    ],
    messages: [
      ...(opts.entradas ?? []).map((e) => ({ ...e, direction: "inbound", id: `in-${e.created_at}` })),
      ...(opts.mensagens ?? []).map((m) => ({ ...m, direction: "inbound", created_at: "2000-01-01" })),
    ],
    funnel_channels: [],
  };
  return {
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] === v); return q; },
        like: (c: string, padrao: string) => {
          const re = new RegExp("^" + padrao.replace(/%/g, ".*").replace(/_/g, ".") + "$");
          linhas = linhas.filter((l) => re.test(String(l[c])));
          return q;
        },
        not: (c: string, _op: string, _v: unknown) => { linhas = linhas.filter((l) => l[c] != null); return q; },
        order: (c: string, o?: { ascending?: boolean }) => {
          linhas.sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (o?.ascending === false ? -1 : 1));
          return q;
        },
        limit: (n: number) => { linhas = linhas.slice(0, n); return q; },
        maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
        then: (ok: any, err: any) => Promise.resolve({ data: linhas, error: null }).then(ok, err),
      };
      return q;
    },
  };
}

const horasAtras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

Deno.test("lead sem carimbo que escreveu no Comercial 2 há 2h: responde pelo Comercial 2 (não pelo padrão)", async () => {
  const s = cenario({ entradas: [{ lead_id: "L1", whatsapp_number_id: COMERCIAL2, created_at: horasAtras(2) }] });
  const r = await numeroDeSaida(s, { leadId: "L1", tenantId: T, leadNumberId: null, pipelineId: null });
  assertEquals(r.ok && r.numberId, COMERCIAL2);
  assertEquals(r.ok && r.token, "tk-c2");
});

Deno.test("escreveu no número de contingência (desligado): sai pelo padrão, que é o oficial via whatsapp_config", async () => {
  const s = cenario({ entradas: [{ lead_id: "L2", whatsapp_number_id: CONTINGENCIA, created_at: horasAtras(1) }] });
  const r = await numeroDeSaida(s, { leadId: "L2", tenantId: T, leadNumberId: null, pipelineId: null });
  assertEquals(r.ok && r.numberId, OFICIAL);
  assertEquals(r.ok && r.integrationKey, "whatsapp_config");
  assertEquals(r.ok && r.token, "tk-oficial");
});

Deno.test("lead carimbado com o oficial que escreveu no Comercial 2 dentro da janela: Comercial 2", async () => {
  const s = cenario({ entradas: [{ lead_id: "L3", whatsapp_number_id: COMERCIAL2, created_at: horasAtras(3) }] });
  const r = await numeroDeSaida(s, { leadId: "L3", tenantId: T, leadNumberId: OFICIAL, pipelineId: null });
  assertEquals(r.ok && r.numberId, COMERCIAL2);
});

Deno.test("janela fechada: vale o número do lead", async () => {
  const s = cenario({ entradas: [{ lead_id: "L4", whatsapp_number_id: COMERCIAL2, created_at: horasAtras(30) }] });
  const r = await numeroDeSaida(s, { leadId: "L4", tenantId: T, leadNumberId: OFICIAL, pipelineId: null });
  assertEquals(r.ok && r.numberId, OFICIAL);
});

Deno.test("closer com número antigo desativado: sai pelo número ativo DO CLOSER, nunca pelo central", async () => {
  const s = cenario();
  const r = await numeroDeSaida(s, { leadId: "L5", tenantId: T, leadNumberId: CLOSER_ANTIGO, pipelineId: null });
  assertEquals(r.ok && r.numberId, CLOSER_ATIVO);
});

Deno.test("resposta a uma mensagem: sai pelo número daquela mensagem", async () => {
  const s = cenario({
    entradas: [{ lead_id: "L6", whatsapp_number_id: COMERCIAL2, created_at: horasAtras(1) }],
    mensagens: [{ id: "M-ref", lead_id: "L6", whatsapp_number_id: OFICIAL }],
  });
  const r = await numeroDeSaida(s, { leadId: "L6", tenantId: T, leadNumberId: null, pipelineId: null, mensagemReferenciaId: "M-ref" });
  assertEquals(r.ok && r.numberId, OFICIAL);
});

Deno.test("Comercial 2 com integração desativada: o próximo candidato da equipe assume", async () => {
  const s = cenario({ comercial2Desativado: true, entradas: [{ lead_id: "L7", whatsapp_number_id: COMERCIAL2, created_at: horasAtras(1) }] });
  const r = await numeroDeSaida(s, { leadId: "L7", tenantId: T, leadNumberId: null, pipelineId: null });
  assertEquals(r.ok && r.numberId, OFICIAL);
});

Deno.test("lead do closer nunca sai por número central, mesmo sem número ativo do closer", async () => {
  const s = cenario();
  // Desliga o número ativo do closer.
  const original = s.from.bind(s);
  const semCloserAtivo = {
    from(t: string) {
      const q = original(t);
      if (t !== "whatsapp_numbers") return q;
      const then = q.then;
      q.then = (ok: any, err: any) =>
        then((res: any) => ({ ...res, data: res.data.map((n: any) => n.id === CLOSER_ATIVO ? { ...n, is_active: false } : n) })).then(ok, err);
      return q;
    },
  };
  const r = await numeroDeSaida(semCloserAtivo, { leadId: "L8", tenantId: T, leadNumberId: CLOSER_ANTIGO, pipelineId: null });
  assertEquals(r.ok, false);
});

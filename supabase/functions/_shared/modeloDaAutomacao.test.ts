import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { conferirModeloDaAutomacao, MODELO_INVALIDO } from "./modeloDaAutomacao.ts";
import type { MundoRef } from "./mundoNumero.ts";

// Retrato do tenant Rizodent em 09/10/2026 (ids encurtados): oficial e
// Comercial 2 na WABA central 893…; o closer no número novo (WABA 2077…) e os
// modelos dele ainda na WABA do número antigo (1773…).
const T = "rizodent";
const CLOSER = "user-closer";
const OFICIAL = "num-oficial";
const COMERCIAL2 = "num-comercial-2";
const CLOSER_ATIVO = "num-closer";
const CLOSER_ANTIGO = "num-closer-antigo";
const WABA_CENTRAL = "893372606594069";
const WABA_CLOSER = "2077987393589730";
const WABA_CLOSER_ANTIGO = "1773640530293332";

const tabelas: Record<string, Record<string, unknown>[]> = {
  whatsapp_numbers: [
    { id: OFICIAL, tenant_id: T, phone_number_id: "846998725169815", waba_id: WABA_CENTRAL, mundo: "crc", dono_user_id: null, is_active: true, is_default: true, token: "tk", created_at: "2026-10-09" },
    { id: COMERCIAL2, tenant_id: T, phone_number_id: "1379479318578791", waba_id: WABA_CENTRAL, mundo: "crc", dono_user_id: null, is_active: true, is_default: false, token: "tk", created_at: "2026-10-08" },
    { id: CLOSER_ATIVO, tenant_id: T, phone_number_id: "1348609001677203", waba_id: WABA_CLOSER, mundo: "closer", dono_user_id: CLOSER, is_active: true, is_default: false, token: "tk", created_at: "2026-10-09" },
    { id: CLOSER_ANTIGO, tenant_id: T, phone_number_id: "1326232703900018", waba_id: WABA_CLOSER_ANTIGO, mundo: "closer", dono_user_id: CLOSER, is_active: false, is_default: false, token: "tk", created_at: "2026-08-24" },
  ],
  integrations: [
    { tenant_id: T, key: "whatsapp_config", status: "connected", owner_role: "crc", config: { phone_number_id: "846998725169815", waba_id: WABA_CENTRAL, token: "tk-oficial" } },
    { tenant_id: T, key: "whatsapp_1379479318578791", status: "connected", owner_role: "crc", config: { phone_number_id: "1379479318578791", waba_id: WABA_CENTRAL, token: "tk-c2" } },
    { tenant_id: T, key: "whatsapp_1348609001677203", status: "connected", owner_role: "closer", config: { phone_number_id: "1348609001677203", waba_id: WABA_CLOSER, token: "tk-closer" } },
  ],
  crm_whatsapp_templates: [
    { id: "tpl-central", tenant_id: T, name: "lembrete", language: "pt_BR", status: "APPROVED", waba_id: WABA_CENTRAL },
    { id: "tpl-pendente", tenant_id: T, name: "novo", language: "pt_BR", status: "PENDING", waba_id: WABA_CENTRAL },
    { id: "tpl-closer-antigo", tenant_id: T, name: "boas_vindas_closer", language: "pt_BR", status: "APPROVED", waba_id: WABA_CLOSER_ANTIGO },
    { id: "tpl-closer-antigo-2", tenant_id: T, name: "retorno_closer", language: "pt_BR", status: "APPROVED", waba_id: WABA_CLOSER_ANTIGO },
    { id: "tpl-closer-novo-2", tenant_id: T, name: "retorno_closer", language: "pt_BR", status: "APPROVED", waba_id: WABA_CLOSER },
    { id: "tpl-outro-cliente", tenant_id: "outro", name: "lembrete", language: "pt_BR", status: "APPROVED", waba_id: WABA_CENTRAL },
  ],
  messages: [],
  funnel_channels: [],
};

function fakeAdmin() {
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
        not: (c: string) => { linhas = linhas.filter((l) => l[c] != null); return q; },
        order: () => q,
        limit: (n: number) => { linhas = linhas.slice(0, n); return q; },
        maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
        then: (ok: any, err: any) => Promise.resolve({ data: linhas, error: null }).then(ok, err),
      };
      return q;
    },
  };
}

const mundoCentral: MundoRef = {
  tenantId: T, pipelineId: "funil-principal", mundo: "crc", dono: null,
  numberIds: [OFICIAL, COMERCIAL2], idsDeOutrosMundos: [CLOSER_ATIVO, CLOSER_ANTIGO], semNumero: true,
};
const mundoCloser: MundoRef = {
  tenantId: T, pipelineId: "padrao-closer", mundo: "closer", dono: CLOSER,
  numberIds: [CLOSER_ANTIGO, CLOSER_ATIVO], idsDeOutrosMundos: [OFICIAL, COMERCIAL2], semNumero: false,
};

const conferir = (templateId: string, mundo: MundoRef, amostra: { leadId: string; leadNumberId: string | null } | null) =>
  conferirModeloDaAutomacao(fakeAdmin(), { templateId, tenantId: T, pipelineId: null, mundo, amostra });

Deno.test("modelo aprovado da WABA central, lead sem carimbo: pode disparar", async () => {
  const r = await conferir("tpl-central", mundoCentral, { leadId: "L1", leadNumberId: null });
  assertEquals(r.ok, true);
  assertEquals(r.ok && r.wabaId, WABA_CENTRAL);
});

Deno.test("modelo ainda em análise (PENDING): recusa antes de enfileirar", async () => {
  const r = await conferir("tpl-pendente", mundoCentral, { leadId: "L1", leadNumberId: COMERCIAL2 });
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.status, 400);
  assertEquals(!r.ok && r.error, MODELO_INVALIDO);
});

Deno.test("modelo excluído (id que não existe mais) e modelo de outro cliente: recusa", async () => {
  for (const id of ["tpl-apagado", "tpl-outro-cliente"]) {
    const r = await conferir(id, mundoCentral, { leadId: "L1", leadNumberId: null });
    assertEquals(!r.ok && r.error, MODELO_INVALIDO);
  }
});

Deno.test("closer sem lead de amostra: modelo da WABA do número ANTIGO não sai pelo número novo", async () => {
  const r = await conferir("tpl-closer-antigo", mundoCloser, null);
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.error, MODELO_INVALIDO);
});

Deno.test("modelo de mesmo nome e idioma aprovado na WABA de saída: o envio usa esse, então pode", async () => {
  const r = await conferir("tpl-closer-antigo-2", mundoCloser, { leadId: "L2", leadNumberId: CLOSER_ANTIGO });
  assertEquals(r.ok, true);
  assertEquals(r.ok && r.wabaId, WABA_CLOSER);
});

Deno.test("modelo do closer num funil central: a saída é central, recusa", async () => {
  const r = await conferir("tpl-closer-novo-2", mundoCentral, { leadId: "L3", leadNumberId: OFICIAL });
  assertEquals(r.ok, false);
});

Deno.test("equipe sem nenhum número: recusa com o motivo certo (não cai no número central)", async () => {
  const semNumero: MundoRef = { ...mundoCloser, numberIds: [] };
  const r = await conferir("tpl-central", semNumero, null);
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.error, "Nenhum número de WhatsApp ativo da equipe deste funil");
});

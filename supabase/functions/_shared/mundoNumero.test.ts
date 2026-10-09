import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mesmoMundo, mundoCentral, mundoDoFunil, mundoDoNumero, orDoMundo } from "./mundoNumero.ts";

// Retrato do tenant Rizodent em 09/10/2026.
const T = "tenant-rizodent";
const CLOSER = "user-closer";
const N = {
  closerAntigo: "num-closer-antigo",
  closerComercial: "num-closer-comercial",
  closer: "num-closer",
  contingencia: "num-contingencia",
  comercial2: "num-comercial-2",
  oficial: "num-oficial",
};

const tabelas: Record<string, Record<string, unknown>[]> = {
  whatsapp_numbers: [
    { id: N.closerAntigo, tenant_id: T, mundo: "closer", dono_user_id: CLOSER, phone_number_id: "111" },
    { id: N.closerComercial, tenant_id: T, mundo: "closer", dono_user_id: CLOSER, phone_number_id: "222" },
    { id: N.closer, tenant_id: T, mundo: "closer", dono_user_id: CLOSER, phone_number_id: "1348609001677203" },
    { id: N.contingencia, tenant_id: T, mundo: "crc", dono_user_id: null, phone_number_id: "333" },
    { id: N.comercial2, tenant_id: T, mundo: "crc", dono_user_id: null, phone_number_id: "1379479318578791" },
    { id: N.oficial, tenant_id: T, mundo: "crc", dono_user_id: null, phone_number_id: "846998725169815" },
  ],
  integrations: [
    { tenant_id: T, key: "whatsapp_config", owner_role: "crc", config: { phone_number_id: "846998725169815" } },
    { tenant_id: T, key: "whatsapp_1348609001677203", owner_role: "closer", config: { phone_number_id: "1348609001677203" } },
  ],
  funnel_channels: [
    { tenant_id: T, pipeline_id: "funil-principal", channel_type: "whatsapp", channel_config: { integration_key: "whatsapp_config" }, created_at: "1" },
    { tenant_id: T, pipeline_id: "padrao-closer", channel_type: "whatsapp", channel_config: { integration_key: "whatsapp_1348609001677203" }, created_at: "1" },
  ],
  crm_pipelines: [
    { id: "funil-principal", allowed_roles: null, created_by: null },
    { id: "padrao-closer", allowed_roles: ["gerente", "closer"], created_by: null },
    { id: "faceta-closer", allowed_roles: ["gerente", "closer"], created_by: CLOSER },
    { id: "pos-venda", allowed_roles: ["posvenda"], created_by: null },
    { id: "implante", allowed_roles: null, created_by: null },
  ],
  user_roles: [{ user_id: CLOSER, role: "closer" }],
};

// Cliente falso: só o que os helpers usam (select/eq/order/limit/maybeSingle/await).
function fakeAdmin() {
  return {
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          linhas = linhas.filter((l) => l[col] === val);
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          linhas = linhas.slice(0, n);
          return q;
        },
        maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
        then: (ok: any, err: any) => Promise.resolve({ data: linhas, error: null }).then(ok, err),
      };
      return q;
    },
  };
}

Deno.test("mundo central: legado, oficial, contingência e Comercial 2 são da mesma equipe", async () => {
  const m = await mundoCentral(fakeAdmin(), T);
  assertEquals(mesmoMundo(null, m), true);
  assertEquals(mesmoMundo(N.oficial, m), true);
  assertEquals(mesmoMundo(N.comercial2, m), true);
  assertEquals(mesmoMundo(N.contingencia, m), true);
  assertEquals(mesmoMundo(N.closer, m), false);
  assertEquals(mesmoMundo(N.closerAntigo, m), false);
});

Deno.test("número novo central (ainda fora do cache) conta como central, não como closer", async () => {
  const m = await mundoCentral(fakeAdmin(), T);
  assertEquals(mesmoMundo("numero-conectado-agora", m), true);
});

Deno.test("Funil Principal (canal whatsapp_config) alcança o lead carimbado com o número oficial", async () => {
  const m = await mundoDoFunil(fakeAdmin(), "funil-principal", T);
  assertEquals(m.mundo, "crc");
  assertEquals(mesmoMundo(N.oficial, m), true);
  assertEquals(mesmoMundo(null, m), true);
  assertEquals(mesmoMundo(N.closer, m), false);
});

Deno.test("funil do closer SEM canal (FACETA) alcança os leads do closer — antes não alcançava", async () => {
  const m = await mundoDoFunil(fakeAdmin(), "faceta-closer", T);
  assertEquals(m.mundo, "closer");
  assertEquals(m.dono, CLOSER);
  assertEquals(mesmoMundo(N.closer, m), true);
  assertEquals(mesmoMundo(N.closerAntigo, m), true);
  assertEquals(mesmoMundo(null, m), false);
  assertEquals(mesmoMundo(N.oficial, m), false);
});

Deno.test("Padrão Closer (canal do número do closer)", async () => {
  const m = await mundoDoFunil(fakeAdmin(), "padrao-closer", T);
  assertEquals(m.mundo, "closer");
  assertEquals(mesmoMundo(N.closer, m), true);
  assertEquals(mesmoMundo(N.comercial2, m), false);
});

Deno.test("funil de pós-venda e funis de especialidade sem canal ficam no central", async () => {
  for (const funil of ["pos-venda", "implante"]) {
    const m = await mundoDoFunil(fakeAdmin(), funil, T);
    assertEquals(m.mundo, "crc");
    assertEquals(mesmoMundo(null, m), true);
    assertEquals(mesmoMundo(N.oficial, m), true);
  }
});

Deno.test("mundo do número de um lead", async () => {
  assertEquals((await mundoDoNumero(fakeAdmin(), T, null)).mundo, "crc");
  assertEquals((await mundoDoNumero(fakeAdmin(), T, N.oficial)).mundo, "crc");
  assertEquals((await mundoDoNumero(fakeAdmin(), T, N.closer)).mundo, "closer");
});

Deno.test("expressão .or() do mundo central e do closer", async () => {
  const central = await mundoCentral(fakeAdmin(), T);
  assertEquals(
    orDoMundo(central),
    `whatsapp_number_id.is.null,whatsapp_number_id.not.in.(${N.closerAntigo},${N.closerComercial},${N.closer})`,
  );
  const closer = await mundoDoFunil(fakeAdmin(), "faceta-closer", T);
  assertEquals(orDoMundo(closer), `whatsapp_number_id.in.(${N.closerAntigo},${N.closerComercial},${N.closer})`);
});

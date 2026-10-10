import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  donoDaConexao,
  mesmoMundo,
  mundoCentral,
  mundoDaPessoa,
  mundoDoFunil,
  mundoDoNumero,
  mundoDoUsuario,
  numeroEhDaEquipe,
  numerosDaEquipeDoUsuario,
  orDoMundo,
  usuarioDoMundoDoNumero,
} from "./mundoNumero.ts";

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
    { id: N.closerAntigo, tenant_id: T, mundo: "closer", dono_user_id: CLOSER, phone_number_id: "111", is_active: false, is_default: false, created_at: "2026-08-24T18:40" },
    { id: N.closerComercial, tenant_id: T, mundo: "closer", dono_user_id: CLOSER, phone_number_id: "222", is_active: false, is_default: false, created_at: "2026-08-24T18:46" },
    { id: N.closer, tenant_id: T, mundo: "closer", dono_user_id: CLOSER, phone_number_id: "1348609001677203", is_active: true, is_default: false, created_at: "2026-10-09T19:53" },
    { id: N.contingencia, tenant_id: T, mundo: "crc", dono_user_id: null, phone_number_id: "333", is_active: false, is_default: false, created_at: "2026-10-07T14:55" },
    { id: N.comercial2, tenant_id: T, mundo: "crc", dono_user_id: null, phone_number_id: "1379479318578791", is_active: true, is_default: false, created_at: "2026-10-08T20:11" },
    { id: N.oficial, tenant_id: T, mundo: "crc", dono_user_id: null, phone_number_id: "846998725169815", is_active: true, is_default: true, created_at: "2026-10-09T19:54" },
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

// ---------------------------------------------------------------------------
// Equipe de uma PESSOA (substitui a contagem de user_permission_overrides).

Deno.test("equipe de quem conecta: closer e recepção são donos; o resto é central", () => {
  assertEquals(mundoDoUsuario(["closer"]), "closer");
  assertEquals(mundoDoUsuario(["recepcao"]), "recepcao");
  for (const p of ["crc", "sdr", "crc_legacy", "gerente", "superadmin", "posvenda"]) {
    assertEquals(mundoDoUsuario([p]), "crc");
  }
  assertEquals(mundoDoUsuario(["gerente", "closer"]), "closer");
});

Deno.test("número é da equipe da pessoa: closer só os dele; central só os centrais", () => {
  const doCloser = { mundo: "closer", dono_user_id: CLOSER };
  const central = { mundo: "crc", dono_user_id: null };
  const closerSemDono = { mundo: "closer", dono_user_id: null };
  assertEquals(numeroEhDaEquipe(doCloser, CLOSER, ["closer"]), true);
  assertEquals(numeroEhDaEquipe(doCloser, "outro-closer", ["closer"]), false);
  assertEquals(numeroEhDaEquipe(closerSemDono, "outro-closer", ["closer"]), true);
  assertEquals(numeroEhDaEquipe(central, CLOSER, ["closer"]), false);
  assertEquals(numeroEhDaEquipe(central, "sdr-1", ["sdr"]), true);
  assertEquals(numeroEhDaEquipe(doCloser, "crc-1", ["crc"]), false);
  assertEquals(numeroEhDaEquipe(central, "gerente-1", ["gerente"]), true);
});

Deno.test("espelho de usuario_do_mundo_do_numero (destino de transferência)", () => {
  assertEquals(usuarioDoMundoDoNumero({ mundo: "closer", dono_user_id: CLOSER }, CLOSER, ["closer"]), true);
  assertEquals(usuarioDoMundoDoNumero({ mundo: "closer", dono_user_id: CLOSER }, "outro", ["closer"]), false);
  assertEquals(usuarioDoMundoDoNumero({ mundo: "closer", dono_user_id: null }, "outro", ["closer"]), true);
  assertEquals(usuarioDoMundoDoNumero({ mundo: "closer", dono_user_id: null }, "outro", ["crc"]), false);
  assertEquals(usuarioDoMundoDoNumero({ mundo: "crc", dono_user_id: null }, "x", ["posvenda"]), true);
  assertEquals(usuarioDoMundoDoNumero({ mundo: "posvenda", dono_user_id: null }, "x", ["crc"]), false);
  // gerência/superadmin enxergam tudo pela can_access, não por pertencer ao mundo
  assertEquals(usuarioDoMundoDoNumero({ mundo: "crc", dono_user_id: null }, "x", ["gerente"]), false);
});

Deno.test("números da equipe do closer: os 3 dele, o ativo primeiro; nenhum central", async () => {
  const nums = await numerosDaEquipeDoUsuario(fakeAdmin(), T, CLOSER, ["closer"]);
  assertEquals(nums.map((n) => n.id), [N.closer, N.closerAntigo, N.closerComercial]);
  const central = await numerosDaEquipeDoUsuario(fakeAdmin(), T, "crc-1", ["crc"]);
  assertEquals(central.map((n) => n.id), [N.oficial, N.comercial2, N.contingencia]);
  const outroCloser = await numerosDaEquipeDoUsuario(fakeAdmin(), T, "outro-closer", ["closer"]);
  assertEquals(outroCloser.length, 0);
});

// ---------------------------------------------------------------------------
// Dono de um número ao conectar/reconectar (minha-conexao e OAuth).

Deno.test("número novo: closer conecta → mundo do closer com ele de dono; crc/gerente → central", () => {
  const closer = donoDaConexao({ papeis: ["closer"], userId: CLOSER, numero: null, integracao: null });
  assertEquals([closer.podeMexer, closer.ownerRole, closer.mundo, closer.ownerUserId], [true, "closer", "closer", CLOSER]);
  for (const p of ["crc", "sdr", "crc_legacy", "gerente", "superadmin"]) {
    const c = donoDaConexao({ papeis: [p], userId: "u", numero: null, integracao: null });
    assertEquals([c.ownerRole, c.mundo, c.ownerUserId], ["crc", "crc", ""]);
  }
  const recepcao = donoDaConexao({ papeis: ["recepcao"], userId: "r1", numero: null, integracao: null });
  assertEquals([recepcao.ownerRole, recepcao.ownerUserId], ["recepcao", "r1"]);
});

Deno.test("reconectar não muda o número de equipe: gerente reconecta o número do closer", () => {
  const d = donoDaConexao({
    papeis: ["gerente"],
    userId: "gerente-1",
    numero: { mundo: "closer", dono_user_id: CLOSER },
    integracao: { owner_role: "closer", config: { owner_user_id: CLOSER } },
  });
  assertEquals([d.podeMexer, d.ownerRole, d.mundo, d.ownerUserId], [true, "closer", "closer", CLOSER]);
});

Deno.test("closer não mexe no número oficial (whatsapp_config) nem no de outro closer", () => {
  const oficial = donoDaConexao({
    papeis: ["closer"],
    userId: CLOSER,
    numero: { mundo: "crc", dono_user_id: null },
    integracao: { owner_role: "crc", config: {} },
  });
  assertEquals(oficial.podeMexer, false);
  const deOutro = donoDaConexao({ papeis: ["closer"], userId: "outro", numero: { mundo: "closer", dono_user_id: CLOSER }, integracao: null });
  assertEquals(deOutro.podeMexer, false);
  // e o crc não mexe no número do closer
  const crc = donoDaConexao({ papeis: ["crc"], userId: "crc-1", numero: { mundo: "closer", dono_user_id: CLOSER }, integracao: null });
  assertEquals(crc.podeMexer, false);
});

Deno.test("integração antiga com owner_role NULL fica NULL (central), salvo número já de outra equipe", () => {
  const legado = donoDaConexao({ papeis: ["crc"], userId: "crc-1", numero: { mundo: "crc", dono_user_id: null }, integracao: { owner_role: null, config: {} } });
  assertEquals([legado.ownerRole, legado.mundo], [null, "crc"]);
  const doCloser = donoDaConexao({ papeis: ["gerente"], userId: "g", numero: { mundo: "closer", dono_user_id: CLOSER }, integracao: { owner_role: null, config: {} } });
  assertEquals([doCloser.ownerRole, doCloser.mundo, doCloser.ownerUserId], ["closer", "closer", CLOSER]);
});

Deno.test("número inativo do próprio closer (integração apagada): volta para ele mesmo", () => {
  const d = donoDaConexao({ papeis: ["closer"], userId: CLOSER, numero: { mundo: "closer", dono_user_id: CLOSER }, integracao: null });
  assertEquals([d.podeMexer, d.ownerRole, d.ownerUserId], [true, "closer", CLOSER]);
});

Deno.test("mundo da pessoa: closer alcança só os números dele; SDR, a central inteira", async () => {
  const closer = await mundoDaPessoa(fakeAdmin(), T, "faceta-closer", CLOSER, ["closer"]);
  assertEquals(closer.mundo, "closer");
  assertEquals(mesmoMundo(N.closer, closer), true);
  assertEquals(mesmoMundo(N.oficial, closer), false);
  assertEquals(mesmoMundo(null, closer), false);
  const sdr = await mundoDaPessoa(fakeAdmin(), T, "funil-principal", "sdr-1", ["sdr"]);
  assertEquals(sdr.mundo, "crc");
  assertEquals(mesmoMundo(N.comercial2, sdr), true);
  assertEquals(mesmoMundo(N.closer, sdr), false);
});

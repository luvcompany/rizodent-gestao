import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contasDasIntegracoes,
  donoDoModelo,
  gravarModeloCriado,
  jsonIgual,
  listarModelosDaMeta,
  mesmoCabecalho,
  type NumeroDoCliente,
  numeroDaConta,
  papelDoChamadorComoDono,
  sincronizarConta,
  tokensDaConta,
} from "./modelosDaConta.ts";
import { copiarModelosEntreNumeros, HANDLE_PENDENTE, montarPayloadDaCopia } from "./copiarModelos.ts";

// ─── Retrato do tenant Rizodent em 09/10/2026 (ids encurtados) ───
const T = "rizodent";
const WABA_CENTRAL = "893372606594069";
const WABA_CLOSER = "2077987393589730";
const WABA_CLOSER_ANTIGA = "1773640530293332";
const OFICIAL = "num-oficial"; // whatsapp_config, padrão
const COMERCIAL2 = "num-comercial-2";
const CLOSER = "num-closer";
const CLOSER_ANTIGO = "num-closer-antigo";
const DONO_CLOSER = "user-closer";

const NUMEROS: (NumeroDoCliente & { tenant_id: string })[] = [
  { id: OFICIAL, tenant_id: T, waba_id: WABA_CENTRAL, phone_number_id: "846998725169815", is_active: true, is_default: true, created_at: "2026-10-09T19:54:39Z", mundo: "crc", dono_user_id: null },
  { id: COMERCIAL2, tenant_id: T, waba_id: WABA_CENTRAL, phone_number_id: "1379479318578791", is_active: true, is_default: false, created_at: "2026-10-08T20:11:31Z", mundo: "crc", dono_user_id: null },
  { id: CLOSER, tenant_id: T, waba_id: WABA_CLOSER, phone_number_id: "1348609001677203", is_active: true, is_default: false, created_at: "2026-10-09T19:53:13Z", mundo: "closer", dono_user_id: DONO_CLOSER },
  { id: CLOSER_ANTIGO, tenant_id: T, waba_id: WABA_CLOSER_ANTIGA, phone_number_id: "1326232703900018", is_active: false, is_default: false, created_at: "2026-08-24T18:46:03Z", mundo: "closer", dono_user_id: DONO_CLOSER },
];

type Linha = Record<string, any>;

/** Banco em memória com o pedaço da API do supabase-js que os módulos usam. */
function bancoFalso(tabelas: Record<string, Linha[]>, opts: { erroInsert?: (l: Linha) => string | null; erroDelete?: (l: Linha) => string | null } = {}) {
  const log = { updates: [] as { tabela: string; id: string; patch: Linha }[], inserts: [] as Linha[], deletes: [] as string[] };
  let seq = 0;
  const from = (tabela: string) => {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: "select" | "update" | "insert" | "delete" = "select";
    let patch: Linha = {};
    let novos: Linha[] = [];
    let devolver = false;
    let faixa: [number, number] | null = null;
    let limite: number | null = null;
    const executar = (): Promise<{ data: any; error: any }> => {
      const linhas = tabelas[tabela] ??= [];
      if (op === "insert") {
        for (const n of novos) {
          const erro = opts.erroInsert?.(n);
          if (erro) return Promise.resolve({ data: null, error: { message: erro } });
        }
        const gravados = novos.map((n) => ({ id: n.id ?? `novo-${++seq}`, ...n }));
        linhas.push(...gravados);
        log.inserts.push(...gravados);
        return Promise.resolve({ data: devolver ? gravados.map((g) => ({ ...g })) : null, error: null });
      }
      const achadas = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        for (const l of achadas) {
          Object.assign(l, patch);
          log.updates.push({ tabela, id: l.id, patch: { ...patch } });
        }
        return Promise.resolve({ data: devolver ? achadas.map((l) => ({ id: l.id })) : null, error: null });
      }
      if (op === "delete") {
        for (const l of achadas) {
          const erro = opts.erroDelete?.(l);
          if (erro) return Promise.resolve({ data: null, error: { message: erro } });
        }
        tabelas[tabela] = linhas.filter((l) => !achadas.includes(l));
        log.deletes.push(...achadas.map((l) => l.id));
        return Promise.resolve({ data: devolver ? achadas.map((l) => ({ id: l.id })) : null, error: null });
      }
      let out = achadas.map((l) => ({ ...l }));
      if (faixa) out = out.slice(faixa[0], faixa[1] + 1);
      if (limite != null) out = out.slice(0, limite);
      return Promise.resolve({ data: out, error: null });
    };
    const q: any = {
      select: () => { if (op !== "select") devolver = true; return q; },
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
      is: (c: string, v: unknown) => { filtros.push((l) => (l[c] ?? null) === v); return q; },
      in: (c: string, vs: unknown[]) => { filtros.push((l) => vs.includes(l[c])); return q; },
      order: () => q,
      range: (a: number, b: number) => { faixa = [a, b]; return q; },
      limit: (n: number) => { limite = n; return q; },
      update: (p: Linha) => { op = "update"; patch = p; return q; },
      insert: (r: Linha | Linha[]) => { op = "insert"; novos = Array.isArray(r) ? r : [r]; return q; },
      delete: () => { op = "delete"; return q; },
      maybeSingle: () => executar().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
      single: () => executar().then((r) => (r.error ? r : { data: r.data?.[0] ?? null, error: r.data?.length ? null : { message: "nenhuma linha" } })),
      then: (ok: any, err: any) => executar().then(ok, err),
    };
    return q;
  };
  return { db: { from }, tabelas, log };
}

/** Meta falsa: páginas de listagem por WABA e respostas de criação. */
function metaFalsa(paginas: Record<string, (any[] | number)[]>, criar?: (corpo: any) => { status: number; json: any }) {
  const chamadas: { url: string; metodo: string; corpo?: any }[] = [];
  const buscar = (url: string, init?: RequestInit): Promise<Response> => {
    const metodo = init?.method ?? "GET";
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    chamadas.push({ url, metodo, corpo });
    if (metodo === "POST") {
      const r = criar ? criar(corpo) : { status: 500, json: { error: { message: "sem criar" } } };
      return Promise.resolve(new Response(JSON.stringify(r.json), { status: r.status }));
    }
    const waba = url.split("/v25.0/")[1].split("/")[0];
    const pagina = Number(new URL(url).searchParams.get("pagina") ?? "0");
    const lista = paginas[waba] ?? [[]];
    const atual = lista[pagina];
    if (typeof atual === "number") {
      return Promise.resolve(new Response(JSON.stringify({ error: { message: "Please reduce the amount of data" } }), { status: atual }));
    }
    const proxima = pagina + 1 < lista.length ? `https://graph.facebook.com/v25.0/${waba}/message_templates?limit=100&pagina=${pagina + 1}` : undefined;
    return Promise.resolve(new Response(JSON.stringify({ data: atual, paging: proxima ? { next: proxima } : {} }), { status: 200 }));
  };
  return { buscar, chamadas };
}

const modeloMeta = (id: string, name: string, extra: Linha = {}) => ({
  id, name, language: "pt_BR", category: "UTILITY", status: "APPROVED",
  components: [{ type: "BODY", text: `Olá {{1}}, ${name}` }],
  ...extra,
});

/** Linha local como a sincronização gravaria o modeloMeta acima. */
const linhaLocal = (id: string, metaId: string, name: string, extra: Linha = {}): Linha => ({
  id, tenant_id: T, waba_id: WABA_CENTRAL, whatsapp_number_id: COMERCIAL2, meta_template_id: metaId,
  name, language: "pt_BR", category: "UTILITY", status: "APPROVED",
  header_type: null, header_content: null, body_text: `Olá {{1}}, ${name}`, footer_text: null, buttons: null,
  owner_role: "crc", updated_at: "2026-10-09T00:00:00Z",
  ...extra,
});

// ─── Listagem da Meta ───

Deno.test("listagem: junta todas as páginas", async () => {
  const meta = metaFalsa({ [WABA_CENTRAL]: [[modeloMeta("m1", "a")], [modeloMeta("m2", "b")]] });
  const r = await listarModelosDaMeta(WABA_CENTRAL, "tk", meta.buscar);
  assert(r.ok);
  assertEquals(r.modelos.map((m) => m.id), ["m1", "m2"]);
});

Deno.test("listagem: erro da Meta na 2ª página devolve erro, nunca lista parcial", async () => {
  const meta = metaFalsa({ [WABA_CENTRAL]: [[modeloMeta("m1", "a")], 500] });
  const r = await listarModelosDaMeta(WABA_CENTRAL, "tk", meta.buscar);
  assertEquals(r.ok, false);
  assert(!r.ok && r.paginasLidas === 1 && r.erro.includes("página 2"));
});

Deno.test("listagem: falha de rede e corpo sem lista também são erro", async () => {
  const rede = await listarModelosDaMeta(WABA_CENTRAL, "tk", () => Promise.reject(new Error("timeout")));
  assertEquals(rede.ok, false);
  const semLista = await listarModelosDaMeta(WABA_CENTRAL, "tk", () => Promise.resolve(new Response("{}", { status: 200 })));
  assertEquals(semLista.ok, false);
});

// ─── Contas e número escolhido ───

Deno.test("oficial (whatsapp_config) e Comercial 2 na mesma WABA viram UMA conta; closer é outra", () => {
  const { contas, semCredencial } = contasDasIntegracoes([
    { key: "whatsapp_config", tenant_id: T, config: { phone_number_id: "846998725169815", waba_id: WABA_CENTRAL, access_token: "tk-oficial" } },
    { key: "whatsapp_1379479318578791", tenant_id: T, config: { phone_number_id: "1379479318578791", waba_id: WABA_CENTRAL, access_token: "tk-c2" } },
    { key: "whatsapp_1348609001677203", tenant_id: T, config: { phone_number_id: "1348609001677203", waba_id: WABA_CLOSER, access_token: "tk-closer" } },
    { key: "whatsapp_quebrada", tenant_id: T, config: { phone_number_id: "1", waba_id: "" , access_token: "x" } },
  ]);
  assertEquals(contas.length, 2);
  const central = contas.find((c) => c.wabaId === WABA_CENTRAL)!;
  assertEquals(central.integracoes.map((i) => i.key), ["whatsapp_config", "whatsapp_1379479318578791"]);
  assertEquals(semCredencial.map((i) => i.key), ["whatsapp_quebrada"]);
  // Token do número escolhido (o oficial) primeiro; o do Comercial 2 de reserva.
  assertEquals(tokensDaConta(central, "846998725169815"), ["tk-oficial", "tk-c2"]);
  assertEquals(tokensDaConta(central, "1379479318578791"), ["tk-c2", "tk-oficial"]);
});

Deno.test("número da conta: o padrão ativo; sem padrão, o ativo mais antigo; nunca um desativado", () => {
  assertEquals(numeroDaConta(NUMEROS, WABA_CENTRAL), OFICIAL);
  const semPadrao = NUMEROS.map((n) => ({ ...n, is_default: false }));
  assertEquals(numeroDaConta(semPadrao, WABA_CENTRAL), COMERCIAL2);
  assertEquals(numeroDaConta(NUMEROS, WABA_CLOSER_ANTIGA), null);
  // Número sem waba_id cadastrada entra pela integração (phone_number_id).
  const semWaba = NUMEROS.map((n) => (n.id === CLOSER ? { ...n, waba_id: null } : n));
  assertEquals(numeroDaConta(semWaba, WABA_CLOSER, ["1348609001677203"]), CLOSER);
});

// ─── Sincronização ───

function cenarioCentral(locais: Linha[], metas: any[]) {
  const banco = bancoFalso({ crm_whatsapp_templates: locais });
  const sinc = (papelDoChamador: string | null = null) =>
    sincronizarConta(banco.db, {
      tenantId: T, wabaId: WABA_CENTRAL, modelosMeta: metas, numeros: NUMEROS, papelDoChamador, agora: "2026-10-10T00:00:00Z",
    });
  return { banco, sinc };
}

Deno.test("bug do 'troca-troca': passadas repetidas não mudam o número nem regravam a linha", async () => {
  const metas = [modeloMeta("m1", "lembrete"), modeloMeta("m2", "confirmar")];
  const { banco, sinc } = cenarioCentral([linhaLocal("L1", "m1", "lembrete"), linhaLocal("L2", "m2", "confirmar")], metas);
  // Antes: uma passada pelo whatsapp_config e outra pelo Comercial 2 — cada uma
  // regravava whatsapp_number_id. Agora é a mesma conta e nada muda.
  const r1 = await sinc();
  const r2 = await sinc("crc");
  assertEquals(r1.numeroEscolhido, OFICIAL);
  assertEquals([r1.atualizados, r1.inalterados, r2.atualizados, r2.inalterados], [0, 2, 0, 2]);
  assertEquals(banco.log.updates.length, 0);
  assertEquals(banco.tabelas.crm_whatsapp_templates.map((l) => l.whatsapp_number_id), [COMERCIAL2, COMERCIAL2]);
});

Deno.test("linha sem número (ou em número desativado) vai para o número da conta; só uma vez", async () => {
  const metas = [modeloMeta("m1", "lembrete"), modeloMeta("m2", "confirmar")];
  const { banco, sinc } = cenarioCentral([
    linhaLocal("L1", "m1", "lembrete", { whatsapp_number_id: null }),
    linhaLocal("L2", "m2", "confirmar", { whatsapp_number_id: "num-contingencia-desligado" }),
  ], metas);
  const r1 = await sinc();
  assertEquals(r1.atualizados, 2);
  assertEquals(banco.tabelas.crm_whatsapp_templates.map((l) => l.whatsapp_number_id), [OFICIAL, OFICIAL]);
  const r2 = await sinc();
  assertEquals(r2.atualizados, 0);
});

Deno.test("mídia no nosso Storage não é trocada; link da CDN com outra assinatura não regrava; botões em outra ordem de chaves não regravam", async () => {
  const comMidia = (id: string, url: string) => modeloMeta(id, `video_${id}`, {
    components: [
      { type: "HEADER", format: "VIDEO", example: { header_handle: [url] } },
      { type: "BODY", text: `Olá {{1}}, video_${id}` },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://rizodent.com.br" }] },
    ],
  });
  const metas = [
    comMidia("m1", "https://scontent.whatsapp.net/v/abc.mp4?oe=NOVO"),
    comMidia("m2", "https://scontent.whatsapp.net/v/def.mp4?oe=NOVO"),
  ];
  const botoesReordenados = [{ url: "https://rizodent.com.br", text: "Ver", type: "URL" }];
  const { banco, sinc } = cenarioCentral([
    linhaLocal("L1", "m1", "video_m1", { header_type: "VIDEO", header_content: "https://x.supabase.co/storage/v1/object/public/midia/abc.mp4", buttons: botoesReordenados }),
    linhaLocal("L2", "m2", "video_m2", { header_type: "VIDEO", header_content: "https://scontent.whatsapp.net/v/def.mp4?oe=VELHO", buttons: botoesReordenados }),
  ], metas);
  const r = await sinc();
  assertEquals(r.atualizados, 0);
  assertEquals(banco.tabelas.crm_whatsapp_templates[0].header_content, "https://x.supabase.co/storage/v1/object/public/midia/abc.mp4");
  assert(jsonIgual({ a: 1, b: [{ x: 1, y: 2 }] }, { b: [{ y: 2, x: 1 }], a: 1 }));
  assert(mesmoCabecalho("https://a/b.mp4?x=1", "https://a/b.mp4?x=2"));
  assert(!mesmoCabecalho("https://a/b.mp4", "https://a/c.mp4"));
});

Deno.test("status novo da Meta (PENDING → APPROVED) regrava só a linha que mudou", async () => {
  const metas = [modeloMeta("m1", "lembrete"), modeloMeta("m2", "confirmar")];
  const { banco, sinc } = cenarioCentral([
    linhaLocal("L1", "m1", "lembrete", { status: "PENDING" }),
    linhaLocal("L2", "m2", "confirmar"),
  ], metas);
  const r = await sinc();
  assertEquals([r.atualizados, r.inalterados], [1, 1]);
  assertEquals(banco.log.updates[0].patch.status, "APPROVED");
  assertEquals(banco.log.updates[0].patch.whatsapp_number_id, undefined);
});

Deno.test("sumiu da Meta: vira DELETED e a linha fica; recriado com o mesmo nome, a MESMA linha volta (automação não quebra)", async () => {
  const { banco, sinc } = cenarioCentral(
    [linhaLocal("L1", "m1", "lembrete"), linhaLocal("L2", "m2", "confirmar")],
    [modeloMeta("m1", "lembrete")],
  );
  const r1 = await sinc();
  assertEquals(r1.marcadosExcluidos, 1);
  assertEquals(banco.log.deletes.length, 0);
  assertEquals(banco.tabelas.crm_whatsapp_templates.find((l) => l.id === "L2")!.status, "DELETED");
  // Passada seguinte: já está DELETED, nada a regravar.
  assertEquals((await sinc()).marcadosExcluidos, 0);

  // Recriado na Meta com id novo: reaproveita a linha L2 por nome+idioma.
  const r2 = await sincronizarConta(banco.db, {
    tenantId: T, wabaId: WABA_CENTRAL, numeros: NUMEROS,
    modelosMeta: [modeloMeta("m1", "lembrete"), modeloMeta("m2-novo", "confirmar")],
  });
  assertEquals([r2.inseridos, r2.atualizados], [0, 1]);
  const l2 = banco.tabelas.crm_whatsapp_templates.find((l) => l.id === "L2")!;
  assertEquals([l2.meta_template_id, l2.status], ["m2-novo", "APPROVED"]);
  assertEquals(banco.tabelas.crm_whatsapp_templates.length, 2);
});

Deno.test("Meta devolveu a conta vazia: nada é marcado como excluído", async () => {
  const { banco, sinc } = cenarioCentral([linhaLocal("L1", "m1", "lembrete")], []);
  const r = await sinc();
  assertEquals(r.marcadosExcluidos, 0);
  assertEquals(banco.log.updates.length, 0);
});

Deno.test("rascunho sem conta gravado num número da conta é adotado pelo modelo de mesmo nome+idioma da Meta", async () => {
  const { banco, sinc } = cenarioCentral([
    linhaLocal("R1", null as unknown as string, "boas_vindas", { waba_id: null, whatsapp_number_id: OFICIAL, meta_template_id: null, status: "DRAFT" }),
  ], [modeloMeta("m9", "boas_vindas")]);
  const r = await sinc();
  assertEquals([r.inseridos, r.atualizados], [0, 1]);
  const l = banco.tabelas.crm_whatsapp_templates[0];
  assertEquals([l.id, l.meta_template_id, l.waba_id, l.status, l.whatsapp_number_id], ["R1", "m9", WABA_CENTRAL, "APPROVED", OFICIAL]);
});

Deno.test("modelo novo: número da conta e dono pela regra (cron NULL; gerente NULL; SDR 'crc'; closer 'closer')", async () => {
  const meta = [modeloMeta("m1", "novo")];
  for (const [papel, esperado] of [[null, null], ["gerente", null], ["superadmin", null], ["sdr", "crc"], ["posvenda", "posvenda"]] as const) {
    const { banco, sinc } = cenarioCentral([], meta);
    await sinc(papel);
    assertEquals(banco.log.inserts[0].owner_role, esperado, `papel ${papel}`);
    assertEquals(banco.log.inserts[0].whatsapp_number_id, OFICIAL);
  }
  const banco = bancoFalso({ crm_whatsapp_templates: [] });
  await sincronizarConta(banco.db, { tenantId: T, wabaId: WABA_CLOSER, modelosMeta: meta, numeros: NUMEROS, papelDoChamador: "gerente" });
  assertEquals([banco.log.inserts[0].owner_role, banco.log.inserts[0].whatsapp_number_id], ["closer", CLOSER]);
});

Deno.test("modelo sem dono num número de closer é reparado com 'closer'; na central NULL continua geral", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [
    linhaLocal("C1", "mc", "closer_a", { waba_id: WABA_CLOSER, whatsapp_number_id: CLOSER, owner_role: null }),
  ] });
  await sincronizarConta(banco.db, { tenantId: T, wabaId: WABA_CLOSER, modelosMeta: [modeloMeta("mc", "closer_a")], numeros: NUMEROS });
  assertEquals(banco.tabelas.crm_whatsapp_templates[0].owner_role, "closer");

  const { banco: b2, sinc } = cenarioCentral([linhaLocal("L1", "m1", "geral", { owner_role: null })], [modeloMeta("m1", "geral")]);
  await sinc("crc");
  assertEquals(b2.tabelas.crm_whatsapp_templates[0].owner_role, null);
});

Deno.test("dono do modelo: dono do número prevalece; senão o papel de quem chama", () => {
  assertEquals(donoDoModelo("closer", "gerente"), "closer");
  assertEquals(donoDoModelo(null, "gerente"), null);
  assertEquals(donoDoModelo(null, "sdr"), "crc");
  assertEquals(papelDoChamadorComoDono("superadmin"), null);
  assertEquals(papelDoChamadorComoDono("crc"), "crc");
});

// ─── Gravação do modelo criado na Meta ───

const conteudo = {
  name: "boas_vindas", language: "pt_BR", category: "UTILITY", header_type: null, header_content: null,
  body_text: "Olá {{1}}", footer_text: null, buttons: null,
};

Deno.test("Rascunho → Enviar: a linha do rascunho vira o modelo (mesmo id)", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [
    { id: "R1", tenant_id: T, name: "boas_vindas", language: "pt_BR", status: "DRAFT", meta_template_id: null, whatsapp_number_id: OFICIAL, waba_id: null, owner_role: "crc" },
  ] });
  const r = await gravarModeloCriado(banco.db, {
    tenantId: T, wabaId: WABA_CENTRAL, numeroId: OFICIAL, rascunhoId: "R1", conteudo, metaTemplateId: "m1", status: "PENDING",
    criadoPor: "u1", ownerRole: null, papelDonoDoNumero: null,
  });
  assertEquals(r, { ok: true, id: "R1" });
  const l = banco.tabelas.crm_whatsapp_templates[0];
  assertEquals([l.meta_template_id, l.status, l.waba_id, l.owner_role], ["m1", "PENDING", WABA_CENTRAL, "crc"]);
  assertEquals(banco.log.inserts.length, 0);
});

Deno.test("Rascunho que já foi enviado (ou sumiu): devolve o motivo, não finge que gravou", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [
    { id: "R1", tenant_id: T, name: "boas_vindas", language: "pt_BR", meta_template_id: "m0" },
  ] });
  const r = await gravarModeloCriado(banco.db, {
    tenantId: T, wabaId: WABA_CENTRAL, numeroId: OFICIAL, rascunhoId: "R1", conteudo, metaTemplateId: "m1", status: "PENDING",
    criadoPor: "u1", ownerRole: null, papelDonoDoNumero: null,
  });
  assertEquals(r.ok, false);
});

Deno.test("sem rascunho: reaproveita a linha velha do mesmo nome+idioma da conta; senão insere e devolve o id", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [
    { id: "V1", tenant_id: T, waba_id: WABA_CENTRAL, name: "boas_vindas", language: "pt_BR", status: "DELETED", meta_template_id: "m-velho", updated_at: "2026-09-01" },
  ] });
  const base = { tenantId: T, wabaId: WABA_CENTRAL, numeroId: OFICIAL, rascunhoId: null, metaTemplateId: "m1", status: "PENDING", criadoPor: "u1", ownerRole: "crc", papelDonoDoNumero: null };
  assertEquals(await gravarModeloCriado(banco.db, { ...base, conteudo }), { ok: true, id: "V1" });
  const novo = await gravarModeloCriado(banco.db, { ...base, metaTemplateId: "m2", conteudo: { ...conteudo, name: "outro" } });
  assert(novo.ok);
  const inserido = banco.log.inserts[0];
  assertEquals([inserido.created_by_user_id, inserido.owner_role, inserido.whatsapp_number_id], ["u1", "crc", OFICIAL]);
});

Deno.test("erro ao gravar devolve ok:false com o motivo do banco", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [] }, { erroInsert: () => "duplicate key value violates unique constraint" });
  const r = await gravarModeloCriado(banco.db, {
    tenantId: T, wabaId: WABA_CENTRAL, numeroId: OFICIAL, rascunhoId: null, conteudo, metaTemplateId: "m1", status: "PENDING",
    criadoPor: "u1", ownerRole: null, papelDonoDoNumero: null,
  });
  assertEquals(r, { ok: false, motivo: "duplicate key value violates unique constraint" });
});

// ─── Cópia entre números (copy_to_number) ───

const aprovadoDoCloserAntigo = (id: string, name: string, extra: Linha = {}): Linha => ({
  id, tenant_id: T, waba_id: WABA_CLOSER_ANTIGA, whatsapp_number_id: CLOSER_ANTIGO, meta_template_id: `meta-${id}`,
  name, language: "pt_BR", category: "MARKETING", status: "APPROVED",
  header_type: null, header_content: null, body_text: "Oi {{1}}, sua avaliação é {{2}}", footer_text: null, buttons: null,
  owner_role: "closer",
  ...extra,
});

const numeroParaCopia = (id: string) => {
  const n = NUMEROS.find((x) => x.id === id)!;
  return { id: n.id, tenant_id: T, waba_id: n.waba_id, mundo: n.mundo ?? null, dono_user_id: n.dono_user_id ?? null, is_active: n.is_active };
};

Deno.test("payload da cópia: amostras reais nas variáveis; Flow e autenticação ficam de fora; mídia espera o handle", () => {
  const texto = montarPayloadDaCopia(aprovadoDoCloserAntigo("a", "aval") as any);
  assert(texto.ok);
  assertEquals(texto.payload.components[0].example.body_text, [["Maria Silva", "Quarta, 20/05 às 14:00"]]);
  const flow = montarPayloadDaCopia(aprovadoDoCloserAntigo("b", "form", { buttons: [{ type: "FLOW", text: "Abrir", flow_id: "1" }] }) as any);
  assertEquals(flow.ok, false);
  const auth = montarPayloadDaCopia(aprovadoDoCloserAntigo("c", "otp", { category: "AUTHENTICATION" }) as any);
  assertEquals(auth.ok, false);
  const video = montarPayloadDaCopia(aprovadoDoCloserAntigo("d", "video", { header_type: "VIDEO", header_content: "https://x/storage/v1/object/public/a.mp4" }) as any);
  assert(video.ok && video.midia?.tipo === "VIDEO");
  assert(video.ok && video.payload.components[0].example.header_handle[0] === HANDLE_PENDENTE);
  const url = montarPayloadDaCopia(aprovadoDoCloserAntigo("e", "link", { buttons: [{ type: "URL", text: "Ver", url: "https://r.com/{{1}}" }] }) as any);
  assert(url.ok && url.payload.components.at(-1).buttons[0].example[0] === "https://r.com/exemplo");
});

Deno.test("cópia simulada (padrão): monta os payloads e NÃO chama a Meta", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [
    aprovadoDoCloserAntigo("a", "aval"),
    aprovadoDoCloserAntigo("b", "form", { buttons: [{ type: "FLOW", text: "Abrir", flow_id: "1" }] }),
    aprovadoDoCloserAntigo("c", "pendente", { status: "PENDING" }),
  ] });
  const meta = metaFalsa({});
  const r = await copiarModelosEntreNumeros(banco.db, {
    tenantId: T, origem: numeroParaCopia(CLOSER_ANTIGO), destino: numeroParaCopia(CLOSER), wabaDestino: WABA_CLOSER,
    token: "tk-closer", executar: false, buscar: meta.buscar, criadoPor: "super",
  });
  assert(r.ok);
  assertEquals(r.resultado.simulado, true);
  assertEquals(r.resultado.previstos.map((p) => p.name), ["aval"]);
  assertEquals(r.resultado.pulados.map((p) => p.name), ["form"]);
  assertEquals(meta.chamadas.length, 0);
  assertEquals(banco.log.inserts.length, 0);
});

Deno.test("cópia executada (com Meta falsa): cria na conta de destino, grava no número de destino como 'closer', pula o que já existe", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [
    aprovadoDoCloserAntigo("a", "aval"),
    aprovadoDoCloserAntigo("v", "video", { header_type: "VIDEO", header_content: "https://x/storage/v1/object/public/a.mp4" }),
    aprovadoDoCloserAntigo("j", "ja_existe"),
    { id: "D1", tenant_id: T, waba_id: WABA_CLOSER, whatsapp_number_id: CLOSER, name: "ja_existe", language: "pt_BR", status: "APPROVED" },
  ] });
  let n = 0;
  const meta = metaFalsa({}, () => ({ status: 200, json: { id: `novo-meta-${++n}`, status: "PENDING", category: "MARKETING" } }));
  const r = await copiarModelosEntreNumeros(banco.db, {
    tenantId: T, origem: numeroParaCopia(CLOSER_ANTIGO), destino: numeroParaCopia(CLOSER), wabaDestino: WABA_CLOSER,
    token: "tk-closer", executar: true, buscar: meta.buscar, criadoPor: "super",
    subirMidia: () => Promise.resolve({ handle: "h-destino" }),
  });
  assert(r.ok);
  assertEquals(r.resultado.copiados.map((c) => c.name), ["aval", "video"]);
  assertEquals(r.resultado.pulados.map((c) => c.motivo), ["já existe na conta de destino"]);
  assertEquals(meta.chamadas.every((c) => c.url.includes(`/${WABA_CLOSER}/message_templates`)), true);
  assertEquals(meta.chamadas[1].corpo.components[0].example.header_handle, ["h-destino"]);
  const criados = banco.log.inserts;
  assertEquals(criados.map((c) => [c.waba_id, c.whatsapp_number_id, c.owner_role, c.status]), [
    [WABA_CLOSER, CLOSER, "closer", "PENDING"],
    [WABA_CLOSER, CLOSER, "closer", "PENDING"],
  ]);
});

Deno.test("cópia recusada: outro mundo/dono, mesma conta, destino desativado", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [] });
  const base = { tenantId: T, token: "tk", executar: false, criadoPor: "super" };
  const central = await copiarModelosEntreNumeros(banco.db, {
    ...base, origem: numeroParaCopia(CLOSER_ANTIGO), destino: numeroParaCopia(OFICIAL), wabaDestino: WABA_CENTRAL,
  });
  assertEquals(!central.ok && central.status, 403);
  const outroDono = await copiarModelosEntreNumeros(banco.db, {
    ...base, origem: { ...numeroParaCopia(CLOSER_ANTIGO), dono_user_id: "outro" }, destino: numeroParaCopia(CLOSER), wabaDestino: WABA_CLOSER,
  });
  assertEquals(!outroDono.ok && outroDono.status, 403);
  const mesmaConta = await copiarModelosEntreNumeros(banco.db, {
    ...base, origem: numeroParaCopia(COMERCIAL2), destino: numeroParaCopia(OFICIAL), wabaDestino: WABA_CENTRAL,
  });
  assertEquals(!mesmaConta.ok && mesmaConta.status, 409);
  const desativado = await copiarModelosEntreNumeros(banco.db, {
    ...base, origem: numeroParaCopia(CLOSER), destino: numeroParaCopia(CLOSER_ANTIGO), wabaDestino: WABA_CLOSER_ANTIGA,
  });
  assertEquals(!desativado.ok && desativado.status, 400);
});

Deno.test("cópia: Meta recusa um modelo → vai para falhas, os outros seguem", async () => {
  const banco = bancoFalso({ crm_whatsapp_templates: [aprovadoDoCloserAntigo("a", "aval"), aprovadoDoCloserAntigo("b", "outro")] });
  const meta = metaFalsa({}, (corpo) =>
    corpo.name === "aval"
      ? { status: 400, json: { error: { message: "Invalid parameter", error_user_msg: "Conteúdo não permitido" } } }
      : { status: 200, json: { id: "ok-1", status: "PENDING" } });
  const r = await copiarModelosEntreNumeros(banco.db, {
    tenantId: T, origem: numeroParaCopia(CLOSER_ANTIGO), destino: numeroParaCopia(CLOSER), wabaDestino: WABA_CLOSER,
    token: "tk", executar: true, buscar: meta.buscar, criadoPor: "super",
  });
  assert(r.ok);
  assertEquals(r.resultado.falhas.map((f) => f.motivo), ["a Meta recusou: Conteúdo não permitido"]);
  assertEquals(r.resultado.copiados.map((c) => c.name), ["outro"]);
});

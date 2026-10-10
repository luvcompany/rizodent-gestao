/**
 * Modelos de mensagem são da CONTA do WhatsApp (WABA), não do número.
 *
 * RELATO (09/10/2026): a tela de Modelos, aberta no número padrão (o oficial),
 * mostrava 0 dos 154 aprovados — eles estavam carimbados com o "Comercial 2",
 * que está na MESMA WABA. E "Rascunho → Enviar para aprovação" criava na Meta
 * sem gravar no CRM; excluir com a Meta recusando apagava só aqui.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

type Linha = Record<string, unknown>;

const WABA_CENTRAL = "893372606594069";
const WABA_CLOSER_ANTIGA = "1773640530293332";
const OFICIAL = "num-oficial";
const COMERCIAL2 = "num-comercial-2";
const CONTINGENCIA = "num-contingencia";
const CLOSER_ANTIGO = "num-closer-antigo";

const NUMEROS: Linha[] = [
  { id: OFICIAL, display_name: "Whatsapp - Comercial", phone_e164: "+5577999990001", is_active: true, is_default: true, waba_id: WABA_CENTRAL, mundo: "crc" },
  { id: COMERCIAL2, display_name: "Rizodent - Comercial 2", phone_e164: "+5577999990002", is_active: true, is_default: false, waba_id: WABA_CENTRAL, mundo: "crc" },
  { id: CONTINGENCIA, display_name: "Contingência", phone_e164: "+5577999990003", is_active: false, is_default: false, waba_id: "1042192912129672", mundo: "crc" },
  { id: CLOSER_ANTIGO, display_name: "Closer antigo", phone_e164: "+5577999990004", is_active: false, is_default: false, waba_id: WABA_CLOSER_ANTIGA, mundo: "closer" },
];

const modelo = (id: string, name: string, extra: Linha = {}): Linha => ({
  id, name, category: "UTILITY", language: "pt_BR", status: "APPROVED",
  header_type: null, header_content: null, body_text: `Texto de ${name}`, footer_text: null, buttons: null,
  meta_template_id: `meta-${id}`, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  owner_role: "crc", shared_roles: [], created_by_user_id: "u1",
  waba_id: WABA_CENTRAL, whatsapp_number_id: COMERCIAL2,
  ...extra,
});

let tabelaModelos: Linha[] = [];
const filtrosOr: string[] = [];
const operacoes: { tabela: string; op: string; valor?: unknown }[] = [];
const invoke = vi.fn();

/** Avalia o `or` do PostgREST nas formas que a tela usa. */
function dividir(s: string): string[] {
  const partes: string[] = [];
  let prof = 0;
  let atual = "";
  for (const ch of s) {
    if (ch === "(") prof++;
    if (ch === ")") prof--;
    if (ch === "," && prof === 0) { partes.push(atual); atual = ""; } else atual += ch;
  }
  partes.push(atual);
  return partes;
}
function termo(t: string, l: Linha): boolean {
  if (t.startsWith("and(")) return dividir(t.slice(4, -1)).every((x) => termo(x, l));
  const [col, op, ...resto] = t.split(".");
  const v = resto.join(".");
  if (op === "eq") return String(l[col]) === v;
  if (op === "is" && v === "null") return l[col] == null;
  throw new Error(`termo não suportado: ${t}`);
}

vi.mock("@/integrations/supabase/client", () => {
  const from = (tabela: string) => {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op = "select";
    let valor: unknown;
    const linhas = () => (tabela === "whatsapp_numbers" ? NUMEROS : tabela === "crm_whatsapp_templates" ? tabelaModelos : []);
    const executar = () => {
      if (op !== "select") operacoes.push({ tabela, op, valor });
      const achadas = linhas().filter((l) => filtros.every((f) => f(l)));
      if (op === "update") achadas.forEach((l) => Object.assign(l, valor as Linha));
      return Promise.resolve({ data: achadas.map((l) => ({ ...l })), error: null });
    };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
      neq: (c: string, v: unknown) => { filtros.push((l) => l[c] !== v); return q; },
      is: (c: string, v: unknown) => { filtros.push((l) => (l[c] ?? null) === v); return q; },
      or: (f: string) => { filtrosOr.push(f); filtros.push((l) => dividir(f).some((t) => termo(t, l))); return q; },
      update: (v: unknown) => { op = "update"; valor = v; return q; },
      delete: () => { op = "delete"; return q; },
      insert: (v: unknown) => { op = "insert"; valor = v; return q; },
      single: () => executar().then((r) => ({ data: r.data[0] ?? null, error: null })),
      maybeSingle: () => executar().then((r) => ({ data: r.data[0] ?? null, error: null })),
      then: (ok: (r: unknown) => unknown, err?: (e: unknown) => unknown) => executar().then(ok, err),
    });
    return q;
  };
  return {
    supabase: {
      from: vi.fn(from),
      rpc: vi.fn(() => Promise.resolve({ data: "crc", error: null })),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "u1" } } })) },
      functions: { invoke: (...args: unknown[]) => invoke(...args) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userRole: "crc", user: { id: "u1" } }) }));
vi.mock("@/hooks/useOpcoesDoTenant", () => ({ useServicosDoTenant: () => [] }));
vi.mock("@/hooks/useVocab", () => ({ useVocab: () => ({ servicosInteresse: [] }) }));
vi.mock("@/components/automation/automationMediaUpload", () => ({ uploadAutomationMedia: vi.fn() }));

import CrmModelos from "@/pages/CrmModelos";
import {
  donoDoModeloNaTela,
  filtroDeModelosDaConta,
  numeroAtivoDaConta,
  situacaoDosNumeros,
  somenteModelosDeNumerosAtivos,
} from "@/lib/whatsappNumeros";
import { deduplicarNaConta, deduplicateTemplates } from "@/lib/templateUtils";

const ativos = NUMEROS.filter((n) => n.is_active) as { id: string; waba_id: string; is_default: boolean }[];
const situacao = situacaoDosNumeros(NUMEROS as { id: string; waba_id: string; is_active: boolean }[]);

describe("regras por conta (funções puras)", () => {
  it("filtro da conta: um só `or` com a WABA, os rascunhos sem conta do número e os sem número", () => {
    expect(filtroDeModelosDaConta({ id: OFICIAL, waba_id: WABA_CENTRAL })).toBe(
      `waba_id.eq.${WABA_CENTRAL},and(waba_id.is.null,whatsapp_number_id.eq.${OFICIAL}),and(waba_id.is.null,whatsapp_number_id.is.null)`,
    );
    expect(filtroDeModelosDaConta({ id: OFICIAL, waba_id: null })).toBe(`whatsapp_number_id.eq.${OFICIAL},whatsapp_number_id.is.null`);
    expect(filtroDeModelosDaConta(null)).toBeNull();
  });

  it("esconde por CONTA: número desligado numa conta viva não esconde; conta só com número desligado esconde", () => {
    const lista = [
      { id: "a", waba_id: WABA_CENTRAL, whatsapp_number_id: CONTINGENCIA },
      { id: "b", waba_id: WABA_CLOSER_ANTIGA, whatsapp_number_id: CLOSER_ANTIGO },
      { id: "c", waba_id: "waba-que-a-rls-nao-mostra", whatsapp_number_id: "num-invisivel" },
      { id: "d", waba_id: null, whatsapp_number_id: CONTINGENCIA },
      { id: "e", waba_id: null, whatsapp_number_id: null },
    ];
    expect(somenteModelosDeNumerosAtivos(lista, situacao).map((m) => m.id)).toEqual(["a", "c", "e"]);
  });

  it("número para gravar/operar: nunca um desativado; o da conta do modelo", () => {
    expect(numeroAtivoDaConta({ whatsapp_number_id: COMERCIAL2, waba_id: WABA_CENTRAL }, ativos, OFICIAL)).toBe(COMERCIAL2);
    expect(numeroAtivoDaConta({ whatsapp_number_id: CONTINGENCIA, waba_id: WABA_CENTRAL }, ativos, COMERCIAL2)).toBe(COMERCIAL2);
    expect(numeroAtivoDaConta({ whatsapp_number_id: CONTINGENCIA, waba_id: WABA_CENTRAL }, ativos, null)).toBe(OFICIAL);
    expect(numeroAtivoDaConta({ whatsapp_number_id: CLOSER_ANTIGO, waba_id: WABA_CLOSER_ANTIGA }, ativos, OFICIAL)).toBe(OFICIAL);
    expect(numeroAtivoDaConta({ whatsapp_number_id: CLOSER_ANTIGO, waba_id: WABA_CLOSER_ANTIGA }, ativos, null)).toBeNull();
  });

  it("dono do modelo criado na tela: número de closer → 'closer'; gerente/superadmin → NULL; SDR → 'crc'", () => {
    expect(donoDoModeloNaTela("gerente", "closer")).toBe("closer");
    expect(donoDoModeloNaTela("gerente", "crc")).toBeNull();
    expect(donoDoModeloNaTela("superadmin", null)).toBeNull();
    expect(donoDoModeloNaTela("sdr", "crc")).toBe("crc");
    expect(donoDoModeloNaTela("posvenda", "crc")).toBe("posvenda");
  });

  it("uma linha por (conta, nome, idioma): fica a que está na Meta; rascunho sem conta conta pela WABA do número", () => {
    const wabaDoNumero = new Map([[OFICIAL, WABA_CENTRAL]]);
    const lista = [
      { id: "1", name: "x", language: "pt_BR", waba_id: WABA_CENTRAL, whatsapp_number_id: COMERCIAL2, meta_template_id: "m1" },
      { id: "2", name: "x", language: "pt_BR", waba_id: null, whatsapp_number_id: OFICIAL, meta_template_id: null, updated_at: "2099" },
      { id: "3", name: "x", language: "en_US", waba_id: WABA_CENTRAL, whatsapp_number_id: COMERCIAL2, meta_template_id: "m3" },
    ];
    expect(deduplicarNaConta(lista, wabaDoNumero).map((m) => m.id)).toEqual(["1", "3"]);
  });

  it("deduplicateTemplates (Transmissão/Automações/chat) junta pela WABA, não pelo número", () => {
    const lista = [
      { name: "lembrete", waba_id: WABA_CENTRAL, whatsapp_number_id: OFICIAL, updated_at: "1" },
      { name: "lembrete", waba_id: WABA_CENTRAL, whatsapp_number_id: COMERCIAL2, updated_at: "2" },
      { name: "lembrete", waba_id: "outra", whatsapp_number_id: "n3", updated_at: "1" },
    ];
    expect(deduplicateTemplates(lista).length).toBe(2);
  });
});

describe("tela de Modelos", () => {
  beforeEach(() => {
    filtrosOr.length = 0;
    operacoes.length = 0;
    invoke.mockReset();
    tabelaModelos = [
      modelo("t1", "lembrete_agendamento_vespera"),
      modelo("t2", "mensagemnaocompareceu"),
      modelo("t3", "apagado_na_meta", { status: "DELETED" }),
      modelo("t4", "do_closer_antigo", { waba_id: WABA_CLOSER_ANTIGA, whatsapp_number_id: CLOSER_ANTIGO, owner_role: "closer" }),
      modelo("t5", "rascunho_do_oficial", { status: "DRAFT", meta_template_id: null, waba_id: null, whatsapp_number_id: OFICIAL }),
    ];
  });

  it("aberta no número padrão (oficial), mostra os modelos da conta carimbados no Comercial 2", async () => {
    render(<CrmModelos />);
    expect(await screen.findByText("lembrete_agendamento_vespera")).toBeInTheDocument();
    expect(screen.getByText("mensagemnaocompareceu")).toBeInTheDocument();
    expect(screen.getByText("rascunho_do_oficial")).toBeInTheDocument();
    expect(screen.queryByText("apagado_na_meta")).not.toBeInTheDocument();
    expect(screen.queryByText("do_closer_antigo")).not.toBeInTheDocument();
    expect(filtrosOr.at(-1)).toBe(filtroDeModelosDaConta({ id: OFICIAL, waba_id: WABA_CENTRAL }));
  });

  it("excluir: se a function recusa, nada é apagado localmente", async () => {
    invoke.mockResolvedValue({ data: { error: "A Meta não removeu o modelo: permissão" }, error: null });
    render(<CrmModelos />);
    await screen.findByText("lembrete_agendamento_vespera");
    fireEvent.click(screen.getAllByTitle("Excluir modelo")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const [, { body }] = invoke.mock.calls[0] as [string, { body: Linha }];
    expect(body).toMatchObject({ action: "delete", template_id: "t1", whatsapp_number_id: COMERCIAL2 });
    await new Promise((r) => setTimeout(r, 20));
    expect(operacoes.filter((o) => o.op === "delete")).toEqual([]);
  });

  it("Rascunho → Enviar para aprovação manda o rascunho_id e grava a conta no rascunho", async () => {
    invoke.mockResolvedValue({ data: { success: true, id: "t5", meta_template_id: "m-novo", status: "PENDING" }, error: null });
    render(<CrmModelos />);
    await screen.findByText("rascunho_do_oficial");
    fireEvent.click(screen.getByTitle("Editar rascunho"));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar para aprovação" }));
    // (o editor também pede os formulários da conta: list_flows)
    const doCreate = () => invoke.mock.calls.map((c) => (c[1] as { body: Linha }).body).find((b) => b.action === "create");
    await waitFor(() => expect(doCreate()).toBeTruthy());
    expect(doCreate()).toMatchObject({ action: "create", rascunho_id: "t5", whatsapp_number_id: OFICIAL, name: "rascunho_do_oficial" });
    const update = operacoes.find((o) => o.op === "update");
    expect(update?.valor).toMatchObject({ whatsapp_number_id: OFICIAL, waba_id: WABA_CENTRAL });
    // A linha do rascunho virou o modelo: nada de apagar "órfão".
    expect(operacoes.filter((o) => o.op === "delete")).toEqual([]);
  });
});

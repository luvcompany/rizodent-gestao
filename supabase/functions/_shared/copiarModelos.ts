/**
 * Copiar os modelos aprovados de um número para outro número do MESMO mundo
 * (e do mesmo dono, no caso de closer/recepção) que está em OUTRA conta (WABA).
 *
 * Caso real (09/10/2026): o closer trocou de número; o antigo
 * (WABA 1773640530293332) tinha 6 modelos aprovados e o novo
 * (WABA 2077987393589730) nasceu com 0. Modelo é da conta: para o número novo
 * usar, a Meta precisa aprovar de novo, com o mesmo nome, na conta nova.
 *
 * O payload sai do BANCO (o que o CRM guardou da Meta), não de outra leitura
 * da Meta. Fica de fora o que não dá para recriar fielmente em outra conta:
 *  - botão de formulário (Flow): o formulário pertence à conta de origem;
 *  - modelo de autenticação: formato próprio da Meta;
 *  - botão ou cabeçalho de tipo que a cópia não conhece.
 *
 * DESLIGADO por padrão: quem chama decide `executar`; sem isso só devolve o que
 * mandaria (nenhuma chamada à Meta). A action só existe para o superadmin.
 */

import {
  type Buscador,
  type ConteudoDoModelo,
  gravarModeloCriado,
  META_GRAPH,
  papelDonoPeloMundo,
} from "./modelosDaConta.ts";

export type NumeroParaCopia = {
  id: string;
  tenant_id: string;
  waba_id: string | null;
  mundo: string | null;
  dono_user_id: string | null;
  is_active: boolean;
};

export type LinhaParaCopia = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  header_type: string | null;
  header_content: string | null;
  body_text: string | null;
  footer_text: string | null;
  buttons: unknown;
  owner_role: string | null;
};

/** Amostras de cada {{N}} — as mesmas da tela de Modelos (o que o envio põe ali). */
const AMOSTRAS: Record<number, string> = {
  1: "Maria Silva",
  2: "Quarta, 20/05 às 14:00",
  3: "Consulta",
  4: "(11) 99999-9999",
  5: "Anúncio",
};
const amostra = (n: number) => AMOSTRAS[n] ?? `Exemplo ${n}`;

function indicesDasVariaveis(texto: string | null | undefined): number[] {
  const vistos = new Set<number>();
  for (const m of String(texto || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) vistos.add(n);
  }
  return [...vistos].sort((a, b) => a - b);
}

export type PayloadDaCopia = { name: string; language: string; category: string; components: any[] };

export type MontagemDaCopia =
  | { ok: true; payload: PayloadDaCopia; midia: { tipo: string; url: string } | null }
  | { ok: false; motivo: string };

/** Marca no lugar do header_handle até a mídia ser enviada à conta de destino. */
export const HANDLE_PENDENTE = "__handle_da_conta_de_destino__";

const MIDIA = new Set(["IMAGE", "VIDEO", "DOCUMENT"]);

/** Payload de criação na Meta a partir da linha do banco (ou o motivo de pular). */
export function montarPayloadDaCopia(linha: LinhaParaCopia): MontagemDaCopia {
  if (linha.status !== "APPROVED") return { ok: false, motivo: "não está aprovado" };
  const categoria = String(linha.category || "").toUpperCase();
  if (categoria === "AUTHENTICATION") {
    return { ok: false, motivo: "modelo de autenticação (formato próprio da Meta)" };
  }
  if (!linha.body_text) return { ok: false, motivo: "sem corpo" };

  const botoes = Array.isArray(linha.buttons) ? (linha.buttons as any[]) : [];
  if (botoes.some((b) => String(b?.type || "").toUpperCase() === "FLOW")) {
    return { ok: false, motivo: "botão de formulário (Flow): o formulário é da conta de origem" };
  }

  const components: any[] = [];
  let midia: { tipo: string; url: string } | null = null;
  const tipoCabecalho = String(linha.header_type || "").toUpperCase();
  if (tipoCabecalho === "TEXT") {
    const texto = String(linha.header_content || "");
    if (!texto) return { ok: false, motivo: "cabeçalho de texto vazio" };
    const comp: any = { type: "HEADER", format: "TEXT", text: texto };
    const vars = indicesDasVariaveis(texto);
    if (vars.length > 0) comp.example = { header_text: vars.map(amostra) };
    components.push(comp);
  } else if (MIDIA.has(tipoCabecalho)) {
    const url = String(linha.header_content || "");
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, motivo: "cabeçalho de mídia sem o arquivo guardado no CRM" };
    }
    midia = { tipo: tipoCabecalho, url };
    components.push({ type: "HEADER", format: tipoCabecalho, example: { header_handle: [HANDLE_PENDENTE] } });
  } else if (tipoCabecalho) {
    return { ok: false, motivo: `cabeçalho ${tipoCabecalho} não é copiado` };
  }

  const corpo: any = { type: "BODY", text: linha.body_text };
  const varsCorpo = indicesDasVariaveis(linha.body_text);
  if (varsCorpo.length > 0) corpo.example = { body_text: [varsCorpo.map(amostra)] };
  components.push(corpo);

  if (linha.footer_text) components.push({ type: "FOOTER", text: linha.footer_text });

  if (botoes.length > 0) {
    const daMeta: any[] = [];
    for (const b of botoes) {
      const tipo = String(b?.type || "").toUpperCase();
      if (tipo === "QUICK_REPLY") daMeta.push({ type: "QUICK_REPLY", text: b.text });
      else if (tipo === "URL") {
        const btn: any = { type: "URL", text: b.text, url: b.url };
        if (Array.isArray(b.example) && b.example.length > 0) btn.example = b.example;
        else if (/\{\{\s*\d+\s*\}\}/.test(String(b.url || ""))) {
          btn.example = [String(b.url).replace(/\{\{\s*\d+\s*\}\}/g, "exemplo")];
        }
        daMeta.push(btn);
      } else if (tipo === "PHONE_NUMBER") daMeta.push({ type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number });
      else if (tipo === "COPY_CODE") daMeta.push({ type: "COPY_CODE", example: b.example });
      else return { ok: false, motivo: `botão ${tipo || "sem tipo"} não é copiado` };
    }
    components.push({ type: "BUTTONS", buttons: daMeta });
  }

  return {
    ok: true,
    payload: { name: linha.name, language: linha.language, category: categoria, components },
    midia,
  };
}

export type CopiaEntreNumeros = {
  tenantId: string;
  origem: NumeroParaCopia;
  destino: NumeroParaCopia;
  /** WABA de destino como a integração do número de destino diz. */
  wabaDestino: string;
  /** Token da conta de destino. */
  token: string;
  /** Só estes nomes (vazio/null = todos os aprovados da origem). */
  nomes?: string[] | null;
  /** false = só simula: monta e devolve os payloads, não chama a Meta. */
  executar: boolean;
  buscar?: Buscador;
  /** Sobe a mídia do cabeçalho para a conta de destino e devolve o handle. */
  subirMidia?: (url: string, tipo: string) => Promise<{ handle?: string; error?: string }>;
  criadoPor: string | null;
  agora?: string;
};

type ItemDaCopia = { name: string; language: string };

export type ResultadoDaCopia = {
  simulado: boolean;
  previstos: (ItemDaCopia & { payload: PayloadDaCopia; midia: string | null })[];
  copiados: (ItemDaCopia & { id: string; meta_template_id: string; status: string })[];
  pulados: (ItemDaCopia & { motivo: string })[];
  falhas: (ItemDaCopia & { motivo: string })[];
};

/** Mesmo mundo e, em mundo com dono (closer/recepção), mesmo dono. */
export function mesmoMundoEDono(a: NumeroParaCopia, b: NumeroParaCopia): boolean {
  const ma = a.mundo || "crc";
  const mb = b.mundo || "crc";
  if (ma !== mb) return false;
  if (ma === "closer" || ma === "recepcao") return !!a.dono_user_id && a.dono_user_id === b.dono_user_id;
  return true;
}

export async function copiarModelosEntreNumeros(
  supabase: any,
  p: CopiaEntreNumeros,
): Promise<{ ok: true; resultado: ResultadoDaCopia } | { ok: false; status: number; erro: string }> {
  const { origem, destino } = p;
  if (origem.id === destino.id) return { ok: false, status: 400, erro: "Origem e destino são o mesmo número." };
  if (origem.tenant_id !== p.tenantId || destino.tenant_id !== p.tenantId) {
    return { ok: false, status: 404, erro: "Número não encontrado neste cliente." };
  }
  if (!destino.is_active) return { ok: false, status: 400, erro: "O número de destino está desativado." };
  if (!mesmoMundoEDono(origem, destino)) {
    return { ok: false, status: 403, erro: "Os dois números não são da mesma equipe (mundo/dono)." };
  }
  if (!origem.waba_id) return { ok: false, status: 400, erro: "O número de origem não tem conta (WABA) cadastrada." };
  if (!p.wabaDestino) return { ok: false, status: 400, erro: "O número de destino não tem conta (WABA)." };
  if (String(origem.waba_id) === String(p.wabaDestino)) {
    return { ok: false, status: 409, erro: "Os dois números estão na mesma conta: os modelos já valem para os dois." };
  }

  const [{ data: daConta, error: e1 }, { data: legado, error: e2 }, { data: noDestino, error: e3 }] = await Promise.all([
    supabase.from("crm_whatsapp_templates")
      .select("id, name, language, category, status, header_type, header_content, body_text, footer_text, buttons, owner_role")
      .eq("tenant_id", p.tenantId).eq("waba_id", origem.waba_id).eq("status", "APPROVED"),
    supabase.from("crm_whatsapp_templates")
      .select("id, name, language, category, status, header_type, header_content, body_text, footer_text, buttons, owner_role")
      .eq("tenant_id", p.tenantId).is("waba_id", null).eq("whatsapp_number_id", origem.id).eq("status", "APPROVED"),
    supabase.from("crm_whatsapp_templates")
      .select("name, language, status")
      .eq("tenant_id", p.tenantId).eq("waba_id", p.wabaDestino),
  ]);
  const erroLeitura = e1 || e2 || e3;
  if (erroLeitura) return { ok: false, status: 500, erro: `Leitura dos modelos falhou: ${erroLeitura.message || erroLeitura}` };

  const chave = (n: string, l: string) => `${n}\u0000${l}`;
  const jaNoDestino = new Set(
    ((noDestino as any[]) || []).filter((r) => r.status !== "DELETED").map((r) => chave(r.name, r.language)),
  );
  const filtro = (p.nomes || []).filter(Boolean);
  const vistos = new Set<string>();
  const resultado: ResultadoDaCopia = { simulado: !p.executar, previstos: [], copiados: [], pulados: [], falhas: [] };
  const buscar = p.buscar ?? fetch;

  for (const linha of [...((daConta as any[]) || []), ...((legado as any[]) || [])] as LinhaParaCopia[]) {
    const k = chave(linha.name, linha.language);
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (filtro.length > 0 && !filtro.includes(linha.name)) continue;
    const item = { name: linha.name, language: linha.language };
    if (jaNoDestino.has(k)) {
      resultado.pulados.push({ ...item, motivo: "já existe na conta de destino" });
      continue;
    }
    const montagem = montarPayloadDaCopia(linha);
    if (!montagem.ok) {
      resultado.pulados.push({ ...item, motivo: montagem.motivo });
      continue;
    }
    if (!p.executar) {
      resultado.previstos.push({ ...item, payload: montagem.payload, midia: montagem.midia?.url ?? null });
      continue;
    }

    const payload = montagem.payload;
    if (montagem.midia) {
      if (!p.subirMidia) {
        resultado.falhas.push({ ...item, motivo: "sem como enviar a mídia do cabeçalho à conta de destino" });
        continue;
      }
      const up = await p.subirMidia(montagem.midia.url, montagem.midia.tipo);
      if (!up.handle) {
        resultado.falhas.push({ ...item, motivo: `mídia do cabeçalho: ${up.error || "sem handle"}` });
        continue;
      }
      for (const c of payload.components) {
        if (c.type === "HEADER" && c.example?.header_handle?.[0] === HANDLE_PENDENTE) c.example.header_handle = [up.handle];
      }
    }

    let res: Response;
    let dados: any;
    try {
      res = await buscar(`${META_GRAPH}/${p.wabaDestino}/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      dados = await res.json().catch(() => ({}));
    } catch (e) {
      resultado.falhas.push({ ...item, motivo: `falha de rede: ${String(e)}` });
      continue;
    }
    if (!res.ok || !dados?.id) {
      const motivo = dados?.error?.error_user_msg || dados?.error?.message || `HTTP ${res.status}`;
      resultado.falhas.push({ ...item, motivo: `a Meta recusou: ${motivo}` });
      continue;
    }

    const conteudo: ConteudoDoModelo = {
      name: linha.name,
      language: linha.language,
      category: linha.category,
      header_type: linha.header_type,
      header_content: linha.header_content,
      body_text: String(linha.body_text || ""),
      footer_text: linha.footer_text,
      buttons: Array.isArray(linha.buttons) ? (linha.buttons as unknown[]) : null,
    };
    const status = String(dados.status || "PENDING");
    const gravado = await gravarModeloCriado(supabase, {
      tenantId: p.tenantId,
      wabaId: p.wabaDestino,
      numeroId: destino.id,
      rascunhoId: null,
      conteudo,
      metaTemplateId: String(dados.id),
      status,
      criadoPor: p.criadoPor,
      // Mesmo mundo: o dono do modelo de origem vale no destino.
      ownerRole: linha.owner_role ?? null,
      papelDonoDoNumero: papelDonoPeloMundo(destino.mundo),
      agora: p.agora,
    });
    if (!gravado.ok) {
      resultado.falhas.push({ ...item, motivo: `Criado na Meta, mas não gravado no CRM: ${gravado.motivo}` });
      continue;
    }
    resultado.copiados.push({ ...item, id: gravado.id, meta_template_id: String(dados.id), status });
  }

  return { ok: true, resultado };
}

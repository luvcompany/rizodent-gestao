/**
 * Modelos de mensagem (templates) por CONTA do WhatsApp (WABA).
 *
 * O modelo pertence à conta, não ao número: dois números na mesma WABA usam os
 * mesmos modelos. Até 09/10/2026 a sincronização rodava uma passada POR
 * INTEGRAÇÃO; com o número oficial (`whatsapp_config`) e o "Comercial 2" na
 * mesma WABA, cada passada regravava o whatsapp_number_id que a outra tinha
 * gravado — 400 mil UPDATEs em crm_whatsapp_templates — e a tela de Modelos,
 * que filtrava por número, mostrava 0 dos 154 aprovados no número padrão.
 * E um erro da Meta no meio da paginação apagava os modelos que não tinham
 * vindo: eles voltavam com id novo e as automações (que guardam o id) quebravam.
 *
 * Regras daqui (usadas pelo cron e pelo "Sincronizar com Meta"):
 *  - uma passada por (cliente, WABA);
 *  - número de modelo novo sempre pela mesma regra: o padrão ativo da conta,
 *    senão o ativo mais antigo;
 *  - whatsapp_number_id que já aponta para número ATIVO da mesma conta não muda;
 *  - linha sem diferença não é regravada;
 *  - a Meta falhou em qualquer página → nada é gravado nem removido;
 *  - modelo que sumiu da Meta vira status 'DELETED' (a linha e o id ficam) e
 *    a linha é reaproveitada se o mesmo nome+idioma reaparecer na conta.
 */

export const META_GRAPH = "https://graph.facebook.com/v25.0";

export type Buscador = (url: string, init?: RequestInit) => Promise<Response>;

export type ListagemDaMeta =
  | { ok: true; modelos: any[] }
  | { ok: false; erro: string; paginasLidas: number };

/**
 * Todos os modelos da WABA, página por página. Qualquer página que falhe
 * (HTTP, rede, corpo sem lista) devolve erro — nunca uma lista parcial, porque
 * quem sincroniza trataria o que faltou como "apagado na Meta".
 */
export async function listarModelosDaMeta(
  wabaId: string,
  token: string,
  buscar: Buscador = fetch,
): Promise<ListagemDaMeta> {
  const modelos: any[] = [];
  let url: string | null =
    `${META_GRAPH}/${wabaId}/message_templates?limit=100&fields=id,name,category,language,status,components`;
  let paginas = 0;
  while (url) {
    let res: Response;
    let dados: any;
    try {
      res = await buscar(url, { headers: { Authorization: `Bearer ${token}` } });
      dados = await res.json().catch(() => null);
    } catch (e) {
      return { ok: false, erro: `falha de rede na página ${paginas + 1}: ${String(e)}`, paginasLidas: paginas };
    }
    if (!res.ok) {
      const motivo = dados?.error?.message || `HTTP ${res.status}`;
      return { ok: false, erro: `a Meta recusou a página ${paginas + 1}: ${motivo}`, paginasLidas: paginas };
    }
    if (!Array.isArray(dados?.data)) {
      return { ok: false, erro: `a página ${paginas + 1} veio sem a lista de modelos`, paginasLidas: paginas };
    }
    modelos.push(...dados.data);
    paginas++;
    url = dados?.paging?.next || null;
    if (paginas > 500) {
      return { ok: false, erro: "paginação da Meta não terminou (mais de 500 páginas)", paginasLidas: paginas };
    }
  }
  return { ok: true, modelos };
}

export type LinhaDoModelo = {
  meta_template_id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  header_type: string | null;
  header_content: string | null;
  body_text: string | null;
  footer_text: string | null;
  buttons: unknown[] | null;
};

/** Modelo como a Meta devolve → colunas de crm_whatsapp_templates. */
export function linhaDoModeloDaMeta(t: any): LinhaDoModelo {
  const comps: any[] = Array.isArray(t?.components) ? t.components : [];
  const header = comps.find((c) => c?.type === "HEADER");
  const corpo = comps.find((c) => c?.type === "BODY");
  const rodape = comps.find((c) => c?.type === "FOOTER");
  const botoes = comps.find((c) => c?.type === "BUTTONS");
  return {
    meta_template_id: String(t?.id ?? ""),
    name: String(t?.name ?? ""),
    category: String(t?.category ?? ""),
    language: String(t?.language ?? ""),
    status: String(t?.status ?? ""),
    header_type: header?.format || null,
    header_content: header?.text || header?.example?.header_handle?.[0] || null,
    body_text: corpo?.text || null,
    footer_text: rodape?.text || null,
    buttons: botoes?.buttons || null,
  };
}

export type NumeroDoCliente = {
  id: string;
  tenant_id?: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: string | null;
  mundo?: string | null;
  dono_user_id?: string | null;
};

/**
 * Números ATIVOS da conta, na ordem da regra: padrão primeiro, depois o mais
 * antigo (desempate pelo id — determinístico). Um número é da conta pela
 * waba_id dele ou por ser o phone_number_id de uma integração da conta.
 */
export function numerosAtivosDaConta(
  numeros: NumeroDoCliente[],
  wabaId: string,
  pnidsDaConta: (string | null | undefined)[] = [],
): NumeroDoCliente[] {
  const pnids = new Set(pnidsDaConta.filter(Boolean).map(String));
  return numeros
    .filter((n) =>
      n.is_active &&
      ((!!n.waba_id && String(n.waba_id) === String(wabaId)) ||
        (!!n.phone_number_id && pnids.has(String(n.phone_number_id))))
    )
    .sort((a, b) =>
      Number(!!b.is_default) - Number(!!a.is_default) ||
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
      a.id.localeCompare(b.id)
    );
}

/** O número que recebe os modelos novos da conta (null = conta sem número ativo). */
export function numeroDaConta(
  numeros: NumeroDoCliente[],
  wabaId: string,
  pnidsDaConta: (string | null | undefined)[] = [],
): string | null {
  return numerosAtivosDaConta(numeros, wabaId, pnidsDaConta)[0]?.id ?? null;
}

export type IntegracaoWhatsapp = {
  id?: string;
  key: string;
  tenant_id: string;
  config: Record<string, any> | null;
};

export type ContaWhatsapp = { chave: string; tenantId: string; wabaId: string; integracoes: IntegracaoWhatsapp[] };

/**
 * Agrupa as integrações por conta (cliente + WABA): é UMA passada por conta.
 * Integração sem token ou sem WABA fica de fora (semCredencial).
 */
export function contasDasIntegracoes(integracoes: IntegracaoWhatsapp[]): {
  contas: ContaWhatsapp[];
  semCredencial: IntegracaoWhatsapp[];
} {
  const contas = new Map<string, ContaWhatsapp>();
  const semCredencial: IntegracaoWhatsapp[] = [];
  for (const intg of integracoes) {
    const cfg = intg.config ?? {};
    const token = cfg.access_token || cfg.token || "";
    const wabaId = String(cfg.waba_id || "");
    if (!token || !wabaId) {
      semCredencial.push(intg);
      continue;
    }
    const chave = `${intg.tenant_id}|${wabaId}`;
    const conta = contas.get(chave) ?? { chave, tenantId: intg.tenant_id, wabaId, integracoes: [] };
    conta.integracoes.push(intg);
    contas.set(chave, conta);
  }
  return { contas: [...contas.values()], semCredencial };
}

/**
 * Tokens para ler a conta: o da integração do número escolhido primeiro; os
 * das outras integrações da mesma conta como reserva (token vencido de uma).
 */
export function tokensDaConta(conta: ContaWhatsapp, pnidEscolhido: string | null): string[] {
  const doEscolhido = (i: IntegracaoWhatsapp) =>
    Number(!!pnidEscolhido && String(i.config?.phone_number_id || "") === String(pnidEscolhido));
  return [...conta.integracoes]
    .sort((a, b) => doEscolhido(b) - doEscolhido(a))
    .map((i) => String(i.config?.access_token || i.config?.token || ""))
    .filter((t, i, todos) => !!t && todos.indexOf(t) === i);
}

/** Dono pelo mundo do número: closer/recepção → o papel; central → null. */
export function papelDonoPeloMundo(mundo: string | null | undefined): string | null {
  return mundo === "closer" || mundo === "recepcao" ? mundo : null;
}

/**
 * Papel de quem chama como dono do modelo. Superadmin e gerente gravam NULL
 * (modelo geral: 'gerente' esconderia o modelo da central inteira); a SDR
 * vive no mundo do CRC e grava 'crc'.
 */
export function papelDoChamadorComoDono(papel: string | null | undefined): string | null {
  if (!papel || papel === "superadmin" || papel === "gerente") return null;
  if (papel === "sdr") return "crc";
  return papel;
}

/** owner_role = dono do número (closer/recepção) ?? papel de quem chama. */
export function donoDoModelo(papelDonoDoNumero: string | null, papelDoChamador: string | null | undefined): string | null {
  return papelDonoDoNumero ?? papelDoChamadorComoDono(papelDoChamador);
}

/** Comparação de JSON sem depender da ordem das chaves (o jsonb reordena). */
export function jsonIgual(a: unknown, b: unknown): boolean {
  const canonico = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonico);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>).sort().reduce((acc, k) => {
        acc[k] = canonico((v as Record<string, unknown>)[k]);
        return acc;
      }, {} as Record<string, unknown>);
    }
    return v ?? null;
  };
  return JSON.stringify(canonico(a ?? null)) === JSON.stringify(canonico(b ?? null));
}

/** Link guardado no nosso Storage: estável, nunca é trocado pelo da CDN da Meta. */
export function midiaNoNossoStorage(valor: string | null | undefined): boolean {
  const v = String(valor || "");
  return v.includes("/storage/v1/object/public/") || v.includes("/storage/v1/object/sign/");
}

/**
 * Mesmo conteúdo de cabeçalho? Para link da CDN da Meta, a assinatura (query
 * string) muda a cada leitura; o arquivo é o mesmo se o caminho é o mesmo.
 */
export function mesmoCabecalho(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === y) return true;
  if (!x || !y) return false;
  const semQuery = (s: string) => (/^https?:\/\//i.test(s) ? s.split("?")[0] : s);
  return semQuery(x) === semQuery(y);
}

type LinhaLocal = {
  id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  status: string;
  category: string | null;
  header_type: string | null;
  header_content: string | null;
  body_text: string | null;
  footer_text: string | null;
  buttons: unknown;
  owner_role: string | null;
  whatsapp_number_id: string | null;
  waba_id: string | null;
  updated_at: string | null;
};

const COLUNAS =
  "id, meta_template_id, name, language, status, category, header_type, header_content, body_text, footer_text, buttons, owner_role, whatsapp_number_id, waba_id, updated_at";

const PAGINA_LOCAL = 1000;

async function lerTodas(montar: () => any): Promise<{ linhas: LinhaLocal[]; erro: string | null }> {
  const linhas: LinhaLocal[] = [];
  for (let de = 0; ; de += PAGINA_LOCAL) {
    const { data, error } = await montar().order("id", { ascending: true }).range(de, de + PAGINA_LOCAL - 1);
    if (error) return { linhas, erro: error.message || String(error) };
    const pagina = (data || []) as LinhaLocal[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA_LOCAL) break;
  }
  return { linhas, erro: null };
}

const chaveNomeIdioma = (name: string, language: string) => `${name}\u0000${language}`;

export type SincronizacaoDaConta = {
  tenantId: string;
  wabaId: string;
  /** Listagem COMPLETA da Meta (só chame com ListagemDaMeta ok). */
  modelosMeta: any[];
  /** Números do cliente (ativos e inativos), com o mundo de cada um. */
  numeros: NumeroDoCliente[];
  /** phone_number_id das integrações desta conta (acha número sem waba_id). */
  pnidsDaConta?: (string | null | undefined)[];
  /** Papel de quem sincroniza (null = cron): dono dos modelos NOVOS da central. */
  papelDoChamador?: string | null;
  agora?: string;
};

export type ResultadoDaConta = {
  numeroEscolhido: string | null;
  inseridos: number;
  atualizados: number;
  inalterados: number;
  marcadosExcluidos: number;
  erros: string[];
};

/**
 * Grava no CRM a listagem da Meta de UMA conta. Só escreve o que mudou.
 */
export async function sincronizarConta(supabase: any, p: SincronizacaoDaConta): Promise<ResultadoDaConta> {
  const agora = p.agora ?? new Date().toISOString();
  const ativos = numerosAtivosDaConta(p.numeros, p.wabaId, p.pnidsDaConta ?? []);
  const idsAtivos = new Set(ativos.map((n) => n.id));
  const escolhido = ativos[0]?.id ?? null;
  const mundoPorId = new Map(p.numeros.map((n) => [n.id, n.mundo ?? null]));
  const res: ResultadoDaConta = {
    numeroEscolhido: escolhido,
    inseridos: 0,
    atualizados: 0,
    inalterados: 0,
    marcadosExcluidos: 0,
    erros: [],
  };

  // Linhas da conta + rascunhos/legado sem waba_id gravados num número desta conta.
  const daConta = await lerTodas(() =>
    supabase.from("crm_whatsapp_templates").select(COLUNAS).eq("tenant_id", p.tenantId).eq("waba_id", p.wabaId)
  );
  if (daConta.erro) {
    res.erros.push(`leitura dos modelos locais falhou: ${daConta.erro}`);
    return res;
  }
  let semConta: LinhaLocal[] = [];
  if (idsAtivos.size > 0) {
    const r = await lerTodas(() =>
      supabase.from("crm_whatsapp_templates").select(COLUNAS).eq("tenant_id", p.tenantId)
        .is("waba_id", null).in("whatsapp_number_id", [...idsAtivos])
    );
    if (r.erro) {
      res.erros.push(`leitura dos modelos locais falhou: ${r.erro}`);
      return res;
    }
    semConta = r.linhas;
  }
  const linhas = [...daConta.linhas, ...semConta];

  const idsDaMeta = new Set(p.modelosMeta.map((t) => String(t?.id ?? "")).filter(Boolean));
  const porMetaId = new Map<string, LinhaLocal>();
  const porNomeIdioma = new Map<string, LinhaLocal[]>();
  for (const l of linhas) {
    if (l.meta_template_id && !porMetaId.has(l.meta_template_id)) porMetaId.set(l.meta_template_id, l);
    const k = chaveNomeIdioma(l.name, l.language);
    porNomeIdioma.set(k, [...(porNomeIdioma.get(k) ?? []), l]);
  }
  const usadas = new Set<string>();

  for (const t of p.modelosMeta) {
    const m = linhaDoModeloDaMeta(t);
    if (!m.meta_template_id || !m.name) continue;

    let linha = porMetaId.get(m.meta_template_id);
    if (linha && usadas.has(linha.id)) linha = undefined;
    if (!linha) {
      // Reaproveita a linha do mesmo nome+idioma da conta que não é outro
      // modelo vivo: rascunho, ou id da Meta que não existe mais (status
      // DELETED). É assim que as automações, que guardam o id da linha,
      // sobrevivem a um modelo apagado e recriado com o mesmo nome.
      const candidatas = (porNomeIdioma.get(chaveNomeIdioma(m.name, m.language)) ?? [])
        .filter((l) => !usadas.has(l.id) && (!l.meta_template_id || !idsDaMeta.has(l.meta_template_id)))
        .sort((a, b) =>
          Number(b.waba_id === p.wabaId) - Number(a.waba_id === p.wabaId) ||
          String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
        );
      linha = candidatas[0];
    }

    if (linha) {
      usadas.add(linha.id);
      const patch: Record<string, unknown> = {};
      const campos = [
        "meta_template_id", "name", "category", "language", "status", "header_type", "body_text", "footer_text",
      ] as const;
      for (const c of campos) {
        if (((linha as any)[c] ?? null) !== ((m as any)[c] ?? null)) patch[c] = (m as any)[c];
      }
      if (!jsonIgual(linha.buttons ?? null, m.buttons ?? null)) patch.buttons = m.buttons;
      // A mídia já guardada no nosso Storage NÃO é trocada pelo link da CDN da
      // Meta: esse link expira em dias (e às vezes vem cortado em 1 MB) — foi o
      // que derrubou o endereco_rizodent_ipiau em 20/09/2026.
      if (!midiaNoNossoStorage(linha.header_content) && !mesmoCabecalho(linha.header_content, m.header_content)) {
        patch.header_content = m.header_content;
      }
      if (linha.waba_id !== p.wabaId) patch.waba_id = p.wabaId;
      let numeroFinal = linha.whatsapp_number_id ?? null;
      if (escolhido && (!numeroFinal || !idsAtivos.has(numeroFinal))) {
        patch.whatsapp_number_id = escolhido;
        numeroFinal = escolhido;
      }
      // Repara o modelo sem dono de número de closer/recepção (sumia da tela do
      // dono do número). Número da central: NULL continua "modelo geral".
      if (!linha.owner_role) {
        const dono = papelDonoPeloMundo(numeroFinal ? mundoPorId.get(numeroFinal) : null);
        if (dono) patch.owner_role = dono;
      }

      if (Object.keys(patch).length === 0) {
        res.inalterados++;
        continue;
      }
      patch.updated_at = agora;
      const { error } = await supabase.from("crm_whatsapp_templates").update(patch)
        .eq("id", linha.id).eq("tenant_id", p.tenantId);
      if (error) res.erros.push(`${m.name}/${m.language}: ${error.message || String(error)}`);
      else res.atualizados++;
      continue;
    }

    const donoDoNumero = papelDonoPeloMundo(escolhido ? mundoPorId.get(escolhido) : null);
    const { error } = await supabase.from("crm_whatsapp_templates").insert({
      ...m,
      tenant_id: p.tenantId,
      waba_id: p.wabaId,
      whatsapp_number_id: escolhido,
      owner_role: donoDoModelo(donoDoNumero, p.papelDoChamador ?? null),
      created_at: agora,
      updated_at: agora,
    });
    if (error) res.erros.push(`${m.name}/${m.language}: ${error.message || String(error)}`);
    else res.inseridos++;
  }

  // Sumiu da Meta → status DELETED (a linha fica: automações guardam o id).
  // Lista vazia não marca nada: conta sem nenhum modelo é mais provável de ser
  // token/conta errada do que a clínica ter apagado tudo.
  if (idsDaMeta.size > 0) {
    for (const l of daConta.linhas) {
      if (usadas.has(l.id) || !l.meta_template_id || idsDaMeta.has(l.meta_template_id)) continue;
      if (l.status === "DELETED") continue;
      const { error } = await supabase.from("crm_whatsapp_templates")
        .update({ status: "DELETED", updated_at: agora })
        .eq("id", l.id).eq("tenant_id", p.tenantId);
      if (error) res.erros.push(`${l.name}/${l.language}: ${error.message || String(error)}`);
      else res.marcadosExcluidos++;
    }
  }

  return res;
}

export type ConteudoDoModelo = {
  name: string;
  language: string;
  category: string;
  header_type: string | null;
  header_content: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: unknown[] | null;
};

export type GravacaoDoModeloCriado = {
  tenantId: string;
  wabaId: string;
  numeroId: string | null;
  /** Rascunho que foi enviado ("Rascunho → Enviar para aprovação"). */
  rascunhoId: string | null;
  conteudo: ConteudoDoModelo;
  metaTemplateId: string;
  status: string;
  criadoPor: string | null;
  /** owner_role de linha nova (donoDoModelo). */
  ownerRole: string | null;
  /** Dono do número (closer/recepção): prevalece sobre o do rascunho. */
  papelDonoDoNumero: string | null;
  agora?: string;
};

/**
 * Grava no CRM o modelo que a Meta acabou de aceitar. Antes, "Rascunho →
 * Enviar para aprovação" criava na Meta e não gravava nada aqui (o erro do
 * insert só ia para o log): o rascunho continuava rascunho e o modelo só
 * aparecia na próxima sincronização, com outra linha.
 *  - com rascunho: atualiza aquela linha;
 *  - sem rascunho: reaproveita a linha do mesmo nome+idioma da conta (a Meta
 *    acabou de aceitar o nome, então a que existir é velha), senão insere.
 */
export async function gravarModeloCriado(
  supabase: any,
  p: GravacaoDoModeloCriado,
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const agora = p.agora ?? new Date().toISOString();
  const base: Record<string, unknown> = {
    ...p.conteudo,
    buttons: p.conteudo.buttons && p.conteudo.buttons.length > 0 ? p.conteudo.buttons : null,
    meta_template_id: p.metaTemplateId,
    status: p.status,
    waba_id: p.wabaId,
    whatsapp_number_id: p.numeroId,
    updated_at: agora,
  };
  if (p.papelDonoDoNumero) base.owner_role = p.papelDonoDoNumero;

  if (p.rascunhoId) {
    const { data, error } = await supabase.from("crm_whatsapp_templates").update(base)
      .eq("id", p.rascunhoId).eq("tenant_id", p.tenantId).is("meta_template_id", null).select("id");
    if (error) return { ok: false, motivo: error.message || String(error) };
    const id = (data as { id: string }[] | null)?.[0]?.id;
    if (!id) return { ok: false, motivo: "o rascunho não existe mais ou já tinha sido enviado" };
    return { ok: true, id };
  }

  const [{ data: daConta, error: e1 }, { data: doNumero, error: e2 }] = await Promise.all([
    supabase.from("crm_whatsapp_templates").select("id, updated_at")
      .eq("tenant_id", p.tenantId).eq("waba_id", p.wabaId)
      .eq("name", p.conteudo.name).eq("language", p.conteudo.language),
    p.numeroId
      ? supabase.from("crm_whatsapp_templates").select("id, updated_at")
        .eq("tenant_id", p.tenantId).is("waba_id", null).eq("whatsapp_number_id", p.numeroId)
        .eq("name", p.conteudo.name).eq("language", p.conteudo.language)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (e1 || e2) return { ok: false, motivo: (e1 || e2).message || String(e1 || e2) };
  const existente = [...((daConta as any[]) || []), ...((doNumero as any[]) || [])]
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
  if (existente) {
    const { data, error } = await supabase.from("crm_whatsapp_templates").update(base)
      .eq("id", existente.id).eq("tenant_id", p.tenantId).select("id");
    if (error) return { ok: false, motivo: error.message || String(error) };
    const id = (data as { id: string }[] | null)?.[0]?.id;
    return id ? { ok: true, id } : { ok: false, motivo: "a linha existente sumiu durante a gravação" };
  }

  const { data, error } = await supabase.from("crm_whatsapp_templates").insert({
    ...base,
    tenant_id: p.tenantId,
    created_by_user_id: p.criadoPor,
    owner_role: p.papelDonoDoNumero ?? p.ownerRole,
    created_at: agora,
  }).select("id").single();
  if (error) return { ok: false, motivo: error.message || String(error) };
  if (!(data as any)?.id) return { ok: false, motivo: "o banco não devolveu o id" };
  return { ok: true, id: (data as any).id };
}

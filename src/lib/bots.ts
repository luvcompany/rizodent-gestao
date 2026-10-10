// Regras puras do construtor de bots (editor e lista), sem banco nem React.
//
// - Modelos da Meta nos blocos "Mensagem de Texto": só modelo APROVADO sai
//   pelo WhatsApp. O editor oferece só os aprovados e não publica o bot
//   enquanto algum bloco apontar para modelo que deixou de ser aprovado
//   (AUTO-29) — antes, a recusa da Meta virava o ramo "Timeout" sem aviso.
// - Referências a um bot (automações "Enviar bot" e blocos "Acionar outro bot")
//   para avisar antes de arquivar/excluir (AUTO-30).
// - Mensagem de erro do banco em PT-BR para as telas de bots (REC-03): nada de
//   "new row violates row-level security policy" na cara do usuário.
//   Quando src/lib/mensagemDeErro.ts (P13) estiver no main, as telas de bots
//   podem trocar mensagemDeErroDoBot por ela.

/** Status do modelo na Meta → rótulo PT-BR. */
const ROTULO_STATUS_MODELO: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Pendente (em análise na Meta)",
  IN_APPEAL: "Em recurso na Meta",
  REJECTED: "Rejeitado pela Meta",
  DRAFT: "Rascunho (não enviado à Meta)",
  PAUSED: "Pausado pela Meta",
  DISABLED: "Desativado pela Meta",
  LIMIT_EXCEEDED: "Bloqueado por limite da Meta",
  // A sincronização marca assim o modelo que sumiu da Meta (a linha fica: bots
  // e automações guardam o id, e ele volta se for recriado com o mesmo nome).
  DELETED: "Excluído na Meta",
};

export function rotuloStatusModelo(status: string | null | undefined): string {
  if (!status) return "Não encontrado (excluído ou fora do seu acesso)";
  return ROTULO_STATUS_MODELO[String(status).toUpperCase()] ?? "Não aprovado";
}

export function modeloAprovado(status: string | null | undefined): boolean {
  return String(status || "").toUpperCase() === "APPROVED";
}

type NoDoFluxo = { id: string; type?: string | null; data?: Record<string, unknown> | null };

export type ModeloNoFluxo = {
  nodeId: string;
  /** Rótulo do bloco (descrição, se houver; senão o tipo). */
  bloco: string;
  templateId: string;
  templateName: string;
};

/** Blocos "Mensagem de Texto" que usam um modelo da Meta. */
export function modelosDoFluxo(nodes: NoDoFluxo[]): ModeloNoFluxo[] {
  const out: ModeloNoFluxo[] = [];
  for (const n of nodes || []) {
    if (n?.type !== "send_text") continue;
    const d = (n.data || {}) as Record<string, unknown>;
    const templateId = typeof d.templateId === "string" ? d.templateId.trim() : "";
    if (!templateId) continue;
    const descricao = typeof d.description === "string" ? d.description.trim() : "";
    out.push({
      nodeId: n.id,
      bloco: descricao || "Mensagem de Texto",
      templateId,
      templateName: typeof d.templateName === "string" && d.templateName ? d.templateName : "modelo sem nome",
    });
  }
  return out;
}

export type StatusDoModelo = { name: string; status: string | null };

export type ModeloNaoAprovado = ModeloNoFluxo & { status: string | null; rotulo: string };

/**
 * Blocos cujo modelo não está aprovado (ou não existe mais). `statusPorId` vem
 * do banco (crm_whatsapp_templates, id → status); id ausente = modelo excluído.
 */
export function modelosNaoAprovados(
  nodes: NoDoFluxo[],
  statusPorId: Record<string, StatusDoModelo | undefined>,
): ModeloNaoAprovado[] {
  return modelosDoFluxo(nodes)
    .map((m) => {
      const s = statusPorId[m.templateId];
      const status = s ? s.status : null;
      return {
        ...m,
        templateName: s?.name || m.templateName,
        status,
        rotulo: rotuloStatusModelo(status),
      };
    })
    .filter((m) => !modeloAprovado(m.status));
}

/** Frase única para o toast de "não dá para publicar". */
export function descreverModelosNaoAprovados(lista: ModeloNaoAprovado[]): string {
  if (!lista.length) return "";
  const [p] = lista;
  const primeiro = `O bloco "${p.bloco}" usa o modelo "${p.templateName}", que não está aprovado (${p.rotulo})`;
  if (lista.length === 1) return `${primeiro}.`;
  const resto = lista.length - 1;
  return `${primeiro}; mais ${resto} bloco${resto > 1 ? "s estão" : " está"} na mesma situação.`;
}

/** Bots cujo fluxo aciona `botId` por um bloco "Acionar outro bot". */
export function botsQueAcionam<T extends { id: string; flow_json?: unknown }>(bots: T[], botId: string): T[] {
  return (bots || []).filter((b) => {
    if (!b || b.id === botId) return false;
    const nodes = (b.flow_json as { nodes?: NoDoFluxo[] } | null | undefined)?.nodes;
    return Array.isArray(nodes) && nodes.some((n) => n?.type === "trigger_bot" && (n.data as Record<string, unknown> | null)?.botId === botId);
  });
}

/** Erro do banco (PostgREST) nas telas de bots → frase PT-BR. */
export function mensagemDeErroDoBot(
  error: { code?: string | null; message?: string | null } | null | undefined,
  padrao: string,
): string {
  const code = String(error?.code || "");
  const msg = String(error?.message || "").toLowerCase();
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return "Seu perfil não tem permissão para esta ação neste bot. Peça à gestão da clínica.";
  }
  if (code === "23505" || msg.includes("duplicate key")) {
    return "Outra pessoa salvou este bot ao mesmo tempo. Recarregue a página e tente de novo.";
  }
  if (code === "PGRST301" || msg.includes("jwt expired")) {
    return "Sua sessão expirou. Entre de novo e tente outra vez.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  }
  return padrao;
}

/** Corpo de erro do Storage (texto JSON do XHR) → frase PT-BR. */
export function mensagemDeErroDoUpload(status: number, corpo: string): string {
  let msg = "";
  try {
    const j = JSON.parse(corpo || "{}") as { message?: string; error?: string };
    msg = String(j.message || j.error || "");
  } catch {
    msg = String(corpo || "");
  }
  const m = msg.toLowerCase();
  if (m.includes("row-level security") || m.includes("unauthorized") || status === 401 || status === 403) {
    return "Seu perfil não tem permissão para enviar arquivos aqui.";
  }
  if (m.includes("exceeded the maximum allowed size") || m.includes("payload too large") || status === 413) {
    return "O arquivo é maior do que o armazenamento aceita.";
  }
  if (m.includes("mime type") || m.includes("invalid_mime_type")) {
    return "Tipo de arquivo não aceito.";
  }
  if (m.includes("already exists") || m.includes("duplicate")) {
    return "Já existe um arquivo com esse nome. Tente de novo.";
  }
  return msg ? `Falha no armazenamento (${msg}).` : `Falha no armazenamento (HTTP ${status}).`;
}

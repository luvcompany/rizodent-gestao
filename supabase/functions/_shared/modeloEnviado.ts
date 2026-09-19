/**
 * O que um modelo (template) do WhatsApp disse ao paciente — congelado no envio.
 *
 * POR QUE EXISTE (dono, 19/09/2026): o chat do CRClin remontava o texto do
 * modelo NA HORA DE ABRIR a conversa, com o nome atual do lead, as consultas
 * que existem HOJE e o texto atual do modelo. Remarcou a consulta e recarregou
 * a página? O balão passava a mostrar a data nova — que o paciente nunca
 * recebeu. E o formato também era outro ("21/09/2026 às 09:00" no CRClin,
 * "Segunda, 21/09 às 09:00" no celular do paciente).
 *
 * A regra agora: o servidor que ENVIA grava, junto da mensagem, exatamente o
 * texto que foi para a Meta (messages.template_snapshot). A tela só mostra isso.
 */

const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export type ConsultaDoModelo = { scheduled_date: string; scheduled_time: string | null };

/**
 * Valor de {{2}} (data e hora da consulta), escrito de acordo com a frase do
 * modelo em volta dele — e SÓ encurta quando a frase diz a verdade:
 *   "… de amanhã às {{2}}" e a consulta É amanhã   → "09:00"
 *   "… marcada para hoje {{2}}" e a consulta É hoje → "às 09:00"
 *   frase diz "amanhã"/"hoje" mas a consulta é outro dia, ou "às {{2}}" sem dia
 *                                                  → "09:00 de sábado, 19/09" /
 *                                                    "às 09:00 de sábado, 19/09"
 *   qualquer outro lugar                           → "Sábado, 19/09 às 09:00"
 * Antes de 19/09 todos recebiam "19/09/2026 às 09:00", e o "às {{2}}" virava
 * "amanhã às 19/09/2026 às 09:00". O dia da semana sai da DATA da consulta em
 * UTC puro, para o fuso do servidor não empurrar para o dia vizinho.
 * `hoje` = data de hoje no fuso da clínica (AAAA-MM-DD).
 */
export function formatarDataDoModelo(
  consulta: ConsultaDoModelo | null | undefined,
  textoAntes = "",
  hoje?: string,
): string | null {
  if (!consulta?.scheduled_date) return null;
  const [y, m, d] = consulta.scheduled_date.split("-");
  const hora = consulta.scheduled_time ? consulta.scheduled_time.slice(0, 5) : null;
  const dataUTC = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const dia = DIAS_DA_SEMANA[new Date(dataUTC).getUTCDay()];
  const completa = `${dia}, ${d}/${m}${hora ? ` às ${hora}` : ""}`;
  if (!hora) return completa;

  const fim = textoAntes.replace(/\s+$/u, "").toLowerCase();
  const diasAteConsulta = hoje
    ? Math.round((dataUTC - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000)
    : null;
  const bate = (palavra: string) =>
    (palavra === "hoje" && diasAteConsulta === 0) ||
    ((palavra === "amanhã" || palavra === "amanha") && diasAteConsulta === 1);
  const doDia = `${dia.toLowerCase()}, ${d}/${m}`;

  // "... hoje às {{2}}" / "... amanhã às {{2}}" / "... clínica às {{2}}"
  if (/(^|\s)às$/u.test(fim)) {
    const palavra = /(^|\s)(hoje|amanhã|amanha)\s+às$/u.exec(fim)?.[2];
    return palavra && bate(palavra) ? hora : `${hora} de ${doDia}`;
  }
  // "... hoje {{2}}" / "... amanhã {{2}}"
  const palavra = /(^|\s)(hoje|amanhã|amanha)$/u.exec(fim)?.[2];
  if (palavra) return bate(palavra) ? `às ${hora}` : `às ${hora} de ${doDia}`;

  return completa;
}

/** Texto do modelo imediatamente antes da 1ª ocorrência de {{n}}. */
export function textoAntesDoMarcador(corpo: string | null | undefined, n: number | undefined): string {
  if (!corpo || !n) return "";
  const achado = new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`).exec(corpo);
  return achado ? corpo.slice(0, achado.index) : "";
}

export type ModeloParaRegistro = {
  name: string;
  header_type?: string | null;
  header_content?: string | null;
  body_text?: string | null;
  footer_text?: string | null;
  buttons?: unknown;
};

export type RegistroDoModeloEnviado = {
  v: 1;
  origem: "envio";
  nome: string;
  header_type: string | null;
  header_content: string | null;
  body: string | null;
  footer: string | null;
  buttons: unknown;
  params: string[];
};

const textoDoParametro = (p: any): string =>
  String(p?.text ?? p?.currency?.fallback_value ?? p?.date_time?.fallback_value ?? "");

/** Troca {{n}} pelo n-ésimo parâmetro — a mesma regra da Meta (1º parâmetro → {{1}}). */
function preencher(texto: string, parametros: string[]): string {
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (inteiro, n) => {
    const valor = parametros[Number(n) - 1];
    return valor === undefined ? inteiro : valor;
  });
}

/**
 * Monta o registro do que foi enviado, a partir do modelo resolvido e dos
 * componentes FINAIS que seguiram para a Meta (quem chamou pode ter mandado
 * parâmetros próprios; senão valem os preenchidos pelo servidor).
 */
export function registroDoModeloEnviado(modelo: ModeloParaRegistro, componentes: any[]): RegistroDoModeloEnviado {
  const tipo = (c: any) => String(c?.type || "").toLowerCase();
  const corpo = componentes.find((c) => tipo(c) === "body");
  const cabecalho = componentes.find((c) => tipo(c) === "header");
  const params = Array.isArray(corpo?.parameters) ? corpo.parameters.map(textoDoParametro) : [];

  let headerContent = modelo.header_content ?? null;
  const tipoCabecalho = String(modelo.header_type || "").toUpperCase();
  if (tipoCabecalho === "TEXT" && headerContent && Array.isArray(cabecalho?.parameters)) {
    headerContent = preencher(headerContent, cabecalho.parameters.map(textoDoParametro));
  }
  // Mídia: vale o link que FOI para a Meta (o do componente), não o que estava
  // no cadastro do modelo antes de o envio copiá-lo para o Storage. O do
  // cadastro pode ser da CDN da Meta, que expira (22 modelos vencem em 19/10/2026);
  // o do Storage a tela reassina sempre que precisa.
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(tipoCabecalho) && Array.isArray(cabecalho?.parameters)) {
    const p = cabecalho.parameters[0] || {};
    const enviado = p?.image?.link || p?.video?.link || p?.document?.link;
    if (enviado) headerContent = String(enviado);
  }

  return {
    v: 1,
    origem: "envio",
    nome: modelo.name,
    header_type: modelo.header_type ?? null,
    header_content: headerContent,
    body: modelo.body_text ? preencher(modelo.body_text, params) : null,
    footer: modelo.footer_text ?? null,
    buttons: modelo.buttons ?? null,
    params,
  };
}

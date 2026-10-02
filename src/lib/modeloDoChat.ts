/**
 * Modelo (template) do WhatsApp enviado pelo chat — CONV-15.
 *
 * Antes o chat mandava só o nome do modelo e o servidor preenchia {{1}}…{{5}}
 * por POSIÇÃO (nome, data da consulta, serviço, telefone, origem). Para um
 * modelo sincronizado da Meta, criado fora do app, isso punha a data da
 * consulta no lugar do "procedimento", e a tela mostrava o corpo cru com
 * {{1}}/{{2}} sem dizer o que ia sair.
 *
 * Agora a tela:
 *  - mostra a prévia JÁ PREENCHIDA com os mesmos valores que o servidor usaria
 *    (valoresPadraoDoModelo — mesma regra de buildTemplateFallbacks e de
 *    _shared/modeloEnviado.ts);
 *  - abre um campo por {{n}}, pré-preenchido, que a pessoa pode trocar;
 *  - envia os valores escolhidos em template_components (componentesDoCorpo).
 * O servidor mantém esses parâmetros quando vêm completos (um por variável,
 * nenhum vazio, nenhum "cliente", nenhum "{{").
 */

export type ConsultaDoModelo = { scheduled_date: string; scheduled_time: string | null };

export type LeadDoModelo = {
  name?: string | null;
  phone?: string | null;
  source?: string | null;
  servico_interesse?: string | null;
};

/**
 * O que o servidor põe em cada variável, pela POSIÇÃO na lista crescente
 * (a 1ª variável é o nome, a 2ª a data…). CrmModelos mostra a mesma lista.
 */
const ROTULOS_POR_POSICAO = ["Nome do paciente", "Data e hora da consulta", "Serviço de interesse", "Telefone", "Origem do lead"];

/** Rótulo do campo de {{n}} no formulário do envio. */
export function rotuloDaVariavel(corpo: string | null | undefined, n: number): string {
  const i = variaveisDoCorpo(corpo).indexOf(n);
  return ROTULOS_POR_POSICAO[i] ?? "Texto livre";
}

/** Números das variáveis {{N}} do corpo, sem repetição, em ordem crescente. */
export function variaveisDoCorpo(corpo: string | null | undefined): number[] {
  if (!corpo) return [];
  const vistos = new Set<number>();
  for (const m of corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) vistos.add(n);
  }
  return [...vistos].sort((a, b) => a - b);
}

const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * Valor de {{2}} (data e hora da consulta) escrito conforme a frase do modelo.
 * ESPELHO de formatarDataDoModelo em supabase/functions/_shared/modeloEnviado.ts
 * (a explicação completa está lá); src/test/composerP14.test.tsx confere que os
 * dois dão o mesmo resultado.
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

  if (/(^|\s)às$/u.test(fim)) {
    const palavra = /(^|\s)(hoje|amanhã|amanha)\s+às$/u.exec(fim)?.[2];
    return palavra && bate(palavra) ? hora : `${hora} de ${doDia}`;
  }
  const palavra = /(^|\s)(hoje|amanhã|amanha)$/u.exec(fim)?.[2];
  if (palavra) return bate(palavra) ? `às ${hora}` : `às ${hora} de ${doDia}`;

  return completa;
}

/** Texto do corpo imediatamente antes da 1ª ocorrência de {{n}}. */
export function textoAntesDaVariavel(corpo: string | null | undefined, n: number): string {
  if (!corpo) return "";
  const achado = new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`).exec(corpo);
  return achado ? corpo.slice(0, achado.index) : "";
}

/**
 * Valor que o servidor usaria em cada {{n}} do corpo (buildTemplateFallbacks
 * do send-whatsapp-message), pela POSIÇÃO da variável na lista crescente —
 * como o servidor faz: 1ª nome, 2ª data da próxima consulta ("data a
 * confirmar"), 3ª serviço ("consulta"), 4ª telefone, 5ª origem; da 6ª em
 * diante, o nome. Devolve um mapa n → valor só com as variáveis do corpo.
 */
export function valoresPadraoDoModelo(
  corpo: string | null | undefined,
  lead: LeadDoModelo | null | undefined,
  consulta: ConsultaDoModelo | null | undefined,
  hoje?: string,
): Record<number, string> {
  const vars = variaveisDoCorpo(corpo);
  // Sem nome, o campo nasce vazio (a pessoa preenche): "cliente", o valor reserva do
  // servidor, faria o servidor descartar TODOS os valores escolhidos na tela.
  const nome = lead?.name?.trim() || "";
  const data = formatarDataDoModelo(consulta, textoAntesDaVariavel(corpo, vars[1] ?? 0), hoje) || "data a confirmar";
  const padroes = [
    nome,
    data,
    lead?.servico_interesse?.trim() || "consulta",
    lead?.phone?.trim() || nome,
    lead?.source?.trim() || nome,
  ];
  const valores: Record<number, string> = {};
  vars.forEach((n, i) => { valores[n] = (padroes[i] || padroes[0]).trim(); });
  return valores;
}

/** Corpo com cada {{n}} trocado pelo valor escolhido (vazio fica marcado). */
export function preencherCorpo(corpo: string | null | undefined, valores: Record<number, string>): string {
  if (!corpo) return "";
  return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (inteiro, n) => {
    const v = valores[Number(n)];
    return v && v.trim() ? v : inteiro;
  });
}

/**
 * Variáveis que o servidor NÃO aceitaria como vieram (e trocaria pelo padrão):
 * vazias, "cliente" ou com "{{". A tela barra o envio e diz quais são.
 */
export function variaveisInvalidas(corpo: string | null | undefined, valores: Record<number, string>): number[] {
  return variaveisDoCorpo(corpo).filter((n) => {
    const v = (valores[n] ?? "").trim();
    return !v || v.toLowerCase() === "cliente" || v.includes("{{");
  });
}

/**
 * template_components com o corpo preenchido: um parâmetro por variável, na
 * ordem crescente (a Meta lê o 1º parâmetro como {{1}}). Sem variável no corpo,
 * nada — o servidor monta cabeçalho de mídia e botão de formulário sozinho.
 */
export function componentesDoCorpo(
  corpo: string | null | undefined,
  valores: Record<number, string>,
): Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }> {
  const vars = variaveisDoCorpo(corpo);
  if (vars.length === 0) return [];
  return [{ type: "body", parameters: vars.map((n) => ({ type: "text", text: (valores[n] ?? "").trim() })) }];
}

/** Primeiro nome para {{nome}} das respostas rápidas ("Maria Souza" → "Maria"). */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? "").trim();
  if (!limpo) return "";
  return limpo.split(/\s+/)[0];
}

/**
 * Texto da resposta rápida pronto para a caixa: {{nome}} (e {{primeiro_nome}})
 * vira o primeiro nome do lead; sem nome, o marcador some com o espaço antes
 * ("Olá {{nome}}!" → "Olá!").
 */
export function textoDaRespostaRapida(conteudo: string, nomeDoLead: string | null | undefined): string {
  const nome = primeiroNome(nomeDoLead);
  if (nome) return conteudo.replace(/\{\{\s*(nome|primeiro_nome)\s*\}\}/gi, nome);
  return conteudo.replace(/\s?\{\{\s*(nome|primeiro_nome)\s*\}\}/gi, "");
}

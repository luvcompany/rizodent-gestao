/**
 * Campo de dinheiro sem ambiguidade.
 *
 * Interpretar o que a pessoa digitou é onde mora o erro caro: "1234.56" pode
 * ser mil duzentos e trinta e quatro reais e cinquenta e seis centavos (ponto
 * decimal, hábito de teclado numérico) ou cento e vinte e três mil (ponto como
 * milhar). Um parser que erra essa leitura lança 100x o valor — e passa, porque
 * o resultado continua sendo um número válido.
 *
 * Aqui a leitura é sempre a mesma: contam só os dígitos, e os dois últimos são
 * os centavos. O campo mostra o valor já formatado enquanto se digita, então o
 * que a pessoa vê é exatamente o que será gravado.
 */

import { fusoDoTenant } from "@/lib/fuso";

/** Dígitos digitados -> valor em reais. "123456" => 1234.56 */
export function centavosParaValor(digitado: string): number {
  const digitos = String(digitado).replace(/\D/g, "");
  if (!digitos) return 0;
  return Number(digitos) / 100;
}

/** Valor em reais -> texto do campo. 1234.56 => "1.234,56" */
export function formatarMoeda(valor: number): string {
  if (!valor) return "";
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** O que exibir no campo enquanto a pessoa digita. */
export function mascaraMoeda(digitado: string): string {
  return formatarMoeda(centavosParaValor(digitado));
}

const REAIS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Exibição de dinheiro (relatórios, painéis, listas): sempre "R$ 1.234,50".
 *
 * Única na aplicação de propósito: sem o máximo de casas, 0.1+0.2 vira
 * "R$ 0,30000000000000004" em algumas telas. Nulo, vazio ou NaN vira
 * "R$ 0,00" — a tela mostra zero, nunca "R$ NaN".
 */
export function formatarReais(valor: number | string | null | undefined): string {
  const n = typeof valor === "string" ? Number(valor.trim()) : valor;
  if (n === null || n === undefined || typeof n !== "number" || !Number.isFinite(n)) return REAIS.format(0);
  return REAIS.format(n);
}

/**
 * Data de hoje no fuso da clínica (tenants.timezone, via src/lib/fuso.ts),
 * no formato do banco.
 *
 * O caminho intuitivo — new Date(toLocaleString(...)) e depois toISOString() —
 * erra: a conversão para texto local é reinterpretada no fuso do navegador e o
 * offset entra duas vezes. Perto da meia-noite isso grava o pagamento no dia
 * seguinte, jogando o valor para o faturamento do dia errado. Intl com "en-CA"
 * já devolve AAAA-MM-DD no fuso pedido, sem conversão intermediária.
 */
export function hojeNaClinica(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoDoTenant(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

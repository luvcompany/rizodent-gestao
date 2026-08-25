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

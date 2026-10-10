import { supabase } from "@/integrations/supabase/client";

/**
 * O modelo de mensagem (template) pertence à CONTA do WhatsApp (WABA), não ao
 * número: dois números na mesma WABA usam os mesmos modelos. Filtrar e
 * esconder por número fazia a tela de Modelos mostrar 0 dos 154 aprovados no
 * número padrão (09/10/2026) — eles estavam carimbados com o outro número da
 * mesma conta.
 */

/** O que a tela sabe dos números que enxerga (a RLS só mostra os acessíveis). */
export type SituacaoDosNumeros = {
  /** Ids dos números desativados (ex.: integração excluída). */
  inativos: Set<string>;
  /** Contas (WABA) com pelo menos um número ativo visível. */
  wabasAtivas: Set<string>;
  /** Contas que aparecem em número desativado visível. */
  wabasInativas: Set<string>;
};

type NumeroComConta = { id: string; waba_id?: string | null; is_active: boolean };

export function situacaoDosNumeros(numeros: NumeroComConta[]): SituacaoDosNumeros {
  const s: SituacaoDosNumeros = { inativos: new Set(), wabasAtivas: new Set(), wabasInativas: new Set() };
  for (const n of numeros) {
    const waba = n.waba_id?.trim() || null;
    if (n.is_active) {
      if (waba) s.wabasAtivas.add(waba);
    } else {
      s.inativos.add(n.id);
      if (waba) s.wabasInativas.add(waba);
    }
  }
  return s;
}

/** Lê os números visíveis e devolve a situação de cada conta. */
export async function lerSituacaoDosNumeros(): Promise<SituacaoDosNumeros> {
  const { data } = await supabase.from("whatsapp_numbers").select("id, waba_id, is_active");
  return situacaoDosNumeros((data as NumeroComConta[] | null) ?? []);
}

/**
 * Remove da lista os modelos de conta morta (Modelos, Transmissão, gatilhos,
 * seletor do chat). Por CONTA: o modelo some só quando NENHUM número ativo tem
 * aquela WABA — modelo carimbado com um número desligado continua valendo pelos
 * outros números da mesma conta. Sem prova de que a conta morreu (a RLS pode
 * esconder os números dela), o modelo fica. Modelo sem WABA: pelo número.
 */
export function somenteModelosDeNumerosAtivos<T extends { whatsapp_number_id?: string | null; waba_id?: string | null }>(
  modelos: T[],
  situacao: SituacaoDosNumeros,
): T[] {
  return modelos.filter((m) => {
    const numero = m.whatsapp_number_id ?? null;
    const waba = m.waba_id?.trim() || null;
    if (waba) {
      if (situacao.wabasAtivas.has(waba)) return true;
      return !(situacao.wabasInativas.has(waba) || (numero !== null && situacao.inativos.has(numero)));
    }
    return !numero || !situacao.inativos.has(numero);
  });
}

/**
 * Filtro `or` (PostgREST) dos modelos da conta de um número: os da WABA dele,
 * os rascunhos sem WABA gravados nele e os sem número nenhum. Um só `or` — dois
 * `or=` na mesma consulta viram AND.
 */
export function filtroDeModelosDaConta(numero: { id: string; waba_id?: string | null } | null): string | null {
  if (!numero?.id) return null;
  const waba = numero.waba_id?.trim() || "";
  if (/^[\w-]+$/.test(waba)) {
    return `waba_id.eq.${waba},and(waba_id.is.null,whatsapp_number_id.eq.${numero.id}),and(waba_id.is.null,whatsapp_number_id.is.null)`;
  }
  return `whatsapp_number_id.eq.${numero.id},whatsapp_number_id.is.null`;
}

/**
 * Número ATIVO para gravar/operar um modelo: o do próprio modelo, se ativo;
 * senão um ativo da mesma conta (o selecionado, o padrão, o primeiro); senão o
 * selecionado. Nunca um número desativado.
 */
export function numeroAtivoDaConta(
  modelo: { whatsapp_number_id?: string | null; waba_id?: string | null },
  ativos: { id: string; waba_id?: string | null; is_default?: boolean | null }[],
  selecionado: string | null,
): string | null {
  const ids = new Set(ativos.map((n) => n.id));
  if (modelo.whatsapp_number_id && ids.has(modelo.whatsapp_number_id)) return modelo.whatsapp_number_id;
  const waba = modelo.waba_id?.trim() || null;
  if (waba) {
    const daConta = ativos.filter((n) => (n.waba_id?.trim() || null) === waba);
    const escolhido = daConta.find((n) => n.id === selecionado) ?? daConta.find((n) => n.is_default) ?? daConta[0];
    if (escolhido) return escolhido.id;
  }
  return selecionado && ids.has(selecionado) ? selecionado : null;
}

/**
 * owner_role de modelo criado na tela — a mesma regra do servidor
 * (donoDoModelo em _shared/modelosDaConta.ts): dono do número
 * (closer/recepção) ?? papel de quem cria; superadmin e gerente → NULL
 * (modelo geral), SDR → 'crc' (o mundo dela).
 */
export function donoDoModeloNaTela(papel: string | null | undefined, mundoDoNumero: string | null | undefined): string | null {
  if (mundoDoNumero === "closer" || mundoDoNumero === "recepcao") return mundoDoNumero;
  if (!papel || papel === "superadmin" || papel === "gerente") return null;
  if (papel === "sdr") return "crc";
  return papel;
}

// Versão CRClin: o selo de "Operação" é recurso do v2 (operacao_selo_do_lead
// não existe aqui). No v2 ele já não aparece para quem a RPC volta vazia.
type Selo = { origem_operacao: boolean | null; motivo: string | null; primeiro_contato_em: string | null };

export function textoDoSelo(s: Selo | null | undefined): string | null {
  if (!s || s.origem_operacao === null) return null;
  return s.origem_operacao ? "Operação" : `Não conta: ${s.motivo ?? "sem motivo"}`;
}

export function SeloOperacao(_props: { leadId: string }) {
  return null;
}

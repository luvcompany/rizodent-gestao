// Versão CRClin: setores são recurso do v2 (setores, lead_transferencias e
// transferir_lead não existem aqui). No v2 este bloco "não aparece para
// cliente sem setores" — aqui nunca há setores, então não aparece.
export function SeloSetor({ nome, cor }: { nome: string; cor: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
      <span className="truncate">{nome}</span>
    </span>
  );
}

export default function SetorDoLead(_props: { leadId: string; setorAtualId: string | null; onTransferido?: () => void }) {
  return null;
}

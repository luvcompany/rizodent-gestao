import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVOS_DESQUALIFICACAO, MOTIVO_OUTRO } from "@/lib/desqualificacao";

interface Props {
  open: boolean;
  nomeDoLead?: string | null;
  onCancelar: () => void;
  /** Recebe o motivo final ("Sem interesse", ou "Outro: <texto>"). */
  onConfirmar: (motivo: string) => void;
}

/**
 * Pergunta o motivo antes de mover o lead para "Desqualificado". Sem escolher
 * um motivo o lead não é movido — cancelar deixa o lead onde estava.
 */
export default function MotivoDesqualificacaoDialog({ open, nomeDoLead, onCancelar, onConfirmar }: Props) {
  const [escolha, setEscolha] = useState<string>("");
  const [outro, setOutro] = useState("");

  useEffect(() => {
    if (open) {
      setEscolha("");
      setOutro("");
    }
  }, [open]);

  const outroTexto = outro.trim();
  const podeConfirmar = !!escolha && (escolha !== MOTIVO_OUTRO || outroTexto.length >= 3);
  const opcoes = [...MOTIVOS_DESQUALIFICACAO, MOTIVO_OUTRO];

  const confirmar = () => {
    if (!podeConfirmar) return;
    onConfirmar(escolha === MOTIVO_OUTRO ? `${MOTIVO_OUTRO}: ${outroTexto}` : escolha);
  };

  return (
    <Dialog open={open} onOpenChange={(aberto) => { if (!aberto) onCancelar(); }}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Por que desqualificar?</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {nomeDoLead ? <><strong>{nomeDoLead}</strong> vai para Desqualificado. </> : null}
            Escolha o motivo — ele fica registrado no histórico do lead.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Motivo da desqualificação" className="grid gap-2 pt-1">
          {opcoes.map((m) => {
            const marcado = escolha === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={marcado}
                onClick={() => setEscolha(m)}
                className={`flex min-h-11 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  marcado ? "border-primary bg-primary-soft-2 font-medium text-foreground shadow-xs" : "border-border/70 bg-card hover:border-border hover:bg-surface-sunken"
                }`}
              >
                <span
                  className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${marcado ? "border-primary" : "border-muted-foreground/40"}`}
                  aria-hidden
                >
                  {marcado && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                {m}
              </button>
            );
          })}
        </div>

        {escolha === MOTIVO_OUTRO && (
          <Textarea
            autoFocus
            value={outro}
            onChange={(e) => setOutro(e.target.value)}
            placeholder="Descreva o motivo"
            maxLength={200}
            className="min-h-24 rounded-xl"
          />
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-10 rounded-xl px-4" onClick={onCancelar}>Cancelar</Button>
          <Button className="h-10 rounded-xl px-5" onClick={confirmar} disabled={!podeConfirmar}>Desqualificar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Por que desqualificar?</DialogTitle>
          <DialogDescription>
            {nomeDoLead ? <><strong>{nomeDoLead}</strong> vai para Desqualificado. </> : null}
            Escolha o motivo — ele fica registrado no histórico do lead.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Motivo da desqualificação" className="grid gap-2">
          {opcoes.map((m) => {
            const marcado = escolha === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={marcado}
                onClick={() => setEscolha(m)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  marcado ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border hover:bg-muted/60"
                }`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${marcado ? "border-primary" : "border-muted-foreground/50"}`}
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
            className="min-h-[70px]"
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!podeConfirmar}>Desqualificar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

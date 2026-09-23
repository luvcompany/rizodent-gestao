import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2 } from "lucide-react";

/**
 * Perguntas prontas e menu fixo do Direct de UMA conta do Instagram.
 *
 * As perguntas só aparecem para quem nunca falou com a clínica, no celular
 * (no Direct do computador a Meta não mostra). O menu fica a conversa inteira.
 * A escolha chega no CRClin como nota na conversa do lead.
 */

const MAX_PERGUNTAS = 4;
const MAX_MENU = 5;

type Pergunta = { pergunta: string };
type ItemMenu = { titulo: string; url: string };

export default function InstagramPerguntasDialog({
  contaId,
  usuario,
  open,
  onOpenChange,
}: {
  contaId: string;
  usuario: string;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [perguntas, setPerguntas] = useState<Pergunta[]>([]);
  const [menu, setMenu] = useState<ItemMenu[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setCarregando(true);
    supabase.functions
      .invoke("instagram-perguntas-menu", { body: { ig_account_id: contaId, acao: "ler" } })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          toast.error("Não consegui ler a configuração atual na Meta.");
          return;
        }
        const r = (data ?? {}) as any;
        if (r.ok === false) {
          toast.warning(r.motivo || "A Meta não devolveu a configuração.");
          return;
        }
        setPerguntas((r.perguntas ?? []).map((p: any) => ({ pergunta: p.pergunta ?? "" })));
        setMenu((r.menu ?? []).map((m: any) => ({ titulo: m.titulo ?? "", url: m.url ?? "" })));
      })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [open, contaId]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-perguntas-menu", {
        body: {
          ig_account_id: contaId,
          acao: "salvar",
          perguntas: perguntas.filter((p) => p.pergunta.trim()),
          menu: menu.filter((m) => m.titulo.trim()),
        },
      });
      if (error) { toast.error("Erro ao salvar: " + error.message); return; }
      const r = (data ?? {}) as any;
      if (r.ok) {
        toast.success("Direct atualizado na Meta.");
        onOpenChange(false);
      } else {
        const detalhe = r.resultados
          ? Object.entries(r.resultados).map(([k, v]) => `${k}: ${v}`).join(" · ")
          : r.motivo;
        toast.error("A Meta recusou: " + (detalhe || "motivo não informado"));
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Direct de @{usuario}</DialogTitle>
          <DialogDescription>
            Perguntas prontas aparecem antes da primeira mensagem, no celular. O menu fica disponível a conversa
            inteira. A escolha do paciente vira uma nota na conversa dele.
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Lendo o que está configurado na Meta…
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Perguntas prontas <span className="text-muted-foreground font-normal">(até {MAX_PERGUNTAS})</span></h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPerguntas((p) => [...p, { pergunta: "" }])}
                  disabled={perguntas.length >= MAX_PERGUNTAS}
                >
                  <Plus size={14} className="mr-1" /> Adicionar
                </Button>
              </div>
              {perguntas.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma pergunta — o Direct abre em branco, como hoje.</p>
              )}
              {perguntas.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={p.pergunta}
                    maxLength={80}
                    placeholder="Ex.: Quero marcar uma avaliação"
                    onChange={(e) =>
                      setPerguntas((lista) => lista.map((x, j) => (j === i ? { pergunta: e.target.value } : x)))
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label="Remover pergunta"
                    onClick={() => setPerguntas((lista) => lista.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Menu fixo <span className="text-muted-foreground font-normal">(até {MAX_MENU})</span></h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMenu((m) => [...m, { titulo: "", url: "" }])}
                  disabled={menu.length >= MAX_MENU}
                >
                  <Plus size={14} className="mr-1" /> Adicionar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Título de até 30 caracteres. Com link, o item abre o site; sem link, a escolha vira nota na conversa.
              </p>
              {menu.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={m.titulo}
                    maxLength={30}
                    placeholder="Título (ex.: Agendar avaliação)"
                    onChange={(e) => setMenu((l) => l.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))}
                  />
                  <Input
                    value={m.url}
                    placeholder="Link (opcional)"
                    onChange={(e) => setMenu((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label="Remover item do menu"
                    onClick={() => setMenu((l) => l.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || carregando}>
            {salvando ? <><Loader2 size={14} className="mr-1 animate-spin" /> Salvando…</> : "Salvar na Meta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

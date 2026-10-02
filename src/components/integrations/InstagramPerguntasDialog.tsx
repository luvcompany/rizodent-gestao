import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { motivoDoServidor } from "@/lib/erroDeFuncao";

/**
 * Perguntas prontas e menu fixo do Direct de UMA conta do Instagram.
 *
 * As perguntas só aparecem para quem nunca falou com a clínica, no celular
 * (no Direct do computador a Meta não mostra). O menu fica a conversa inteira.
 * A escolha chega no CRClin como nota na conversa do lead.
 *
 * A Meta substitui a configuração inteira a cada gravação (lista vazia =
 * apagar). Por isso, se a LEITURA do que está lá falhar (INTEG-13), a tela não
 * finge que está vazio: avisa, oferece "Tentar de novo" e só deixa salvar com
 * a confirmação explícita de que isto substitui o que está na Meta.
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
  /** Motivo de a leitura da Meta ter falhado; null = leu (ou ainda lendo). */
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  /** Com a leitura falha, salvar exige marcar "isto substitui o que está na Meta". */
  const [confirmaSubstituir, setConfirmaSubstituir] = useState(false);
  const leituraAtual = useRef(0);

  const ler = useCallback(async () => {
    const minha = ++leituraAtual.current;
    setCarregando(true);
    setErroLeitura(null);
    setConfirmaSubstituir(false);
    setPerguntas([]);
    setMenu([]);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-perguntas-menu", {
        body: { ig_account_id: contaId, acao: "ler" },
      });
      if (minha !== leituraAtual.current) return;
      if (error) {
        setErroLeitura(await motivoDoServidor(data, error, "A Meta não respondeu."));
        return;
      }
      const r = (data ?? {}) as any;
      if (r.ok === false) {
        setErroLeitura(r.motivo || "A Meta não devolveu a configuração.");
        return;
      }
      setPerguntas((r.perguntas ?? []).map((p: any) => ({ pergunta: p.pergunta ?? "" })));
      setMenu((r.menu ?? []).map((m: any) => ({ titulo: m.titulo ?? "", url: m.url ?? "" })));
    } catch (e) {
      if (minha !== leituraAtual.current) return;
      setErroLeitura(e instanceof Error && e.message ? e.message : "A Meta não respondeu.");
    } finally {
      if (minha === leituraAtual.current) setCarregando(false);
    }
  }, [contaId]);

  // Cada abertura começa do zero: relê a Meta e esquece erro/confirmação antigos.
  useEffect(() => {
    if (!open) {
      leituraAtual.current += 1; // resposta atrasada de uma abertura anterior é ignorada
      return;
    }
    void ler();
  }, [open, ler]);

  const bloqueadoPelaLeitura = !!erroLeitura && !confirmaSubstituir;

  const salvar = async () => {
    if (bloqueadoPelaLeitura) return;
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
      if (error) { toast.error("Erro ao salvar: " + (await motivoDoServidor(data, error, "a Meta não respondeu."))); return; }
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
       <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl">
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
            {erroLeitura && (
               <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive-soft p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <AlertTriangle size={16} className="text-destructive shrink-0" />
                  Não foi possível ler a configuração atual
                </p>
                <p className="text-xs text-muted-foreground break-words">Motivo: {erroLeitura}</p>
                <p className="text-xs text-muted-foreground">
                  As perguntas e o menu que já estão na Meta não aparecem aqui, e salvar substitui tudo o que está lá.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" variant="outline" onClick={() => void ler()}>
                    <RotateCcw size={14} className="mr-1" /> Tentar de novo
                  </Button>
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <Checkbox
                      checked={confirmaSubstituir}
                      onCheckedChange={(v) => setConfirmaSubstituir(v === true)}
                      aria-label="Entendo que salvar substitui o que está na Meta"
                    />
                    Entendo que salvar substitui o que está na Meta
                  </label>
                </div>
              </div>
            )}
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
              {perguntas.length === 0 && !erroLeitura && (
                <p className="text-xs text-muted-foreground">Nenhuma pergunta — o Direct abre em branco, como hoje.</p>
              )}
              {perguntas.map((p, i) => (
                 <div key={i} className="flex min-w-0 gap-2">
                  <Input
                     className="h-10 min-w-0 rounded-xl"
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
                 <div key={i} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                     className="h-10 min-w-0 rounded-xl"
                     value={m.titulo}
                    maxLength={30}
                    placeholder="Título (ex.: Agendar avaliação)"
                    onChange={(e) => setMenu((l) => l.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))}
                  />
                  <Input
                     className="h-10 min-w-0 rounded-xl"
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
          <Button onClick={salvar} disabled={salvando || carregando || bloqueadoPelaLeitura}>
            {salvando ? <><Loader2 size={14} className="mr-1 animate-spin" /> Salvando…</> : "Salvar na Meta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

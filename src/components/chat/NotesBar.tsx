import { useState } from "react";
import { StickyNote, Pencil, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  notes: string | null;
  onUpdateNotes: (newNotesRaw: string) => void;
};

export type ParsedNote = { timestamp: string; text: string; raw: string };

export function parseNotes(raw: string | null): ParsedNote[] {
  if (!raw?.trim()) return [];
  const lines = raw.split("\n").filter(Boolean);
  return lines.map((line) => {
    const match = line.match(/^\[(.+?)\]\s*(.*)$/);
    if (match) return { timestamp: match[1], text: match[2], raw: line };
    return { timestamp: "", text: line, raw: line };
  });
}

export default function NotesBar({ notes, onUpdateNotes }: Props) {
  const [allOpen, setAllOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const parsed = parseNotes(notes);
  const latest = parsed.length > 0 ? parsed[parsed.length - 1] : null;

  if (!latest) return null;

  const handleDelete = (idx: number) => {
    const updated = parsed.filter((_, i) => i !== idx).map((n) => n.raw).join("\n");
    onUpdateNotes(updated);
  };

  const handleEdit = (idx: number) => {
    setEditIdx(idx);
    setEditText(parsed[idx].text);
  };

  const saveEdit = () => {
    if (editIdx === null) return;
    const note = parsed[editIdx];
    const newRaw = note.timestamp ? `[${note.timestamp}] ${editText.trim()}` : editText.trim();
    const updated = parsed.map((n, i) => (i === editIdx ? newRaw : n.raw)).join("\n");
    onUpdateNotes(updated);
    setEditIdx(null);
    setEditText("");
  };

  return (
    <>
      {/* Pinned latest note bar */}
      <button
        onClick={() => setAllOpen(true)}
        className="mx-3 mt-3 flex w-[calc(100%-1.5rem)] flex-shrink-0 items-start gap-3 rounded-xl border border-warning/20 bg-warning-soft/60 px-3 py-2.5 text-left transition-colors hover:bg-warning-soft"
      >
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
          <StickyNote size={16} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          {latest.timestamp && (
            <p className="text-[11px] text-tertiary tabular-nums">{latest.timestamp}</p>
          )}
          <p className="line-clamp-2 text-[13px] text-foreground">{latest.text}</p>
        </div>
        {parsed.length > 1 && (
          <span className="mt-1 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-card px-1.5 text-[11px] font-semibold text-muted-foreground">+{parsed.length - 1}</span>
        )}
      </button>

      {/* All notes modal */}
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Todas as Notas</DialogTitle>
            <DialogDescription>Histórico completo de notas deste lead.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3 pr-2">
              {parsed.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma nota registrada.</p>
              ) : (
                parsed.map((n, i) => (
                  <div key={i} className="group/note rounded-xl border border-border/60 bg-surface-sunken px-3 py-2.5">
                    {editIdx === i ? (
                      <div className="flex gap-2">
                        <Input
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditIdx(null); }}
                          className="h-9 rounded-xl text-sm"
                        />
                        <Button size="sm" onClick={saveEdit} className="h-9 rounded-xl">Salvar</Button>
                      </div>
                    ) : (
                      <>
                        {/* min-w-0 + quebra em qualquer ponto: nota com texto
                            longo sem espaço (o gclid do lead vindo do site)
                            esticava a linha, e os botões Editar/Excluir ficavam
                            FORA da janela, recortados — parecia que a opção não
                            existia (relato da gestão, 22/09/2026). */}
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-foreground flex-1 min-w-0 [overflow-wrap:anywhere]">{n.text}</p>
                          {/* Sempre visíveis: escondidos atrás do hover, ninguém
                              achava os botões (e em tela de toque não aparecem
                              nunca) — relato da gestão em 22/09/2026. */}
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleEdit(i)}
                              title="Editar nota"
                              className="flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Pencil size={12} /> Editar
                            </button>
                            <button
                              onClick={() => handleDelete(i)}
                              title="Excluir nota"
                              className="flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive"
                            >
                              <Trash2 size={12} /> Excluir
                            </button>
                          </div>
                        </div>
                        {n.timestamp && <p className="mt-1 text-[11px] text-tertiary tabular-nums">{n.timestamp}</p>}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

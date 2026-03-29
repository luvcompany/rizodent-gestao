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
        className="flex-shrink-0 w-full border-b border-border bg-card px-4 py-2.5 flex items-start gap-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <StickyNote size={14} className="text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          {latest.timestamp && (
            <p className="text-[11px] text-muted-foreground">{latest.timestamp}</p>
          )}
          <p className="text-sm text-foreground line-clamp-2">{latest.text}</p>
        </div>
        {parsed.length > 1 && (
          <span className="text-[10px] text-primary flex-shrink-0 mt-1">+{parsed.length - 1}</span>
        )}
      </button>

      {/* All notes modal */}
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-w-md">
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
                  <div key={i} className="border-l-2 border-primary/30 pl-3 py-1.5 group/note">
                    {editIdx === i ? (
                      <div className="flex gap-2">
                        <Input
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditIdx(null); }}
                          className="h-8 text-sm"
                        />
                        <Button size="sm" onClick={saveEdit} className="h-8">Salvar</Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-foreground flex-1">{n.text}</p>
                          <div className="flex gap-1 opacity-0 group-hover/note:opacity-100 transition-opacity flex-shrink-0">
                            <button onClick={() => handleEdit(i)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => handleDelete(i)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        {n.timestamp && <p className="text-[10px] text-muted-foreground mt-0.5">{n.timestamp}</p>}
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

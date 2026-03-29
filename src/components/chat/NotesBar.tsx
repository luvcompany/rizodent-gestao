import { useState } from "react";
import { StickyNote, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  notes: string | null;
  onAddNote: (note: string) => void;
};

function parseNotes(raw: string | null): { timestamp: string; text: string }[] {
  if (!raw?.trim()) return [];
  const lines = raw.split("\n").filter(Boolean);
  return lines.map((line) => {
    const match = line.match(/^\[(.+?)\]\s*(.*)$/);
    if (match) return { timestamp: match[1], text: match[2] };
    return { timestamp: "", text: line };
  });
}

export default function NotesBar({ notes, onAddNote }: Props) {
  const [allOpen, setAllOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const parsed = parseNotes(notes);
  const latest = parsed.length > 0 ? parsed[parsed.length - 1] : null;

  const handleAdd = () => {
    if (!newNote.trim()) return;
    onAddNote(newNote.trim());
    setNewNote("");
  };

  return (
    <>
      <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2">
        <StickyNote size={14} className="text-amber-600 flex-shrink-0" />
        {latest ? (
          <button onClick={() => setAllOpen(true)} className="flex-1 text-left min-w-0 hover:underline">
            <span className="text-xs text-foreground truncate block">{latest.text}</span>
            {latest.timestamp && <span className="text-[10px] text-muted-foreground">{latest.timestamp}</span>}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground flex-1">Sem notas</span>
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Nota rápida..."
            className="h-7 text-xs w-32 bg-background"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button size="sm" variant="ghost" onClick={handleAdd} disabled={!newNote.trim()} className="h-7 w-7 p-0">
            <Plus size={12} />
          </Button>
        </div>
        {parsed.length > 0 && (
          <button onClick={() => setAllOpen(true)} className="text-[10px] text-primary hover:underline flex-shrink-0">
            {parsed.length} nota(s)
          </button>
        )}
      </div>

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
                  <div key={i} className="border-l-2 border-primary/30 pl-3 py-1">
                    <p className="text-sm text-foreground">{n.text}</p>
                    {n.timestamp && <p className="text-[10px] text-muted-foreground mt-0.5">{n.timestamp}</p>}
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

import { useState } from "react";
import { StickyNote, Pencil, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ConvNote = {
  id: string;
  content: string;
  author_id: string | null;
  created_at: string;
  after_message_id: string | null;
};

type Props = {
  note: ConvNote;
  authorName?: string;
  onDeleted: (id: string) => void;
  onUpdated: (id: string, content: string) => void;
};

export default function ConversationInlineNote({ note, authorName, onDeleted, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.content);

  const handleSave = async () => {
    if (!editText.trim()) return;
    const { error } = await supabase
      .from("crm_conversation_notes")
      .update({ content: editText.trim(), updated_at: new Date().toISOString() })
      .eq("id", note.id);
    if (error) { toast.error("Erro ao atualizar nota"); return; }
    onUpdated(note.id, editText.trim());
    setEditing(false);
  };

  const handleDelete = async () => {
    const { error } = await supabase
      .from("crm_conversation_notes")
      .delete()
      .eq("id", note.id);
    if (error) { toast.error("Erro ao excluir nota"); return; }
    onDeleted(note.id);
  };

  const ts = new Date(note.created_at).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="mx-4 my-2 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 group/note">
      <div className="flex items-start gap-2">
        <StickyNote size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <Textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="min-h-[60px] text-sm bg-background"
                onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
              />
              <div className="flex gap-1">
                <Button size="sm" className="h-6 px-2 text-xs" onClick={handleSave}>
                  <Check size={12} className="mr-1" /> Salvar
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setEditing(false); setEditText(note.content); }}>
                  <X size={12} className="mr-1" /> Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {authorName && <span>{authorName} · </span>}
                {ts}
              </p>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex gap-0.5 opacity-0 group-hover/note:opacity-100 transition-opacity flex-shrink-0">
            <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
              <Pencil size={12} />
            </button>
            <button onClick={handleDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AddInlineNoteButton({
  messageId,
  leadId,
  onNoteAdded,
}: {
  messageId: string;
  leadId: string;
  onNoteAdded: (note: ConvNote) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const handleAdd = async () => {
    if (!text.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("crm_conversation_notes")
      .insert({
        lead_id: leadId,
        after_message_id: messageId,
        content: text.trim(),
        author_id: userData.user?.id || null,
      })
      .select()
      .single();
    if (error) { toast.error("Erro ao criar nota"); return; }
    onNoteAdded(data as ConvNote);
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="opacity-0 group-hover:opacity-100 transition-opacity mx-auto flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 hover:underline py-0.5"
      >
        <StickyNote size={10} /> Anotar
      </button>
    );
  }

  return (
    <div className="mx-4 my-1 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
      <Textarea
        autoFocus
        placeholder="Escreva sua anotação..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[50px] text-sm bg-background mb-2"
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setText(""); } }}
      />
      <div className="flex gap-1">
        <Button size="sm" className="h-6 px-2 text-xs" onClick={handleAdd}>
          <Check size={12} className="mr-1" /> Salvar
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setOpen(false); setText(""); }}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export type { ConvNote };

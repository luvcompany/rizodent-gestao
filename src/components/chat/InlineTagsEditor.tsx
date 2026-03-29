import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";

type Props = {
  leadId: string;
  tags: string[];
  source: string | null;
  onUpdated: (updates: { tags?: string[]; source?: string | null }) => void;
};

export default function InlineTagsEditor({ leadId, tags, source, onUpdated }: Props) {
  const [newTag, setNewTag] = useState("");
  const [editingSource, setEditingSource] = useState(false);
  const [sourceVal, setSourceVal] = useState(source || "");

  const save = async (updates: { tags?: string[]; source?: string | null }) => {
    const { error } = await supabase.from("crm_leads").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", leadId);
    if (error) { toast.error("Erro ao salvar"); return; }
    onUpdated(updates);
  };

  const addTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag || tags.includes(tag)) { setNewTag(""); return; }
    const next = [...tags, tag];
    setNewTag("");
    save({ tags: next });
  };

  const removeTag = (tag: string) => {
    save({ tags: tags.filter((t) => t !== tag) });
  };

  const saveSource = () => {
    setEditingSource(false);
    save({ source: sourceVal.trim() || null });
  };

  return (
    <div className="p-4 border-b border-border space-y-3">
      {/* Source */}
      <div>
        <span className="text-xs text-muted-foreground">Origem</span>
        {editingSource ? (
          <Input
            autoFocus
            value={sourceVal}
            onChange={(e) => setSourceVal(e.target.value)}
            onBlur={saveSource}
            onKeyDown={(e) => { if (e.key === "Enter") saveSource(); if (e.key === "Escape") setEditingSource(false); }}
            className="h-7 text-sm mt-0.5"
            placeholder="whatsapp, instagram..."
          />
        ) : (
          <p
            onClick={() => { setSourceVal(source || ""); setEditingSource(true); }}
            className="text-sm text-foreground capitalize cursor-pointer hover:text-primary transition-colors"
          >
            {source || <span className="text-muted-foreground italic">Clique para definir</span>}
          </p>
        )}
      </div>

      {/* Tags */}
      <div>
        <span className="text-xs text-muted-foreground block mb-1">Tags</span>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="text-xs gap-1 cursor-default">
              #{t}
              <button onClick={() => removeTag(t)} className="hover:text-destructive ml-0.5">
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Nova tag..."
            className="h-7 text-xs flex-1"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          />
          <button onClick={addTag} className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-secondary transition-colors">
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

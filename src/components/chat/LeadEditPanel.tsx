import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, X, Plus } from "lucide-react";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  tags: string[] | null;
  notes: string | null;
  value: number | null;
};

type Props = {
  lead: Lead;
  onLeadUpdated: (lead: Lead) => void;
  onLeadDeleted: () => void;
};

export default function LeadEditPanel({ lead, onLeadUpdated, onLeadDeleted }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(lead.phone || "");
  const [source, setSource] = useState(lead.source || "");
  const [value, setValue] = useState(lead.value?.toString() || "");
  const [tags, setTags] = useState<string[]>(lead.tags || []);
  const [newTag, setNewTag] = useState("");
  const [notes, setNotes] = useState(lead.notes || "");

  useEffect(() => {
    if (editOpen) {
      setName(lead.name);
      setPhone(lead.phone || "");
      setSource(lead.source || "");
      setValue(lead.value?.toString() || "");
      setTags(lead.tags || []);
      setNotes(lead.notes || "");
      setNewTag("");
    }
  }, [editOpen, lead]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    const updates = {
      name: name.trim(),
      phone: phone.trim() || null,
      source: source.trim() || null,
      value: value ? parseFloat(value) : null,
      tags,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("crm_leads").update(updates).eq("id", lead.id);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar lead");
      return;
    }
    onLeadUpdated({ ...lead, ...updates } as Lead);
    setEditOpen(false);
    toast.success("Lead atualizado");
  };

  const handleDelete = async () => {
    const { error } = await supabase.from("crm_leads").delete().eq("id", lead.id);
    if (error) {
      toast.error("Erro ao excluir lead");
      return;
    }
    toast.success("Lead excluído");
    onLeadDeleted();
  };

  const addTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil size={14} className="mr-1" /> Editar
        </Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={14} />
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Lead</DialogTitle>
            <DialogDescription>Atualize as informações do lead.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nome *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Telefone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5511999999999" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Origem</label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="whatsapp, instagram..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Valor (R$)</label>
              <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tags</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs gap-1">
                    #{tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-destructive">
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Nova tag..."
                  className="text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                />
                <Button size="sm" variant="outline" onClick={addTag} type="button">
                  <Plus size={14} />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso excluirá permanentemente o lead "{lead.name}" e todo o seu histórico de mensagens. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

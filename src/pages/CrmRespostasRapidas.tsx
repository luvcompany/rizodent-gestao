import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Edit } from "lucide-react";

export default function CrmRespostasRapidas() {
  const [replies, setReplies] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_quick_replies").select("*").order("created_at", { ascending: false });
    setReplies(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!title.trim() || !content.trim()) return toast.error("Preencha título e conteúdo");
    if (editing) {
      await supabase.from("crm_quick_replies").update({ title, content }).eq("id", editing.id);
    } else {
      await supabase.from("crm_quick_replies").insert({ title, content });
    }
    setOpen(false); setEditing(null); setTitle(""); setContent("");
    load();
    toast.success(editing ? "Resposta atualizada" : "Resposta criada");
  };

  const remove = async (id: string) => {
    await supabase.from("crm_quick_replies").delete().eq("id", id);
    load(); toast.success("Removida");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Respostas Rápidas</h1>
          <p className="text-muted-foreground">Snippets de texto para uso no chat com comando /</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setTitle(""); setContent(""); } }}>
          <DialogTrigger asChild><Button size="sm"><Plus size={16} /> Nova Resposta</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} Resposta Rápida</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Saudação inicial" /></div>
              <div><Label>Conteúdo</Label><Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Olá! Tudo bem? Como posso ajudar?" rows={4} /></div>
              <Button onClick={save} className="w-full">{editing ? "Salvar" : "Criar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Título</TableHead><TableHead>Conteúdo</TableHead><TableHead className="w-24">Ações</TableHead></TableRow></TableHeader>
        <TableBody>
          {replies.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.title}</TableCell>
              <TableCell className="max-w-md truncate text-muted-foreground">{r.content}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setTitle(r.title); setContent(r.content); setOpen(true); }}><Edit size={14} /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 size={14} /></Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {replies.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nenhuma resposta rápida cadastrada</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

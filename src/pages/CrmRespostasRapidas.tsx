import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Users } from "lucide-react";
import ShareRoleDialog, { OwnerRoleBadge, type OwnerRole } from "@/components/crm/ShareRoleDialog";
import { useAuth } from "@/contexts/AuthContext";

export default function CrmRespostasRapidas() {
  const { userRole, user } = useAuth();
  const canShare = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
  // A SDR lê o acervo do crc, mas as policies sdr_escopo_crm_quick_replies_*
  // só deixam editar/apagar o que ela mesma criou (created_by = auth.uid()).
  // Esconder as ações nos itens dos outros evita o clique que sempre falha;
  // para os demais papéis nada muda.
  const podeEditarItem = (r: { created_by?: string | null }) =>
    userRole !== "sdr" || (!!user?.id && r.created_by === user.id);
  const [replies, setReplies] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [shareTarget, setShareTarget] = useState<any | null>(null);
  // REC-13: excluir pede confirmação (como Modelos e Bots) — antes apagava no clique.
  const [paraExcluir, setParaExcluir] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_quick_replies").select("*").order("created_at", { ascending: false });
    setReplies(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!title.trim() || !content.trim()) return toast.error("Preencha título e conteúdo");
    if (editing) {
      // Sem o `.select()`, um update recusado pelo banco volta como sucesso
      // com zero linhas e o toast comemoraria à toa.
      const { data, error } = await supabase.from("crm_quick_replies").update({ title, content }).eq("id", editing.id).select("id");
      if (error) return toast.error("Erro ao atualizar: " + error.message);
      if (!data || data.length === 0) return toast.error("Seu perfil não tem permissão para editar esta resposta.");
    } else {
      // `created_by` não tem default no banco nem gatilho que o preencha (só
      // tenant_id e owner_role têm). Sem mandar daqui a coluna nasce NULL — e
      // a policy sdr_escopo_crm_quick_replies_insert exige created_by =
      // auth.uid(), então a SDR nem conseguiria criar, e o que ela criasse
      // apareceria como "de outra pessoa" na regra de edição acima. Para os
      // demais papéis nada muda: as policies "Staff can insert/update/delete"
      // não olham created_by (é só o carimbo de autoria).
      const { error } = await supabase.from("crm_quick_replies").insert({ title, content, created_by: user?.id ?? null });
      if (error) return toast.error("Erro ao criar: " + error.message);
    }
    setOpen(false); setEditing(null); setTitle(""); setContent("");
    load();
    toast.success(editing ? "Resposta atualizada" : "Resposta criada");
  };

  const remove = async (id: string) => {
    setParaExcluir(null);
    const { data, error } = await supabase.from("crm_quick_replies").delete().eq("id", id).select("id");
    if (error) return toast.error("Erro ao excluir: " + error.message);
    if (!data || data.length === 0) return toast.error("Seu perfil não tem permissão para excluir esta resposta.");
    load(); toast.success("Resposta excluída");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">Respostas Rápidas</h1>
          <p className="text-muted-foreground">Textos prontos para usar no chat digitando /</p>
          {/* CONV-2: como usar no chat (o "/" lista as respostas antes dos modelos). */}
          <p className="text-xs text-muted-foreground mt-1">
            Na conversa, digite <span className="font-mono">/</span> e parte do título: a resposta entra na caixa para você revisar e enviar.
            Escreva <span className="font-mono">{"{{nome}}"}</span> onde deve ir o primeiro nome do paciente. Vale também no Direct do Instagram.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setTitle(""); setContent(""); } }}>
          <DialogTrigger asChild><Button size="sm" className="h-10 rounded-xl shadow-brand"><Plus size={16} /> Nova Resposta</Button></DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} Resposta Rápida</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Título</Label><Input className="h-10 rounded-xl" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Saudação inicial" /></div>
              <div>
                <Label>Conteúdo</Label>
                 <Textarea className="rounded-xl" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Olá, {{nome}}! Tudo bem? Como posso ajudar?" rows={4} />
                <p className="text-[11px] text-muted-foreground mt-1">{"{{nome}}"} vira o primeiro nome do paciente.</p>
              </div>
              <Button onClick={save} className="w-full">{editing ? "Salvar" : "Criar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card"><Table className="sm:min-w-[720px]">
        <TableHeader className="max-sm:hidden"><TableRow><TableHead>Título</TableHead><TableHead>Conteúdo</TableHead><TableHead>Visibilidade</TableHead><TableHead className="w-32">Ações</TableHead></TableRow></TableHeader>
        <TableBody className="max-sm:block">
          {replies.map((r) => (
            <TableRow key={r.id} className="max-sm:grid max-sm:grid-cols-1 max-sm:gap-2 max-sm:border-b max-sm:border-border/60 max-sm:p-4">
              <TableCell className="font-medium max-sm:block max-sm:p-0">{r.title}</TableCell>
              <TableCell className="max-w-md truncate text-muted-foreground max-sm:block max-sm:max-w-none max-sm:whitespace-normal max-sm:break-words max-sm:p-0">{r.content}</TableCell>
              <TableCell className="max-sm:block max-sm:p-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <OwnerRoleBadge ownerRole={(r.owner_role ?? null) as OwnerRole} />
                  {/* SDR-22: a autoria distingue a resposta da própria pessoa das da clínica. */}
                  {!!user?.id && r.created_by === user.id && (
                    <span className="text-[10px] text-muted-foreground">criada por você</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-sm:block max-sm:p-0">
                <div className="flex gap-1">
                  {podeEditarItem(r) && (
                    <Button size="icon" variant="ghost" title="Editar" onClick={() => { setEditing(r); setTitle(r.title); setContent(r.content); setOpen(true); }}><Edit size={14} /></Button>
                  )}
                  {canShare && (
                    <Button size="icon" variant="ghost" title="Compartilhar com papel" onClick={() => setShareTarget(r)}><Users size={14} /></Button>
                  )}
                  {podeEditarItem(r) && (
                    <Button size="icon" variant="ghost" title="Excluir" onClick={() => setParaExcluir({ id: r.id, title: r.title })}><Trash2 size={14} /></Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {replies.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhuma resposta rápida cadastrada</TableCell></TableRow>}
        </TableBody>
      </Table></div>

      <AlertDialog open={!!paraExcluir} onOpenChange={(aberto) => { if (!aberto) setParaExcluir(null); }}>
         <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir resposta?</AlertDialogTitle>
            <AlertDialogDescription>
              {paraExcluir ? <>“{paraExcluir.title}” sai do atalho / para todos. </> : null}Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (paraExcluir) void remove(paraExcluir.id); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShareRoleDialog
        open={!!shareTarget}
        onOpenChange={(v) => !v && setShareTarget(null)}
        table="crm_quick_replies"
        rowId={shareTarget?.id ?? null}
        currentOwnerRole={(shareTarget?.owner_role ?? null) as OwnerRole}
        currentSharedRoles={(shareTarget?.shared_roles ?? []) as string[]}
        itemLabel="Resposta"
        onSaved={load}
      />
    </div>
  );
}

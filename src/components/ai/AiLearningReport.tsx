import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Brain, Database, Loader2, ThumbsUp, ThumbsDown, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  lead_id: string;
  suggested_text: string;
  final_text: string | null;
  was_edited: boolean;
  status: string;
  created_at: string;
};

type LearningStats = { total: number; embedded: number; pending: number; corrections: number };
type ColKind = "approved" | "edited" | "discarded";

type EditState = { open: boolean; kind: ColKind; row: Row | null };
type AddState = {
  open: boolean;
  kind: ColKind;
  leadQuery: string;
  leadResults: Array<{ id: string; name: string | null; phone: string | null }>;
  leadId: string | null;
  leadLabel: string;
  suggested: string;
  final: string;
  saving: boolean;
};

const emptyAdd = (kind: ColKind): AddState => ({
  open: true, kind, leadQuery: "", leadResults: [], leadId: null, leadLabel: "",
  suggested: "", final: "", saving: false,
});

export default function AiLearningReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<LearningStats>({ total: 0, embedded: 0, pending: 0, corrections: 0 });
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditState>({ open: false, kind: "approved", row: null });
  const [editText1, setEditText1] = useState("");
  const [editText2, setEditText2] = useState("");
  const [saving, setSaving] = useState(false);
  const [add, setAdd] = useState<AddState | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data }, { count: total }, { count: embedded }, { count: corrections }] = await Promise.all([
      supabase.from("ai_reply_suggestions" as any)
        .select("id, lead_id, suggested_text, final_text, was_edited, status, created_at")
        .in("status", ["sent", "discarded"])
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("ai_good_examples" as any).select("id", { count: "exact", head: true }),
      supabase.from("ai_good_examples" as any).select("id", { count: "exact", head: true }).not("embedding", "is", null),
      supabase.from("ai_good_examples" as any).select("id", { count: "exact", head: true }).not("rejected_reply", "is", null),
    ]);
    setRows((data as any) || []);
    setStats({
      total: total || 0,
      embedded: embedded || 0,
      pending: Math.max((total || 0) - (embedded || 0), 0),
      corrections: corrections || 0,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const approved = useMemo(() => rows.filter((r) => r.status === "sent" && !r.was_edited), [rows]);
  const edited = useMemo(() => rows.filter((r) => r.was_edited), [rows]);
  const discarded = useMemo(() => rows.filter((r) => r.status === "discarded" && !r.was_edited), [rows]);

  const openEdit = (kind: ColKind, row: Row) => {
    setEdit({ open: true, kind, row });
    setEditText1(row.suggested_text || "");
    setEditText2(row.final_text || "");
  };

  const saveEdit = async () => {
    if (!edit.row) return;
    setSaving(true);
    const patch: any = { suggested_text: editText1 };
    if (edit.kind === "edited") patch.final_text = editText2;
    const { error } = await supabase.from("ai_reply_suggestions" as any).update(patch).eq("id", edit.row.id);
    setSaving(false);
    if (error) return toast.error("Falha ao salvar: " + error.message);
    toast.success("Atualizado");
    setEdit({ open: false, kind: "approved", row: null });
    load();
  };

  const removeRow = async (row: Row) => {
    if (!confirm("Remover este exemplo?")) return;
    const { error } = await supabase.from("ai_reply_suggestions" as any).delete().eq("id", row.id);
    if (error) return toast.error("Falha ao remover: " + error.message);
    toast.success("Removido");
    load();
  };

  const searchLeads = async (q: string) => {
    if (!add) return;
    setAdd({ ...add, leadQuery: q });
    if (q.trim().length < 2) { setAdd((s) => s ? { ...s, leadResults: [] } : s); return; }
    const digits = q.replace(/\D/g, "");
    const filter = digits.length >= 3
      ? `phone.ilike.%${digits}%,name.ilike.%${q}%`
      : `name.ilike.%${q}%`;
    const { data } = await supabase.from("crm_leads")
      .select("id, name, phone").or(filter).limit(8);
    setAdd((s) => s ? { ...s, leadResults: (data as any) || [] } : s);
  };

  const saveAdd = async () => {
    if (!add) return;
    if (!add.leadId) return toast.error("Selecione um lead");
    if (!add.suggested.trim()) return toast.error("Preencha o texto");
    if (add.kind === "edited" && !add.final.trim()) return toast.error("Preencha a versão corrigida");
    setAdd({ ...add, saving: true });

    const { data: u } = await supabase.auth.getUser();
    const { data: lead } = await supabase.from("crm_leads").select("tenant_id").eq("id", add.leadId).maybeSingle();

    const payload: any = {
      lead_id: add.leadId,
      tenant_id: (lead as any)?.tenant_id ?? null,
      suggested_text: add.suggested.trim(),
      action: "reply",
      status: add.kind === "discarded" ? "discarded" : "sent",
      was_edited: add.kind === "edited",
      final_text: add.kind === "edited" ? add.final.trim() : (add.kind === "approved" ? add.suggested.trim() : null),
      decided_by: u.user?.id ?? null,
      decided_at: new Date().toISOString(),
      model: "manual",
    };
    const { error } = await supabase.from("ai_reply_suggestions" as any).insert(payload);
    setAdd({ ...add, saving: false });
    if (error) return toast.error("Falha ao adicionar: " + error.message);
    toast.success("Exemplo adicionado. A Bia aprenderá em instantes.");
    setAdd(null);
    load();
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 size={14} className="animate-spin" />Carregando...</div>;

  const Block = ({ title, items, color, icon, kind }: { title: string; items: Row[]; color: string; icon: any; kind: ColKind }) => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className={`text-base flex items-center gap-2 ${color}`}>{icon}{title} ({items.length})</CardTitle>
            <CardDescription>Últimas 300 sugestões.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAdd(emptyAdd(kind))}>
            <Plus size={14} className="mr-1" /> Adicionar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground">Nada por aqui ainda.</p>}
        {items.map((r) => (
          <div key={r.id} className="p-2 rounded border border-border bg-secondary/30 text-xs space-y-1 group">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-[10px]">{new Date(r.created_at).toLocaleString("pt-BR")}</Badge>
              <div className="flex items-center gap-1">
                {r.was_edited && <Badge variant="secondary" className="text-[10px]">editada</Badge>}
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(kind, r)} title="Editar">
                  <Pencil size={12} />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => removeRow(r)} title="Remover">
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
            <div><span className="text-muted-foreground">Sugerida:</span> {r.suggested_text}</div>
            {r.final_text && r.final_text !== r.suggested_text && (
              <div><span className="text-muted-foreground">Enviada:</span> {r.final_text}</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 flex items-center gap-3"><Brain size={18} className="text-primary" /><div><p className="text-xs text-muted-foreground">Exemplos salvos</p><p className="font-semibold">{stats.total}</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-3"><Database size={18} className="text-emerald-600" /><div><p className="text-xs text-muted-foreground">Prontos para busca</p><p className="font-semibold">{stats.embedded}</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-3"><Loader2 size={18} className="text-amber-600" /><div><p className="text-xs text-muted-foreground">Sem vetor</p><p className="font-semibold">{stats.pending}</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-3"><Pencil size={18} className="text-amber-600" /><div><p className="text-xs text-muted-foreground">Correções aprendidas</p><p className="font-semibold">{stats.corrections}</p></div></CardContent></Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Block title="Aprovadas sem edição" items={approved} color="text-emerald-600" icon={<ThumbsUp size={16} />} kind="approved" />
        <Block title="Corrigidas pela equipe" items={edited} color="text-amber-600" icon={<Pencil size={16} />} kind="edited" />
        <Block title="Descartadas" items={discarded} color="text-destructive" icon={<ThumbsDown size={16} />} kind="discarded" />
      </div>

      {/* EDIT */}
      <Dialog open={edit.open} onOpenChange={(o) => !o && setEdit({ open: false, kind: "approved", row: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar exemplo</DialogTitle>
            <DialogDescription>As alterações serão reprocessadas pela Bia.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">{edit.kind === "edited" ? "Sugestão original" : "Texto"}</label>
              <Textarea value={editText1} onChange={(e) => setEditText1(e.target.value)} rows={4} />
            </div>
            {edit.kind === "edited" && (
              <div>
                <label className="text-xs text-muted-foreground">Versão corrigida (enviada)</label>
                <Textarea value={editText2} onChange={(e) => setEditText2(e.target.value)} rows={4} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit({ open: false, kind: "approved", row: null })}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD */}
      <Dialog open={!!add} onOpenChange={(o) => !o && setAdd(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Adicionar exemplo — {add?.kind === "approved" ? "Aprovada" : add?.kind === "edited" ? "Corrigida" : "Descartada"}
            </DialogTitle>
            <DialogDescription>Selecione o lead de referência e escreva o texto.</DialogDescription>
          </DialogHeader>
          {add && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Lead (busque por nome ou telefone)</label>
                <Input value={add.leadQuery} onChange={(e) => searchLeads(e.target.value)} placeholder="Ex.: Maria ou 5577..." />
                {add.leadId && <p className="text-xs mt-1 text-emerald-600">Selecionado: {add.leadLabel}</p>}
                {add.leadResults.length > 0 && (
                  <div className="mt-1 border rounded max-h-40 overflow-y-auto">
                    {add.leadResults.map((l) => (
                      <button key={l.id} type="button"
                        className="w-full text-left px-2 py-1 text-xs hover:bg-secondary"
                        onClick={() => setAdd({ ...add, leadId: l.id, leadLabel: `${l.name ?? "sem nome"} · ${l.phone ?? ""}`, leadResults: [], leadQuery: "" })}>
                        {l.name ?? "Sem nome"} · <span className="text-muted-foreground">{l.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  {add.kind === "edited" ? "Sugestão que a Bia deu (errada)" : add.kind === "discarded" ? "Resposta a evitar" : "Resposta ideal"}
                </label>
                <Textarea value={add.suggested} onChange={(e) => setAdd({ ...add, suggested: e.target.value })} rows={4} />
              </div>
              {add.kind === "edited" && (
                <div>
                  <label className="text-xs text-muted-foreground">Versão correta (o que deveria ter enviado)</label>
                  <Textarea value={add.final} onChange={(e) => setAdd({ ...add, final: e.target.value })} rows={4} />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdd(null)}>Cancelar</Button>
            <Button onClick={saveAdd} disabled={add?.saving}>{add?.saving ? "Salvando..." : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

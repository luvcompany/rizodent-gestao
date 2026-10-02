import { forwardRef, useState, type ButtonHTMLAttributes } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { LABEL_COLORS, type LeadLabel, useLeadLabels } from "@/hooks/useLeadLabels";
import { toast } from "sonner";

type Props = {
  leadId: string;
  /** Render trigger as small ghost button by default; override for inline use */
  trigger?: React.ReactNode;
};

export default function LeadLabelsPopover({ leadId, trigger }: Props) {
  const { labels, labelsByLead, toggleAssignment, createLabel, updateLabel, deleteLabel } = useLeadLabels();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LeadLabel | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", color: LABEL_COLORS[0], description: "" });

  const assigned = new Set(labelsByLead(leadId).map(l => l.id));
  const filtered = labels.filter(l => l.name.toLowerCase().includes(search.toLowerCase()));

  const resetForm = () => { setForm({ name: "", color: LABEL_COLORS[0], description: "" }); setEditing(null); setCreating(false); };

  const openCreate = () => { resetForm(); setCreating(true); };
  const openEdit = (l: LeadLabel) => { setForm({ name: l.name, color: l.color, description: l.description || "" }); setEditing(l); setCreating(false); };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Dê um nome ao marcador"); return; }
    if (editing) {
      const ok = await updateLabel(editing.id, { name: form.name.trim(), color: form.color, description: form.description.trim() || null });
      if (!ok) { toast.error("Este marcador é de outra pessoa — só quem criou pode alterar."); return; }
      toast.success("Marcador atualizado");
    } else {
      await createLabel({ name: form.name.trim(), color: form.color, description: form.description.trim() || undefined });
      toast.success("Marcador criado");
    }
    resetForm();
  };

  const onDelete = async (id: string) => {
    if (!confirm("Excluir este marcador? Ele será removido de todos os leads.")) return;
    const ok = await deleteLabel(id);
    if (!ok) { toast.error("Este marcador é de outra pessoa — só quem criou pode excluir."); return; }
    toast.success("Marcador excluído");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Marcadores"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Tag size={12} />
          </button>
        )}
      </DialogTrigger>
      <DialogContent
        className="w-[340px] max-w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden rounded-2xl shadow-float"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onKeyPress={(e) => e.stopPropagation()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Configurar marcadores</DialogTitle>
        </DialogHeader>
        <div className="px-4 pt-4 pb-3 pr-14 border-b border-border/60">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold tracking-tight">Marcadores</span>
            {!creating && !editing && (
              <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-primary-soft hover:text-primary" onClick={openCreate}>
                <Plus size={12} className="mr-1" /> Novo
              </Button>
            )}
          </div>
          {!creating && !editing && (
            <Input
              placeholder="Buscar marcador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-xl border-transparent bg-surface-sunken text-[13px] mt-3 placeholder:text-tertiary focus-visible:bg-card"
            />
          )}
        </div>

        {(creating || editing) && (
          <div className="p-4 space-y-3 border-b border-border/60">
            <Input
              placeholder="Nome (ex: Urgente)"
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              className="h-9 rounded-xl text-[13px]"
              autoFocus
            />
            <Textarea
              placeholder="Descrição (o que significa esta cor?)"
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              className="rounded-xl text-[13px] min-h-[64px]"
            />
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Cor</div>
              <div className="grid grid-cols-10 gap-1.5">
                {LABEL_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`h-6 w-6 rounded-full transition-all ${form.color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "hover:ring-2 hover:ring-border hover:ring-offset-1 hover:ring-offset-background"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button size="sm" variant="ghost" className="h-8 rounded-lg px-3 text-xs" onClick={resetForm}>Cancelar</Button>
              <Button size="sm" className="h-8 rounded-lg px-3 text-xs font-semibold shadow-brand" onClick={submit}>{editing ? "Salvar" : "Criar"}</Button>
            </div>
          </div>
        )}

        {!creating && !editing && (
          <div className="max-h-72 overflow-y-auto p-2">
            {filtered.length === 0 && (
              <div className="text-center text-xs text-muted-foreground px-4 py-8">
                {labels.length === 0 ? "Nenhum marcador ainda. Clique em \"Novo\" para criar." : "Nada encontrado."}
              </div>
            )}
            {filtered.map(l => {
              const isOn = assigned.has(l.id);
              return (
                <div key={l.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-surface-sunken transition-colors">
                  <button
                    type="button"
                    onClick={() => toggleAssignment(leadId, l.id)}
                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
                    title={l.description || ""}
                  >
                    <span className="h-5 w-9 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: l.color }} />
                    <span className="text-[13px] font-medium truncate flex-1">{l.name}</span>
                    {isOn && <Check size={14} strokeWidth={2.5} className="text-primary shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(l)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-muted rounded-lg transition-opacity"
                    title="Editar"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(l.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive-soft hover:text-destructive rounded-lg transition-opacity"
                    title="Excluir"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type LeadLabelsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & { leadId: string };

export const LeadLabelsTrigger = forwardRef<HTMLButtonElement, LeadLabelsTriggerProps>(
  ({ leadId, onPointerDown, onMouseDown, onClick, className = "", ...props }, ref) => {
  const { labelsByLead } = useLeadLabels();
  const items = labelsByLead(leadId);

  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex min-h-6 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-tertiary hover:bg-muted hover:text-foreground transition-colors ${className}`}
      title="Configurar marcadores"
      onPointerDown={(e) => { e.stopPropagation(); onPointerDown?.(e); }}
      onMouseDown={(e) => { e.stopPropagation(); onMouseDown?.(e); }}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      {...props}
    >
      {items.length === 0 ? (
        <>
          <Tag size={12} />
          <span>Marcadores</span>
        </>
      ) : (
        <>
          <Tag size={12} className="shrink-0" />
          <span className="flex min-w-0 flex-wrap gap-1">
            {items.slice(0, 3).map(l => (
              <span key={l.id} className="h-2 w-4 rounded-full" style={{ backgroundColor: l.color }} />
            ))}
            {items.length > 3 && <span className="leading-none">+{items.length - 3}</span>}
          </span>
        </>
      )}
    </button>
  );
  },
);
LeadLabelsTrigger.displayName = "LeadLabelsTrigger";

/** Small read-only display of assigned label chips for a lead. */
export function LeadLabelChips({ leadId, max = 4 }: { leadId: string; max?: number }) {
  const { labelsByLead } = useLeadLabels();
  const items = labelsByLead(leadId);
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return (
    <div className="basis-full flex flex-wrap gap-1 mt-1.5">
      {shown.map(l => (
        <span
          key={l.id}
          className="inline-flex h-5 items-center gap-1 text-[11px] font-semibold text-white px-2 rounded-full shadow-xs"
          style={{ backgroundColor: l.color }}
          title={l.description ? `${l.name} — ${l.description}` : l.name}
        >
          {l.name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-muted-foreground px-1 py-0.5">+{extra}</span>
      )}
    </div>
  );
}

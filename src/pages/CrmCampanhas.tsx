import { useState, useEffect, useCallback } from "react";
import { deduplicateTemplates, cleanTemplateName } from "@/lib/templateUtils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Send, Users, Share2 } from "lucide-react";
import { format } from "date-fns";
import TemplateSearchSelect from "@/components/chat/TemplateSearchSelect";
import ShareRoleDialog, { OwnerRoleBadge, type OwnerRole } from "@/components/crm/ShareRoleDialog";
import { useAuth } from "@/contexts/AuthContext";

export default function CrmCampanhas() {
  const { userRole } = useAuth();
  const canShare = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", template_id: "", pipeline_id: "", stage_id: "" });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<any | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_broadcasts").select("*").order("created_at", { ascending: false });
    setBroadcasts(data || []);
  }, []);

  useEffect(() => {
    load();
    supabase.from("crm_whatsapp_templates").select("id, name, status").eq("status", "APPROVED").order("created_at", { ascending: false }).then(({ data }) => setTemplates(deduplicateTemplates(data || [])));
    supabase.from("crm_pipelines").select("id, name").then(({ data }) => setPipelines(data || []));
  }, [load]);

  useEffect(() => {
    if (form.pipeline_id) supabase.from("crm_stages").select("id, name").eq("pipeline_id", form.pipeline_id).order("position").then(({ data }) => setStages(data || []));
  }, [form.pipeline_id]);

  const preview = async () => {
    let q = supabase.from("crm_leads").select("id", { count: "exact", head: true });
    if (form.pipeline_id) q = q.eq("pipeline_id", form.pipeline_id);
    if (form.stage_id) q = q.eq("stage_id", form.stage_id);
    const { count } = await q;
    setPreviewCount(count || 0);
  };

  const create = async () => {
    if (!form.name || !form.template_id) return toast.error("Nome e template são obrigatórios");
    const totalLeads = previewCount || 0;
    const { data: bc } = await supabase.from("crm_broadcasts").insert({
      name: form.name, template_id: form.template_id,
      filter_pipeline_id: form.pipeline_id || null, filter_stage_id: form.stage_id || null,
      total_leads: totalLeads, status: "draft",
    }).select().single();
    if (!bc) return toast.error("Erro ao criar campanha");

    const PAGE = 1000;
    const leads: { id: string }[] = [];
    let from = 0;
    while (true) {
      let q = supabase.from("crm_leads").select("id").range(from, from + PAGE - 1);
      if (form.pipeline_id) q = q.eq("pipeline_id", form.pipeline_id);
      if (form.stage_id) q = q.eq("stage_id", form.stage_id);
      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      leads.push(...(data as { id: string }[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    if (leads.length > 0) {
      // Insert recipients in chunks to avoid payload size limits
      const CHUNK = 500;
      for (let i = 0; i < leads.length; i += CHUNK) {
        const recipients = leads.slice(i, i + CHUNK).map(l => ({ broadcast_id: bc.id, lead_id: l.id }));
        await supabase.from("crm_broadcast_recipients").insert(recipients);
      }
    }
    setOpen(false); setForm({ name: "", template_id: "", pipeline_id: "", stage_id: "" }); setPreviewCount(null);
    load();
    toast.success(`Campanha criada com ${leads.length} destinatários`);
  };

  const send = async (id: string) => {
    await supabase.from("crm_broadcasts").update({ status: "sending" }).eq("id", id);
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    try {
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/broadcast-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        body: JSON.stringify({ broadcast_id: id }),
      });
      if (resp.ok) {
        const result = await resp.json();
        toast.success(`Envio concluído: ${result.sent ?? 0} mensagens enviadas`);
      } else {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        await supabase.from("crm_broadcasts").update({ status: "draft" }).eq("id", id);
        toast.error(`Erro no envio: ${err.error || resp.status}`);
      }
    } catch {
      await supabase.from("crm_broadcasts").update({ status: "draft" }).eq("id", id);
      toast.error("Erro ao conectar com o servidor de envio");
    }
    load();
  };

  const statusColor: Record<string, string> = { draft: "secondary", sending: "default", completed: "outline", failed: "destructive" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campanhas em Massa</h1>
          <p className="text-muted-foreground">Envie templates aprovados para múltiplos leads</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus size={16} /> Nova Campanha</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Campanha</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Template</Label><TemplateSearchSelect templates={templates} value={form.template_id || undefined} onValueChange={v => setForm(p => ({ ...p, template_id: v }))} placeholder="Selecione..." /></div>
              <div><Label>Funil (filtro)</Label><Select value={form.pipeline_id} onValueChange={v => setForm(p => ({ ...p, pipeline_id: v, stage_id: "" }))}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent>{pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              {form.pipeline_id && <div><Label>Etapa (filtro)</Label><Select value={form.stage_id} onValueChange={v => setForm(p => ({ ...p, stage_id: v }))}><SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger><SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>}
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={preview}><Users size={16} /> Preview</Button>
                {previewCount !== null && <span className="text-sm text-muted-foreground">{previewCount} leads</span>}
              </div>
              <Button onClick={create} className="w-full"><Send size={16} /> Criar Campanha</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Status</TableHead><TableHead>Visibilidade</TableHead><TableHead>Total</TableHead><TableHead>Enviados</TableHead><TableHead>Data</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader>
        <TableBody>
          {broadcasts.map(b => (
            <TableRow key={b.id}>
              <TableCell className="font-medium">{b.name}</TableCell>
              <TableCell><Badge variant={statusColor[b.status] as any || "outline"}>{b.status}</Badge></TableCell>
              <TableCell><OwnerRoleBadge ownerRole={(b.owner_role ?? null) as OwnerRole} /></TableCell>
              <TableCell>{b.total_leads}</TableCell>
              <TableCell>{b.sent_count}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{format(new Date(b.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {b.status === "draft" && <Button size="sm" variant="outline" onClick={() => send(b.id)}><Send size={14} /> Enviar</Button>}
                  {canShare && <Button size="icon" variant="ghost" title="Compartilhar com papel" onClick={() => setShareTarget(b)}><Share2 size={14} /></Button>}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {broadcasts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma campanha</TableCell></TableRow>}
        </TableBody>
      </Table>

      <ShareRoleDialog
        open={!!shareTarget}
        onOpenChange={(v) => !v && setShareTarget(null)}
        table="crm_broadcasts"
        rowId={shareTarget?.id ?? null}
        currentOwnerRole={(shareTarget?.owner_role ?? null) as OwnerRole}
        currentSharedRoles={(shareTarget?.shared_roles ?? []) as string[]}
        itemLabel="Campanha"
        onSaved={load}
      />
    </div>
  );
}

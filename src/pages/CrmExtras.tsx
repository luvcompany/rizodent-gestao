import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Trash2, Edit, Zap, Upload, Send, Webhook, Bell,
  RefreshCw, Copy, CheckCircle2, AlertTriangle, Users, FileText
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/* ═══════════════════════════════════════════════════
   TAB 1 — Respostas Rápidas
   ═══════════════════════════════════════════════════ */
function QuickRepliesTab() {
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
        <h3 className="text-lg font-semibold">Respostas Rápidas</h3>
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

/* ═══════════════════════════════════════════════════
   TAB 2 — Score de Lead
   ═══════════════════════════════════════════════════ */
function LeadScoreTab() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_leads").select("id, name, phone, score, stage_id, last_message_at").order("score", { ascending: false }).limit(50);
    setLeads(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const recalcAll = async () => {
    setLoading(true);
    await supabase.rpc("recalculate_all_lead_scores");
    await load();
    setLoading(false);
    toast.success("Scores recalculados");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Score de Leads</h3>
        <Button size="sm" onClick={recalcAll} disabled={loading}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Recalcular Todos</Button>
      </div>
      <p className="text-sm text-muted-foreground">Pontuação: +10 por resposta recebida, +15 por mudança de etapa, +5 por tarefa concluída, -1 por dia inativo.</p>
      <Table>
        <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Telefone</TableHead><TableHead>Score</TableHead><TableHead>Última Msg</TableHead></TableRow></TableHeader>
        <TableBody>
          {leads.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-medium">{l.name}</TableCell>
              <TableCell className="text-muted-foreground">{l.phone || "—"}</TableCell>
              <TableCell><Badge variant={l.score > 50 ? "default" : l.score > 20 ? "secondary" : "outline"}>{l.score}</Badge></TableCell>
              <TableCell className="text-muted-foreground text-sm">{l.last_message_at ? format(new Date(l.last_message_at), "dd/MM HH:mm") : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 3 — Métricas por Atendente
   ═══════════════════════════════════════════════════ */
function AttendantMetricsTab() {
  const [metrics, setMetrics] = useState<any[]>([]);

  useEffect(() => {
    const run = async () => {
      const { data: profiles } = await supabase.from("profiles").select("id, nome");
      const { data: msgs } = await supabase.from("messages").select("sender_id, direction, created_at, lead_id").eq("direction", "outbound").not("sender_id", "is", null);
      const { data: leads } = await supabase.from("crm_leads").select("id, assigned_to");

      if (!profiles || !msgs || !leads) return;

      const profileMap = new Map(profiles.map(p => [p.id, p.nome]));
      const grouped = new Map<string, { msgs: number; leads: Set<string> }>();

      for (const m of msgs) {
        if (!m.sender_id) continue;
        if (!grouped.has(m.sender_id)) grouped.set(m.sender_id, { msgs: 0, leads: new Set() });
        const g = grouped.get(m.sender_id)!;
        g.msgs++;
        g.leads.add(m.lead_id);
      }

      const assignedCounts = new Map<string, number>();
      for (const l of leads) {
        if (l.assigned_to) assignedCounts.set(l.assigned_to, (assignedCounts.get(l.assigned_to) || 0) + 1);
      }

      const result = Array.from(grouped.entries()).map(([uid, g]) => ({
        name: profileMap.get(uid) || uid.slice(0, 8),
        totalMsgs: g.msgs,
        leadsAtendidos: g.leads.size,
        assignedLeads: assignedCounts.get(uid) || 0,
      })).sort((a, b) => b.totalMsgs - a.totalMsgs);

      setMetrics(result);
    };
    run();
  }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Métricas por Atendente</h3>
      <p className="text-sm text-muted-foreground">Baseado em mensagens enviadas com sender_id registrado.</p>
      <Table>
        <TableHeader><TableRow><TableHead>Atendente</TableHead><TableHead>Mensagens Enviadas</TableHead><TableHead>Leads Atendidos</TableHead><TableHead>Leads Atribuídos</TableHead></TableRow></TableHeader>
        <TableBody>
          {metrics.map((m, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium">{m.name}</TableCell>
              <TableCell>{m.totalMsgs}</TableCell>
              <TableCell>{m.leadsAtendidos}</TableCell>
              <TableCell>{m.assignedLeads}</TableCell>
            </TableRow>
          ))}
          {metrics.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhuma métrica disponível. As mensagens precisam ter sender_id registrado.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 4 — Distribuição Automática
   ═══════════════════════════════════════════════════ */
function DistributionTab() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [method, setMethod] = useState("round_robin");
  const [selectedPipeline, setSelectedPipeline] = useState("");
  const [eligible, setEligible] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("profiles").select("id, nome").then(({ data }) => setProfiles(data || []));
    supabase.from("crm_pipelines").select("id, name").then(({ data }) => setPipelines(data || []));
  }, []);

  const toggleUser = (id: string) => {
    setEligible(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const saveConfig = async () => {
    if (!selectedPipeline) return toast.error("Selecione um funil");
    if (eligible.length === 0) return toast.error("Selecione ao menos um atendente");
    // Save as automation config
    const { data: existing } = await supabase.from("crm_automations").select("id").eq("action_type", "assign_lead").limit(1);
    const config = { method, eligible_users: eligible, pipeline_id: selectedPipeline };
    if (existing && existing.length > 0) {
      await supabase.from("crm_automations").update({ action_config: config, is_active: true }).eq("id", existing[0].id);
    } else {
      // Need a stage_id — use first stage of pipeline
      const { data: stages } = await supabase.from("crm_stages").select("id").eq("pipeline_id", selectedPipeline).order("position").limit(1);
      if (!stages?.length) return toast.error("Pipeline sem etapas");
      await supabase.from("crm_automations").insert({ stage_id: stages[0].id, action_type: "assign_lead", trigger_type: "on_enter", action_config: config });
    }
    toast.success("Configuração salva");
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Distribuição Automática de Leads</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <Label>Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">Round Robin</SelectItem>
                <SelectItem value="least_load">Menor Carga</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Funil</Label>
            <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={saveConfig}><Zap size={16} /> Salvar Configuração</Button>
        </div>
        <div>
          <Label>Atendentes Elegíveis</Label>
          <div className="space-y-2 mt-2 max-h-60 overflow-auto">
            {profiles.map(p => (
              <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={eligible.includes(p.id)} onChange={() => toggleUser(p.id)} className="rounded" />
                <span className="text-sm">{p.nome}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 5 — Importação em Massa
   ═══════════════════════════════════════════════════ */
function ImportTab() {
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("crm_pipelines").select("id, name").then(({ data }) => setPipelines(data || []));
  }, []);

  useEffect(() => {
    if (selectedPipeline) {
      supabase.from("crm_stages").select("id, name").eq("pipeline_id", selectedPipeline).order("position").then(({ data }) => setStages(data || []));
    }
  }, [selectedPipeline]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
      if (lines.length < 2) return toast.error("Arquivo vazio");
      setHeaders(lines[0]);
      setRows(lines.slice(1).filter(r => r.some(c => c)));
      setResult(null);
    };
    reader.readAsText(file);
  };

  const fields = [
    { key: "name", label: "Nome" },
    { key: "phone", label: "Telefone" },
    { key: "tags", label: "Tags (separadas por ;)" },
    { key: "source", label: "Origem" },
  ];

  const doImport = async () => {
    if (!selectedPipeline || !selectedStage) return toast.error("Selecione funil e etapa");
    if (!mapping.name || !mapping.phone) return toast.error("Mapeie ao menos Nome e Telefone");
    setImporting(true);
    let imported = 0, skipped = 0;
    const nameIdx = headers.indexOf(mapping.name);
    const phoneIdx = headers.indexOf(mapping.phone);
    const tagsIdx = mapping.tags ? headers.indexOf(mapping.tags) : -1;
    const sourceIdx = mapping.source ? headers.indexOf(mapping.source) : -1;

    for (const row of rows) {
      const name = row[nameIdx]?.trim();
      const phone = row[phoneIdx]?.trim().replace(/\D/g, "");
      if (!name || !phone) { skipped++; continue; }

      // Check duplicate
      const { data: existing } = await supabase.from("crm_leads").select("id").eq("phone", phone).limit(1);
      if (existing && existing.length > 0) { skipped++; continue; }

      const tags = tagsIdx >= 0 ? row[tagsIdx]?.split(";").map(t => t.trim()).filter(Boolean) : [];
      const source = sourceIdx >= 0 ? row[sourceIdx]?.trim() : "import";

      await supabase.from("crm_leads").insert({
        name, phone, pipeline_id: selectedPipeline, stage_id: selectedStage,
        tags, source: source || "import",
      });
      imported++;
    }
    setImporting(false);
    setResult({ imported, skipped });
    toast.success(`${imported} leads importados, ${skipped} ignorados`);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Importação em Massa</h3>
      <div className="flex gap-4 items-end">
        <div><Label>Arquivo CSV</Label><Input ref={fileRef} type="file" accept=".csv" onChange={handleFile} /></div>
        <div>
          <Label>Funil</Label>
          <Select value={selectedPipeline} onValueChange={setSelectedPipeline}><SelectTrigger className="w-48"><SelectValue placeholder="Funil" /></SelectTrigger><SelectContent>{pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div>
          <Label>Etapa</Label>
          <Select value={selectedStage} onValueChange={setSelectedStage}><SelectTrigger className="w-48"><SelectValue placeholder="Etapa" /></SelectTrigger><SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
        </div>
      </div>

      {headers.length > 0 && (
        <Card className="p-4 space-y-3">
          <h4 className="font-medium">Mapeamento de Colunas</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {fields.map(f => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Select value={mapping[f.key] || ""} onValueChange={(v) => setMapping(prev => ({ ...prev, [f.key]: v }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2">Preview (primeiros 5)</h4>
            <Table>
              <TableHeader><TableRow>{headers.map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{rows.slice(0, 5).map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className="text-xs">{c}</TableCell>)}</TableRow>)}</TableBody>
            </Table>
          </div>
          <div className="flex items-center gap-4">
            <Button onClick={doImport} disabled={importing}><Upload size={16} /> {importing ? "Importando..." : `Importar ${rows.length} leads`}</Button>
            {result && <span className="text-sm text-muted-foreground">{result.imported} importados, {result.skipped} ignorados</span>}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 6 — Campanhas (Broadcast)
   ═══════════════════════════════════════════════════ */
function BroadcastTab() {
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", template_id: "", pipeline_id: "", stage_id: "" });
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_broadcasts").select("*").order("created_at", { ascending: false });
    setBroadcasts(data || []);
  }, []);

  useEffect(() => {
    load();
    supabase.from("crm_whatsapp_templates").select("id, name, status").eq("status", "APPROVED").then(({ data }) => setTemplates(data || []));
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

    // Create recipients
    let q = supabase.from("crm_leads").select("id");
    if (form.pipeline_id) q = q.eq("pipeline_id", form.pipeline_id);
    if (form.stage_id) q = q.eq("stage_id", form.stage_id);
    const { data: leads } = await q;
    if (leads && leads.length > 0) {
      const recipients = leads.map(l => ({ broadcast_id: bc.id, lead_id: l.id }));
      await supabase.from("crm_broadcast_recipients").insert(recipients);
    }
    setOpen(false); setForm({ name: "", template_id: "", pipeline_id: "", stage_id: "" }); setPreviewCount(null);
    load();
    toast.success(`Campanha criada com ${leads?.length || 0} destinatários`);
  };

  const send = async (id: string) => {
    await supabase.from("crm_broadcasts").update({ status: "sending" }).eq("id", id);
    // Call broadcast-engine
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    try {
      await fetch(`https://${projectId}.supabase.co/functions/v1/broadcast-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        body: JSON.stringify({ broadcast_id: id }),
      });
      toast.success("Envio iniciado");
    } catch {
      toast.error("Erro ao iniciar envio");
    }
    load();
  };

  const statusColor: Record<string, string> = { draft: "secondary", sending: "default", completed: "outline", failed: "destructive" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Campanhas em Massa</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus size={16} /> Nova Campanha</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Campanha</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Template</Label><Select value={form.template_id} onValueChange={v => setForm(p => ({ ...p, template_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger><SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
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
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Enviados</TableHead><TableHead>Data</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader>
        <TableBody>
          {broadcasts.map(b => (
            <TableRow key={b.id}>
              <TableCell className="font-medium">{b.name}</TableCell>
              <TableCell><Badge variant={statusColor[b.status] as any || "outline"}>{b.status}</Badge></TableCell>
              <TableCell>{b.total_leads}</TableCell>
              <TableCell>{b.sent_count}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{format(new Date(b.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
              <TableCell>{b.status === "draft" && <Button size="sm" variant="outline" onClick={() => send(b.id)}><Send size={14} /> Enviar</Button>}</TableCell>
            </TableRow>
          ))}
          {broadcasts.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma campanha</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 7 — Webhook Genérico
   ═══════════════════════════════════════════════════ */
function WebhookTab() {
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const webhookUrl = `https://${projectId}.supabase.co/functions/v1/generic-lead-webhook`;

  const examplePayload = JSON.stringify({
    name: "João Silva",
    phone: "5511999887766",
    tags: ["landing-page", "promo"],
    pipeline: "nome-do-funil",
    source: "typeform"
  }, null, 2);

  useEffect(() => {
    supabase.from("crm_leads").select("id, name, phone, source, created_at").eq("source", "webhook").order("created_at", { ascending: false }).limit(10).then(({ data }) => setRecentLeads(data || []));
  }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Webhook Genérico</h3>
      <Card className="p-4 space-y-3">
        <div>
          <Label>URL do Endpoint</Label>
          <div className="flex gap-2 items-center">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("Copiado!"); }}><Copy size={14} /></Button>
          </div>
        </div>
        <div>
          <Label>Método: POST</Label>
          <p className="text-xs text-muted-foreground">Content-Type: application/json</p>
        </div>
        <div>
          <Label>Exemplo de Payload</Label>
          <pre className="bg-muted p-3 rounded text-xs font-mono overflow-auto max-h-48">{examplePayload}</pre>
        </div>
      </Card>
      <div>
        <h4 className="font-medium mb-2">Últimos leads via webhook</h4>
        <Table>
          <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Telefone</TableHead><TableHead>Data</TableHead></TableRow></TableHeader>
          <TableBody>
            {recentLeads.map(l => (
              <TableRow key={l.id}>
                <TableCell>{l.name}</TableCell>
                <TableCell>{l.phone}</TableCell>
                <TableCell className="text-sm">{format(new Date(l.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
              </TableRow>
            ))}
            {recentLeads.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nenhum lead recebido via webhook</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 8 — Notificações
   ═══════════════════════════════════════════════════ */
function NotificationsTab() {
  const [prefs, setPrefs] = useState({ notify_task_due: true, notify_new_lead: true, notify_lead_reply: true, browser_push_enabled: false });
  const [permissionState, setPermissionState] = useState<string>("default");

  useEffect(() => {
    if ("Notification" in window) setPermissionState(Notification.permission);
    supabase.from("crm_notification_preferences").select("*").limit(1).then(({ data }) => {
      if (data && data.length > 0) setPrefs(data[0] as any);
    });
  }, []);

  const requestPermission = async () => {
    if (!("Notification" in window)) return toast.error("Navegador não suporta notificações");
    const perm = await Notification.requestPermission();
    setPermissionState(perm);
    if (perm === "granted") {
      toast.success("Notificações ativadas");
      await savePrefs({ ...prefs, browser_push_enabled: true });
    }
  };

  const savePrefs = async (newPrefs: typeof prefs) => {
    setPrefs(newPrefs);
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) return;
    const { data: existing } = await supabase.from("crm_notification_preferences").select("id").eq("user_id", userId).limit(1);
    if (existing && existing.length > 0) {
      await supabase.from("crm_notification_preferences").update(newPrefs).eq("user_id", userId);
    } else {
      await supabase.from("crm_notification_preferences").insert({ ...newPrefs, user_id: userId });
    }
    toast.success("Preferências salvas");
  };

  const testNotification = () => {
    if (Notification.permission !== "granted") return toast.error("Permita as notificações primeiro");
    new Notification("🔔 Teste de Notificação", { body: "Notificação do CRM funcionando!", icon: "/placeholder.svg" });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Notificações</h3>
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Permissão do Navegador</p>
            <p className="text-sm text-muted-foreground">Status: {permissionState}</p>
          </div>
          {permissionState !== "granted" && <Button onClick={requestPermission}><Bell size={16} /> Permitir Notificações</Button>}
          {permissionState === "granted" && <Badge variant="default"><CheckCircle2 size={14} /> Ativado</Badge>}
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Notificar tarefa vencendo</Label>
            <Switch checked={prefs.notify_task_due} onCheckedChange={v => savePrefs({ ...prefs, notify_task_due: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Notificar novo lead</Label>
            <Switch checked={prefs.notify_new_lead} onCheckedChange={v => savePrefs({ ...prefs, notify_new_lead: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Notificar resposta de lead</Label>
            <Switch checked={prefs.notify_lead_reply} onCheckedChange={v => savePrefs({ ...prefs, notify_lead_reply: v })} />
          </div>
        </div>
        <Button variant="outline" onClick={testNotification}><Bell size={16} /> Testar Notificação</Button>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PÁGINA PRINCIPAL
   ═══════════════════════════════════════════════════ */
export default function CrmExtras() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Funções Extras</h1>
      <p className="text-muted-foreground">Funcionalidades em teste antes de integrar ao painel principal.</p>
      <Tabs defaultValue="quick_replies" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="quick_replies"><FileText size={14} className="mr-1" /> Respostas Rápidas</TabsTrigger>
          <TabsTrigger value="score"><Zap size={14} className="mr-1" /> Score</TabsTrigger>
          <TabsTrigger value="metrics"><Users size={14} className="mr-1" /> Métricas</TabsTrigger>
          <TabsTrigger value="distribution"><RefreshCw size={14} className="mr-1" /> Distribuição</TabsTrigger>
          <TabsTrigger value="import"><Upload size={14} className="mr-1" /> Importação</TabsTrigger>
          <TabsTrigger value="broadcast"><Send size={14} className="mr-1" /> Campanhas</TabsTrigger>
          <TabsTrigger value="webhook"><Webhook size={14} className="mr-1" /> Webhook</TabsTrigger>
          <TabsTrigger value="notifications"><Bell size={14} className="mr-1" /> Notificações</TabsTrigger>
        </TabsList>
        <TabsContent value="quick_replies"><QuickRepliesTab /></TabsContent>
        <TabsContent value="score"><LeadScoreTab /></TabsContent>
        <TabsContent value="metrics"><AttendantMetricsTab /></TabsContent>
        <TabsContent value="distribution"><DistributionTab /></TabsContent>
        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="broadcast"><BroadcastTab /></TabsContent>
        <TabsContent value="webhook"><WebhookTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

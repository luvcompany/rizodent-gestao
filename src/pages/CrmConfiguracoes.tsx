import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/phoneUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Upload, Bell, CheckCircle2, Ban, RotateCcw, Trash2, MessageSquare, Clock } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/* ═══════════════════════════════════════════════════
   Importação em Massa
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
      const rawPhone = row[phoneIdx]?.trim();
      if (!name || !rawPhone) { skipped++; continue; }
      const phone = normalizePhone(rawPhone);

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
      <div className="flex gap-4 items-end flex-wrap">
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
   Notificações
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
   Leads Bloqueados
   ═══════════════════════════════════════════════════ */
function BlockedTab() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("crm_leads")
      .select("id, name, phone, blocked_at, source, instagram_username")
      .eq("is_blocked", true)
      .order("blocked_at", { ascending: false });
    setLeads(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const unblock = async (id: string) => {
    const { error } = await supabase.from("crm_leads").update({
      is_blocked: false,
      blocked_at: null,
      blocked_by: null,
    } as any).eq("id", id);
    if (error) { toast.error("Erro ao desbloquear: " + error.message); return; }
    toast.success("Lead desbloqueado");
    setLeads(prev => prev.filter(l => l.id !== id));
  };

  const filtered = leads.filter(l => {
    if (!search.trim()) return true;
    const t = search.toLowerCase();
    return (l.name || "").toLowerCase().includes(t)
      || (l.phone || "").toLowerCase().includes(t)
      || (l.instagram_username || "").toLowerCase().includes(t);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold">Leads Bloqueados</h3>
        <Input
          placeholder="Buscar por nome, telefone ou @"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Leads bloqueados não aparecem no Kanban nem na lista de conversas, e mensagens recebidas deles são automaticamente descartadas.
      </p>
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {leads.length === 0 ? "Nenhum lead bloqueado." : "Nenhum lead encontrado."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Bloqueado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.phone || (l.instagram_username ? `@${l.instagram_username}` : "—")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.source || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.blocked_at ? new Date(l.blocked_at).toLocaleString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => unblock(l.id)}>
                      <RotateCcw size={14} className="mr-1" /> Desbloquear
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Lixeira — Conversas Excluídas (retenção 30 dias)
   ═══════════════════════════════════════════════════ */
type DeletedBackup = {
  id: string;
  original_lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  messages_count: number;
  deleted_at: string;
  expires_at: string;
  restored_at: string | null;
  lead_snapshot: any;
  messages_snapshot: any[];
  instagram_messages_snapshot: any[];
};

function LixeiraTab() {
  const [items, setItems] = useState<DeletedBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewItem, setViewItem] = useState<DeletedBackup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeletedBackup | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("deleted_leads_backup" as any)
      .select("*")
      .order("deleted_at", { ascending: false })
      .limit(500);
    if (error) toast.error("Erro ao carregar lixeira: " + error.message);
    setItems((data as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (bk: DeletedBackup) => {
    setBusyId(bk.id);
    const { data, error } = await supabase.rpc("restore_deleted_lead" as any, { _backup_id: bk.id });
    setBusyId(null);
    if (error) { toast.error("Erro ao restaurar: " + error.message); return; }
    toast.success(`Lead restaurado (${bk.messages_count} mensagens)`);
    await load();
  };

  const purge = async (bk: DeletedBackup) => {
    setBusyId(bk.id);
    const { error } = await supabase.from("deleted_leads_backup" as any).delete().eq("id", bk.id);
    setBusyId(null);
    setConfirmDelete(null);
    if (error) { toast.error("Erro ao apagar definitivamente: " + error.message); return; }
    toast.success("Backup apagado definitivamente");
    setItems((prev) => prev.filter((i) => i.id !== bk.id));
  };

  const filtered = items.filter((i) => {
    if (!search.trim()) return true;
    const t = search.toLowerCase();
    return (i.lead_name || "").toLowerCase().includes(t)
      || (i.lead_phone || "").toLowerCase().includes(t);
  });

  const daysLeft = (expires_at: string) => {
    const ms = new Date(expires_at).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold">Lixeira de Conversas</h3>
        <Input placeholder="Buscar por nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>
      <p className="text-sm text-muted-foreground">
        Toda vez que um lead é excluído (manualmente ou via exclusão de etapa), uma cópia completa fica aqui por <strong>30 dias</strong>. Você pode restaurar com todo o histórico de mensagens ou apagar definitivamente.
      </p>
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {items.length === 0 ? "Nenhum lead excluído nos últimos 30 dias." : "Nenhum resultado."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead className="text-right">Mensagens</TableHead>
                <TableHead>Excluído em</TableHead>
                <TableHead>Expira em</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((bk) => (
                <TableRow key={bk.id}>
                  <TableCell className="font-medium">{bk.lead_name || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{bk.lead_phone || "—"}</TableCell>
                  <TableCell className="text-right">{bk.messages_count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(bk.deleted_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={daysLeft(bk.expires_at) <= 3 ? "destructive" : "secondary"}>
                      {daysLeft(bk.expires_at)} dia(s)
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {bk.restored_at ? (
                      <Badge variant="default" className="gap-1"><CheckCircle2 size={12} /> Restaurado</Badge>
                    ) : (
                      <Badge variant="outline">Na lixeira</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setViewItem(bk)} title="Ver conversa">
                        <MessageSquare size={14} />
                      </Button>
                      {!bk.restored_at && (
                        <Button size="sm" variant="outline" disabled={busyId === bk.id} onClick={() => restore(bk)}>
                          <RotateCcw size={14} className="mr-1" /> Restaurar
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(bk)} title="Apagar definitivamente">
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Preview das mensagens */}
      <Dialog open={!!viewItem} onOpenChange={(o) => !o && setViewItem(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewItem?.lead_name || "Lead"}</DialogTitle>
            <DialogDescription>
              {viewItem?.lead_phone} · {viewItem?.messages_count} mensagem(ns)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(viewItem?.messages_snapshot || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma mensagem registrada.</p>
            ) : (
              viewItem?.messages_snapshot.map((m: any, i: number) => (
                <div key={i} className={`p-2 rounded-md text-sm ${m.direction === "inbound" ? "bg-muted" : "bg-primary/10 ml-12"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">{m.direction === "inbound" ? "← Recebida" : "→ Enviada"} · {m.type}</span>
                    <span className="text-xs text-muted-foreground">{m.created_at ? new Date(m.created_at).toLocaleString("pt-BR") : ""}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{m.content || (m.media_url ? `[mídia: ${m.media_url}]` : "—")}</p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão definitiva */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              O backup de <strong>{confirmDelete?.lead_name}</strong> e todas as {confirmDelete?.messages_count} mensagens serão excluídos para sempre. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && purge(confirmDelete)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Apagar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PÁGINA PRINCIPAL — Configurações CRM
   ═══════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   Horário Comercial (usado pelas métricas de tempo de resposta)
   ═══════════════════════════════════════════════════ */
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
type DiaCfg = { enabled: boolean; open: string; close: string };

function HorarioComercialTab() {
  const [cfg, setCfg] = useState<DiaCfg[]>(() =>
    DIAS_SEMANA.map((_, d) => ({ enabled: d >= 1 && d <= 5, open: "07:30", close: "18:00" }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("tenants").select("business_hours").limit(1).maybeSingle();
      const bh = (data as any)?.business_hours as Record<string, [string, string]> | null;
      if (bh && typeof bh === "object") {
        setCfg(DIAS_SEMANA.map((_, d) => {
          const w = bh[String(d)];
          return w ? { enabled: true, open: w[0], close: w[1] } : { enabled: false, open: "07:30", close: "18:00" };
        }));
      }
      setLoading(false);
    })();
  }, []);

  const upd = (d: number, patch: Partial<DiaCfg>) =>
    setCfg((prev) => prev.map((x, i) => (i === d ? { ...x, ...patch } : x)));

  const salvar = async () => {
    setSaving(true);
    const bh: Record<string, [string, string]> = {};
    cfg.forEach((c, d) => { if (c.enabled && c.open && c.close) bh[String(d)] = [c.open, c.close]; });
    // Escrita via RPC SECURITY DEFINER (a RLS de tenants só permite superadmin no UPDATE direto).
    const { error } = await supabase.rpc("set_tenant_business_hours" as any, { p_hours: bh } as any);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Horário comercial salvo");
  };

  if (loading) return <Card className="p-4 text-sm text-muted-foreground">Carregando…</Card>;
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Horário Comercial</h3>
      <p className="text-sm text-muted-foreground">
        Define o expediente do time de atendimento. As métricas de tempo de resposta contam apenas as horas
        dentro do expediente — mensagens recebidas à noite ou no fim de semana não penalizam o time.
      </p>
      <Card className="p-4 space-y-3 max-w-xl">
        {cfg.map((c, d) => (
          <div key={d} className="flex items-center gap-3 flex-wrap">
            <div className="w-32 flex items-center gap-2">
              <Switch checked={c.enabled} onCheckedChange={(v) => upd(d, { enabled: v })} />
              <span className="text-sm">{DIAS_SEMANA[d]}</span>
            </div>
            {c.enabled ? (
              <div className="flex items-center gap-2">
                <Input type="time" value={c.open} onChange={(e) => upd(d, { open: e.target.value })} className="w-32" />
                <span className="text-muted-foreground text-sm">às</span>
                <Input type="time" value={c.close} onChange={(e) => upd(d, { close: e.target.value })} className="w-32" />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Fechado</span>
            )}
          </div>
        ))}
        <Button onClick={salvar} disabled={saving}>
          <Clock size={16} className="mr-1" /> {saving ? "Salvando…" : "Salvar horário"}
        </Button>
      </Card>
    </div>
  );
}

export default function CrmConfiguracoes() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Configurações</h1>
      <p className="text-muted-foreground">Horário comercial, importação de dados, notificações, leads bloqueados e lixeira.</p>
      <Tabs defaultValue="horario" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="horario"><Clock size={14} className="mr-1" /> Horário</TabsTrigger>
          <TabsTrigger value="import"><Upload size={14} className="mr-1" /> Importação</TabsTrigger>
          <TabsTrigger value="notifications"><Bell size={14} className="mr-1" /> Notificações</TabsTrigger>
          <TabsTrigger value="blocked"><Ban size={14} className="mr-1" /> Bloqueados</TabsTrigger>
          <TabsTrigger value="lixeira"><Trash2 size={14} className="mr-1" /> Lixeira</TabsTrigger>
        </TabsList>
        <TabsContent value="horario"><HorarioComercialTab /></TabsContent>
        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab /></TabsContent>
        <TabsContent value="blocked"><BlockedTab /></TabsContent>
        <TabsContent value="lixeira"><LixeiraTab /></TabsContent>
      </Tabs>
    </div>
  );
}

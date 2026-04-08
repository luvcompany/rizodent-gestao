import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Upload, Bell, CheckCircle2 } from "lucide-react";

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
      const phone = row[phoneIdx]?.trim().replace(/\D/g, "");
      if (!name || !phone) { skipped++; continue; }

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
   PÁGINA PRINCIPAL — Configurações CRM
   ═══════════════════════════════════════════════════ */
export default function CrmConfiguracoes() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Configurações</h1>
      <p className="text-muted-foreground">Importação de dados e preferências de notificação.</p>
      <Tabs defaultValue="import" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="import"><Upload size={14} className="mr-1" /> Importação</TabsTrigger>
          <TabsTrigger value="notifications"><Bell size={14} className="mr-1" /> Notificações</TabsTrigger>
        </TabsList>
        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

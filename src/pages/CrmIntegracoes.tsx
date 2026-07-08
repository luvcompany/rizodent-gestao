import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Instagram, Facebook, Mail, ShoppingBag, Webhook,
  Settings, Copy, RefreshCw, Send, Eye, EyeOff, CheckCircle, XCircle,
  Plus, Trash2, Check, AlertTriangle, Pencil, GitBranch, Power
} from "lucide-react";
import { format } from "date-fns";
import whatsappLogo from "@/assets/whatsapp-logo.png";
import InstagramLiteSection from "@/components/integrations/InstagramLiteSection";
import InstagramAccountsSection from "@/components/integrations/InstagramAccountsSection";


import { useTenant } from "@/contexts/TenantContext";


type WhatsAppConfig = {
  token: string;
  phone_number_id: string;
  waba_id: string;
  app_id: string;
  api_version: string;
  webhook_verify_token: string;
  display_name: string;
  pipeline_id?: string;
};

type WhatsAppEntry = {
  id?: string;
  key: string;
  config: WhatsAppConfig;
  status: string;
};

type Pipeline = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
};

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  pipeline_id: string;
};

const defaultConfig: WhatsAppConfig = {
  token: "",
  phone_number_id: "",
  waba_id: "",
  app_id: "",
  api_version: "v25.0",
  webhook_verify_token: "",
  display_name: "",
  pipeline_id: "",
};

const DEFAULT_STAGES = [
  { name: "Novo Lead", color: "#6366f1", position: 0 },
  { name: "Em Atendimento", color: "#3b82f6", position: 1 },
  { name: "Agendado", color: "#f59e0b", position: 2 },
  { name: "Compareceu", color: "#10b981", position: 3 },
  { name: "Contratou", color: "#22c55e", position: 4 },
  { name: "Perdido", color: "#ef4444", position: 5 },
];

const otherIntegrations = [
  { key: "facebook", name: "Facebook Messenger", desc: "Em breve", icon: Facebook, enabled: false },
  { key: "email", name: "E-mail (SMTP)", desc: "Em breve", icon: Mail, enabled: false },
  { key: "mercadolivre", name: "Mercado Livre", desc: "Em breve", icon: ShoppingBag, enabled: false },
];

function WebhookSection() {
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
    <div className="mt-6">
      <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Webhook size={18} /> Webhook Genérico de Entrada</h2>
      <Card>
        <CardContent className="p-5 space-y-4">
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
          {recentLeads.length > 0 && (
            <div>
              <Label className="mb-2 block">Últimos leads via webhook</Label>
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
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function CrmIntegracoes() {
  const { tenant } = useTenant();
  const { profile } = useAuth();
  const [whatsappEntries, setWhatsappEntries] = useState<WhatsAppEntry[]>([]);
  const [editEntry, setEditEntry] = useState<WhatsAppEntry | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [testNumber, setTestNumber] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Pipeline state
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);
  const [editingPipelineName, setEditingPipelineName] = useState("");

  useEffect(() => {
    loadEntries();
    loadPipelines();
    const params = new URLSearchParams(window.location.search);
    if (params.get("instagram") === "connected") {
      toast.success("Conta do Instagram conectada com sucesso!");
      params.delete("instagram");
      const newSearch = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${newSearch ? "?" + newSearch : ""}`);
    } else if (params.get("instagram") === "error") {
      toast.error("Falha ao conectar Instagram. Tente novamente.");
      params.delete("instagram");
      const newSearch = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${newSearch ? "?" + newSearch : ""}`);
    }
  }, []);

  const loadEntries = async () => {
    const { data } = await supabase.from("integrations").select("*").like("key", "whatsapp_%");
    if (data) {
      setWhatsappEntries(data.map(d => ({
        id: d.id,
        key: d.key,
        config: { ...defaultConfig, ...(d.config as Record<string, unknown>) } as WhatsAppConfig,
        status: d.status,
      })));
    }
  };

  const loadPipelines = async () => {
    const { data } = await supabase.from("crm_pipelines").select("*").order("created_at");
    if (data) setPipelines(data);
  };

  const loadStages = async (pipelineId: string) => {
    const { data } = await supabase.from("crm_stages").select("*").eq("pipeline_id", pipelineId).order("position");
    if (data) setStages(data);
  };

  // Load stages when pipeline changes
  useEffect(() => {
    const pid = editEntry?.config.pipeline_id;
    if (pid) loadStages(pid);
    else setStages([]);
  }, [editEntry?.config.pipeline_id]);

  const handleNew = () => {
    const idx = whatsappEntries.length + 1;
    setEditEntry({
      key: `whatsapp_${idx}`,
      config: { ...defaultConfig, display_name: `WhatsApp ${idx}` },
      status: "disconnected",
    });
  };

  const handleSave = async () => {
    if (!editEntry) return;
    setSaving(true);
    const payload = { config: editEntry.config as unknown as import("@/integrations/supabase/types").Json, updated_at: new Date().toISOString() };
    if (editEntry.id) {
      await supabase.from("integrations").update(payload).eq("id", editEntry.id);
    } else {
      const { data } = await supabase.from("integrations").insert({ key: editEntry.key, ...payload, status: "disconnected" }).select().single();
      if (data) {
        setEditEntry(prev => prev ? { ...prev, id: data.id } : prev);
      }
    }

    // Link pipeline via funnel_channels
    if (editEntry.config.pipeline_id && editEntry.id) {
      await supabase.from("funnel_channels").delete().eq("channel_type", "whatsapp").eq("pipeline_id", editEntry.config.pipeline_id);
      await supabase.from("funnel_channels").upsert({
        pipeline_id: editEntry.config.pipeline_id,
        channel_type: "whatsapp",
        channel_config: { integration_key: editEntry.key } as import("@/integrations/supabase/types").Json,
      }, { onConflict: "id" });
    }

    toast.success("Configurações salvas");

    // Auto-sync templates from Meta when WABA is configured
    if (editEntry.config.waba_id && editEntry.config.token) {
      try {
        toast.info("Sincronizando modelos do WhatsApp...");
        const { data: syncResult, error: syncError } = await supabase.functions.invoke("manage-whatsapp-templates", {
          body: { action: "list", integration_key: editEntry.key },
        });
        if (syncError) {
          console.error("[Sync] Erro:", syncError);
          toast.warning("Erro ao sincronizar modelos");
        } else {
          toast.success(`${syncResult?.count || 0} modelos sincronizados`);
        }
      } catch (e) {
        console.error("[Sync] Erro:", e);
      }
    }

    setSaving(false);
    loadEntries();
  };

  const handleDelete = async (entry: WhatsAppEntry) => {
    if (!entry.id) return;
    if (!confirm("Excluir este canal WhatsApp?")) return;
    await supabase.from("integrations").delete().eq("id", entry.id);
    toast.success("Canal removido");
    setEditEntry(null);
    loadEntries();
  };

  const handleToggleIntegration = async (entry: WhatsAppEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!entry.id) return;
    const newStatus = entry.status === "disabled" ? "connected" : "disabled";
    await supabase.from("integrations").update({ status: newStatus }).eq("id", entry.id);
    toast.success(newStatus === "disabled" ? "Integração desativada" : "Integração ativada");
    loadEntries();
  };

  const handleTestConnection = async () => {
    if (!editEntry) return;
    const c = editEntry.config;
    if (!c.token || !c.phone_number_id) { toast.error("Preencha o token e o Phone Number ID"); return; }
    setTesting(true);
    try {
      const res = await fetch(`https://graph.facebook.com/${c.api_version}/${c.phone_number_id}`, {
        headers: { Authorization: `Bearer ${c.token}` },
      });
      const json = await res.json();
      if (res.ok && editEntry.id) {
        await supabase.from("integrations").update({ status: "connected" }).eq("id", editEntry.id);
        setEditEntry(prev => prev ? { ...prev, status: "connected" } : prev);
        toast.success("Conexão bem-sucedida!");
      } else if (!res.ok) {
        toast.error("Falha na conexão");
      }
      setTestResult(JSON.stringify(json, null, 2));
    } catch (err: unknown) {
      toast.error("Erro ao testar conexão");
      setTestResult(err instanceof Error ? err.message : "Erro desconhecido");
    }
    setTesting(false);
  };

  const handleSendTest = async () => {
    if (!editEntry || !testNumber || !testMessage) { toast.error("Preencha número e mensagem"); return; }
    const c = editEntry.config;
    setTesting(true);
    try {
      const res = await fetch(`https://graph.facebook.com/${c.api_version}/${c.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: testNumber, type: "text", text: { body: testMessage } }),
      });
      const json = await res.json();
      setTestResult(JSON.stringify(json, null, 2));
      if (res.ok) toast.success("Mensagem de teste enviada!");
      else toast.error("Erro ao enviar mensagem");
    } catch (err: unknown) {
      setTestResult(err instanceof Error ? err.message : "Erro desconhecido");
      toast.error("Erro na requisição");
    }
    setTesting(false);
  };

  // Pipeline CRUD
  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) { toast.error("Digite um nome para o funil"); return; }
    setCreatingPipeline(true);
    const { data: pipeline, error } = await supabase.from("crm_pipelines").insert({ name: newPipelineName.trim(), ...(profile?.tenant_id ? { tenant_id: profile.tenant_id } : {}) }).select().single();
    if (error || !pipeline) { toast.error("Erro ao criar funil"); setCreatingPipeline(false); return; }

    // Create default stages
    const stagesPayload = DEFAULT_STAGES.map(s => ({ ...s, pipeline_id: pipeline.id }));
    await supabase.from("crm_stages").insert(stagesPayload);

    toast.success("Funil criado com etapas padrão!");
    setNewPipelineName("");
    setCreatingPipeline(false);
    await loadPipelines();

    // Auto-select
    setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, pipeline_id: pipeline.id } } : prev);
  };

  const handleEditPipeline = async (id: string) => {
    if (!editingPipelineName.trim()) return;
    await supabase.from("crm_pipelines").update({ name: editingPipelineName.trim() }).eq("id", id);
    toast.success("Funil renomeado");
    setEditingPipelineId(null);
    loadPipelines();
  };

  const handleDeletePipeline = async (id: string) => {
    // Check if pipeline has leads
    const { count } = await supabase.from("crm_leads").select("id", { count: "exact", head: true }).eq("pipeline_id", id);
    if (count && count > 0) {
      toast.error(`Não é possível excluir: existem ${count} leads neste funil`);
      return;
    }
    if (!confirm("Excluir este funil e todas as suas etapas?")) return;
    await supabase.from("crm_stages").delete().eq("pipeline_id", id);
    await supabase.from("funnel_channels").delete().eq("pipeline_id", id);
    await supabase.from("crm_pipelines").delete().eq("id", id);
    toast.success("Funil excluído");

    // Unselect if was selected
    if (editEntry?.config.pipeline_id === id) {
      setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, pipeline_id: "" } } : prev);
    }
    loadPipelines();
  };

  const webhookUrl = `https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/whatsapp-webhook`;
  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copiado!"); };

  const FieldStatus = ({ value }: { value: string | undefined }) =>
    value ? <Check size={14} className="text-green-400" /> : <AlertTriangle size={14} className="text-yellow-400" />;

  const selectedPipeline = pipelines.find(p => p.id === editEntry?.config.pipeline_id);

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Integrações</h1>
          <p className="text-sm text-muted-foreground">Conecte canais externos ao seu CRM</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* WhatsApp Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <img src={whatsappLogo} alt="WhatsApp" width={20} height={20} className="rounded-full" /> WhatsApp Business
            </h2>
            <div className="flex items-center gap-2">
              <WhatsAppEmbeddedSignupButton onConnected={loadWhatsapp} />
              <Button size="sm" onClick={handleNew}>
                <Plus size={14} className="mr-1" /> Novo Número
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {whatsappEntries.map(entry => {
              const c = entry.config;
              const isConnected = entry.status === "connected";
              const pName = pipelines.find(p => p.id === c.pipeline_id)?.name;
              return (
                <Card key={entry.key} className="cursor-pointer hover:border-primary/30 transition-all" onClick={() => setEditEntry(entry)}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <img src={whatsappLogo} alt="WhatsApp" width={28} height={28} className="rounded-full" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={entry.status !== "disabled"}
                          onCheckedChange={() => {}}
                          onClick={(e) => handleToggleIntegration(entry, e)}
                        />
                        {isConnected ? (
                          <Badge className="bg-green-900/30 text-green-400 border-0"><CheckCircle size={12} className="mr-1" /> Ativo</Badge>
                        ) : entry.status === "disabled" ? (
                          <Badge variant="secondary" className="text-muted-foreground"><Power size={12} className="mr-1" /> Desativado</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-muted-foreground"><XCircle size={12} className="mr-1" /> Não conectado</Badge>
                        )}
                      </div>
                    </div>
                    <h3 className={`font-semibold mb-1 ${entry.status === "disabled" ? "text-muted-foreground" : "text-foreground"}`}>{c.display_name || entry.key}</h3>
                    <p className="text-sm text-muted-foreground">{c.phone_number_id ? `ID: ...${c.phone_number_id.slice(-4)}` : "Não configurado"}</p>
                    {pName && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <GitBranch size={12} /> Funil: {pName}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><FieldStatus value={c.token} /> Token</span>
                      <span className="flex items-center gap-1"><FieldStatus value={c.phone_number_id} /> Phone ID</span>
                      <span className="flex items-center gap-1"><FieldStatus value={c.waba_id} /> WABA</span>
                    </div>
                    <Button variant="outline" size="sm" className="mt-3 w-full">
                      <Settings size={14} className="mr-1" /> Configurar
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            {whatsappEntries.length === 0 && (
              <Card className="cursor-pointer hover:border-primary/30 border-dashed transition-all" onClick={handleNew}>
                <CardContent className="p-5 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <Plus size={24} />
                  <span className="text-sm">Adicionar número WhatsApp</span>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Instagram (Full API) via OAuth */}
        <InstagramAccountsSection />


        {/* Instagram Lite */}
        <InstagramLiteSection />

        {/* Other Integrations */}
        <h2 className="font-semibold text-foreground mt-6 mb-4">Outros Canais</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          {otherIntegrations.map(intg => {
            const Icon = intg.icon;
            return (
              <Card key={intg.key} className="opacity-50 cursor-not-allowed">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-primary/10"><Icon size={24} className="text-primary" /></div>
                    <Badge variant="secondary" className="text-muted-foreground">Em breve</Badge>
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{intg.name}</h3>
                  <p className="text-sm text-muted-foreground">{intg.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Webhook Genérico */}
        <WebhookSection />
      </div>

      {/* WhatsApp Config Modal */}
      <Dialog open={!!editEntry} onOpenChange={(open) => { if (!open) { setEditEntry(null); setTestResult(null); setEditingPipelineId(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <img src={whatsappLogo} alt="WhatsApp" width={20} height={20} className="rounded-full" />
              {editEntry?.config.display_name || "WhatsApp Business API"}
            </DialogTitle>
          </DialogHeader>

          {editEntry && (
            <Tabs defaultValue="config">
              <TabsList className="w-full">
                <TabsTrigger value="config" className="flex-1">Configuração</TabsTrigger>
                <TabsTrigger value="funnel" className="flex-1">Funil</TabsTrigger>
                <TabsTrigger value="webhook" className="flex-1">Webhook</TabsTrigger>
                <TabsTrigger value="test" className="flex-1">Teste</TabsTrigger>
              </TabsList>

              <TabsContent value="config" className="space-y-4 mt-4">
                <div>
                  <Label className="flex items-center gap-2">Nome de Exibição <FieldStatus value={editEntry.config.display_name} /></Label>
                  <Input value={editEntry.config.display_name} onChange={(e) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, display_name: e.target.value } } : prev)} placeholder="WhatsApp Clínica Principal" />
                </div>
                <div>
                  <Label className="flex items-center gap-2">Token de Acesso Permanente <FieldStatus value={editEntry.config.token} /></Label>
                  <div className="relative">
                    <Input type={showToken ? "text" : "password"} value={editEntry.config.token} onChange={(e) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, token: e.target.value } } : prev)} placeholder="EAAxxxxxxx..." className="pr-10" />
                    <button onClick={() => setShowToken(!showToken)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="flex items-center gap-2">Phone Number ID <FieldStatus value={editEntry.config.phone_number_id} /></Label>
                  <Input value={editEntry.config.phone_number_id} onChange={(e) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, phone_number_id: e.target.value } } : prev)} placeholder="123456789..." />
                </div>
                <div>
                  <Label className="flex items-center gap-2">WABA ID <FieldStatus value={editEntry.config.waba_id} /></Label>
                  <Input value={editEntry.config.waba_id} onChange={(e) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, waba_id: e.target.value } } : prev)} placeholder="987654321..." />
                </div>
                <div>
                  <Label className="flex items-center gap-2">App ID (Meta) <FieldStatus value={editEntry.config.app_id} /></Label>
                  <Input value={editEntry.config.app_id} onChange={(e) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, app_id: e.target.value } } : prev)} placeholder="ID do aplicativo no Meta for Developers" />
                  <p className="text-[11px] text-muted-foreground mt-1">Encontrado em: developers.facebook.com → Seu app → Configurações → Básico → ID do aplicativo</p>
                </div>
                <div>
                  <Label>Versão da API</Label>
                  <Input value={editEntry.config.api_version} onChange={(e) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, api_version: e.target.value } } : prev)} placeholder="v25.0" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? "Salvando..." : "Salvar Configurações"}</Button>
                  <Button variant="outline" onClick={handleTestConnection} disabled={testing}>{testing ? "Testando..." : "Testar Conexão"}</Button>
                  {editEntry.id && (
                    <Button variant="destructive" size="icon" onClick={() => handleDelete(editEntry)}><Trash2 size={16} /></Button>
                  )}
                </div>
              </TabsContent>

              {/* FUNNEL TAB */}
              <TabsContent value="funnel" className="space-y-4 mt-4">
                <div>
                  <Label className="flex items-center gap-2 mb-2">
                    <GitBranch size={14} /> Funil vinculado a este canal
                  </Label>
                  <Select
                    value={editEntry.config.pipeline_id || ""}
                    onValueChange={(val) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, pipeline_id: val } } : prev)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um funil..." />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelines.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Leads novos deste WhatsApp serão criados na primeira etapa do funil selecionado.</p>
                </div>

                {/* Create new pipeline */}
                <div className="border border-border rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Criar novo funil</h4>
                  <div className="flex gap-2">
                    <Input
                      value={newPipelineName}
                      onChange={e => setNewPipelineName(e.target.value)}
                      placeholder="Nome do funil"
                      onKeyDown={e => e.key === "Enter" && handleCreatePipeline()}
                    />
                    <Button onClick={handleCreatePipeline} disabled={creatingPipeline} size="sm">
                      <Plus size={14} className="mr-1" /> Criar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    O novo funil será criado com as etapas padrão: {DEFAULT_STAGES.map(s => s.name).join(", ")}
                  </p>
                </div>

                {/* Pipeline list with edit/delete */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Funis existentes</h4>
                  {pipelines.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhum funil cadastrado.</p>
                  )}
                  {pipelines.map(p => (
                    <div key={p.id} className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${editEntry.config.pipeline_id === p.id ? "border-primary bg-primary/5" : "border-border"}`}>
                      {editingPipelineId === p.id ? (
                        <>
                          <Input
                            value={editingPipelineName}
                            onChange={e => setEditingPipelineName(e.target.value)}
                            className="flex-1 h-8"
                            onKeyDown={e => e.key === "Enter" && handleEditPipeline(p.id)}
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" onClick={() => handleEditPipeline(p.id)}><Check size={14} /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingPipelineId(null)}><XCircle size={14} /></Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm font-medium text-foreground">{p.name}</span>
                          {editEntry.config.pipeline_id === p.id && (
                            <Badge className="bg-primary/20 text-primary border-0 text-xs">Selecionado</Badge>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => { setEditingPipelineId(p.id); setEditingPipelineName(p.name); }}>
                            <Pencil size={14} />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeletePipeline(p.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Show stages of selected pipeline */}
                {selectedPipeline && stages.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-foreground">Etapas de "{selectedPipeline.name}"</h4>
                    <div className="flex flex-wrap gap-2">
                      {stages.map((s, i) => (
                        <div key={s.id} className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="text-xs text-foreground">{s.name}</span>
                          {i < stages.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? "Salvando..." : "Salvar Configurações"}
                </Button>
              </TabsContent>

              <TabsContent value="webhook" className="space-y-4 mt-4">
                <div>
                  <Label>URL do Webhook</Label>
                  <div className="flex gap-2">
                    <Input value={webhookUrl} readOnly className="bg-secondary" />
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl)}><Copy size={16} /></Button>
                  </div>
                </div>
                <div>
                  <Label className="flex items-center gap-2">Token de Verificação <FieldStatus value={editEntry.config.webhook_verify_token} /></Label>
                  <div className="flex gap-2">
                    <Input value={editEntry.config.webhook_verify_token} onChange={(e) => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, webhook_verify_token: e.target.value } } : prev)} placeholder="Digite o token de verificação do webhook" />
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(editEntry.config.webhook_verify_token)}><Copy size={16} /></Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Este token deve ser o mesmo configurado no Meta Business Manager e nos secrets do backend.</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
                  <h4 className="font-semibold text-sm text-foreground">Como configurar no Meta Business Manager:</h4>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Acesse Meta Business Manager → Configurações → WhatsApp</li>
                    <li>Vá para Configuração → Webhook</li>
                    <li>Cole a URL do webhook no campo "URL de retorno"</li>
                    <li>Cole o token de verificação</li>
                    <li>Clique em "Verificar e salvar"</li>
                    <li>Assine os campos: <strong>messages</strong>, <strong>message_status</strong></li>
                  </ol>
                </div>
              </TabsContent>

              <TabsContent value="test" className="space-y-4 mt-4">
                <div>
                  <Label>Número de destino (com código do país)</Label>
                  <Input value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="5571999999999" />
                </div>
                <div>
                  <Label>Mensagem de teste</Label>
                  <Textarea value={testMessage} onChange={(e) => setTestMessage(e.target.value)} placeholder="Olá, esta é uma mensagem de teste!" rows={3} />
                </div>
                <Button onClick={handleSendTest} disabled={testing} className="w-full">
                  <Send size={14} className="mr-1" />{testing ? "Enviando..." : "Enviar mensagem de teste"}
                </Button>
                {testResult && (
                  <div className="bg-secondary rounded-lg p-3">
                    <Label className="text-xs">Resposta da API:</Label>
                    <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap overflow-x-auto">{testResult}</pre>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

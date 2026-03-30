import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  MessageSquare, Instagram, Facebook, Mail, ShoppingBag,
  Settings, Copy, RefreshCw, Send, Eye, EyeOff, CheckCircle, XCircle,
  Plus, Trash2, Check, AlertTriangle
} from "lucide-react";

type WhatsAppConfig = {
  token: string;
  phone_number_id: string;
  waba_id: string;
  api_version: string;
  webhook_verify_token: string;
  display_name: string;
};

type WhatsAppEntry = {
  id?: string;
  key: string;
  config: WhatsAppConfig;
  status: string;
};

const defaultConfig: WhatsAppConfig = {
  token: "",
  phone_number_id: "",
  waba_id: "",
  api_version: "v25.0",
  webhook_verify_token: "",
  display_name: "",
};

const otherIntegrations = [
  { key: "instagram", name: "Instagram Direct", desc: "Em breve", icon: Instagram, enabled: false },
  { key: "facebook", name: "Facebook Messenger", desc: "Em breve", icon: Facebook, enabled: false },
  { key: "email", name: "E-mail (SMTP)", desc: "Em breve", icon: Mail, enabled: false },
  { key: "mercadolivre", name: "Mercado Livre", desc: "Em breve", icon: ShoppingBag, enabled: false },
];

export default function CrmIntegracoes() {
  const [whatsappEntries, setWhatsappEntries] = useState<WhatsAppEntry[]>([]);
  const [editEntry, setEditEntry] = useState<WhatsAppEntry | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [testNumber, setTestNumber] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { loadEntries(); }, []);

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
      await supabase.from("integrations").insert({ key: editEntry.key, ...payload, status: "disconnected" });
    }
    toast.success("Configurações salvas");
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

  const webhookUrl = `https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/whatsapp-webhook`;
  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copiado!"); };

  const FieldStatus = ({ value }: { value: string | undefined }) =>
    value ? <Check size={14} className="text-green-400" /> : <AlertTriangle size={14} className="text-yellow-400" />;

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
              <MessageSquare size={18} className="text-primary" /> WhatsApp Business
            </h2>
            <Button size="sm" onClick={handleNew}>
              <Plus size={14} className="mr-1" /> Novo Número
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {whatsappEntries.map(entry => {
              const c = entry.config;
              const isConnected = entry.status === "connected";
              return (
                <Card key={entry.key} className="cursor-pointer hover:border-primary/30 transition-all" onClick={() => setEditEntry(entry)}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <MessageSquare size={24} className="text-primary" />
                      </div>
                      {isConnected ? (
                        <Badge className="bg-green-900/30 text-green-400 border-0"><CheckCircle size={12} className="mr-1" /> Conectado</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground"><XCircle size={12} className="mr-1" /> Não conectado</Badge>
                      )}
                    </div>
                    <h3 className="font-semibold text-foreground mb-1">{c.display_name || entry.key}</h3>
                    <p className="text-sm text-muted-foreground">{c.phone_number_id ? `ID: ...${c.phone_number_id.slice(-4)}` : "Não configurado"}</p>
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

        {/* Other Integrations */}
        <h2 className="font-semibold text-foreground mb-4">Outros Canais</h2>
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
      </div>

      {/* WhatsApp Config Modal */}
      <Dialog open={!!editEntry} onOpenChange={(open) => { if (!open) { setEditEntry(null); setTestResult(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare size={20} className="text-primary" />
              {editEntry?.config.display_name || "WhatsApp Business API"}
            </DialogTitle>
          </DialogHeader>

          {editEntry && (
            <Tabs defaultValue="config">
              <TabsList className="w-full">
                <TabsTrigger value="config" className="flex-1">Configuração</TabsTrigger>
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

              <TabsContent value="webhook" className="space-y-4 mt-4">
                <div>
                  <Label>URL do Webhook</Label>
                  <div className="flex gap-2">
                    <Input value={webhookUrl} readOnly className="bg-secondary" />
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl)}><Copy size={16} /></Button>
                  </div>
                </div>
                <div>
                  <Label>Token de Verificação</Label>
                  <div className="flex gap-2">
                    <Input value={editEntry.config.webhook_verify_token} readOnly className="bg-secondary" />
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(editEntry.config.webhook_verify_token)}><Copy size={16} /></Button>
                    <Button variant="outline" size="icon" onClick={() => setEditEntry(prev => prev ? { ...prev, config: { ...prev.config, webhook_verify_token: crypto.randomUUID().slice(0, 16) } } : prev)}><RefreshCw size={16} /></Button>
                  </div>
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

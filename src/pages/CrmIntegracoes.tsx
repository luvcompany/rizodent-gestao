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
  Settings, Copy, RefreshCw, Send, Eye, EyeOff, CheckCircle, XCircle
} from "lucide-react";

type WhatsAppConfig = {
  token: string;
  phone_number_id: string;
  waba_id: string;
  api_version: string;
  webhook_verify_token: string;
};

const defaultConfig: WhatsAppConfig = {
  token: "",
  phone_number_id: "",
  waba_id: "",
  api_version: "v19.0",
  webhook_verify_token: crypto.randomUUID().slice(0, 16),
};

const integrations = [
  { key: "whatsapp", name: "WhatsApp Business API", desc: "Envie e receba mensagens diretamente no CRM", icon: MessageSquare, enabled: true },
  { key: "instagram", name: "Instagram Direct", desc: "Em breve", icon: Instagram, enabled: false },
  { key: "facebook", name: "Facebook Messenger", desc: "Em breve", icon: Facebook, enabled: false },
  { key: "email", name: "E-mail (SMTP)", desc: "Em breve", icon: Mail, enabled: false },
  { key: "mercadolivre", name: "Mercado Livre", desc: "Em breve", icon: ShoppingBag, enabled: false },
];

export default function CrmIntegracoes() {
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfig>(defaultConfig);
  const [showToken, setShowToken] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<string>("disconnected");
  const [testNumber, setTestNumber] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const { data } = await supabase.from("integrations").select("*").eq("key", "whatsapp_config").maybeSingle();
    if (data) {
      const c = data.config as any;
      setConfig({ ...defaultConfig, ...c });
      setWhatsappStatus(data.status);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const { data: existing } = await supabase.from("integrations").select("id").eq("key", "whatsapp_config").maybeSingle();
    if (existing) {
      await supabase.from("integrations").update({
        config: config as any,
        updated_at: new Date().toISOString(),
      }).eq("key", "whatsapp_config");
    } else {
      await supabase.from("integrations").insert({
        key: "whatsapp_config",
        config: config as any,
        status: "disconnected",
      });
    }
    toast.success("Configurações salvas");
    setSaving(false);
  };

  const handleTestConnection = async () => {
    if (!config.token || !config.phone_number_id) {
      toast.error("Preencha o token e o Phone Number ID");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(`https://graph.facebook.com/${config.api_version}/${config.phone_number_id}`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      const json = await res.json();
      if (res.ok) {
        await supabase.from("integrations").update({ status: "connected" }).eq("key", "whatsapp_config");
        setWhatsappStatus("connected");
        toast.success("Conexão bem-sucedida!");
      } else {
        toast.error("Falha na conexão");
      }
      setTestResult(JSON.stringify(json, null, 2));
    } catch (err: any) {
      toast.error("Erro ao testar conexão");
      setTestResult(err.message);
    }
    setTesting(false);
  };

  const handleSendTest = async () => {
    if (!testNumber || !testMessage) {
      toast.error("Preencha número e mensagem");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(`https://graph.facebook.com/${config.api_version}/${config.phone_number_id}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: testNumber,
          type: "text",
          text: { body: testMessage },
        }),
      });
      const json = await res.json();
      setTestResult(JSON.stringify(json, null, 2));
      if (res.ok) toast.success("Mensagem de teste enviada!");
      else toast.error("Erro ao enviar mensagem");
    } catch (err: any) {
      setTestResult(err.message);
      toast.error("Erro na requisição");
    }
    setTesting(false);
  };

  const webhookUrl = `https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/whatsapp-webhook`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  };

  const regenerateToken = () => {
    setConfig((prev) => ({ ...prev, webhook_verify_token: crypto.randomUUID().slice(0, 16) }));
  };

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">Integrações</h1>
        <p className="text-sm text-muted-foreground">Conecte canais externos ao seu CRM</p>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          {integrations.map((intg) => {
            const Icon = intg.icon;
            const isConnected = intg.key === "whatsapp" && whatsappStatus === "connected";
            return (
              <Card
                key={intg.key}
                className={`cursor-pointer transition-all hover:border-primary/30 ${!intg.enabled ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => intg.enabled && intg.key === "whatsapp" && setWhatsappOpen(true)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Icon size={24} className="text-primary" />
                    </div>
                    {intg.enabled ? (
                      isConnected ? (
                        <Badge className="bg-green-900/30 text-green-400 border-0">
                          <CheckCircle size={12} className="mr-1" /> Conectado
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          <XCircle size={12} className="mr-1" /> Não conectado
                        </Badge>
                      )
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">Em breve</Badge>
                    )}
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{intg.name}</h3>
                  <p className="text-sm text-muted-foreground">{intg.desc}</p>
                  {intg.enabled && (
                    <Button variant="outline" size="sm" className="mt-3 w-full">
                      <Settings size={14} className="mr-1" /> Configurar
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* WhatsApp Config Modal */}
      <Dialog open={whatsappOpen} onOpenChange={setWhatsappOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare size={20} className="text-primary" />
              WhatsApp Business API
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="config">
            <TabsList className="w-full">
              <TabsTrigger value="config" className="flex-1">Configuração</TabsTrigger>
              <TabsTrigger value="webhook" className="flex-1">Webhook</TabsTrigger>
              <TabsTrigger value="test" className="flex-1">Teste</TabsTrigger>
            </TabsList>

            <TabsContent value="config" className="space-y-4 mt-4">
              <div>
                <Label>Token de Acesso Permanente</Label>
                <div className="relative">
                  <Input
                    type={showToken ? "text" : "password"}
                    value={config.token}
                    onChange={(e) => setConfig((p) => ({ ...p, token: e.target.value }))}
                    placeholder="EAAxxxxxxx..."
                    className="pr-10"
                  />
                  <button onClick={() => setShowToken(!showToken)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <Label>ID do Número de Telefone (Phone Number ID)</Label>
                <Input value={config.phone_number_id} onChange={(e) => setConfig((p) => ({ ...p, phone_number_id: e.target.value }))} placeholder="123456789..." />
              </div>
              <div>
                <Label>ID da Conta WhatsApp Business (WABA ID)</Label>
                <Input value={config.waba_id} onChange={(e) => setConfig((p) => ({ ...p, waba_id: e.target.value }))} placeholder="987654321..." />
              </div>
              <div>
                <Label>Versão da API</Label>
                <Input value={config.api_version} onChange={(e) => setConfig((p) => ({ ...p, api_version: e.target.value }))} placeholder="v19.0" />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? "Salvando..." : "Salvar Configurações"}
                </Button>
                <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
                  {testing ? "Testando..." : "Testar Conexão"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="webhook" className="space-y-4 mt-4">
              <div>
                <Label>URL do Webhook</Label>
                <div className="flex gap-2">
                  <Input value={webhookUrl} readOnly className="bg-secondary" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl)}>
                    <Copy size={16} />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Token de Verificação do Webhook</Label>
                <div className="flex gap-2">
                  <Input value={config.webhook_verify_token} readOnly className="bg-secondary" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(config.webhook_verify_token)}>
                    <Copy size={16} />
                  </Button>
                  <Button variant="outline" size="icon" onClick={regenerateToken}>
                    <RefreshCw size={16} />
                  </Button>
                </div>
              </div>
              <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-sm text-foreground">Como configurar no Meta Business Manager:</h4>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Acesse o Meta Business Manager → Configurações da conta → WhatsApp</li>
                  <li>Vá para Configuração → Webhook</li>
                  <li>Cole a URL do webhook acima no campo "URL de retorno"</li>
                  <li>Cole o token de verificação no campo "Token de verificação"</li>
                  <li>Clique em "Verificar e salvar"</li>
                  <li>Assine os campos: messages, message_status</li>
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
                <Send size={14} className="mr-1" />
                {testing ? "Enviando..." : "Enviar mensagem de teste"}
              </Button>
              {testResult && (
                <div className="bg-secondary rounded-lg p-3">
                  <Label className="text-xs">Resposta da API:</Label>
                  <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap overflow-x-auto">{testResult}</pre>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

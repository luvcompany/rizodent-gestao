import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Facebook, Mail, ShoppingBag, Webhook, Copy, RefreshCw, Eye, EyeOff, Info, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import InstagramLiteSection from "@/components/integrations/InstagramLiteSection";
import InstagramAccountsSection from "@/components/integrations/InstagramAccountsSection";
import WhatsAppEmbeddedSignupButton from "@/components/integrations/WhatsAppEmbeddedSignupButton";
import WhatsAppAccountsSection from "@/components/integrations/WhatsAppAccountsSection";
import Api4ComSection from "@/components/integrations/Api4ComSection";
import { useModule, podeMostrar } from "@/hooks/useModule";

// Instagram pelo Login do FACEBOOK (tokens de Página, tabela instagram_accounts).
// Desligado no v2: o app geral usa o caso de uso "API do Instagram" com Login do
// Instagram, que não oferece pages_manage_metadata — sem ela a Meta não entrega
// webhook por Página. O botão principal agora é o "Conectar Instagram" da
// InstagramLiteSection. Código mantido; só religar para um app com Login do Facebook.
const MOSTRAR_INSTAGRAM_LOGIN_FACEBOOK = false;

const otherIntegrations = [
  { key: "facebook", name: "Facebook Messenger", desc: "Em breve", icon: Facebook, enabled: false },
  { key: "email", name: "E-mail (SMTP)", desc: "Em breve", icon: Mail, enabled: false },
  { key: "mercadolivre", name: "Mercado Livre", desc: "Em breve", icon: ShoppingBag, enabled: false },
];

// types.ts ainda não conhece as RPCs do segredo (é regenerado depois da migration).
// bind: rpc usa `this` (o client); solta numa variável, perderia o contexto.
const rpcSegredo = supabase.rpc.bind(supabase) as unknown as (
  nome: "lead_webhook_segredo" | "lead_webhook_segredo_gerar",
) => Promise<{ data: string | null; error: { message: string } | null }>;

type LeadRecente = { id: string; name: string | null; phone: string | null; source: string | null; created_at: string };

function WebhookSection() {
  const [recentLeads, setRecentLeads] = useState<LeadRecente[]>([]);
  // Segredo do webhook (tenant_private.lead_webhook_secret, tabela só do
  // servidor). Sem ele a function responde 401 a qualquer chamada. Lido/gerado
  // por RPC que só atende crc/gerente do próprio tenant.
  const [segredo, setSegredo] = useState<string | null>(null);
  const [mostrarSegredo, setMostrarSegredo] = useState(false);
  const [gerando, setGerando] = useState(false);
  // Base das functions vem do projeto em que o front foi publicado (nunca ref fixo).
  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generic-lead-webhook`;

  const examplePayload = JSON.stringify({
    name: "João Silva",
    phone: "5511999887766",
    tags: ["landing-page", "promo"],
    pipeline: "nome-do-funil",
    source: "typeform"
  }, null, 2);

  useEffect(() => {
    supabase.from("crm_leads").select("id, name, phone, source, created_at").eq("source", "webhook").order("created_at", { ascending: false }).limit(10).then(({ data }) => setRecentLeads(data || []));
    void rpcSegredo("lead_webhook_segredo").then(({ data }) => setSegredo(data ?? null));
  }, []);

  const gerarSegredo = async () => {
    if (segredo && !window.confirm("Gerar um segredo novo? Quem usa o atual para de conseguir enviar leads até ser atualizado.")) return;
    setGerando(true);
    const { data, error } = await rpcSegredo("lead_webhook_segredo_gerar");
    setGerando(false);
    if (error) { toast.error("Não foi possível gerar o segredo."); return; }
    setSegredo(data ?? null);
    setMostrarSegredo(true);
    toast.success("Segredo gerado.");
  };

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
            <Label>Segredo (header x-webhook-secret)</Label>
            <div className="flex gap-2 items-center">
              <Input
                readOnly
                type={mostrarSegredo ? "text" : "password"}
                value={segredo ?? ""}
                placeholder="Nenhum segredo gerado"
                className="font-mono text-xs"
              />
              <Button size="icon" variant="outline" disabled={!segredo} aria-label={mostrarSegredo ? "Ocultar segredo" : "Mostrar segredo"} onClick={() => setMostrarSegredo((v) => !v)}>
                {mostrarSegredo ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
              <Button size="icon" variant="outline" disabled={!segredo} aria-label="Copiar segredo" onClick={() => { if (segredo) { navigator.clipboard.writeText(segredo); toast.success("Copiado!"); } }}><Copy size={14} /></Button>
              <Button size="sm" variant="outline" disabled={gerando} onClick={() => void gerarSegredo()}>
                <RefreshCw size={14} className="mr-1" /> {segredo ? "Gerar novo" : "Gerar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Envie em toda chamada no header <code>x-webhook-secret</code>. Sem ele o endpoint responde 401.</p>
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

// Resumo do WhatsApp do cliente (RPC tenant_whatsapp_resumo): nunca traz
// app_id, segredo nem verify token.
type ResumoWhatsApp = {
  app_origem: "geral" | "proprio" | null;
  app_nome: string | null;
  embedded_signup_disponivel: boolean;
  pode_gerir: boolean;
  numeros_ativos: number;
};

// types.ts ainda não conhece a RPC (é regenerado no fechamento).
const rpcResumo = supabase.rpc.bind(supabase) as unknown as (
  nome: "tenant_whatsapp_resumo",
) => Promise<{ data: ResumoWhatsApp | null; error: { message: string } | null }>;

const AVISO_SIGNUP_BLOQUEADO =
  "A conexão pelo Facebook ainda não está liberada. Peça ao administrador para conectar o número.";

function ResumoDoWhatsApp({ resumo }: { resumo: ResumoWhatsApp | null }) {
  if (!resumo) return null;
  const origem =
    resumo.app_origem === "proprio" ? "Conectado pelo app próprio"
      : resumo.app_origem === "geral" ? "Conectado pelo app geral"
        : "Nenhum app Meta configurado para este cliente";
  const ativos = resumo.numeros_ativos ?? 0;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="secondary" className="gap-1">
        <ShieldCheck size={12} /> {origem}
      </Badge>
      <span className="text-muted-foreground">
        {ativos === 0 ? "nenhum número ativo" : ativos === 1 ? "1 número ativo" : `${ativos} números ativos`}
      </span>
    </div>
  );
}

export default function CrmIntegracoes() {
  const [resumo, setResumo] = useState<ResumoWhatsApp | null>(null);
  // Muda quando o popup do Embedded Signup fecha: a lista de números relê.
  const [versaoNumeros, setVersaoNumeros] = useState(0);
  const { ligado: ligacoesLigado } = useModule("ligacoes");

  const carregarResumo = useCallback(async () => {
    const { data, error } = await rpcResumo("tenant_whatsapp_resumo");
    if (!error) setResumo(data ?? null);
  }, []);

  useEffect(() => {
    void carregarResumo();
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
  }, [carregarResumo]);

  const aposConectar = useCallback(() => {
    setVersaoNumeros((v) => v + 1);
    void carregarResumo();
  }, [carregarResumo]);

  const podeGerir = resumo?.pode_gerir === true;
  const signupLiberado = resumo?.embedded_signup_disponivel === true;

  const botoesDeConexao = podeGerir ? (
    <>
      <WhatsAppEmbeddedSignupButton onConnected={aposConectar} disabled={!signupLiberado} />
      <WhatsAppEmbeddedSignupButton coexistencia onConnected={aposConectar} disabled={!signupLiberado} />
    </>
  ) : null;

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Integrações</h1>
          <p className="text-sm text-muted-foreground">Conecte canais externos ao seu CRM</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* WhatsApp: só leitura + testar. Quem configura é o administrador. */}
        <WhatsAppAccountsSection
          versao={versaoNumeros}
          onCarregado={() => void carregarResumo()}
          acoes={botoesDeConexao}
          topo={
            <>
              <ResumoDoWhatsApp resumo={resumo} />
              {podeGerir && resumo && !signupLiberado && (
                <p className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  <Info size={16} className="mt-0.5 shrink-0" /> {AVISO_SIGNUP_BLOQUEADO}
                </p>
              )}
              <p className="mb-4 text-sm text-muted-foreground">
                Os números são configurados pelo administrador do sistema. Aqui você acompanha o estado e pode testar a conexão.
              </p>
            </>
          }
        />

        {/* Instagram (legado) via Login do Facebook — ver MOSTRAR_INSTAGRAM_LOGIN_FACEBOOK */}
        {MOSTRAR_INSTAGRAM_LOGIN_FACEBOOK && <InstagramAccountsSection />}

        {/* Instagram: Login do Instagram (principal) + token manual (avançado) */}
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

        {/* Telefonia (Api4Com): só com o módulo de ligações. Enquanto a
            configuração carrega (undefined), aparece — só some com false. */}
        {podeMostrar(ligacoesLigado) && <Api4ComSection />}

        {/* Webhook de leads do site */}
        <WebhookSection />
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Phone, Loader2, CheckCircle2, X, RotateCcw } from "lucide-react";

// Seção da página de Integrações: telefonia por voz via Api4Com.
// Complementar à ligação por WhatsApp. A ligação em si é feita pela extensão do
// Chrome da Api4Com; o CRClin registra o webhook, grava e transcreve as chamadas.
type Status = { connected: boolean; email: string | null; webhook_registered: boolean; webhook_error?: string | null };

export default function Api4ComSection() {
  const { userRole } = useAuth();
  const isAdmin = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: "", password: "" });
  const [connecting, setConnecting] = useState(false);
  const [registering, setRegistering] = useState(false);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("api4com-connect", { body });
    if (error) throw new Error(error.message || "Erro na telefonia");
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const loadStatus = async () => {
    setLoading(true);
    try { setStatus(await call({ action: "status" })); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (isAdmin) loadStatus(); }, [isAdmin]);

  const connect = async () => {
    if (!form.email.trim() || !form.password) { toast.error("Informe e-mail e senha da Api4Com."); return; }
    setConnecting(true);
    try {
      const d = await call({ action: "connect", email: form.email.trim(), password: form.password });
      toast.success(d.webhook_registered ? "Api4Com conectada!" : "Conectada (o registro do webhook falhou — registre abaixo).");
      setForm({ email: "", password: "" });
      loadStatus();
    } catch (e: any) { toast.error(e.message); }
    finally { setConnecting(false); }
  };

  const disconnect = async () => {
    if (!confirm("Desconectar a telefonia Api4Com desta clínica?")) return;
    try { await call({ action: "disconnect" }); toast.success("Desconectada."); loadStatus(); }
    catch (e: any) { toast.error(e.message); }
  };

  const registerWebhook = async () => {
    setRegistering(true);
    try {
      const d = await call({ action: "register_webhook" });
      if (d.webhook_registered) toast.success("Webhook registrado! As ligações vão aparecer em Ligações.");
      else toast.error("Ainda não deu: " + (d.error || "falha ao registrar o webhook."));
      loadStatus();
    } catch (e: any) { toast.error(e.message); }
    finally { setRegistering(false); }
  };

  if (!isAdmin) return null;

  return (
    <div className="mt-6 mb-6">
      <h2 className="font-semibold text-foreground flex items-center gap-2 mb-4">
        <span className="inline-flex items-center justify-center p-1.5 rounded-lg bg-primary/10"><Phone size={16} className="text-primary" /></span>
        Telefonia (Api4Com)
      </h2>
      <Card className="max-w-2xl">
        <CardContent className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Ligações por telefone (voz) integradas ao CRM — <b>separado</b> da chamada por WhatsApp, que continua normal.
            A ligação é feita pela <b>extensão da Api4Com no Chrome</b>; as chamadas (com gravação e transcrição) aparecem
            sozinhas na aba <b>Ligações</b>.
          </p>

          {loading ? (
            <div className="text-muted-foreground text-sm"><Loader2 className="inline animate-spin mr-2" size={14} /> Carregando…</div>
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-3">
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Conectada</p>
                  <p className="text-muted-foreground text-xs">Conta: {status.email} · Webhook: {status.webhook_registered ? "registrado" : "não registrado"}</p>
                </div>
              </div>

              {!status.webhook_registered && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-500">Webhook não registrado</p>
                  <p className="text-xs text-muted-foreground">Sem o webhook, as ligações não aparecem automaticamente em Ligações. Clique para registrar (não precisa digitar a senha de novo).</p>
                  {status.webhook_error && (
                    <p className="text-[11px] text-muted-foreground break-words"><b>Detalhe:</b> {status.webhook_error}</p>
                  )}
                  <Button size="sm" onClick={registerWebhook} disabled={registering}>
                    {registering ? <Loader2 className="animate-spin mr-2" size={14} /> : <RotateCcw className="mr-2" size={14} />} Registrar webhook
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">Instale a <b>extensão da Api4Com no Chrome</b> e faça login com esta mesma conta. As ligações feitas por ela aparecem em <b>Ligações</b>.</p>
              <Button variant="outline" onClick={disconnect} className="text-destructive hover:text-destructive"><X size={14} className="mr-1" /> Desconectar</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Entre com o <b>login da sua conta Api4Com</b> (o mesmo do painel deles). O token fica guardado com segurança no servidor — nunca aparece no navegador.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>E-mail Api4Com</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="seu@email.com" /></div>
                <div className="space-y-1"><Label>Senha Api4Com</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" /></div>
              </div>
              <Button onClick={connect} disabled={connecting}>
                {connecting ? <Loader2 className="animate-spin mr-2" size={16} /> : <Phone className="mr-2" size={16} />} Conectar Api4Com
              </Button>
              <p className="text-[11px] text-muted-foreground">Precisa de uma conta na Api4Com (serviço de voz, pago). A ligação por WhatsApp não é afetada.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

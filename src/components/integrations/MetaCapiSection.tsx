import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Eye, EyeOff, Save, RefreshCw, Send, Search, RotateCcw } from "lucide-react";

/**
 * API de Conversões da Meta — configuração por cliente e acompanhamento da fila.
 *
 * O token nunca volta do servidor (a RPC devolve só "tem_token"); o campo é
 * write-only: vazio = mantém o que está salvo.
 */

type Config = {
  existe: boolean;
  enabled: boolean;
  dataset_id: string;
  waba_id: string;
  test_event_code: string;
  event_source_url: string;
  send_crm_events: boolean;
  send_lead_event: boolean;
  tem_token: boolean;
  updated_at: string | null;
  waba_sugerido: string;
  numeros: { display_name: string | null; phone_e164: string | null; waba_id: string | null; is_default: boolean }[];
};

type EventoFila = {
  id: string;
  event_name: string;
  status: string;
  modo: string | null;
  origem: string | null;
  value: number | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  lead_id: string;
  lead_nome: string | null;
  com_ctwa: boolean;
};

type StatusFila = {
  dias: number;
  por_status: Record<string, number>;
  enviados_por_evento: Record<string, number>;
  ultimos: EventoFila[];
  ultimo_envio: string | null;
  ultimo_erro: string | null;
  leads_com_ctwa_7d: number;
};

const EVENTOS: { nome: string; quando: string }[] = [
  { nome: "LeadSubmitted", quando: "Entrou lead vindo de anúncio de WhatsApp (com identificador do clique)" },
  { nome: "QualifiedLead", quando: "Agendou (consulta confirmada)" },
  { nome: "InitiateCheckout", quando: "Compareceu (consulta marcada como compareceu ou contratou)" },
  { nome: "Purchase", quando: "Pagou (pagamento lançado ou importado do Dontus), com o valor" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Na fila",
  processing: "Enviando",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Pulado",
};

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function MetaCapiSection() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [status, setStatus] = useState<StatusFila | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testando, setTestando] = useState(false);
  const [descobrindo, setDescobrindo] = useState(false);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [c, s] = await Promise.all([rpc("meta_capi_config_ler"), rpc("meta_capi_eventos_status", { p_dias: 7 })]);
    if (c.error) {
      toast.error(`API de Conversões: ${c.error.message}`);
    } else {
      setCfg(c.data as Config);
    }
    if (!s.error) setStatus(s.data as StatusFila);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    if (!cfg) return;
    setSaving(true);
    const p: Record<string, unknown> = {
      enabled: cfg.enabled,
      dataset_id: cfg.dataset_id,
      waba_id: cfg.waba_id,
      test_event_code: cfg.test_event_code,
      event_source_url: cfg.event_source_url,
      send_crm_events: cfg.send_crm_events,
      send_lead_event: cfg.send_lead_event,
    };
    if (token.trim()) p.access_token = token.trim();
    const { data, error } = await rpc("meta_capi_config_salvar", { p });
    setSaving(false);
    if (error) { toast.error(`Erro ao salvar: ${error.message}`); return; }
    setCfg(data as Config);
    setToken("");
    toast.success("Configuração da API de Conversões salva");
  };

  const limparToken = async () => {
    if (!confirm("Apagar o token salvo? Os envios param até colar outro.")) return;
    const { data, error } = await rpc("meta_capi_config_salvar", { p: { access_token: "__limpar__" } });
    if (error) { toast.error(error.message); return; }
    setCfg(data as Config);
    toast.success("Token apagado");
  };

  const testar = async () => {
    setTestando(true);
    setResultadoTeste(null);
    const { data, error } = await supabase.functions.invoke("meta-capi-worker", {
      body: { action: "testar", test_event_code: cfg?.test_event_code || undefined },
    });
    setTestando(false);
    if (error) { setResultadoTeste(`Erro: ${error.message}`); return; }
    const r = data as { ok: boolean; erro?: string | null; resposta?: unknown; modo?: string; http?: number };
    if (r?.ok) {
      setResultadoTeste(`Evento de teste aceito pela Meta (modo ${r.modo}). Confira na aba Eventos de teste do Gerenciador de Eventos.`);
      toast.success("Evento de teste enviado");
    } else {
      setResultadoTeste(`A Meta recusou (HTTP ${r?.http ?? "?"}): ${r?.erro || JSON.stringify(r?.resposta ?? r)}`);
    }
  };

  const descobrir = async (criar: boolean) => {
    if (criar && !confirm("Criar um conjunto de dados novo ligado ao número do WhatsApp na Meta? Se já existe um, a Meta devolve o existente.")) return;
    setDescobrindo(true);
    const { data, error } = await supabase.functions.invoke("meta-capi-worker", {
      body: { action: criar ? "criar_dataset" : "descobrir_dataset" },
    });
    setDescobrindo(false);
    if (error) { toast.error(error.message); return; }
    const r = data as { ok: boolean; erro?: string | null; datasets?: string[]; waba_id?: string };
    if (!r?.ok) { toast.error(r?.erro || "A Meta não respondeu"); return; }
    if (!r.datasets?.length) {
      toast.info(`Nenhum conjunto de dados ligado à conta ${r.waba_id}. Ligue o número a um conjunto no Gerenciador de Eventos (ou crie um aqui).`);
      return;
    }
    setCfg((c) => c ? { ...c, dataset_id: r.datasets![0], waba_id: c.waba_id || r.waba_id || "" } : c);
    toast.success(`Conjunto de dados encontrado: ${r.datasets[0]}. Salve para confirmar.`);
  };

  const reenviar = async (id: string) => {
    const { error } = await rpc("meta_capi_reenviar", { p_event_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Evento de volta na fila");
    carregar();
  };

  if (loading) return <Card className="p-4 text-sm text-muted-foreground">Carregando…</Card>;
  if (!cfg) return null;

  const total7d = Object.values(status?.por_status ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">API de Conversões da Meta</h3>
        <p className="text-sm text-muted-foreground max-w-3xl">
          O CRM devolve à Meta o que acontece com cada lead — agendou, compareceu, pagou — para as campanhas de
          WhatsApp aprenderem com quem fecha, e não só com quem manda "oi". Lead vindo de anúncio de WhatsApp vai
          amarrado ao clique (ctwa_clid); lead do site, Google ou Instagram vai como evento de CRM casado por
          telefone em hash.
        </p>
      </div>

      <Card className="p-4 space-y-4 max-w-3xl">
        <div className="flex items-center gap-3">
          <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
          <div>
            <div className="text-sm font-medium">{cfg.enabled ? "Ligada" : "Desligada"}</div>
            <div className="text-xs text-muted-foreground">Desligada, nada é enfileirado nem enviado.</div>
          </div>
          {cfg.tem_token ? <Badge variant="secondary">Token salvo</Badge> : <Badge variant="destructive">Sem token</Badge>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="capi-dataset">Conjunto de dados (dataset / pixel)</Label>
            <Input id="capi-dataset" inputMode="numeric" value={cfg.dataset_id}
              onChange={(e) => setCfg({ ...cfg, dataset_id: e.target.value })} placeholder="1616335282799813" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">Gerenciador de Eventos → Conjuntos de dados → Identificação.</p>
          </div>
          <div>
            <Label htmlFor="capi-waba">Conta do WhatsApp Business (WABA) do número dos anúncios</Label>
            <Input id="capi-waba" inputMode="numeric" value={cfg.waba_id}
              onChange={(e) => setCfg({ ...cfg, waba_id: e.target.value })}
              placeholder={cfg.waba_sugerido || "ID da conta do WhatsApp Business"} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">
              {cfg.waba_sugerido ? `Vazio usa a conta do número principal (${cfg.waba_sugerido}).` : "Vazio usa a conta do número principal cadastrado."}
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="capi-token">Token de acesso do conjunto de dados</Label>
          <div className="flex gap-2">
            <Input id="capi-token" type={showToken ? "text" : "password"} value={token} autoComplete="off"
              onChange={(e) => setToken(e.target.value)}
              placeholder={cfg.tem_token ? "Já existe um token salvo. Cole outro só para trocar." : "Cole o token gerado no Gerenciador de Eventos"}
              className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={() => setShowToken((s) => !s)} aria-label="Mostrar token">
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
            {cfg.tem_token && (
              <Button type="button" variant="outline" onClick={limparToken}>Apagar</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Gerenciador de Eventos → conjunto de dados → Configurações → API de Conversões → Gerar token de acesso.
            O token fica só no servidor e nunca volta para esta tela.
          </p>
        </div>

        <div>
          <Label htmlFor="capi-url">Site do cliente (event_source_url)</Label>
          <Input id="capi-url" inputMode="url" value={cfg.event_source_url}
            onChange={(e) => setCfg({ ...cfg, event_source_url: e.target.value })} placeholder="https://rizodent.com.br/" className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground mt-1">
            Vai em todo evento. Conjunto de dados em categoria restrita (saúde) bloqueia evento de servidor sem URL.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="capi-teste">Código de evento de teste (opcional)</Label>
            <Input id="capi-teste" value={cfg.test_event_code}
              onChange={(e) => setCfg({ ...cfg, test_event_code: e.target.value.toUpperCase() })} placeholder="TEST12345" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">
              Enquanto preenchido, <strong>todo</strong> envio vai só para a aba Eventos de teste. Apague para valer de verdade.
            </p>
          </div>
          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={cfg.send_lead_event} onCheckedChange={(v) => setCfg({ ...cfg, send_lead_event: v })} />
              Enviar LeadSubmitted quando entra lead de anúncio
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={cfg.send_crm_events} onCheckedChange={(v) => setCfg({ ...cfg, send_crm_events: v })} />
              Enviar também leads sem clique de anúncio (site, Google, Instagram) por telefone em hash
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={salvar} disabled={saving}>
            <Save size={16} className="mr-1" /> {saving ? "Salvando…" : "Salvar"}
          </Button>
          <Button variant="outline" onClick={() => descobrir(false)} disabled={descobrindo}>
            <Search size={16} className="mr-1" /> Achar conjunto ligado ao WhatsApp
          </Button>
          <Button variant="outline" onClick={() => descobrir(true)} disabled={descobrindo}>
            Criar conjunto para o WhatsApp
          </Button>
          <Button variant="outline" onClick={testar} disabled={testando || !cfg.tem_token}>
            <Send size={16} className="mr-1" /> {testando ? "Enviando…" : "Enviar evento de teste"}
          </Button>
        </div>
        {resultadoTeste && <p className="text-sm whitespace-pre-wrap">{resultadoTeste}</p>}

        {cfg.numeros.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Números cadastrados: {cfg.numeros.map((n) => `${n.display_name || n.phone_e164} (WABA ${n.waba_id || "?"})`).join(" · ")}.
            Cada conta do WhatsApp Business precisa estar ligada ao conjunto de dados no Gerenciador de Eventos.
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3 max-w-3xl">
        <h4 className="font-medium">O que é enviado</h4>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Evento na Meta</TableHead><TableHead>Quando o CRM manda</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {EVENTOS.map((e) => (
              <TableRow key={e.nome}>
                <TableCell className="font-mono text-xs">{e.nome}</TableCell>
                <TableCell className="text-sm">{e.quando}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          Um evento por lead: remarcação, parcelas e reenvio de webhook não repetem. A Meta só aceita evento de até 7 dias.
          Depois de ligar, troque a otimização dos conjuntos de anúncio para o evento desejado quando houver volume
          (por volta de 50 por semana por conta).
        </p>
      </Card>

      <Card className="p-4 space-y-3 max-w-3xl">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Últimos 7 dias</h4>
          <Button variant="ghost" size="sm" onClick={carregar}><RefreshCw size={14} className="mr-1" /> Atualizar</Button>
        </div>
        {status ? (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{total7d} evento(s)</Badge>
              {Object.entries(status.por_status).map(([k, v]) => (
                <Badge key={k} variant={k === "failed" ? "destructive" : "secondary"}>{STATUS_LABEL[k] || k}: {v}</Badge>
              ))}
              <Badge variant="outline">Leads de anúncio com clique: {status.leads_com_ctwa_7d}</Badge>
            </div>
            {Object.keys(status.enviados_por_evento).length > 0 && (
              <div className="text-xs text-muted-foreground">
                Enviados: {Object.entries(status.enviados_por_evento).map(([k, v]) => `${k} ${v}`).join(" · ")} · último envio {fmt(status.ultimo_envio)}
              </div>
            )}
            {status.ultimo_erro && <p className="text-xs text-destructive">Último erro: {status.ultimo_erro}</p>}
            {status.ultimos.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead><TableHead>Lead</TableHead><TableHead>Evento</TableHead>
                    <TableHead>Modo</TableHead><TableHead>Situação</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.ultimos.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">{fmt(e.created_at)}</TableCell>
                      <TableCell className="text-xs">{e.lead_nome || e.lead_id.slice(0, 8)}{e.com_ctwa ? "" : " (sem clique)"}</TableCell>
                      <TableCell className="font-mono text-xs">{e.event_name}{e.value ? ` R$ ${Number(e.value).toLocaleString("pt-BR")}` : ""}</TableCell>
                      <TableCell className="text-xs">{e.modo === "business_messaging" ? "WhatsApp" : e.modo === "crm" ? "CRM" : "—"}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={e.status === "failed" ? "destructive" : e.status === "sent" ? "secondary" : "outline"}>{STATUS_LABEL[e.status] || e.status}</Badge>
                        {e.last_error && <div className="text-[11px] text-muted-foreground max-w-xs truncate" title={e.last_error}>{e.last_error}</div>}
                      </TableCell>
                      <TableCell>
                        {(e.status === "failed" || e.status === "skipped") && (
                          <Button variant="ghost" size="sm" onClick={() => reenviar(e.id)} title="Reenviar"><RotateCcw size={14} /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum evento ainda. Os eventos entram na fila conforme os leads agendam, comparecem e pagam.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sem dados.</p>
        )}
      </Card>
    </div>
  );
}

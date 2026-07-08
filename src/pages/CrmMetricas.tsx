import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateISO } from "@/lib/utils";
import { dayKeyBahia } from "@/lib/reportKit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Bot, Mic, Sparkles, Zap } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from "recharts";

type UsageData = {
  respostas_por_bot: Array<{ bot_name: string; mes: string; total: number; concluidos: number }>;
  uso_ia: Array<{ mes: string; mode: string; total: number; leads: number }>;
  automacoes: Array<{ mes: string; action_type: string; enviados: number; total: number }>;
};

// O RPC (já corrigido p/ America/Bahia) serializa o bucket "mes" como timestamp local sem
// offset (ex.: "2026-07-01T00:00:00"); versões antigas serializavam com offset UTC
// ("2026-07-01T00:00:00+00:00"). Extrai o dia YYYY-MM-DD do próprio bucket quando ele já vem
// truncado (meia-noite ou date-only); para qualquer outro timestamp, converte para o dia
// local (America/Bahia).
const bucketDia = (raw: string): string => {
  if (/^\d{4}-\d{2}-\d{2}(T00:00:00|$)/.test(raw)) return raw.slice(0, 10);
  return dayKeyBahia(raw);
};

// IMPORTANTE: usar meio-dia LOCAL para não recuar 1 dia/mês em fusos negativos (BRT).
// Recebem SEMPRE um dia YYYY-MM-DD (já normalizado por bucketDia).
const fmtMes = (dia: string) => {
  const d = new Date(dia + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

const fmtDia = (dia: string) => {
  const d = new Date(dia + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

// Tradução de rótulos vindos do backend em inglês/snake_case
const ACTION_TYPE_LABELS: Record<string, string> = {
  send_message: "Mensagem de texto",
  send_template: "Template",
  send_audio: "Áudio",
  send_file: "Arquivo",
  send_image: "Imagem",
  send_video: "Vídeo",
  send_bot: "Disparo de bot",
  move_stage: "Mover etapa",
  assign_user: "Atribuir responsável",
  add_tag: "Adicionar etiqueta",
  remove_tag: "Remover etiqueta",
  create_task: "Criar tarefa",
  webhook: "Webhook",
};

const IA_MODE_LABELS: Record<string, string> = {
  suggest: "Sugestão",
  suggested: "Sugerida",
  approved: "Aprovada",
  edited: "Corrigida",
  discarded: "Ruim",
  dismissed: "Ignorada",
  superseded: "Substituída (regenerada)",
  sent: "Enviada",
  pending: "Pendente",
  auto: "Envio automático",
  analyze: "Análise de conversa",
  transcribe: "Transcrição de áudio",
  reply: "Resposta gerada",
  learn: "Aprendizado",
  good_example: "Exemplo aprendido",
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
  lovable: "Lovable AI",
};

const titleize = (s: string) =>
  s.replace(/[_\-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const traduzir = (key: string, dict: Record<string, string>) =>
  dict[key?.toLowerCase?.() ?? ""] || titleize(key || "—");

type Preset =
  | "current_month"
  | "last_month"
  | "last_30"
  | "last_60"
  | "last_90"
  | "last_6m"
  | "last_12m"
  | "ytd";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "current_month", label: "Mês atual" },
  { value: "last_month", label: "Mês passado" },
  { value: "last_30", label: "Últimos 30 dias" },
  { value: "last_60", label: "Últimos 60 dias" },
  { value: "last_90", label: "Últimos 90 dias" },
  { value: "last_6m", label: "Últimos 6 meses" },
  { value: "last_12m", label: "Últimos 12 meses" },
  { value: "ytd", label: "Este ano" },
];

const rangeFromPreset = (p: Preset): { from: Date; to: Date } => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  switch (p) {
    case "current_month":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
      return { from, to };
    }
    case "last_30": {
      const from = new Date(today); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
      return { from, to: today };
    }
    case "last_60": {
      const from = new Date(today); from.setDate(from.getDate() - 59); from.setHours(0, 0, 0, 0);
      return { from, to: today };
    }
    case "last_90": {
      const from = new Date(today); from.setDate(from.getDate() - 89); from.setHours(0, 0, 0, 0);
      return { from, to: today };
    }
    case "last_6m": {
      const from = startOfMonth(today); from.setMonth(from.getMonth() - 5);
      return { from, to: today };
    }
    case "last_12m": {
      const from = startOfMonth(today); from.setMonth(from.getMonth() - 11);
      return { from, to: today };
    }
    case "ytd": {
      const from = new Date(today.getFullYear(), 0, 1);
      return { from, to: today };
    }
  }
};

const isTranscricao = (mode: string) => (mode || "").toLowerCase() === "transcribe";

// Sugestão 'superseded' foi substituída por uma regeneração na mesma conversa: contá-la como
// item distinto inflaria o KPI. Segue visível no gráfico como "Substituída (regenerada)".
const isSuperseded = (mode: string) => (mode || "").toLowerCase() === "superseded";

const CrmMetricas = () => {
  const [preset, setPreset] = useState<Preset>("current_month");
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { from, to } = useMemo(() => rangeFromPreset(preset), [preset]);
  // Espelha a regra do RPC crm_usage_metrics: span de até 92 dias → buckets diários; acima disso → mensais.
  // Cálculo idêntico ao do RPC — (p_to - p_from) + 1 em dias-calendário. Não usar diferença de
  // timestamps + 1: como "to" já está em 23:59:59.999, o arredondamento sozinho já dá o span
  // inclusivo e o "+1" extra causava off-by-one (ex.: "Este ano" em 2/abr: 92 vira 93).
  const spanDays = Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000,
  ) + 1;
  const granularity: "day" | "month" = spanDays <= 92 ? "day" : "month";
  const fmtEixo = granularity === "day" ? fmtDia : fmtMes;

  useEffect(() => {
    let ativo = true;
    const load = async () => {
      setLoading(true);
      setErrorMsg(null);
      const toIso = toLocalDateISO(to);
      const fromIso = toLocalDateISO(from);
      const { data: res, error } = await (supabase as any).rpc("crm_usage_metrics", {
        p_from: fromIso, p_to: toIso,
      });
      if (!ativo) return;
      if (error) {
        setData(null);
        setErrorMsg(`Erro ao carregar as métricas: ${error.message}`);
      } else if (res && typeof res === "object" && "error" in (res as any)) {
        // O RPC devolve {"error":"no_tenant"} como resposta 200 quando não identifica o tenant.
        setData(null);
        setErrorMsg(
          (res as any).error === "no_tenant"
            ? "Não foi possível identificar a clínica do seu usuário. Saia e entre novamente ou contate o suporte."
            : `Erro retornado pelo servidor: ${String((res as any).error)}`,
        );
      } else if (res && typeof res === "object") {
        const r = res as Partial<UsageData>;
        setData({
          respostas_por_bot: Array.isArray(r.respostas_por_bot) ? r.respostas_por_bot : [],
          uso_ia: Array.isArray(r.uso_ia) ? r.uso_ia : [],
          automacoes: Array.isArray(r.automacoes) ? r.automacoes : [],
        });
      } else {
        setData(null);
        setErrorMsg("Resposta inesperada do servidor ao carregar as métricas.");
      }
      setLoading(false);
    };
    load();
    return () => { ativo = false; };
  }, [from, to]);

  const kpis = useMemo(() => {
    if (!data) return { botsTotal: 0, botsConcluidos: 0, ia: 0, transcricoes: 0, automacoes: 0 };
    return {
      botsTotal: data.respostas_por_bot.reduce((s, r) => s + Number(r.total), 0),
      botsConcluidos: data.respostas_por_bot.reduce((s, r) => s + Number(r.concluidos), 0),
      // Transcrições são geradas automaticamente para todo áudio recebido — separadas do uso real da IA.
      // Sugestões regeneradas (superseded) também ficam fora do KPI para não contar duas vezes.
      ia: data.uso_ia.filter((r) => !isTranscricao(r.mode) && !isSuperseded(r.mode)).reduce((s, r) => s + Number(r.total), 0),
      transcricoes: data.uso_ia.filter((r) => isTranscricao(r.mode)).reduce((s, r) => s + Number(r.total), 0),
      automacoes: data.automacoes.reduce((s, r) => s + Number(r.enviados), 0),
    };
  }, [data]);

  const pctConcluidos = kpis.botsTotal > 0 ? Math.round((kpis.botsConcluidos / kpis.botsTotal) * 100) : 0;

  // Aggregations for charts
  const botPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.respostas_por_bot.forEach((r) => {
      const key = bucketDia(r.mes);
      if (!map.has(key)) map.set(key, { mes: fmtEixo(key) });
      const row = map.get(key);
      const label = r.bot_name || "Sem nome";
      row[label] = (row[label] || 0) + Number(r.concluidos);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [data, fmtEixo]);

  const botNames = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.respostas_por_bot.map((r) => r.bot_name || "Sem nome")));
  }, [data]);

  const iaPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.uso_ia.forEach((r) => {
      const key = bucketDia(r.mes);
      if (!map.has(key)) map.set(key, { mes: fmtEixo(key) });
      const row = map.get(key);
      const label = traduzir(r.mode, IA_MODE_LABELS);
      row[label] = (row[label] || 0) + Number(r.total);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [data, fmtEixo]);

  const iaModes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.uso_ia.map((r) => traduzir(r.mode, IA_MODE_LABELS))));
  }, [data]);


  const autoPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.automacoes.forEach((r) => {
      const key = bucketDia(r.mes);
      if (!map.has(key)) map.set(key, { mes: fmtEixo(key) });
      const row = map.get(key);
      const label = traduzir(r.action_type, ACTION_TYPE_LABELS);
      row[label] = (row[label] || 0) + Number(r.enviados);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [data, fmtEixo]);

  const autoTypes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.automacoes.map((r) => traduzir(r.action_type, ACTION_TYPE_LABELS))));
  }, [data]);

  const COLORS = ["hsl(var(--primary))", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

  const periodoLabel = `${from.toLocaleDateString("pt-BR")} — ${to.toLocaleDateString("pt-BR")}`;
  const semDados = loading ? "Carregando…" : errorMsg ? "Dados indisponíveis." : "Sem dados no período.";

  return (
    <div className="animate-fade-in space-y-6 overflow-y-auto h-full pr-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Métricas de Uso</h1>
          <p className="text-sm text-muted-foreground">
            Bots, IA e Automações · <span className="font-medium">{periodoLabel}</span>
          </p>
        </div>
        <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {errorMsg && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="text-destructive shrink-0" size={18} />
            <p className="text-sm text-destructive">{errorMsg}</p>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Execuções de Bot",
            value: kpis.botsTotal,
            sub: `${kpis.botsConcluidos.toLocaleString("pt-BR")} concluídas (${pctConcluidos}%)`,
            icon: Bot,
          },
          { label: "Sugestões e análises da IA", value: kpis.ia, sub: "sugestões regeneradas não contam", icon: Sparkles },
          { label: "Transcrições de áudio", value: kpis.transcricoes, sub: "geradas automaticamente", icon: Mic },
          { label: "Automações executadas", value: kpis.automacoes, icon: Zap },
        ].map((k) => (
          <Card key={k.label} className="gradient-card shadow-card">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="rounded-lg bg-primary/10 p-3"><k.icon className="text-primary" size={20} /></div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-2xl font-bold">{loading ? "…" : k.value.toLocaleString("pt-BR")}</p>
                {k.sub && !loading && <p className="text-[11px] text-muted-foreground">{k.sub}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bots */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bot size={16} /> Execuções concluídas por Bot</CardTitle>
          <p className="text-xs text-muted-foreground">Execuções de bot concluídas com sucesso no período (uma execução pode enviar várias mensagens).</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {botPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{semDados}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={botPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                {botNames.map((n, i) => (
                  <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} stackId="a" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* IA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles size={16} /> Uso da IA (Bia)</CardTitle>
          <p className="text-xs text-muted-foreground">Volumes por tipo: sugestões, análises, exemplos e transcrições automáticas de áudio.</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {iaPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{semDados}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={iaPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                {iaModes.map((m, i) => (
                  <Bar key={m} dataKey={m} fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>



      {/* Automações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Zap size={16} /> Automações executadas</CardTitle>
          <p className="text-xs text-muted-foreground">Ações efetivamente executadas por gatilhos, agrupadas por tipo.</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {autoPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{semDados}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={autoPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                {autoTypes.map((t, i) => (
                  <Bar key={t} dataKey={t} fill={COLORS[i % COLORS.length]} stackId="a" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CrmMetricas;

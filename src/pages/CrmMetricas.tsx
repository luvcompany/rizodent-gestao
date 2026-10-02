import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toLocalDateISO } from "@/lib/utils";
import { dayKeyNoFuso } from "@/lib/reportKit";
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

// O RPC (no fuso do tenant) serializa o bucket "mes" como timestamp local sem
// offset (ex.: "2026-07-01T00:00:00"); versões antigas serializavam com offset UTC
// ("2026-07-01T00:00:00+00:00"). Extrai o dia YYYY-MM-DD do próprio bucket quando ele já vem
// truncado (meia-noite ou date-only); para qualquer outro timestamp, converte para o dia
// local (fuso do tenant).
const bucketDia = (raw: string): string => {
  if (/^\d{4}-\d{2}-\d{2}(T00:00:00|$)/.test(raw)) return raw.slice(0, 10);
  return dayKeyNoFuso(raw);
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

/**
 * Nome configurado da assistente de IA do cliente
 * (ai_assistant_config.assistant_display_name). Perfis sem leitura dessa config
 * (RLS) ou cliente sem nome configurado ficam com "Assistente".
 */
function useNomeDaAssistente(): string {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["ai-nome", user?.id ?? null],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data: linha, error } = await supabase
        .from("ai_assistant_config")
        .select("assistant_display_name")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      const nome = String(linha?.assistant_display_name ?? "").trim();
      return nome || null;
    },
  });
  return data || "Assistente";
}

const CrmMetricas = () => {
  const nomeAssistente = useNomeDaAssistente();
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

  const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--chart-6))", "hsl(var(--chart-7))", "hsl(var(--chart-8))"];

  const periodoLabel = `${from.toLocaleDateString("pt-BR")} — ${to.toLocaleDateString("pt-BR")}`;
  const semDados = loading ? "Carregando…" : errorMsg ? "Dados indisponíveis." : "Sem dados no período.";

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto animate-fade-in space-y-5 pr-0 lg:space-y-6 lg:pr-2 [&_.recharts-cartesian-grid-horizontal_line]:stroke-border [&_.recharts-cartesian-grid-vertical_line]:stroke-transparent [&_.recharts-cartesian-axis-line]:stroke-transparent [&_.recharts-cartesian-axis-tick-line]:stroke-transparent [&_.recharts-cartesian-axis-tick_text]:fill-tertiary [&_.recharts-cartesian-axis-tick_text]:text-[11px] [&_.recharts-tooltip-cursor]:fill-muted/60 [&_.recharts-default-tooltip]:!rounded-lg [&_.recharts-default-tooltip]:!border-0 [&_.recharts-default-tooltip]:!bg-sidebar [&_.recharts-default-tooltip]:!px-3 [&_.recharts-default-tooltip]:!py-2 [&_.recharts-default-tooltip]:!shadow-float [&_.recharts-tooltip-label]:!text-sidebar-active-foreground/60 [&_.recharts-tooltip-label]:!text-[11px] [&_.recharts-tooltip-item]:!text-sidebar-active-foreground [&_.recharts-tooltip-item]:!text-xs [&_.recharts-tooltip-item]:!font-semibold [&_.recharts-legend-wrapper]:!pt-3 [&_.recharts-legend-item]:!mr-4 [&_.recharts-legend-item_svg]:!h-2.5 [&_.recharts-legend-item_svg]:!w-2.5 [&_.recharts-legend-item_svg]:rounded-full [&_.recharts-legend-item_svg]:!mr-1.5 [&_.recharts-legend-item-text]:!text-muted-foreground [&_.recharts-legend-item-text]:text-[13px] [&_.recharts-legend-item-text]:font-medium [&_.recharts-bar:nth-child(1_of_.recharts-bar)_.recharts-rectangle]:fill-chart-1 [&_.legend-item-0_.recharts-legend-icon]:fill-chart-1 [&_.recharts-bar:nth-child(2_of_.recharts-bar)_.recharts-rectangle]:fill-chart-2 [&_.legend-item-1_.recharts-legend-icon]:fill-chart-2 [&_.recharts-bar:nth-child(3_of_.recharts-bar)_.recharts-rectangle]:fill-chart-3 [&_.legend-item-2_.recharts-legend-icon]:fill-chart-3 [&_.recharts-bar:nth-child(4_of_.recharts-bar)_.recharts-rectangle]:fill-chart-4 [&_.legend-item-3_.recharts-legend-icon]:fill-chart-4 [&_.recharts-bar:nth-child(5_of_.recharts-bar)_.recharts-rectangle]:fill-chart-5 [&_.legend-item-4_.recharts-legend-icon]:fill-chart-5 [&_.recharts-bar:nth-child(6_of_.recharts-bar)_.recharts-rectangle]:fill-chart-6 [&_.legend-item-5_.recharts-legend-icon]:fill-chart-6 [&_.recharts-bar:nth-child(7_of_.recharts-bar)_.recharts-rectangle]:fill-chart-7 [&_.legend-item-6_.recharts-legend-icon]:fill-chart-7 [&_.recharts-bar:nth-child(8_of_.recharts-bar)_.recharts-rectangle]:fill-chart-8 [&_.legend-item-7_.recharts-legend-icon]:fill-chart-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">Métricas de Uso</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bots, IA e Automações · <span className="font-semibold text-foreground tabular-nums">{periodoLabel}</span>
          </p>
        </div>
        <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
          <SelectTrigger className="w-[200px] h-10 rounded-xl bg-card shadow-xs font-medium"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {errorMsg && (
        <Card className="rounded-card border-destructive/20 bg-destructive-soft shadow-none">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="text-destructive shrink-0 mt-0.5" size={18} />
            <p className="text-sm text-destructive-soft-foreground break-words">{errorMsg}</p>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5 [&>*:has(svg.lucide-bot)_.crm-chip]:bg-primary-soft [&>*:has(svg.lucide-bot)_.crm-chip]:text-primary [&>*:has(svg.lucide-sparkles)_.crm-chip]:bg-purple-soft [&>*:has(svg.lucide-sparkles)_.crm-chip]:text-purple [&>*:has(svg.lucide-mic)_.crm-chip]:bg-teal-soft [&>*:has(svg.lucide-mic)_.crm-chip]:text-teal [&>*:has(svg.lucide-zap)_.crm-chip]:bg-warning-soft [&>*:has(svg.lucide-zap)_.crm-chip]:text-warning">
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
          <Card key={k.label} className="h-full rounded-card border-border/60 bg-card shadow-card">
            <CardContent className="relative p-4 sm:p-5 flex h-full min-h-[132px] flex-col">
              <div className="crm-chip absolute right-4 top-4 sm:right-5 sm:top-5 flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary"><k.icon className="text-current" size={20} /></div>
              <div className="flex h-full min-w-0 flex-col">
                <p className="flex min-h-10 items-center pr-12 sm:pr-14 text-xs sm:min-h-11 sm:text-[13px] font-semibold leading-snug text-muted-foreground">{k.label}</p>
                <p className="mt-2 sm:mt-3 text-[30px] sm:text-[34px] font-bold leading-none tracking-tight tabular-nums text-foreground">{loading ? "…" : k.value.toLocaleString("pt-BR")}</p>
                {k.sub && !loading && <p className="mt-auto pt-2.5 text-xs leading-snug text-tertiary">{k.sub}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 lg:gap-6">
      {/* Bots */}
      <Card className="flex min-w-0 flex-col rounded-card border-border/60 shadow-card">
        <CardHeader className="p-5 sm:p-6 pb-3 sm:pb-4 space-y-1.5">
          <CardTitle className="text-base font-semibold flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Bot size={18} /></span> Execuções concluídas por Bot</CardTitle>
          <p className="text-[13px] leading-relaxed text-muted-foreground">Execuções de bot concluídas com sucesso no período (uma execução pode enviar várias mensagens).</p>
        </CardHeader>
        <CardContent className="mt-auto h-[320px] px-3 sm:px-5 pb-5 [&>p]:grid [&>p]:h-full [&>p]:place-items-center [&>p]:rounded-xl [&>p]:bg-surface-sunken/60 [&>p]:text-center [&_.recharts-bar_.recharts-rectangle]:[clip-path:inset(0_max(0px,calc(50%-22px)))_fill-box]">
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
      <Card className="flex min-w-0 flex-col rounded-card border-border/60 shadow-card">
        <CardHeader className="p-5 sm:p-6 pb-3 sm:pb-4 space-y-1.5">
          <CardTitle className="text-base font-semibold flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-soft text-purple"><Sparkles size={18} /></span> Uso da IA ({nomeAssistente})</CardTitle>
          <p className="text-[13px] leading-relaxed text-muted-foreground">Volumes por tipo: sugestões, análises, exemplos e transcrições automáticas de áudio.</p>
        </CardHeader>
        <CardContent className="mt-auto h-[320px] px-3 sm:px-5 pb-5 [&>p]:grid [&>p]:h-full [&>p]:place-items-center [&>p]:rounded-xl [&>p]:bg-surface-sunken/60 [&>p]:text-center">
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
                  <Bar key={m} dataKey={m} fill={COLORS[i % COLORS.length]} maxBarSize={48} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>



      {/* Automações */}
      <Card className="flex min-w-0 flex-col rounded-card border-border/60 shadow-card">
        <CardHeader className="p-5 sm:p-6 pb-3 sm:pb-4 space-y-1.5">
          <CardTitle className="text-base font-semibold flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning"><Zap size={18} /></span> Automações executadas</CardTitle>
          <p className="text-[13px] leading-relaxed text-muted-foreground">Ações efetivamente executadas por gatilhos, agrupadas por tipo.</p>
        </CardHeader>
        <CardContent className="mt-auto h-[320px] px-3 sm:px-5 pb-5 [&>p]:grid [&>p]:h-full [&>p]:place-items-center [&>p]:rounded-xl [&>p]:bg-surface-sunken/60 [&>p]:text-center [&_.recharts-bar_.recharts-rectangle]:[clip-path:inset(0_max(0px,calc(50%-22px)))_fill-box]">
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
    </div>
  );
};

export default CrmMetricas;

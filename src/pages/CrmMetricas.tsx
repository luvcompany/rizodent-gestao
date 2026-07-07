import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateISO } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Sparkles, Send, Zap } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from "recharts";

type UsageData = {
  respostas_por_bot: Array<{ bot_name: string; mes: string; total: number; concluidos: number }>;
  uso_ia: Array<{ mes: string; mode: string; total: number; leads: number }>;
  automacoes: Array<{ mes: string; action_type: string; enviados: number; total: number }>;
  broadcasts: Array<{ mes: string; campanhas: number; enviados: number }>;
};

// IMPORTANTE: usar meio-dia LOCAL para não recuar 1 dia/mês em fusos negativos (BRT).
const fmtMes = (iso: string) => {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

const fmtDia = (iso: string) => {
  const d = new Date(iso + "T12:00:00");
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

const rangeFromPreset = (p: Preset): { from: Date; to: Date; granularity: "day" | "month" } => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  switch (p) {
    case "current_month":
      return { from: startOfMonth(today), to: today, granularity: "day" };
    case "last_month": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
      return { from, to, granularity: "day" };
    }
    case "last_30": {
      const from = new Date(today); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
      return { from, to: today, granularity: "day" };
    }
    case "last_60": {
      const from = new Date(today); from.setDate(from.getDate() - 59); from.setHours(0, 0, 0, 0);
      return { from, to: today, granularity: "day" };
    }
    case "last_90": {
      const from = new Date(today); from.setDate(from.getDate() - 89); from.setHours(0, 0, 0, 0);
      return { from, to: today, granularity: "day" };
    }
    case "last_6m": {
      const from = startOfMonth(today); from.setMonth(from.getMonth() - 5);
      return { from, to: today, granularity: "month" };
    }
    case "last_12m": {
      const from = startOfMonth(today); from.setMonth(from.getMonth() - 11);
      return { from, to: today, granularity: "month" };
    }
    case "ytd": {
      const from = new Date(today.getFullYear(), 0, 1);
      return { from, to: today, granularity: "month" };
    }
  }
};

const CrmMetricas = () => {
  const [preset, setPreset] = useState<Preset>("current_month");
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const { from, to, granularity } = useMemo(() => rangeFromPreset(preset), [preset]);
  const fmtEixo = granularity === "day" ? fmtDia : fmtMes;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const toIso = toLocalDateISO(to);
      const fromIso = toLocalDateISO(from);
      const { data: res, error } = await (supabase as any).rpc("crm_usage_metrics", {
        p_from: fromIso, p_to: toIso,
      });
      if (!error && res) setData(res as UsageData);
      setLoading(false);
    };
    load();
  }, [from, to]);

  const kpis = useMemo(() => {
    if (!data) return { bots: 0, ia: 0, broadcasts: 0 };
    return {
      bots: data.respostas_por_bot.reduce((s, r) => s + Number(r.total), 0),
      ia: data.uso_ia.reduce((s, r) => s + Number(r.total), 0),
      broadcasts: data.broadcasts.reduce((s, r) => s + Number(r.enviados), 0),
    };
  }, [data]);

  // Aggregations for charts
  const botPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.respostas_por_bot.forEach((r) => {
      const key = r.mes;
      if (!map.has(key)) map.set(key, { mes: fmtEixo(key) });
      const row = map.get(key);
      const label = r.bot_name || "Sem nome";
      row[label] = (row[label] || 0) + Number(r.total);
    });
    return Array.from(map.values());
  }, [data, fmtEixo]);

  const botNames = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.respostas_por_bot.map((r) => r.bot_name || "Sem nome")));
  }, [data]);

  const iaPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.uso_ia.forEach((r) => {
      if (!map.has(r.mes)) map.set(r.mes, { mes: fmtEixo(r.mes) });
      const row = map.get(r.mes);
      const label = traduzir(r.mode, IA_MODE_LABELS);
      row[label] = (row[label] || 0) + Number(r.total);
    });
    return Array.from(map.values());
  }, [data, fmtEixo]);

  const iaModes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.uso_ia.map((r) => traduzir(r.mode, IA_MODE_LABELS))));
  }, [data]);


  const autoPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.automacoes.forEach((r) => {
      if (!map.has(r.mes)) map.set(r.mes, { mes: fmtEixo(r.mes) });
      const row = map.get(r.mes);
      const label = traduzir(r.action_type, ACTION_TYPE_LABELS);
      row[label] = (row[label] || 0) + Number(r.enviados);
    });
    return Array.from(map.values());
  }, [data, fmtEixo]);

  const autoTypes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.automacoes.map((r) => traduzir(r.action_type, ACTION_TYPE_LABELS))));
  }, [data]);

  const bcPorMes = useMemo(
    () => (data?.broadcasts || []).map((r) => ({
      mes: fmtEixo(r.mes), Campanhas: Number(r.campanhas), "Mensagens enviadas": Number(r.enviados),
    })),
    [data, fmtEixo],
  );

  const COLORS = ["hsl(var(--primary))", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

  const periodoLabel = `${from.toLocaleDateString("pt-BR")} — ${to.toLocaleDateString("pt-BR")}`;

  return (
    <div className="animate-fade-in space-y-6 overflow-y-auto h-full pr-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Métricas de Uso</h1>
          <p className="text-sm text-muted-foreground">
            Bots, IA, Automações e Transmissões · <span className="font-medium">{periodoLabel}</span>
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

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Execuções de Bot", value: kpis.bots, icon: Bot },
          { label: "Interações com a IA", value: kpis.ia, icon: Sparkles },
          { label: "Mensagens em Transmissões", value: kpis.broadcasts, icon: Send },
        ].map((k) => (
          <Card key={k.label} className="gradient-card shadow-card">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="rounded-lg bg-primary/10 p-3"><k.icon className="text-primary" size={20} /></div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-2xl font-bold">{loading ? "…" : k.value.toLocaleString("pt-BR")}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bots */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bot size={16} /> Respostas por Bot</CardTitle>
          <p className="text-xs text-muted-foreground">Quantas mensagens cada bot enviou no período.</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {botPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados no período.</p>
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
          <p className="text-xs text-muted-foreground">Interações agrupadas por tipo (sugestão, transcrição, análise, etc).</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {iaPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados no período.</p>
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
          <p className="text-xs text-muted-foreground">Ações disparadas por gatilhos, agrupadas por tipo.</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {autoPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados no período.</p>
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

      {/* Broadcasts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Send size={16} /> Transmissões (Broadcasts)</CardTitle>
          <p className="text-xs text-muted-foreground">Campanhas disparadas e total de mensagens enviadas.</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {bcPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bcPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Bar dataKey="Campanhas" fill={COLORS[2]} />
                <Bar dataKey="Mensagens enviadas" fill={COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CrmMetricas;

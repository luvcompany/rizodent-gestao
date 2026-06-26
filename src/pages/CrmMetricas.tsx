import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Sparkles, Send, RefreshCw, Zap } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from "recharts";

type UsageData = {
  respostas_por_bot: Array<{ bot_name: string; mes: string; total: number; concluidos: number }>;
  uso_ia: Array<{ mes: string; mode: string; total: number; leads: number }>;
  followups: Array<{ mes: string; d1: number; d2: number }>;
  automacoes: Array<{ mes: string; action_type: string; enviados: number; total: number }>;
  broadcasts: Array<{ mes: string; campanhas: number; enviados: number }>;
};

const fmtMes = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

const CrmMetricas = () => {
  const [months, setMonths] = useState<3 | 6 | 12>(6);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const to = new Date();
      const from = new Date();
      from.setMonth(from.getMonth() - months + 1);
      from.setDate(1);
      const toIso = to.toISOString().slice(0, 10);
      const fromIso = from.toISOString().slice(0, 10);
      const { data: res, error } = await (supabase as any).rpc("crm_usage_metrics", {
        p_from: fromIso, p_to: toIso,
      });
      if (!error && res) setData(res as UsageData);
      setLoading(false);
    };
    load();
  }, [months]);

  const kpis = useMemo(() => {
    if (!data) return { bots: 0, ia: 0, followups: 0, broadcasts: 0 };
    return {
      bots: data.respostas_por_bot.reduce((s, r) => s + Number(r.total), 0),
      ia: data.uso_ia.reduce((s, r) => s + Number(r.total), 0),
      followups: data.followups.reduce((s, r) => s + Number(r.d1) + Number(r.d2), 0),
      broadcasts: data.broadcasts.reduce((s, r) => s + Number(r.enviados), 0),
    };
  }, [data]);

  // Aggregations for charts
  const botPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.respostas_por_bot.forEach((r) => {
      const key = r.mes;
      if (!map.has(key)) map.set(key, { mes: fmtMes(key) });
      const row = map.get(key);
      row[r.bot_name] = (row[r.bot_name] || 0) + Number(r.total);
    });
    return Array.from(map.values());
  }, [data]);

  const botNames = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.respostas_por_bot.map((r) => r.bot_name)));
  }, [data]);

  const iaPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.uso_ia.forEach((r) => {
      if (!map.has(r.mes)) map.set(r.mes, { mes: fmtMes(r.mes) });
      const row = map.get(r.mes);
      row[r.mode] = (row[r.mode] || 0) + Number(r.total);
    });
    return Array.from(map.values());
  }, [data]);

  const iaModes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.uso_ia.map((r) => r.mode || "—")));
  }, [data]);

  const fuPorMes = useMemo(
    () => (data?.followups || []).map((r) => ({ mes: fmtMes(r.mes), d1: Number(r.d1), d2: Number(r.d2) })),
    [data],
  );

  const autoPorMes = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    data.automacoes.forEach((r) => {
      if (!map.has(r.mes)) map.set(r.mes, { mes: fmtMes(r.mes) });
      const row = map.get(r.mes);
      row[r.action_type] = (row[r.action_type] || 0) + Number(r.enviados);
    });
    return Array.from(map.values());
  }, [data]);

  const autoTypes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.automacoes.map((r) => r.action_type)));
  }, [data]);

  const bcPorMes = useMemo(
    () => (data?.broadcasts || []).map((r) => ({
      mes: fmtMes(r.mes), campanhas: Number(r.campanhas), enviados: Number(r.enviados),
    })),
    [data],
  );

  const COLORS = ["hsl(var(--primary))", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

  return (
    <div className="animate-fade-in space-y-6 overflow-y-auto h-full pr-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Métricas de Uso</h1>
          <p className="text-sm text-muted-foreground">Bots, IA, Follow-ups, Automações e Transmissões</p>
        </div>
        <Select value={String(months)} onValueChange={(v) => setMonths(Number(v) as 3 | 6 | 12)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Execuções de Bot", value: kpis.bots, icon: Bot },
          { label: "Análises de IA", value: kpis.ia, icon: Sparkles },
          { label: "Follow-ups enviados", value: kpis.followups, icon: RefreshCw },
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
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bot size={16} /> Respostas por Bot / mês</CardTitle></CardHeader>
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
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Sparkles size={16} /> Uso da IA por modo / mês</CardTitle></CardHeader>
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

      {/* Follow-ups */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><RefreshCw size={16} /> Follow-ups enviados / mês</CardTitle></CardHeader>
        <CardContent className="h-[320px]">
          {fuPorMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fuPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Line type="monotone" dataKey="d1" name="Disparo 1" stroke={COLORS[0]} strokeWidth={2} />
                <Line type="monotone" dataKey="d2" name="Disparo 2" stroke={COLORS[1]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Automações */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap size={16} /> Automações enviadas por tipo / mês</CardTitle></CardHeader>
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
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Send size={16} /> Transmissões / mês</CardTitle></CardHeader>
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
                <Bar dataKey="campanhas" name="Campanhas" fill={COLORS[2]} />
                <Bar dataKey="enviados" name="Mensagens enviadas" fill={COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CrmMetricas;

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

type AccessLog = {
  id: string;
  user_id: string | null;
  email: string | null;
  tenant_id: string | null;
  context: string | null;
  event: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  metadata: any;
};

const eventLabels: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  login_failed: "Falha no login",
  login_blocked: "Login bloqueado",
  user_blocked: "Usuário bloqueado",
  user_unblocked: "Usuário desbloqueado",
};

import { PageHeader, StatusPill, type SemanticTone } from "@/components/crm-ui";

const eventTone: Record<string, SemanticTone> = {
  login: "success", logout: "slate", login_failed: "warning",
  login_blocked: "destructive", user_blocked: "destructive", user_unblocked: "success",
};

const AcessosLog = () => {
  const { tenant } = useTenant();
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let query = supabase
        .from("access_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data } = await query;
      if (!cancelled) {
        setLogs((data as any as AccessLog[]) || []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (q && !(l.email || "").toLowerCase().includes(q)) return false;
      if (eventFilter === "all") return true;
      if (eventFilter === "logins") return l.event === "login" || l.event === "logout";
      if (eventFilter === "falhas") return l.event === "login_failed";
      if (eventFilter === "bloqueios")
        return l.event === "login_blocked" || l.event === "user_blocked" || l.event === "user_unblocked";
      return true;
    });
  }, [logs, search, eventFilter]);

  return (
    <div className="space-y-6">
      <PageHeader title="Logs de acesso" subtitle="Histórico de acessos, tentativas falhas e bloqueios da sua equipe." />

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder="Buscar por e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="sm:max-w-xs">
              <SelectValue placeholder="Tipo de evento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os eventos</SelectItem>
              <SelectItem value="logins">Logins / Logouts</SelectItem>
              <SelectItem value="falhas">Tentativas falhas</SelectItem>
              <SelectItem value="bloqueios">Bloqueios</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/60">
        <CardHeader>
          <CardTitle className="text-base">
            Registros {loading ? "" : `(${filtered.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum registro encontrado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Dispositivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(l.created_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm">{l.email || "—"}</TableCell>
                      <TableCell>
                        <StatusPill tone={eventTone[l.event] || "slate"}>
                          {eventLabels[l.event] || l.event}
                        </StatusPill>
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground max-w-[360px] truncate"
                        title={l.user_agent || ""}
                      >
                        {l.user_agent || "—"}
                      </TableCell>
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
};

export default AcessosLog;

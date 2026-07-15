import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Search, Shield, User } from "lucide-react";

type LogRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  tenant_id: string | null;
  context: string;
  event: string;
  ip: string | null;
  user_agent: string | null;
  metadata: any;
  created_at: string;
};

type ProfileRow = {
  id: string;
  nome: string | null;
  email: string | null;
  tenant_id: string | null;
  is_blocked: boolean;
  blocked_at: string | null;
};

type TenantRow = { id: string; name: string };

const PAGE_SIZE = 50;

export const AdminLogs = () => {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [tenantList, setTenantList] = useState<TenantRow[]>([]);
  const [tenants, setTenants] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"logs" | "users">("logs");
  const [filter, setFilter] = useState("");
  const [contextFilter, setContextFilter] = useState<"all" | "admin" | "client">("all");

  // filtros server-side (logs)
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Carrega listas fixas (clientes + perfis) uma vez
  const loadStatic = useCallback(async () => {
    const [pr, tn] = await Promise.all([
      supabase.from("profiles").select("id, nome, email, tenant_id, is_blocked, blocked_at").order("nome"),
      (supabase as any).from("tenants").select("id, name").order("name"),
    ]);
    setProfiles((pr.data as any) || []);
    const list = ((tn.data as any) || []) as TenantRow[];
    setTenantList(list);
    const tmap: Record<string, string> = {};
    list.forEach((t) => { tmap[t.id] = t.name; });
    setTenants(tmap);
  }, []);

  // Carrega logs com filtros server-side + paginação por range
  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    let query = (supabase as any)
      .from("access_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (tenantFilter !== "all") query = query.eq("tenant_id", tenantFilter);
    if (contextFilter !== "all") query = query.eq("context", contextFilter);
    if (dateFrom) query = query.gte("created_at", new Date(`${dateFrom}T00:00:00`).toISOString());
    if (dateTo) query = query.lte("created_at", new Date(`${dateTo}T23:59:59.999`).toISOString());

    const fromIdx = page * PAGE_SIZE;
    const toIdx = fromIdx + PAGE_SIZE - 1;
    const { data, count, error } = await query.range(fromIdx, toIdx);
    setLoadingLogs(false);
    if (error) { toast.error(error.message); return; }
    setLogs((data as any) || []);
    setTotal(count ?? 0);
  }, [tenantFilter, contextFilter, dateFrom, dateTo, page]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  // Ao mudar qualquer filtro, volta para a primeira página
  useEffect(() => { setPage(0); }, [tenantFilter, contextFilter, dateFrom, dateTo]);

  const toggleBlock = async (p: ProfileRow) => {
    const next = !p.is_blocked;
    const { error } = await supabase
      .from("profiles")
      .update({
        is_blocked: next,
        blocked_at: next ? new Date().toISOString() : null,
      } as any)
      .eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    toast.success(next ? `${p.nome ?? p.email} bloqueado` : `${p.nome ?? p.email} desbloqueado`);
    loadStatic();
  };

  // Busca textual (email) aplicada sobre a página atual carregada do servidor
  const filteredLogs = logs.filter((l) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (l.email ?? "").toLowerCase().includes(q) || (tenants[l.tenant_id ?? ""] ?? "").toLowerCase().includes(q);
  });

  const filteredUsers = profiles.filter((p) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (p.nome ?? "").toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q);
  });

  const eventBadge = (ev: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      login: { label: "Login", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
      login_failed: { label: "Login falhou", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
      login_blocked: { label: "Login bloqueado", cls: "bg-red-500/20 text-red-300 border-red-500/40" },
      impersonate: { label: "Impersonar", cls: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
      tenant_delete: { label: "Cliente excluído", cls: "bg-red-500/20 text-red-300 border-red-500/40" },
      tenant_soft_delete: { label: "Cliente p/ lixeira", cls: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
      tenant_restore: { label: "Cliente restaurado", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
      tenant_hard_delete: { label: "Cliente apagado", cls: "bg-red-600/20 text-red-300 border-red-600/50" },
      user_block: { label: "Usuário bloqueado", cls: "bg-red-500/20 text-red-300 border-red-500/40" },
      user_unblock: { label: "Usuário desbloqueado", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
      user_reset_password: { label: "Senha redefinida", cls: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
      user_set_role: { label: "Papel alterado", cls: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
      user_set_email: { label: "E-mail alterado", cls: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
      user_delete: { label: "Usuário excluído", cls: "bg-red-500/20 text-red-300 border-red-500/40" },
    };
    const m = map[ev] ?? { label: ev, cls: "bg-slate-500/20 text-slate-300 border-slate-500/40" };
    return <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>;
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  const clearLogFilters = () => {
    setTenantFilter("all");
    setContextFilter("all");
    setDateFrom("");
    setDateTo("");
    setFilter("");
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Logs de acesso</h1>
        <p className="text-sm text-slate-400">Auditoria de quem acessou o painel admin e os clientes. Bloqueie usuários quando necessário.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-slate-800 bg-slate-900/40 p-1">
          <button onClick={() => setTab("logs")} className={`px-3 py-1.5 text-sm rounded ${tab === "logs" ? "bg-blue-500/20 text-blue-200" : "text-slate-400"}`}>Histórico</button>
          <button onClick={() => setTab("users")} className={`px-3 py-1.5 text-sm rounded ${tab === "users" ? "bg-blue-500/20 text-blue-200" : "text-slate-400"}`}>Usuários ({profiles.filter((p) => p.is_blocked).length} bloqueados)</button>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar nesta página..." className="pl-7 bg-slate-900 border-slate-800 text-slate-100" />
        </div>
      </div>

      {tab === "logs" ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Cliente</label>
              <select
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
                className="rounded-md border border-slate-800 bg-slate-900 px-2 py-2 text-sm text-slate-100"
              >
                <option value="all">Todos os clientes</option>
                {tenantList.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Contexto</label>
              <select
                value={contextFilter}
                onChange={(e) => setContextFilter(e.target.value as any)}
                className="rounded-md border border-slate-800 bg-slate-900 px-2 py-2 text-sm text-slate-100"
              >
                <option value="all">Todos os contextos</option>
                <option value="admin">Admin CRClin</option>
                <option value="client">Cliente</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">De</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-slate-900 border-slate-800 text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Até</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-slate-900 border-slate-800 text-slate-100" />
            </div>
            <Button variant="outline" size="sm" onClick={clearLogFilters} className="border-slate-700">Limpar filtros</Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-slate-400">
                <tr>
                  <th className="p-3 text-left">Data/Hora</th>
                  <th className="p-3 text-left">Usuário</th>
                  <th className="p-3 text-left">Cliente</th>
                  <th className="p-3 text-left">Contexto</th>
                  <th className="p-3 text-left">Evento</th>
                  <th className="p-3 text-left">Dispositivo</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="border-t border-slate-800 hover:bg-slate-900/40">
                    <td className="p-3 whitespace-nowrap text-slate-300">{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                    <td className="p-3 text-slate-100">{l.email ?? "—"}</td>
                    <td className="p-3 text-slate-300">{tenants[l.tenant_id ?? ""] ?? "—"}</td>
                    <td className="p-3"><span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${l.context === "admin" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-slate-700 bg-slate-800 text-slate-300"}`}>{l.context === "admin" ? <Shield size={12} /> : <User size={12} />} {l.context}</span></td>
                    <td className="p-3">{eventBadge(l.event)}</td>
                    <td className="p-3 text-xs text-slate-500 max-w-[280px] truncate" title={l.user_agent ?? ""}>{l.user_agent ?? "—"}</td>
                  </tr>
                ))}
                {!loadingLogs && filteredLogs.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhum registro encontrado.</td></tr>
                )}
                {loadingLogs && (
                  <tr><td colSpan={6} className="p-6 text-center text-slate-500">Carregando...</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
            <span>
              {total > 0 ? `${rangeStart}–${rangeEnd} de ${total}` : "0 registros"}
              {filter && filteredLogs.length !== logs.length ? ` · ${filteredLogs.length} nesta página após busca` : ""}
            </span>
            <div className="flex items-center gap-2">
              <span>Página {page + 1} de {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700"
                disabled={page === 0 || loadingLogs}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={14} /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700"
                disabled={page + 1 >= totalPages || loadingLogs}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-2">
          {filteredUsers.map((p) => (
            <Card key={p.id} className="flex items-center justify-between border-slate-800 bg-slate-900/40 p-4 text-slate-100">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${p.is_blocked ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                  {p.is_blocked ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                </div>
                <div>
                  <p className="font-semibold">{p.nome ?? p.email}</p>
                  <p className="text-xs text-slate-400">{p.email} · {tenants[p.tenant_id ?? ""] ?? "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={p.is_blocked ? "destructive" : "default"}>{p.is_blocked ? "Bloqueado" : "Ativo"}</Badge>
                <Button size="sm" variant={p.is_blocked ? "outline" : "destructive"} onClick={() => toggleBlock(p)}>
                  {p.is_blocked ? "Desbloquear" : "Bloquear"}
                </Button>
              </div>
            </Card>
          ))}
          {filteredUsers.length === 0 && <p className="text-slate-500">Nenhum usuário.</p>}
        </div>
      )}
    </div>
  );
};

export default AdminLogs;

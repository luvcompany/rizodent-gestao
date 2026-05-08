import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Ban, CheckCircle2, Search, Shield, User } from "lucide-react";

type LogRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  tenant_id: string | null;
  context: string;
  event: string;
  ip: string | null;
  user_agent: string | null;
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

export const AdminLogs = () => {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [tenants, setTenants] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"logs" | "users">("logs");
  const [filter, setFilter] = useState("");
  const [contextFilter, setContextFilter] = useState<"all" | "admin" | "client">("all");

  const load = async () => {
    const [lg, pr, tn] = await Promise.all([
      (supabase as any).from("access_logs").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("profiles").select("id, nome, email, tenant_id, is_blocked, blocked_at").order("nome"),
      (supabase as any).from("tenants").select("id, name"),
    ]);
    setLogs((lg.data as any) || []);
    setProfiles((pr.data as any) || []);
    const tmap: Record<string, string> = {};
    ((tn.data as any) || []).forEach((t: any) => { tmap[t.id] = t.name; });
    setTenants(tmap);
  };

  useEffect(() => { load(); }, []);

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
    load();
  };

  const filteredLogs = logs.filter(l => {
    if (contextFilter !== "all" && l.context !== contextFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (l.email ?? "").toLowerCase().includes(q) || (tenants[l.tenant_id ?? ""] ?? "").toLowerCase().includes(q);
  });

  const filteredUsers = profiles.filter(p => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (p.nome ?? "").toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q);
  });

  const eventBadge = (ev: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      login: { label: "Login", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
      logout: { label: "Logout", cls: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
      login_blocked: { label: "Bloqueado", cls: "bg-red-500/20 text-red-300 border-red-500/40" },
      login_failed: { label: "Falhou", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
    };
    const m = map[ev] ?? { label: ev, cls: "bg-slate-500/20 text-slate-300" };
    return <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>;
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
          <button onClick={() => setTab("users")} className={`px-3 py-1.5 text-sm rounded ${tab === "users" ? "bg-blue-500/20 text-blue-200" : "text-slate-400"}`}>Usuários ({profiles.filter(p=>p.is_blocked).length} bloqueados)</button>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar..." className="pl-7 bg-slate-900 border-slate-800 text-slate-100" />
        </div>
        {tab === "logs" && (
          <select value={contextFilter} onChange={(e) => setContextFilter(e.target.value as any)} className="rounded-md border border-slate-800 bg-slate-900 px-2 py-2 text-sm text-slate-100">
            <option value="all">Todos os contextos</option>
            <option value="admin">Admin CRClin</option>
            <option value="client">Cliente</option>
          </select>
        )}
      </div>

      {tab === "logs" ? (
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
              {filteredLogs.map(l => (
                <tr key={l.id} className="border-t border-slate-800 hover:bg-slate-900/40">
                  <td className="p-3 whitespace-nowrap text-slate-300">{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                  <td className="p-3 text-slate-100">{l.email ?? "—"}</td>
                  <td className="p-3 text-slate-300">{tenants[l.tenant_id ?? ""] ?? "—"}</td>
                  <td className="p-3"><span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${l.context === "admin" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-slate-700 bg-slate-800 text-slate-300"}`}>{l.context === "admin" ? <Shield size={12} /> : <User size={12} />} {l.context}</span></td>
                  <td className="p-3">{eventBadge(l.event)}</td>
                  <td className="p-3 text-xs text-slate-500 max-w-[280px] truncate" title={l.user_agent ?? ""}>{l.user_agent ?? "—"}</td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhum registro encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-2">
          {filteredUsers.map(p => (
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

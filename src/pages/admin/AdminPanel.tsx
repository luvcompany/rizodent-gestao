import { useEffect, useState } from "react";
import { useNavigate, NavLink, Outlet, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Building2, CreditCard, BarChart3, Receipt, LogOut, Plus, Loader2, ShieldAlert } from "lucide-react";

const navItems = [
  { to: "/admin", icon: Building2, label: "Clientes", end: true },
  { to: "/admin/planos", icon: CreditCard, label: "Planos" },
  { to: "/admin/metricas", icon: BarChart3, label: "Métricas" },
  { to: "/admin/cobranca", icon: Receipt, label: "Cobrança" },
  { to: "/admin/logs", icon: ShieldAlert, label: "Logs & Acesso" },
];

export const AdminLayout = () => {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [isSuper, setIsSuper] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) { navigate("/admin/login", { replace: true }); return; }
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "superadmin" as any).maybeSingle()
      .then(({ data }) => {
        if (!data) navigate("/admin/login", { replace: true });
        else setIsSuper(true);
      });
  }, [user, navigate]);

  if (isSuper === null) return <div className="flex h-screen items-center justify-center text-muted-foreground">Verificando acesso...</div>;

  return (
    <div className="dark flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-60 border-r border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-orange-500 to-amber-400 font-black text-slate-950">C</div>
          <span className="font-bold tracking-tight">CRClin Admin</span>
        </div>
        <nav className="space-y-1">
          {navItems.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}
              className={({ isActive }) => `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/30" : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"}`}>
              <it.icon size={16} /> {it.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={async () => { await signOut(); navigate("/admin/login"); }}
          className="mt-8 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-100">
          <LogOut size={16} /> Sair
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-8"><Outlet /></main>
    </div>
  );
};

export const AdminClientes = () => {
  const [tenants, setTenants] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", primary_color: "#f97316", secondary_color: "#fb923c", tertiary_color: "#ffedd5", admin_name: "", admin_email: "", admin_password: "" });

  const load = async () => {
    const { data } = await (supabase as any).from("tenants").select("*").order("created_at", { ascending: false });
    setTenants(data || []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name || !form.slug || !form.admin_email || !form.admin_password) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-create-tenant", { body: form });
    setLoading(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || "Erro"); return; }
    toast.success(`Cliente ${form.name} criado! Link: ${form.slug}.crclin.com.br`);
    setOpen(false);
    setForm({ name: "", slug: "", primary_color: "#f97316", secondary_color: "#fb923c", tertiary_color: "#ffedd5", admin_name: "", admin_email: "", admin_password: "" });
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-slate-400">Gerencie todos os clientes da plataforma CRClin.</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-gradient-to-r from-orange-500 to-amber-400 text-slate-950 hover:opacity-90"><Plus size={16} /> Novo cliente</Button>
      </div>

      <div className="grid gap-3">
        {tenants.map((t) => (
          <Card key={t.id} className="flex items-center justify-between border-slate-800 bg-slate-900/40 p-4 text-slate-100">
            <Link to={`/admin/clientes/${t.id}`} className="flex flex-1 items-center gap-3 hover:opacity-80">
              {t.logo_url ? <img src={t.logo_url} alt="" className="h-10 w-10 rounded object-contain" /> :
                <div className="flex h-10 w-10 items-center justify-center rounded font-bold" style={{ background: t.primary_color }}>{t.name[0]}</div>}
              <div>
                <p className="font-semibold">{t.name}</p>
                <p className="text-xs text-slate-400">{t.slug}.crclin.com.br · criado em {new Date(t.created_at).toLocaleDateString("pt-BR")}</p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <Badge variant={t.status === "active" ? "default" : "secondary"}>{t.status}</Badge>
              <Button asChild size="sm" variant="outline"><Link to={`/admin/clientes/${t.id}`}>Gerenciar</Link></Button>
            </div>
          </Card>
        ))}
        {tenants.length === 0 && <p className="text-slate-500">Nenhum cliente ainda.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome da clínica/empresa</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Slug (subdomínio)</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="ex: clinicaxyz" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Cor primária</Label><Input type="color" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} className="h-10 w-full p-1" /></div>
              <div><Label>Cor secundária</Label><Input type="color" value={form.secondary_color} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} className="h-10 w-full p-1" /></div>
              <div><Label>Cor terciária</Label><Input type="color" value={form.tertiary_color} onChange={(e) => setForm({ ...form, tertiary_color: e.target.value })} className="h-10 w-full p-1" /></div>
            </div>
            <div className="border-t border-slate-800 pt-3"><p className="mb-2 text-sm font-semibold">Primeiro usuário (admin do cliente)</p></div>
            <div><Label>Nome</Label><Input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} /></div>
            <div><Label>Senha temporária</Label><Input value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} placeholder="Mínimo 6 caracteres" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create} disabled={loading}>{loading && <Loader2 className="mr-2 animate-spin" size={14} />} Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const AdminPlanos = () => {
  const [plans, setPlans] = useState<any[]>([]);
  useEffect(() => { (supabase as any).from("plans").select("*").order("monthly_price").then(({ data }: any) => setPlans(data || [])); }, []);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Planos</h1>
      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className="border-slate-800 bg-slate-900/40 p-5 text-slate-100">
            <p className="text-lg font-bold">{p.name}</p>
            <p className="my-2 text-2xl text-cyan-300">R$ {Number(p.monthly_price).toFixed(2)}<span className="text-sm text-slate-500">/mês</span></p>
            <ul className="space-y-1 text-sm text-slate-400">
              <li>{p.user_limit} usuários</li>
              <li>{p.lead_limit.toLocaleString("pt-BR")} leads</li>
              <li>{p.message_limit.toLocaleString("pt-BR")} mensagens/mês</li>
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
};

export const AdminMetricas = () => {
  const [usage, setUsage] = useState<any[]>([]);
  useEffect(() => { (supabase as any).from("tenant_usage").select("*, tenants(name)").order("month", { ascending: false }).limit(50).then(({ data }: any) => setUsage(data || [])); }, []);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Métricas de uso</h1>
      {usage.length === 0 ? <p className="text-slate-500">Sem dados de uso ainda.</p> : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60"><tr><th className="p-3 text-left">Cliente</th><th className="p-3 text-left">Mês</th><th className="p-3 text-right">Leads</th><th className="p-3 text-right">Mensagens</th></tr></thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id} className="border-t border-slate-800"><td className="p-3">{u.tenants?.name}</td><td className="p-3">{u.month}</td><td className="p-3 text-right">{u.leads_created}</td><td className="p-3 text-right">{u.messages_sent}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const AdminCobranca = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const load = () => (supabase as any).from("tenant_invoices").select("*, tenants(name)").order("created_at", { ascending: false }).then(({ data }: any) => setInvoices(data || []));
  useEffect(() => { load(); }, []);
  const togglePaid = async (inv: any) => {
    await (supabase as any).from("tenant_invoices").update({ status: inv.status === "paid" ? "open" : "paid", paid_at: inv.status === "paid" ? null : new Date().toISOString() }).eq("id", inv.id);
    load();
  };
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Cobrança</h1>
      {invoices.length === 0 ? <p className="text-slate-500">Sem faturas ainda. Faturas serão geradas automaticamente conforme as assinaturas.</p> : (
        <div className="grid gap-2">
          {invoices.map((i) => (
            <Card key={i.id} className="flex items-center justify-between border-slate-800 bg-slate-900/40 p-4 text-slate-100">
              <div><p className="font-semibold">{i.tenants?.name}</p><p className="text-xs text-slate-400">Ref: {i.reference_month}</p></div>
              <div className="flex items-center gap-3">
                <span className="font-mono">R$ {Number(i.amount).toFixed(2)}</span>
                <Badge variant={i.status === "paid" ? "default" : "secondary"}>{i.status}</Badge>
                <Button size="sm" variant="outline" onClick={() => togglePaid(i)}>{i.status === "paid" ? "Marcar aberta" : "Marcar paga"}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminLayout;

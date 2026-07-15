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
import { Building2, CreditCard, BarChart3, Receipt, LogOut, Plus, Loader2, ShieldAlert, Trash2, LayoutDashboard, Users, MessageSquare, TrendingUp, DollarSign, Pencil, RefreshCw } from "lucide-react";

const navItems = [
  { to: "/admin/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/admin", icon: Building2, label: "Clientes", end: true },
  { to: "/admin/planos", icon: CreditCard, label: "Planos" },
  { to: "/admin/metricas", icon: BarChart3, label: "Métricas" },
  { to: "/admin/cobranca", icon: Receipt, label: "Cobrança" },
  { to: "/admin/logs", icon: ShieldAlert, label: "Logs & Acesso" },
];

const getFunctionErrorMessage = async (data: unknown, error: unknown, fallback = "Erro ao processar") => {
  const dataError = (data as any)?.error;
  if (dataError) return String(dataError);

  const context = (error as any)?.context;
  if (context?.json) {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // Keep the original function error message below.
    }
  }

  return (error as any)?.message || fallback;
};

const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => Number(v || 0).toLocaleString("pt-BR");

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

export const AdminDashboard = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_platform_metrics");
    setLoading(false);
    if (error) { toast.error(error.message || "Erro ao carregar métricas"); return; }
    setMetrics(data || {});
  };

  useEffect(() => { load(); }, []);

  const cards = [
    { label: "MRR", value: metrics ? brl(metrics.mrr) : "—", icon: DollarSign, tint: "text-emerald-300", ring: "ring-emerald-500/20", bg: "bg-emerald-500/10" },
    { label: "Clientes ativos", value: metrics ? num(metrics.clients_active) : "—", icon: Building2, tint: "text-cyan-300", ring: "ring-cyan-500/20", bg: "bg-cyan-500/10" },
    { label: "Clientes pausados", value: metrics ? num(metrics.clients_paused) : "—", icon: Building2, tint: "text-amber-300", ring: "ring-amber-500/20", bg: "bg-amber-500/10" },
    { label: "Clientes excluídos", value: metrics ? num(metrics.clients_deleted) : "—", icon: Trash2, tint: "text-red-300", ring: "ring-red-500/20", bg: "bg-red-500/10" },
    { label: "Usuários", value: metrics ? num(metrics.users_total) : "—", icon: Users, tint: "text-violet-300", ring: "ring-violet-500/20", bg: "bg-violet-500/10" },
    { label: "Ativos (30 dias)", value: metrics ? num(metrics.users_active_30d) : "—", icon: TrendingUp, tint: "text-lime-300", ring: "ring-lime-500/20", bg: "bg-lime-500/10" },
    { label: "Leads do mês", value: metrics ? num(metrics.leads_month) : "—", icon: BarChart3, tint: "text-orange-300", ring: "ring-orange-500/20", bg: "bg-orange-500/10" },
    { label: "Mensagens do mês", value: metrics ? num(metrics.messages_month) : "—", icon: MessageSquare, tint: "text-sky-300", ring: "ring-sky-500/20", bg: "bg-sky-500/10" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-400">Visão geral da plataforma CRClin.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="border-slate-700 text-slate-200 hover:bg-slate-800">
          {loading ? <Loader2 className="mr-2 animate-spin" size={14} /> : <RefreshCw className="mr-2" size={14} />} Atualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="border-slate-800 bg-slate-900/40 p-5 text-slate-100">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">{c.label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-md ${c.bg} ring-1 ${c.ring}`}>
                <c.icon size={16} className={c.tint} />
              </div>
            </div>
            <p className={`mt-3 text-2xl font-bold ${loading ? "text-slate-600" : c.tint}`}>{loading ? "…" : c.value}</p>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Total de tenants na base: {metrics ? num(metrics.tenants_total) : "—"}.
      </p>
    </div>
  );
};

export const AdminClientes = () => {
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", primary_color: "#f97316", secondary_color: "#fb923c", tertiary_color: "#ffedd5", admin_name: "", admin_email: "", admin_password: "", clinic_name: "", clinic_city: "", plan_id: "" });

  const load = async () => {
    const q = (supabase as any).from("tenants").select("*").order("created_at", { ascending: false });
    const { data } = showTrash ? await q.eq("status", "deleted") : await q.neq("status", "deleted");
    setTenants(data || []);
  };

  const loadPlans = async () => {
    const { data } = await (supabase as any).from("plans").select("*").eq("is_active", true).order("monthly_price");
    setPlans(data || []);
  };

  const PROTECTED_SLUGS = ["rizodent"];
  const isProtected = (t: any) => PROTECTED_SLUGS.includes(String(t?.slug || "").toLowerCase());

  // "Excluir" = soft-delete (vai para a Lixeira, reversível).
  const handleDelete = async (t: any) => {
    if (isProtected(t)) { toast.error("Este cliente é protegido e não pode ser excluído."); return; }
    if (!confirm(`Enviar "${t.name}" para a Lixeira? O acesso é bloqueado na hora, mas os dados ficam guardados e você pode restaurar depois.`)) return;
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", { body: { tenant_id: t.id, action: "delete" } });
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error, "Erro ao excluir")); return; }
    toast.success(`"${t.name}" movido para a Lixeira`);
    load();
  };

  const handleRestore = async (t: any) => {
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", { body: { tenant_id: t.id, action: "restore" } });
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error, "Erro ao restaurar")); return; }
    toast.success(`"${t.name}" restaurado`);
    load();
  };

  const handleHardDelete = async (t: any) => {
    if (isProtected(t)) { toast.error("Este cliente é protegido e não pode ser excluído."); return; }
    const typed = prompt(`EXCLUSÃO DEFINITIVA e irreversível de "${t.name}" (apaga todos os dados e usuários).\n\nPara confirmar, digite o nome do cliente:`);
    if (typed === null) return;
    if (typed.trim() !== String(t.name).trim()) { toast.error("Nome não confere. Exclusão cancelada."); return; }
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", { body: { tenant_id: t.id, action: "hard_delete", confirm_name: typed } });
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error, "Erro ao excluir definitivamente")); return; }
    toast.success(`"${t.name}" excluído definitivamente`);
    load();
  };

  useEffect(() => { load(); }, [showTrash]);
  useEffect(() => { loadPlans(); }, []);

  const create = async () => {
    if (!form.name || !form.slug || !form.admin_email || !form.admin_password || !form.clinic_name) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    setLoading(true);
    const body: any = { ...form };
    if (!body.plan_id) delete body.plan_id;
    const { data, error } = await supabase.functions.invoke("admin-create-tenant", { body });
    setLoading(false);
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error, "Erro ao criar cliente")); return; }
    toast.success(`Cliente ${form.name} criado! Link: ${form.slug}.crclin.com.br`);
    setOpen(false);
    setForm({ name: "", slug: "", primary_color: "#f97316", secondary_color: "#fb923c", tertiary_color: "#ffedd5", admin_name: "", admin_email: "", admin_password: "", clinic_name: "", clinic_city: "", plan_id: "" });
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{showTrash ? "Lixeira" : "Clientes"}</h1>
          <p className="text-sm text-slate-400">{showTrash ? "Clientes excluídos — restaure ou apague em definitivo." : "Gerencie todos os clientes da plataforma CRClin."}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-slate-800 p-0.5">
            <button onClick={() => setShowTrash(false)} className={`rounded px-3 py-1.5 text-sm ${!showTrash ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>Ativos</button>
            <button onClick={() => setShowTrash(true)} className={`flex items-center gap-1 rounded px-3 py-1.5 text-sm ${showTrash ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}><Trash2 size={13} /> Lixeira</button>
          </div>
          {!showTrash && <Button onClick={() => setOpen(true)} className="bg-gradient-to-r from-orange-500 to-amber-400 text-slate-950 hover:opacity-90"><Plus size={16} /> Novo cliente</Button>}
        </div>
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
              {showTrash ? (
                <>
                  <Button size="sm" variant="outline" className="border-emerald-800 text-emerald-400 hover:bg-emerald-950" onClick={() => handleRestore(t)}>Restaurar</Button>
                  <Button size="sm" variant="outline" disabled={isProtected(t)} title={isProtected(t) ? "Cliente protegido" : "Excluir definitivamente"} className="border-red-900 text-red-400 hover:bg-red-950 disabled:opacity-40" onClick={() => handleHardDelete(t)}><Trash2 size={14} /></Button>
                </>
              ) : (
                <>
                  <Button asChild size="sm" variant="outline"><Link to={`/admin/clientes/${t.id}`}>Gerenciar</Link></Button>
                  <Button size="sm" variant="outline" disabled={isProtected(t)} title={isProtected(t) ? "Cliente protegido" : "Enviar para a Lixeira"} className="border-red-900 text-red-400 hover:bg-red-950 disabled:opacity-40" onClick={() => handleDelete(t)}><Trash2 size={14} /></Button>
                </>
              )}
            </div>
          </Card>
        ))}
        {tenants.length === 0 && <p className="text-slate-500">{showTrash ? "A Lixeira está vazia." : "Nenhum cliente ainda."}</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800 max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome da clínica/empresa</Label><Input className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Slug (subdomínio)</Label><Input className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="ex: clinicaxyz" /></div>
            <div>
              <Label>Plano</Label>
              <select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })} className="mt-1 flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100">
                <option value="">Sem plano (definir depois)</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {brl(p.monthly_price)}/mês</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Cor primária</Label><Input type="color" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} className="h-10 w-full p-1 bg-slate-800 border-slate-700" /></div>
              <div><Label>Cor secundária</Label><Input type="color" value={form.secondary_color} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} className="h-10 w-full p-1 bg-slate-800 border-slate-700" /></div>
              <div><Label>Cor terciária</Label><Input type="color" value={form.tertiary_color} onChange={(e) => setForm({ ...form, tertiary_color: e.target.value })} className="h-10 w-full p-1 bg-slate-800 border-slate-700" /></div>
            </div>
            <div className="border-t border-slate-800 pt-3"><p className="mb-2 text-sm font-semibold">Clínica principal</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome da clínica</Label><Input className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.clinic_name} onChange={(e) => setForm({ ...form, clinic_name: e.target.value })} placeholder="ex: Clínica Centro" /></div>
              <div><Label>Cidade</Label><Input className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.clinic_city} onChange={(e) => setForm({ ...form, clinic_city: e.target.value })} placeholder="ex: São Paulo" /></div>
            </div>
            <div className="border-t border-slate-800 pt-3"><p className="mb-2 text-sm font-semibold">Primeiro usuário (admin do cliente)</p></div>
            <div><Label>Nome</Label><Input className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} /></div>
            <div><Label>E-mail</Label><Input type="email" className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} /></div>
            <div><Label>Senha temporária</Label><Input className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} placeholder="Mínimo 6 caracteres" /></div>
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

const emptyPlan = { id: "", name: "", monthly_price: "", user_limit: "", lead_limit: "", message_limit: "", is_active: true };

export const AdminPlanos = () => {
  const [plans, setPlans] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(emptyPlan);
  const editing = Boolean(form.id);

  const load = async () => {
    const { data } = await (supabase as any).from("plans").select("*").order("monthly_price");
    setPlans(data || []);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm({ ...emptyPlan }); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({
      id: p.id,
      name: p.name ?? "",
      monthly_price: String(p.monthly_price ?? ""),
      user_limit: String(p.user_limit ?? ""),
      lead_limit: String(p.lead_limit ?? ""),
      message_limit: String(p.message_limit ?? ""),
      is_active: p.is_active ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Informe o nome do plano"); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      monthly_price: Number(form.monthly_price) || 0,
      user_limit: parseInt(form.user_limit, 10) || 0,
      lead_limit: parseInt(form.lead_limit, 10) || 0,
      message_limit: parseInt(form.message_limit, 10) || 0,
      is_active: !!form.is_active,
    };
    const res = editing
      ? await (supabase as any).from("plans").update(payload).eq("id", form.id)
      : await (supabase as any).from("plans").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message || "Erro ao salvar plano"); return; }
    toast.success(editing ? "Plano atualizado" : "Plano criado");
    setOpen(false);
    load();
  };

  const toggleActive = async (p: any) => {
    const { error } = await (supabase as any).from("plans").update({ is_active: !p.is_active }).eq("id", p.id);
    if (error) { toast.error(error.message || "Erro ao alterar status"); return; }
    toast.success(!p.is_active ? "Plano ativado" : "Plano desativado");
    load();
  };

  const remove = async (p: any) => {
    if (!confirm(`Excluir o plano "${p.name}"? Se houver assinaturas usando este plano, prefira apenas desativá-lo.`)) return;
    const { error } = await (supabase as any).from("plans").delete().eq("id", p.id);
    if (error) { toast.error(error.message || "Não foi possível excluir (pode haver assinaturas vinculadas). Tente desativar."); return; }
    toast.success("Plano excluído");
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Planos</h1>
          <p className="text-sm text-slate-400">Crie e gerencie os planos da plataforma.</p>
        </div>
        <Button onClick={openNew} className="bg-gradient-to-r from-orange-500 to-amber-400 text-slate-950 hover:opacity-90"><Plus size={16} /> Novo plano</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className="border-slate-800 bg-slate-900/40 p-5 text-slate-100">
            <div className="flex items-start justify-between">
              <p className="text-lg font-bold">{p.name}</p>
              <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "ativo" : "inativo"}</Badge>
            </div>
            <p className="my-2 text-2xl text-cyan-300">{brl(p.monthly_price)}<span className="text-sm text-slate-500">/mês</span></p>
            <ul className="space-y-1 text-sm text-slate-400">
              <li>{num(p.user_limit)} usuários</li>
              <li>{num(p.lead_limit)} leads</li>
              <li>{num(p.message_limit)} mensagens/mês</li>
            </ul>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" variant="outline" className="border-slate-700 text-slate-200 hover:bg-slate-800" onClick={() => openEdit(p)}><Pencil size={13} className="mr-1" /> Editar</Button>
              <Button size="sm" variant="outline" className="border-slate-700 text-slate-200 hover:bg-slate-800" onClick={() => toggleActive(p)}>{p.is_active ? "Desativar" : "Ativar"}</Button>
              <Button size="sm" variant="outline" className="border-red-900 text-red-400 hover:bg-red-950" onClick={() => remove(p)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ))}
        {plans.length === 0 && <p className="text-slate-500">Nenhum plano cadastrado ainda.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle>{editing ? "Editar plano" : "Novo plano"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex: Profissional" /></div>
            <div><Label>Preço mensal (R$)</Label><Input type="number" step="0.01" min="0" className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.monthly_price} onChange={(e) => setForm({ ...form, monthly_price: e.target.value })} placeholder="ex: 299.90" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Limite usuários</Label><Input type="number" min="0" className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.user_limit} onChange={(e) => setForm({ ...form, user_limit: e.target.value })} /></div>
              <div><Label>Limite leads</Label><Input type="number" min="0" className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.lead_limit} onChange={(e) => setForm({ ...form, lead_limit: e.target.value })} /></div>
              <div><Label>Limite mensagens</Label><Input type="number" min="0" className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" value={form.message_limit} onChange={(e) => setForm({ ...form, message_limit: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 rounded border-slate-700 bg-slate-800" />
              Plano ativo (disponível para novos clientes)
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 animate-spin" size={14} />} {editing ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const UsageBar = ({ used, limit }: { used: number; limit: number }) => {
  const u = Number(used || 0);
  const l = Number(limit || 0);
  const pct = l > 0 ? Math.min(100, Math.round((u / l) * 100)) : 0;
  const color = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  const textColor = pct >= 100 ? "text-red-300" : pct >= 80 ? "text-amber-300" : "text-slate-300";
  return (
    <div className="min-w-[140px]">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className={textColor}>{num(u)}{l > 0 ? ` / ${num(l)}` : ""}</span>
        {l > 0 && <span className="text-slate-500">{pct}%</span>}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color}`} style={{ width: `${l > 0 ? pct : 0}%` }} />
      </div>
    </div>
  );
};

export const AdminMetricas = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_all_tenants_usage");
    setLoading(false);
    if (error) { toast.error(error.message || "Erro ao carregar métricas"); return; }
    setRows(data || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Métricas de uso</h1>
          <p className="text-sm text-slate-400">Uso do mês corrente vs. limites do plano, por cliente.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="border-slate-700 text-slate-200 hover:bg-slate-800">
          {loading ? <Loader2 className="mr-2 animate-spin" size={14} /> : <RefreshCw className="mr-2" size={14} />} Atualizar
        </Button>
      </div>

      {loading ? (
        <p className="text-slate-500">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">Sem dados de uso ainda.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60">
              <tr className="text-left">
                <th className="p-3">Cliente</th>
                <th className="p-3">Plano</th>
                <th className="p-3">Status</th>
                <th className="p-3">Usuários</th>
                <th className="p-3">Leads (mês)</th>
                <th className="p-3">Mensagens (mês)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenant_id} className="border-t border-slate-800">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 text-slate-400">{r.plan_name || "—"}</td>
                  <td className="p-3"><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge></td>
                  <td className="p-3"><UsageBar used={r.users} limit={r.user_limit} /></td>
                  <td className="p-3"><UsageBar used={r.leads_month} limit={r.lead_limit} /></td>
                  <td className="p-3"><UsageBar used={r.messages_month} limit={r.message_limit} /></td>
                </tr>
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
  const [generating, setGenerating] = useState(false);
  const load = () => (supabase as any).from("tenant_invoices").select("*, tenants(name)").order("created_at", { ascending: false }).then(({ data }: any) => setInvoices(data || []));
  useEffect(() => { load(); }, []);

  const togglePaid = async (inv: any) => {
    await (supabase as any).from("tenant_invoices").update({ status: inv.status === "paid" ? "open" : "paid", paid_at: inv.status === "paid" ? null : new Date().toISOString() }).eq("id", inv.id);
    load();
  };

  const generate = async () => {
    setGenerating(true);
    const { data, error } = await (supabase as any).rpc("generate_tenant_invoices");
    setGenerating(false);
    if (error) { toast.error(error.message || "Erro ao gerar faturas"); return; }
    const count = Number(data ?? 0);
    toast.success(count > 0 ? `${count} fatura(s) gerada(s) para o mês.` : "Nenhuma fatura nova a gerar (já estão criadas).");
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cobrança</h1>
          <p className="text-sm text-slate-400">Faturas mensais das assinaturas ativas.</p>
        </div>
        <Button onClick={generate} disabled={generating} className="bg-gradient-to-r from-orange-500 to-amber-400 text-slate-950 hover:opacity-90">
          {generating ? <Loader2 className="mr-2 animate-spin" size={14} /> : <Receipt className="mr-2" size={14} />} Gerar faturas do mês
        </Button>
      </div>

      {invoices.length === 0 ? <p className="text-slate-500">Sem faturas ainda. Use "Gerar faturas do mês" para criar as faturas das assinaturas ativas.</p> : (
        <div className="grid gap-2">
          {invoices.map((i) => (
            <Card key={i.id} className="flex items-center justify-between border-slate-800 bg-slate-900/40 p-4 text-slate-100">
              <div><p className="font-semibold">{i.tenants?.name}</p><p className="text-xs text-slate-400">Ref: {i.reference_month}</p></div>
              <div className="flex items-center gap-3">
                <span className="font-mono">{brl(i.amount)}</span>
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

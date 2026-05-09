import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Users, Image as ImageIcon, Settings2, LogIn,
  PauseCircle, PlayCircle, Trash2, Shield, BarChart3, Plus, KeyRound, UserX, UserCheck,
} from "lucide-react";

type Tenant = {
  id: string; slug: string; name: string; logo_url: string | null;
  favicon_url: string | null; primary_color: string; secondary_color: string;
  tertiary_color: string; status: string; created_at: string;
};
type Profile = {
  id: string; nome: string; email: string; cargo: string | null;
  is_blocked: boolean; last_login_at: string | null; must_change_password: boolean;
};
type Metrics = {
  leads_total: number; leads_month: number;
  messages_in_month: number; messages_out_month: number;
  users_total: number; users_active_30d: number; ai_calls_month: number;
};

export default function AdminClienteDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await (supabase as any).from("tenants").select("*").eq("id", id).maybeSingle();
    setTenant(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="text-slate-400"><Loader2 className="inline animate-spin" /> Carregando...</div>;
  if (!tenant) return <div className="text-slate-400">Cliente não encontrado.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}><ArrowLeft size={16} /> Voltar</Button>
        <div className="flex items-center gap-3">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} alt="" className="h-12 w-12 rounded object-contain bg-slate-800" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded font-bold text-slate-950" style={{ background: tenant.primary_color }}>
              {tenant.name[0]}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{tenant.name}</h1>
            <p className="text-sm text-slate-400">
              <Link to={`/${tenant.slug}`} target="_blank" className="hover:underline">{tenant.slug}.crclin.com.br</Link>
              {" · "}<Badge variant={tenant.status === "active" ? "default" : "secondary"}>{tenant.status}</Badge>
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-slate-900/60">
          <TabsTrigger value="overview"><BarChart3 size={14} className="mr-1" /> Visão geral</TabsTrigger>
          <TabsTrigger value="users"><Users size={14} className="mr-1" /> Usuários</TabsTrigger>
          <TabsTrigger value="branding"><ImageIcon size={14} className="mr-1" /> Branding</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 size={14} className="mr-1" /> Configurações</TabsTrigger>
          <TabsTrigger value="actions"><Shield size={14} className="mr-1" /> Acesso & Ações</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab tenant={tenant} /></TabsContent>
        <TabsContent value="users"><UsersTab tenant={tenant} /></TabsContent>
        <TabsContent value="branding"><BrandingTab tenant={tenant} onSaved={load} /></TabsContent>
        <TabsContent value="settings"><SettingsTab tenant={tenant} onSaved={load} /></TabsContent>
        <TabsContent value="actions"><ActionsTab tenant={tenant} onChanged={load} /></TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return (
    <Card className="border-slate-800 bg-slate-900/40 p-4 text-slate-100">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value ?? "—"}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

function OverviewTab({ tenant }: { tenant: Tenant }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("admin-tenant-metrics", { body: { tenant_id: tenant.id } });
      if (error) toast.error(error.message);
      setM(data as Metrics);
      setLoading(false);
    })();
  }, [tenant.id]);

  if (loading) return <div className="text-slate-400"><Loader2 className="inline animate-spin" /> Calculando...</div>;
  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
      <MetricCard label="Leads totais" value={m?.leads_total} />
      <MetricCard label="Leads no mês" value={m?.leads_month} />
      <MetricCard label="Mensagens recebidas (mês)" value={m?.messages_in_month} />
      <MetricCard label="Mensagens enviadas (mês)" value={m?.messages_out_month} />
      <MetricCard label="Usuários totais" value={m?.users_total} />
      <MetricCard label="Ativos (30d)" value={m?.users_active_30d} hint="Login nos últimos 30 dias" />
      <MetricCard label="Chamadas de IA (mês)" value={m?.ai_calls_month} />
    </div>
  );
}

function UsersTab({ tenant }: { tenant: Tenant }) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);
  const [form, setForm] = useState({ nome: "", email: "", password: "" });

  const load = async () => {
    const { data } = await supabase.from("profiles")
      .select("id, nome, email, cargo, is_blocked, last_login_at, must_change_password")
      .eq("tenant_id", tenant.id).order("created_at", { ascending: false });
    setUsers((data as any) ?? []);
  };
  useEffect(() => { load(); }, [tenant.id]);

  const call = async (body: any) => {
    const { data, error } = await supabase.functions.invoke("admin-manage-user", { body });
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return false; }
    return true;
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus size={14} /> Novo usuário</Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-slate-400"><tr>
            <th className="p-3 text-left">Nome</th><th className="p-3 text-left">E-mail</th>
            <th className="p-3 text-left">Último login</th><th className="p-3 text-left">Status</th>
            <th className="p-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-800">
                <td className="p-3">{u.nome}</td>
                <td className="p-3 text-slate-400">{u.email}</td>
                <td className="p-3 text-slate-400">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("pt-BR") : "Nunca"}</td>
                <td className="p-3">{u.is_blocked ? <Badge variant="destructive">Bloqueado</Badge> : <Badge>Ativo</Badge>}</td>
                <td className="p-3 text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => setReset({ id: u.id, password: "" })}><KeyRound size={14} /></Button>
                  {u.is_blocked
                    ? <Button size="sm" variant="ghost" onClick={async () => { if (await call({ action: "unblock", user_id: u.id })) { toast.success("Desbloqueado"); load(); } }}><UserCheck size={14} /></Button>
                    : <Button size="sm" variant="ghost" onClick={async () => { if (await call({ action: "block", user_id: u.id })) { toast.success("Bloqueado"); load(); } }}><UserX size={14} /></Button>}
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!confirm(`Excluir ${u.email}?`)) return;
                    if (await call({ action: "delete", user_id: u.id })) { toast.success("Excluído"); load(); }
                  }}><Trash2 size={14} /></Button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">Nenhum usuário.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Senha temporária</Label><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={async () => {
              if (await call({ action: "create", tenant_id: tenant.id, ...form })) {
                toast.success("Usuário criado"); setOpen(false); setForm({ nome: "", email: "", password: "" }); load();
              }
            }}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reset} onOpenChange={(v) => !v && setReset(null)}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle>Redefinir senha</DialogTitle></DialogHeader>
          <Input placeholder="Nova senha temporária" value={reset?.password ?? ""} onChange={(e) => setReset(reset ? { ...reset, password: e.target.value } : null)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReset(null)}>Cancelar</Button>
            <Button onClick={async () => {
              if (!reset?.password) return;
              if (await call({ action: "reset_password", user_id: reset.id, password: reset.password })) {
                toast.success("Senha redefinida"); setReset(null); load();
              }
            }}>Redefinir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BrandingTab({ tenant, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const [logo, setLogo] = useState(tenant.logo_url ?? "");
  const [favicon, setFavicon] = useState(tenant.favicon_url ?? "");
  const [primary, setPrimary] = useState(tenant.primary_color);
  const [secondary, setSecondary] = useState(tenant.secondary_color ?? "#fb923c");
  const [tertiary, setTertiary] = useState(tenant.tertiary_color ?? "#ffedd5");
  const [saving, setSaving] = useState(false);

  const upload = async (f: File, kind: "logo" | "favicon") => {
    const path = `${tenant.id}/${kind}-${Date.now()}-${f.name}`;
    const { error } = await supabase.storage.from("tenant-logos").upload(path, f, { upsert: true });
    if (error) { toast.error(error.message); return; }
    const { data } = supabase.storage.from("tenant-logos").getPublicUrl(path);
    if (kind === "logo") setLogo(data.publicUrl); else setFavicon(data.publicUrl);
  };

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", {
      body: { tenant_id: tenant.id, action: "update", patch: {
        logo_url: logo || null, favicon_url: favicon || null,
        primary_color: primary, secondary_color: secondary, tertiary_color: tertiary,
      } },
    });
    setSaving(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
    toast.success("Branding salvo"); onSaved();
  };

  return (
    <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100 space-y-4 max-w-xl">
      <div>
        <Label>Logo</Label>
        <div className="flex items-center gap-3 mt-1">
          {logo && <img src={logo} alt="" className="h-12 w-12 rounded object-contain bg-slate-800" />}
          <Input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "logo")} />
        </div>
      </div>
      <div>
        <Label>Favicon</Label>
        <div className="flex items-center gap-3 mt-1">
          {favicon && <img src={favicon} alt="" className="h-8 w-8 rounded object-contain bg-slate-800" />}
          <Input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "favicon")} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Cor primária</Label>
          <Input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-10 w-full p-1" />
        </div>
        <div>
          <Label>Cor secundária</Label>
          <Input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-10 w-full p-1" />
        </div>
        <div>
          <Label>Cor terciária</Label>
          <Input type="color" value={tertiary} onChange={(e) => setTertiary(e.target.value)} className="h-10 w-full p-1" />
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-3">
        <span className="text-xs text-slate-400">Pré-visualização:</span>
        <span className="h-6 w-6 rounded" style={{ background: primary }} />
        <span className="h-6 w-6 rounded" style={{ background: secondary }} />
        <span className="h-6 w-6 rounded" style={{ background: tertiary }} />
      </div>
      <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 animate-spin" size={14} />} Salvar</Button>
    </Card>
  );
}

function SettingsTab({ tenant, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const [name, setName] = useState(tenant.name);
  const [slug, setSlug] = useState(tenant.slug);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", {
      body: { tenant_id: tenant.id, action: "update", patch: { name, slug } },
    });
    setSaving(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
    toast.success("Salvo"); onSaved();
  };

  return (
    <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100 space-y-3 max-w-xl">
      <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><Label>Slug</Label><Input value={slug} onChange={(e) => setSlug(e.target.value)} /></div>
      <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 animate-spin" size={14} />} Salvar</Button>
      <p className="text-xs text-slate-500">Integrações (WhatsApp, Instagram, IA) podem ser editadas via Impersonação na aba ao lado.</p>
    </Card>
  );
}

function ActionsTab({ tenant, onChanged }: { tenant: Tenant; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const action = async (act: "pause" | "activate" | "delete") => {
    if (act === "delete" && !confirm(`Marcar ${tenant.name} como excluído? O acesso será bloqueado.`)) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", { body: { tenant_id: tenant.id, action: act } });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
    toast.success("OK"); onChanged();
  };

  const impersonate = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-impersonate", { body: { tenant_id: tenant.id } });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
    const url = (data as any)?.url;
    if (url) { window.open(url, "_blank"); toast.success("Link de acesso aberto"); }
  };

  return (
    <div className="space-y-3 max-w-xl">
      <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100">
        <p className="font-semibold mb-1"><LogIn size={14} className="inline mr-1" /> Impersonar</p>
        <p className="text-sm text-slate-400 mb-3">Acesse o painel deste cliente em uma nova aba.</p>
        <Button onClick={impersonate} disabled={busy}>Abrir como cliente</Button>
      </Card>
      <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100">
        <p className="font-semibold mb-3">Status do cliente</p>
        <div className="flex gap-2">
          {tenant.status !== "active" && <Button onClick={() => action("activate")} disabled={busy}><PlayCircle size={14} /> Ativar</Button>}
          {tenant.status === "active" && <Button variant="outline" onClick={() => action("pause")} disabled={busy}><PauseCircle size={14} /> Pausar</Button>}
          <Button variant="destructive" onClick={() => action("delete")} disabled={busy}><Trash2 size={14} /> Excluir</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Pausa e exclusão bloqueiam logins imediatamente.</p>
      </Card>
    </div>
  );
}

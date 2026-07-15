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
import { BrandColorField } from "@/components/admin/BrandColorField";
import { BrandPreview } from "@/components/admin/BrandPreview";
import {
  ArrowLeft, Loader2, Users, Image as ImageIcon, Settings2, LogIn,
  PauseCircle, PlayCircle, Trash2, Shield, BarChart3, Plus, KeyRound, UserX, UserCheck,
  Mail, ScrollText, AlertTriangle, ChevronLeft, ChevronRight, Eye,
} from "lucide-react";

/**
 * Helper local para extrair a mensagem de erro de edge functions.
 * Espelha o `getFunctionErrorMessage` de AdminPanel.tsx (que não é exportado).
 */
const getFunctionErrorMessage = async (data: unknown, error: unknown, fallback = "Erro ao processar") => {
  const dataError = (data as any)?.error;
  if (dataError) return String(dataError);
  const context = (error as any)?.context;
  if (context?.json) {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      /* mantém a mensagem original abaixo */
    }
  }
  return (error as any)?.message || fallback;
};

const ROLES: { value: string; label: string }[] = [
  { value: "crc", label: "CRC" },
  { value: "gerente", label: "Gerente" },
  { value: "posvenda", label: "Pós-venda" },
];
const roleLabel = (r: string | null | undefined) =>
  ROLES.find((x) => x.value === r)?.label ?? (r || "—");

const inputDark =
  "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500";
const selectDark =
  "h-9 rounded-md border border-slate-700 bg-slate-800 px-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500";

type Tenant = {
  id: string; slug: string; name: string; logo_url: string | null;
  logo_dark_url?: string | null;
  favicon_url: string | null; primary_color: string; secondary_color: string;
  tertiary_color: string; status: string; created_at: string;
  timezone?: string | null; trial_ends_at?: string | null;
  branding_version?: number | null;
};
type Profile = {
  id: string; nome: string; email: string; cargo: string | null;
  is_blocked: boolean; last_login_at: string | null; must_change_password: boolean;
  role?: string | null;
};
type Metrics = {
  leads_total: number; leads_month: number;
  messages_in_month: number; messages_out_month: number;
  users_total: number; users_active_30d: number; ai_calls_month: number;
};
type Usage = {
  tenant_id: string; name: string; status: string; plan_name: string | null;
  user_limit: number | null; lead_limit: number | null; message_limit: number | null;
  users: number; leads_month: number; messages_month: number;
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
              <Link to={`/${tenant.slug}`} target="_blank" className="hover:underline">crclin.com.br/{tenant.slug}</Link>
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
          <TabsTrigger value="logs"><ScrollText size={14} className="mr-1" /> Logs</TabsTrigger>
          <TabsTrigger value="actions"><Shield size={14} className="mr-1" /> Acesso & Ações</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab tenant={tenant} /></TabsContent>
        <TabsContent value="users"><UsersTab tenant={tenant} /></TabsContent>
        <TabsContent value="branding"><BrandingTab tenant={tenant} onSaved={load} /></TabsContent>
        <TabsContent value="settings"><SettingsTab tenant={tenant} onSaved={load} /></TabsContent>
        <TabsContent value="logs"><LogsTab tenant={tenant} /></TabsContent>
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

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null | undefined }) {
  const hasLimit = typeof limit === "number" && limit > 0;
  const pct = hasLimit ? Math.min(100, Math.round((used / (limit as number)) * 100)) : 0;
  const over = hasLimit && pct >= 80;
  const full = hasLimit && used >= (limit as number);
  const barColor = full ? "bg-red-500" : over ? "bg-amber-500" : "bg-cyan-500";
  return (
    <Card className="border-slate-800 bg-slate-900/40 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        {over && (
          <span className={`inline-flex items-center gap-1 text-xs ${full ? "text-red-400" : "text-amber-400"}`}>
            <AlertTriangle size={12} /> {full ? "Limite atingido" : "Perto do limite"}
          </span>
        )}
      </div>
      <p className="mt-1 text-lg font-bold">
        {used.toLocaleString("pt-BR")}
        <span className="text-sm font-normal text-slate-500">
          {" / "}{hasLimit ? (limit as number).toLocaleString("pt-BR") : "ilimitado"}
        </span>
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${hasLimit ? pct : 0}%` }} />
      </div>
      {hasLimit && <p className="mt-1 text-xs text-slate-500">{pct}% do plano</p>}
    </Card>
  );
}

function OverviewTab({ tenant }: { tenant: Tenant }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [metricsRes, usageRes] = await Promise.all([
        supabase.functions.invoke("admin-tenant-metrics", { body: { tenant_id: tenant.id } }),
        (supabase as any).rpc("admin_all_tenants_usage"),
      ]);
      if (metricsRes.error) toast.error(await getFunctionErrorMessage(metricsRes.data, metricsRes.error, "Erro ao carregar métricas"));
      setM(metricsRes.data as Metrics);
      if (usageRes.error) toast.error(usageRes.error.message);
      const row = ((usageRes.data as Usage[]) ?? []).find((r) => r.tenant_id === tenant.id) ?? null;
      setUsage(row);
      setLoading(false);
    })();
  }, [tenant.id]);

  if (loading) return <div className="text-slate-400"><Loader2 className="inline animate-spin" /> Calculando...</div>;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">
          Uso vs. limite do plano {usage?.plan_name ? <span className="text-slate-500">· {usage.plan_name}</span> : <span className="text-slate-500">· sem plano</span>}
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          <UsageBar label="Usuários" used={usage?.users ?? m?.users_total ?? 0} limit={usage?.user_limit} />
          <UsageBar label="Leads no mês" used={usage?.leads_month ?? m?.leads_month ?? 0} limit={usage?.lead_limit} />
          <UsageBar label="Mensagens no mês" used={usage?.messages_month ?? ((m?.messages_in_month ?? 0) + (m?.messages_out_month ?? 0))} limit={usage?.message_limit} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Métricas gerais</h3>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <MetricCard label="Leads totais" value={m?.leads_total} />
          <MetricCard label="Leads no mês" value={m?.leads_month} />
          <MetricCard label="Mensagens recebidas (mês)" value={m?.messages_in_month} />
          <MetricCard label="Mensagens enviadas (mês)" value={m?.messages_out_month} />
          <MetricCard label="Usuários totais" value={m?.users_total} />
          <MetricCard label="Ativos (30d)" value={m?.users_active_30d} hint="Login nos últimos 30 dias" />
          <MetricCard label="Chamadas de IA (mês)" value={m?.ai_calls_month} />
        </div>
      </div>
    </div>
  );
}

function UsersTab({ tenant }: { tenant: Tenant }) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);
  const [emailEdit, setEmailEdit] = useState<{ id: string; email: string } | null>(null);
  const [form, setForm] = useState({ nome: "", email: "", password: "", role: "crc" });

  const load = async () => {
    const { data: profs } = await supabase.from("profiles")
      .select("id, nome, email, cargo, is_blocked, last_login_at, must_change_password")
      .eq("tenant_id", tenant.id).order("created_at", { ascending: false });
    // O PAPEL vem de user_roles (não de profiles.cargo, que é o cargo/título livre).
    const { data: roles } = await (supabase as any).from("user_roles")
      .select("user_id, role").eq("tenant_id", tenant.id);
    const roleMap = new Map((roles ?? []).map((r: any) => [r.user_id, r.role]));
    setUsers(((profs as any) ?? []).map((p: any) => ({ ...p, role: roleMap.get(p.id) ?? null })));
  };
  useEffect(() => { load(); }, [tenant.id]);

  const call = async (body: any) => {
    const { data, error } = await supabase.functions.invoke("admin-manage-user", { body });
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error)); return false; }
    return true;
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus size={14} /> Novo usuário</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-slate-400"><tr>
            <th className="p-3 text-left">Nome</th><th className="p-3 text-left">E-mail</th>
            <th className="p-3 text-left">Papel</th>
            <th className="p-3 text-left">Último login</th><th className="p-3 text-left">Status</th>
            <th className="p-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-800">
                <td className="p-3">{u.nome}</td>
                <td className="p-3 text-slate-400">{u.email}</td>
                <td className="p-3">
                  <select
                    className={selectDark}
                    value={ROLES.some((r) => r.value === u.role) ? (u.role as string) : "crc"}
                    title="Trocar papel do usuário"
                    onChange={async (e) => {
                      const role = e.target.value;
                      if (await call({ action: "set_role", user_id: u.id, role })) { toast.success(`Papel alterado para ${roleLabel(role)}`); load(); }
                    }}
                  >
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                <td className="p-3 text-slate-400">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("pt-BR") : "Nunca"}</td>
                <td className="p-3">{u.is_blocked ? <Badge variant="destructive">Bloqueado</Badge> : <Badge>Ativo</Badge>}</td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Trocar e-mail" onClick={() => setEmailEdit({ id: u.id, email: u.email })}><Mail size={14} /></Button>
                    <Button size="sm" variant="ghost" title="Redefinir senha" onClick={() => setReset({ id: u.id, password: "" })}><KeyRound size={14} /></Button>
                    {u.is_blocked
                      ? <Button size="sm" variant="ghost" title="Desbloquear" onClick={async () => { if (await call({ action: "unblock", user_id: u.id })) { toast.success("Desbloqueado"); load(); } }}><UserCheck size={14} /></Button>
                      : <Button size="sm" variant="ghost" title="Bloquear" onClick={async () => { if (await call({ action: "block", user_id: u.id })) { toast.success("Bloqueado"); load(); } }}><UserX size={14} /></Button>}
                    <Button size="sm" variant="ghost" title="Excluir usuário" onClick={async () => {
                      if (!confirm(`Excluir ${u.email}?`)) return;
                      if (await call({ action: "delete", user_id: u.id })) { toast.success("Excluído"); load(); }
                    }}><Trash2 size={14} /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhum usuário.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Nome</Label><Input className={inputDark} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>E-mail</Label><Input type="email" className={inputDark} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div>
              <Label>Papel</Label>
              <select className={`${selectDark} w-full`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div><Label>Senha temporária</Label><Input type="password" minLength={6} className={inputDark} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={async () => {
              if (await call({ action: "create", tenant_id: tenant.id, ...form })) {
                toast.success("Usuário criado"); setOpen(false); setForm({ nome: "", email: "", password: "", role: "crc" }); load();
              }
            }}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reset} onOpenChange={(v) => !v && setReset(null)}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle>Redefinir senha</DialogTitle></DialogHeader>
          <Input type="password" minLength={6} className={inputDark} placeholder="Nova senha (mínimo 6 caracteres)" value={reset?.password ?? ""} onChange={(e) => setReset(reset ? { ...reset, password: e.target.value } : null)} />
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

      <Dialog open={!!emailEdit} onOpenChange={(v) => !v && setEmailEdit(null)}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle>Trocar e-mail</DialogTitle></DialogHeader>
          <Input type="email" className={inputDark} placeholder="novo@email.com" value={emailEdit?.email ?? ""} onChange={(e) => setEmailEdit(emailEdit ? { ...emailEdit, email: e.target.value } : null)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEmailEdit(null)}>Cancelar</Button>
            <Button onClick={async () => {
              if (!emailEdit?.email) return;
              if (await call({ action: "set_email", user_id: emailEdit.id, email: emailEdit.email })) {
                toast.success("E-mail alterado"); setEmailEdit(null); load();
              }
            }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BrandingTab({ tenant, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const [logo, setLogo] = useState(tenant.logo_url ?? "");
  const [logoDark, setLogoDark] = useState(tenant.logo_dark_url ?? "");
  const [favicon, setFavicon] = useState(tenant.favicon_url ?? "");
  const [primary, setPrimary] = useState(tenant.primary_color);
  const [secondary, setSecondary] = useState(tenant.secondary_color ?? "#fb923c");
  const [saving, setSaving] = useState(false);

  const upload = async (f: File, kind: "logo" | "logo_dark" | "favicon") => {
    const path = `${tenant.id}/${kind}-${Date.now()}-${f.name}`;
    const { error } = await supabase.storage.from("tenant-logos").upload(path, f, { upsert: true });
    if (error) { toast.error(error.message); return; }
    const { data } = supabase.storage.from("tenant-logos").getPublicUrl(path);
    if (kind === "logo") setLogo(data.publicUrl);
    else if (kind === "logo_dark") setLogoDark(data.publicUrl);
    else setFavicon(data.publicUrl);
  };

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", {
      body: { tenant_id: tenant.id, action: "update", patch: {
        logo_url: logo || null, logo_dark_url: logoDark || null, favicon_url: favicon || null,
        primary_color: primary, secondary_color: secondary,
      } },
    });
    setSaving(false);
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error, "Erro ao salvar branding")); return; }
    toast.success("Branding salvo"); onSaved();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100 space-y-4">
        <div>
          <Label>Logo (fundo claro)</Label>
          <div className="flex items-center gap-3 mt-1">
            {logo && <img src={logo} alt="" className="h-12 w-12 rounded object-contain bg-slate-800" />}
            <Input type="file" accept="image/*" className={inputDark} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "logo")} />
          </div>
          <Input className={`${inputDark} mt-2`} placeholder="ou cole a URL da logo" value={logo} onChange={(e) => setLogo(e.target.value)} />
        </div>
        <div>
          <Label>Logo (fundo escuro)</Label>
          <div className="flex items-center gap-3 mt-1">
            {logoDark && <img src={logoDark} alt="" className="h-12 w-12 rounded object-contain bg-slate-950" />}
            <Input type="file" accept="image/*" className={inputDark} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "logo_dark")} />
          </div>
          <Input className={`${inputDark} mt-2`} placeholder="ou cole a URL da logo escura" value={logoDark} onChange={(e) => setLogoDark(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Usada em áreas de fundo escuro (ex.: cabeçalho invertido). Opcional.</p>
        </div>
        <div>
          <Label>Favicon</Label>
          <div className="flex items-center gap-3 mt-1">
            {favicon && <img src={favicon} alt="" className="h-8 w-8 rounded object-contain bg-slate-800" />}
            <Input type="file" accept="image/*" className={inputDark} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "favicon")} />
          </div>
          <Input className={`${inputDark} mt-2`} placeholder="ou cole a URL do favicon" value={favicon} onChange={(e) => setFavicon(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <BrandColorField label="Cor principal" value={primary} onChange={setPrimary} />
          <BrandColorField label="Cor secundária" value={secondary} onChange={setSecondary} />
        </div>
        <p className="text-xs text-slate-500">A cor principal pinta botões e destaques; a secundária compõe o gradiente. O restante da interface fica neutro (claro).</p>
        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 animate-spin" size={14} />} Salvar</Button>
      </Card>

      {/* Pré-visualização REAL da interface do cliente */}
      <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100 space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-300"><Eye size={14} /> Como fica a interface do cliente</p>
        <BrandPreview primary={primary} secondary={secondary} name={tenant.name} logoUrl={logo || tenant.logo_url} />
        <p className="text-xs text-slate-500">Usa os valores atuais dos campos, mesmo antes de salvar.</p>
      </Card>
    </div>
  );
}

function SettingsTab({ tenant, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const [name, setName] = useState(tenant.name);
  const [slug, setSlug] = useState(tenant.slug);
  const [timezone, setTimezone] = useState(tenant.timezone ?? "America/Sao_Paulo");
  const [trial, setTrial] = useState(tenant.trial_ends_at ? tenant.trial_ends_at.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);

  // Planos / assinatura
  const [plans, setPlans] = useState<any[]>([]);
  const [currentSub, setCurrentSub] = useState<any | null>(null);
  const [planId, setPlanId] = useState<string>("");
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: pl } = await (supabase as any).from("plans").select("*").order("monthly_price");
      setPlans(pl || []);
      const { data: sub } = await (supabase as any).from("tenant_subscriptions")
        .select("*").eq("tenant_id", tenant.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
      setCurrentSub(sub || null);
      setPlanId(sub?.plan_id ?? "");
    })();
  }, [tenant.id]);

  const slugClean = slug.trim().toLowerCase();
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugClean);
  const slugChanged = slugClean !== tenant.slug;

  const save = async () => {
    if (!slugValid) { toast.error("Slug inválido. Use apenas letras minúsculas, números e hífens."); return; }
    setSaving(true);
    const patch: any = {
      name,
      slug: slugClean,
      timezone: timezone || null,
      trial_ends_at: trial ? new Date(`${trial}T00:00:00`).toISOString() : null,
    };
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", {
      body: { tenant_id: tenant.id, action: "update", patch },
    });
    setSaving(false);
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error, "Erro ao salvar")); return; }
    toast.success("Salvo"); onSaved();
  };

  const savePlan = async () => {
    if (!planId) { toast.error("Selecione um plano."); return; }
    const plan = plans.find((p) => p.id === planId);
    setSavingPlan(true);
    const row: any = {
      tenant_id: tenant.id,
      plan_id: planId,
      status: "active",
      amount: plan ? Number(plan.monthly_price) : null,
      updated_at: new Date().toISOString(),
    };
    if (currentSub?.id) row.id = currentSub.id; // atualiza a assinatura existente (upsert por PK)
    else row.started_at = new Date().toISOString();
    const { error } = await (supabase as any).from("tenant_subscriptions").upsert(row);
    setSavingPlan(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Plano atualizado");
    const { data: sub } = await (supabase as any).from("tenant_subscriptions")
      .select("*").eq("tenant_id", tenant.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    setCurrentSub(sub || null);
    setPlanId(sub?.plan_id ?? planId);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100 space-y-3">
        <p className="text-sm font-semibold text-slate-300">Dados gerais</p>
        <div><Label>Nome</Label><Input className={inputDark} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label>Slug (identificador na URL)</Label>
          <Input className={`${inputDark} font-mono`} value={slug} onChange={(e) => setSlug(e.target.value)} />
          {!slugValid ? (
            <p className="mt-1 text-xs text-red-400">Use apenas letras minúsculas, números e hífens (ex.: minha-clinica).</p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              Acesso: <span className="font-mono text-cyan-300">crclin.com.br/{slugClean}</span>
            </p>
          )}
          {slugChanged && slugValid && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-400">
              <AlertTriangle size={12} /> Trocar o slug muda a URL de acesso do cliente. Links antigos deixarão de funcionar.
            </p>
          )}
        </div>
        <div>
          <Label>Fuso horário</Label>
          <Input className={inputDark} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Sao_Paulo" />
        </div>
        <div>
          <Label>Fim do período de teste (trial)</Label>
          <Input type="date" className={inputDark} value={trial} onChange={(e) => setTrial(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Deixe em branco para remover o trial.</p>
        </div>
        <Button onClick={save} disabled={saving || !slugValid}>{saving && <Loader2 className="mr-2 animate-spin" size={14} />} Salvar</Button>
        <p className="text-xs text-slate-500">Integrações (WhatsApp, Instagram, IA) podem ser editadas via Impersonação na aba "Acesso & Ações".</p>
      </Card>

      <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100 space-y-3">
        <p className="text-sm font-semibold text-slate-300">Plano / assinatura</p>
        <div>
          <Label>Plano atual</Label>
          <p className="text-sm text-slate-400">
            {currentSub
              ? <>{plans.find((p) => p.id === currentSub.plan_id)?.name ?? "—"} · <span className="capitalize">{currentSub.status}</span></>
              : "Sem assinatura registrada"}
          </p>
        </div>
        <div>
          <Label>Trocar plano</Label>
          <select className={`${selectDark} w-full`} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Selecione um plano…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — R$ {Number(p.monthly_price).toFixed(2)}/mês</option>
            ))}
          </select>
          {planId && (() => {
            const p = plans.find((x) => x.id === planId);
            return p ? (
              <p className="mt-1 text-xs text-slate-500">
                {p.user_limit} usuários · {Number(p.lead_limit).toLocaleString("pt-BR")} leads · {Number(p.message_limit).toLocaleString("pt-BR")} mensagens/mês
              </p>
            ) : null;
          })()}
        </div>
        <Button onClick={savePlan} disabled={savingPlan || !planId || planId === currentSub?.plan_id}>
          {savingPlan && <Loader2 className="mr-2 animate-spin" size={14} />} Aplicar plano
        </Button>
        <p className="text-xs text-slate-500">A troca grava direto em tenant_subscriptions.</p>
      </Card>
    </div>
  );
}

function LogsTab({ tenant }: { tenant: Tenant }) {
  const PAGE = 20;
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const from = page * PAGE;
      const to = from + PAGE; // busca 1 a mais para saber se há próxima página
      const { data, error } = await (supabase as any).from("access_logs")
        .select("id, event, context, email, ip, user_agent, created_at")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) toast.error(error.message);
      const list = (data as any[]) ?? [];
      setHasMore(list.length > PAGE);
      setRows(list.slice(0, PAGE));
      setLoading(false);
    })();
  }, [tenant.id, page]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-slate-400"><tr>
            <th className="p-3 text-left">Quando</th>
            <th className="p-3 text-left">Evento</th>
            <th className="p-3 text-left">Contexto</th>
            <th className="p-3 text-left">Usuário</th>
            <th className="p-3 text-left">IP</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500"><Loader2 className="inline animate-spin" size={14} /> Carregando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Nenhum registro de acesso.</td></tr>
            ) : rows.map((l) => (
              <tr key={l.id} className="border-t border-slate-800">
                <td className="p-3 text-slate-400 whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString("pt-BR") : "—"}</td>
                <td className="p-3"><Badge variant="secondary">{l.event}</Badge></td>
                <td className="p-3 text-slate-400">{l.context ?? "—"}</td>
                <td className="p-3 text-slate-400">{l.email ?? "—"}</td>
                <td className="p-3 text-slate-500 font-mono text-xs">{l.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Página {page + 1}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft size={14} /> Anterior
          </Button>
          <Button size="sm" variant="outline" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>
            Próxima <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ActionsTab({ tenant, onChanged }: { tenant: Tenant; onChanged: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [hardOpen, setHardOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const isDeleted = tenant.status === "deleted";
  const isProtected = String(tenant.slug).toLowerCase() === "rizodent";

  const call = async (body: any, okMsg: string) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", { body });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error)); return false; }
    toast.success(okMsg); onChanged(); return true;
  };

  const impersonate = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-impersonate", { body: { tenant_id: tenant.id } });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error)); return; }
    const at = (data as any)?.access_token;
    const rt = (data as any)?.refresh_token;
    const slug = (data as any)?.slug ?? tenant.slug;
    if (at && rt) {
      const origin = window.location.origin.includes("lovable") ? "https://crclin.com.br" : window.location.origin;
      const url = `${origin}/${slug}/dashboard#impersonate_at=${encodeURIComponent(at)}&impersonate_rt=${encodeURIComponent(rt)}`;
      window.open(url, "_blank");
      toast.success("Painel do cliente aberto em nova aba");
    }
  };

  const doHardDelete = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-update-tenant", { body: { tenant_id: tenant.id, action: "hard_delete", confirm_name: confirmName } });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error(await getFunctionErrorMessage(data, error, "Erro ao excluir definitivamente")); return; }
    toast.success("Cliente excluído definitivamente");
    setHardOpen(false);
    navigate("/admin");
  };

  return (
    <div className="space-y-3 max-w-xl">
      {!isDeleted && (
        <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100">
          <p className="font-semibold mb-1"><LogIn size={14} className="inline mr-1" /> Impersonar</p>
          <p className="text-sm text-slate-400 mb-3">Acesse o painel deste cliente em uma nova aba.</p>
          <Button onClick={impersonate} disabled={busy}>Abrir como cliente</Button>
        </Card>
      )}

      {isDeleted ? (
        <Card className="border-amber-900/50 bg-amber-950/20 p-5 text-slate-100">
          <p className="font-semibold mb-1 text-amber-300"><Trash2 size={14} className="inline mr-1" /> Cliente na Lixeira</p>
          <p className="text-sm text-slate-400 mb-3">Este cliente está excluído, mas os dados continuam guardados. Você pode restaurá-lo ou excluí-lo em definitivo.</p>
          <div className="flex gap-2">
            <Button onClick={() => call({ tenant_id: tenant.id, action: "restore" }, "Cliente restaurado")} disabled={busy}><PlayCircle size={14} /> Restaurar</Button>
            <Button variant="destructive" onClick={() => setHardOpen(true)} disabled={busy || isProtected} title={isProtected ? "Cliente protegido" : undefined}><Trash2 size={14} /> Excluir definitivamente</Button>
          </div>
        </Card>
      ) : (
        <Card className="border-slate-800 bg-slate-900/40 p-5 text-slate-100">
          <p className="font-semibold mb-3">Status do cliente</p>
          <div className="flex gap-2">
            {tenant.status !== "active" && <Button onClick={() => call({ tenant_id: tenant.id, action: "activate" }, "Cliente ativado")} disabled={busy}><PlayCircle size={14} /> Ativar</Button>}
            {tenant.status === "active" && <Button variant="outline" onClick={() => call({ tenant_id: tenant.id, action: "pause" }, "Cliente pausado")} disabled={busy}><PauseCircle size={14} /> Pausar</Button>}
            <Button variant="outline" className="border-red-900 text-red-400 hover:bg-red-950 disabled:opacity-40" disabled={busy || isProtected} title={isProtected ? "Cliente protegido" : undefined}
              onClick={() => { if (confirm(`Enviar "${tenant.name}" para a Lixeira? O acesso é bloqueado na hora, mas os dados ficam guardados e você pode restaurar depois.`)) call({ tenant_id: tenant.id, action: "delete" }, "Cliente movido para a Lixeira"); }}>
              <Trash2 size={14} /> Excluir (Lixeira)
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">"Excluir" é reversível (vai para a Lixeira). A exclusão permanente é feita de lá.</p>
        </Card>
      )}

      <Dialog open={hardOpen} onOpenChange={(v) => { if (!v) { setHardOpen(false); setConfirmName(""); } }}>
        <DialogContent className="bg-slate-900 text-slate-100 border-slate-800">
          <DialogHeader><DialogTitle className="text-red-400">Excluir definitivamente</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-300">Isto apaga <b>permanentemente</b> todos os dados de <b>{tenant.name}</b> (leads, conversas, agendamentos, usuários). <b>Não pode ser desfeito.</b></p>
            <p className="text-xs text-slate-400">Para confirmar, digite o nome do cliente: <span className="font-mono text-slate-200">{tenant.name}</span></p>
            <Input className={inputDark} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder="Digite o nome exato do cliente" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setHardOpen(false); setConfirmName(""); }}>Cancelar</Button>
            <Button variant="destructive" disabled={busy || confirmName.trim() !== tenant.name.trim()} onClick={doHardDelete}>
              {busy && <Loader2 className="mr-2 animate-spin" size={14} />} Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

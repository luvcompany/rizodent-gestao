import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Camera, Loader2, Save, Building2, Plus, Trash2, User, Send, Pencil, CheckCircle2, X, MapPin, Database, Download, RotateCcw, RefreshCw, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { generateAndSubmitAppointmentTemplate } from "@/lib/appointmentTemplateBlueprint";

export default function Configuracoes() {
  const { userRole } = useAuth();
  const isAdmin = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie seu perfil, preferências e as clínicas integradas</p>
      </div>

      <Tabs defaultValue="perfil">
        <TabsList>
          <TabsTrigger value="perfil"><User size={14} className="mr-1" /> Meu perfil</TabsTrigger>
          <TabsTrigger value="clinicas"><Building2 size={14} className="mr-1" /> Clínicas</TabsTrigger>
          {isAdmin && <TabsTrigger value="backups"><Database size={14} className="mr-1" /> Backups</TabsTrigger>}
        </TabsList>
        <TabsContent value="perfil"><PerfilTab /></TabsContent>
        <TabsContent value="clinicas"><ClinicasTab /></TabsContent>
        {isAdmin && <TabsContent value="backups"><BackupsTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function PerfilTab() {
  const { user, profile, refreshProfile } = useAuth();
  const [nome, setNome] = useState(profile?.nome || "");
  const [cargo, setCargo] = useState(profile?.cargo || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || "");
  const [signatureEnabled, setSignatureEnabled] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("signature_enabled").eq("id", user.id).single()
      .then(({ data }) => { if (data) setSignatureEnabled((data as any).signature_enabled ?? false); });
  }, [user]);

  useEffect(() => {
    if (profile) {
      setNome(profile.nome);
      setCargo(profile.cargo || "");
      setAvatarUrl(profile.avatar_url || "");
    }
  }, [profile]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Imagem deve ter no máximo 2MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = data.publicUrl + "?t=" + Date.now();
      setAvatarUrl(url);
      await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", user.id);
      toast.success("Foto atualizada!");
    } catch (err: any) {
      toast.error("Erro ao enviar foto: " + err.message);
    } finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!user) return;
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({
        nome: nome.trim(), cargo: cargo.trim() || null, signature_enabled: signatureEnabled,
      } as any).eq("id", user.id);
      if (error) throw error;
      toast.success("Configurações salvas!");
      refreshProfile();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally { setSaving(false); }
  };

  const initials = nome.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const signaturePreview = signatureEnabled && nome.trim() ? `*${nome.trim()}*\nOlá, tudo bem?` : "Olá, tudo bem?";

  return (
    <div className="space-y-6 mt-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Meu Perfil</CardTitle>
          <CardDescription>Altere seu nome, cargo e foto de perfil</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
              <Avatar className="h-20 w-20 border-2 border-border">
                <AvatarImage src={avatarUrl || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-xl font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading ? <Loader2 size={20} className="animate-spin text-primary" /> : <Camera size={20} className="text-primary" />}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Foto de perfil</p>
              <p className="text-xs text-muted-foreground">Clique para alterar (máx 2MB)</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} className="bg-secondary border-border" /></div>
            <div className="space-y-2"><Label>E-mail</Label><Input value={profile?.email || ""} disabled className="bg-muted border-border text-muted-foreground" /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Cargo</Label><Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex: Gerente, Recepcionista" className="bg-secondary border-border" /></div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Assinatura nas Mensagens</CardTitle>
          <CardDescription>Quando ativo, seu nome aparecerá em negrito antes de cada mensagem enviada</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Assinar mensagens com meu nome</p>
              <p className="text-xs text-muted-foreground">Formato: <span className="font-semibold">*{nome || "Seu Nome"}*</span></p>
            </div>
            <Switch checked={signatureEnabled} onCheckedChange={setSignatureEnabled} />
          </div>
          <div className="rounded-lg border border-border bg-secondary/50 p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-medium mb-2">Pré-visualização</p>
            <div className="rounded-lg bg-primary/20 px-3 py-2 max-w-[280px] ml-auto">
              <p className="text-sm text-foreground whitespace-pre-line">{signaturePreview}</p>
              <div className="flex justify-end mt-1"><span className="text-[10px] text-muted-foreground">14:30</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90">
        {saving ? <Loader2 className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
        {saving ? "Salvando..." : "Salvar Configurações"}
      </Button>
    </div>
  );
}

type Clinica = {
  id: string; nome: string; cidade: string; telefone: string | null;
  endereco: string | null; location_link: string | null; ativa: boolean;
  appointment_template_name: string | null; tenant_id: string | null;
};

function ClinicasTab() {
  const [clinicas, setClinicas] = useState<Clinica[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nome: "", cidade: "", telefone: "", endereco: "", location_link: "" });

  // Edição inline (endereço + link) e geração de modelo por unidade.
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ endereco: "", location_link: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [genId, setGenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("clinicas")
      .select("id, nome, cidade, telefone, endereco, location_link, ativa, appointment_template_name, tenant_id")
      .order("created_at", { ascending: true });
    if (error) toast.error("Erro ao carregar: " + error.message);
    setClinicas((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.nome.trim() || !form.cidade.trim()) { toast.error("Nome e cidade são obrigatórios"); return; }
    setSaving(true);
    const { error } = await supabase.from("clinicas").insert({
      nome: form.nome.trim(),
      cidade: form.cidade.trim(),
      telefone: form.telefone.trim() || null,
      endereco: form.endereco.trim() || null,
      location_link: form.location_link.trim() || null,
      ativa: true,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Clínica cadastrada!");
    setForm({ nome: "", cidade: "", telefone: "", endereco: "", location_link: "" });
    load();
  };

  const toggleAtiva = async (c: Clinica) => {
    const { error } = await supabase.from("clinicas").update({ ativa: !c.ativa } as any).eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const remove = async (c: Clinica) => {
    if (!confirm(`Excluir a clínica "${c.nome}"?`)) return;
    const { error } = await supabase.from("clinicas").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Clínica removida");
    load();
  };

  const startEdit = (c: Clinica) => {
    setEditId(c.id);
    setEditForm({ endereco: c.endereco || "", location_link: c.location_link || "" });
  };

  const saveEdit = async (c: Clinica) => {
    setEditSaving(true);
    const { error } = await supabase.from("clinicas").update({
      endereco: editForm.endereco.trim() || null,
      location_link: editForm.location_link.trim() || null,
    } as any).eq("id", c.id);
    setEditSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Unidade atualizada");
    setEditId(null);
    load();
  };

  const generateTemplate = async (c: Clinica) => {
    if (!c.endereco || !c.endereco.trim()) { toast.error("Cadastre o endereço da unidade antes de gerar o modelo"); return; }
    setGenId(c.id);
    try {
      const res = await generateAndSubmitAppointmentTemplate(c);
      if (!res.ok) { toast.error("Falha ao enviar à Meta: " + (res.error || "erro desconhecido")); return; }
      toast.success(`Modelo "${res.name}" enviado à Meta (status: ${res.status}). A aprovação pode levar alguns minutos.`);
      load();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || e));
    } finally {
      setGenId(null);
    }
  };

  return (
    <div className="space-y-6 mt-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Cadastrar nova clínica/unidade</CardTitle>
          <CardDescription>Endereço e link de localização são usados para gerar o modelo de agendamento da unidade.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label>Nome *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Clínica Centro" className="bg-secondary border-border" /></div>
            <div className="space-y-2"><Label>Cidade *</Label><Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} placeholder="Ex: São Paulo" className="bg-secondary border-border" /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="Opcional" className="bg-secondary border-border" /></div>
            <div className="space-y-2"><Label>Endereço</Label><Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Rua, número, bairro" className="bg-secondary border-border" /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Link de localização</Label><Input value={form.location_link} onChange={(e) => setForm({ ...form, location_link: e.target.value })} placeholder="Ex: https://maps.app.goo.gl/..." className="bg-secondary border-border" /></div>
          </div>
          <Button onClick={create} disabled={saving} className="gradient-orange text-primary-foreground font-semibold">
            {saving ? <Loader2 className="animate-spin mr-2" size={16} /> : <Plus className="mr-2" size={16} />}
            Cadastrar unidade
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Unidades cadastradas</CardTitle>
          <CardDescription>{clinicas.length} {clinicas.length === 1 ? "unidade" : "unidades"} no total</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground"><Loader2 className="inline animate-spin mr-2" size={14} /> Carregando...</div>
          ) : clinicas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma unidade cadastrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {clinicas.map((c) => (
                <div key={c.id} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">{c.nome}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.cidade}{c.telefone ? ` · ${c.telefone}` : ""}{c.endereco ? ` · ${c.endereco}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Switch checked={c.ativa} onCheckedChange={() => toggleAtiva(c)} />
                        <span className="text-xs text-muted-foreground">{c.ativa ? "Ativa" : "Inativa"}</span>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Editar endereço/link" onClick={() => (editId === c.id ? setEditId(null) : startEdit(c))}>
                        <Pencil size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(c)} className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Excluir">
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>

                  {editId === c.id && (
                    <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2">
                      <div className="space-y-1"><Label className="text-xs">Endereço</Label><Input value={editForm.endereco} onChange={(e) => setEditForm({ ...editForm, endereco: e.target.value })} placeholder="Rua, número, bairro" className="h-8 text-xs bg-secondary border-border" /></div>
                      <div className="space-y-1"><Label className="text-xs">Link de localização</Label><Input value={editForm.location_link} onChange={(e) => setEditForm({ ...editForm, location_link: e.target.value })} placeholder="https://maps.app.goo.gl/..." className="h-8 text-xs bg-secondary border-border" /></div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => setEditId(null)}><X size={12} className="mr-1" />Cancelar</Button>
                        <Button size="sm" className="h-7 text-xs flex-1 gradient-orange text-primary-foreground" onClick={() => saveEdit(c)} disabled={editSaving}>{editSaving ? "Salvando..." : "Salvar"}</Button>
                      </div>
                    </div>
                  )}

                  {/* Modelo de agendamento da unidade */}
                  <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                    <div className="min-w-0 flex items-center gap-1.5 text-xs">
                      <MapPin size={12} className="shrink-0 text-muted-foreground" />
                      {c.appointment_template_name ? (
                        <span className="text-emerald-600 truncate flex items-center gap-1">
                          <CheckCircle2 size={12} /> Modelo: <span className="font-mono">{c.appointment_template_name}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Sem modelo de agendamento</span>
                      )}
                    </div>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs gap-1 shrink-0"
                      onClick={() => generateTemplate(c)}
                      disabled={genId === c.id}
                      title={c.appointment_template_name ? "Reenviar o modelo à Meta" : "Gerar e enviar o modelo à Meta para aprovação"}
                    >
                      {genId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      {c.appointment_template_name ? "Reenviar à Meta" : "Gerar modelo"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type BackupManifest = {
  stamp: string;
  total_rows?: number;
  finished_at?: string;
  updated_at?: string;
  errors?: string[];
  tables?: Record<string, { rows: number; parts: number }>;
};

// Tabelas cuja restauração re-dispara triggers/automações (recriar linhas as
// trata como "entrada" no funil). Restaurar essas exige mais cuidado.
const RESTORE_SENSITIVE = new Set(["crm_leads", "messages", "crm_lead_stage_history"]);

function BackupsTab() {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [manifests, setManifests] = useState<Record<string, BackupManifest | null>>({});
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [restorePanel, setRestorePanel] = useState<{ date: string; table: string; rows: number } | null>(null);
  const [restoreMode, setRestoreMode] = useState<"insert_missing" | "overwrite">("insert_missing");
  const [restoring, setRestoring] = useState(false);

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("daily-backup", { body });
    if (error) throw new Error(error.message || "Erro na função de backup");
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const loadDates = async () => {
    setLoading(true);
    try {
      const d = await invoke({ action: "list" });
      setDates(d.backups || []);
    } catch (e: any) {
      toast.error("Erro ao listar backups: " + e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { loadDates(); }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      await invoke({ action: "run" });
      toast.success("Backup iniciado. Ele roda em segundo plano e aparece na lista em alguns minutos.");
      setTimeout(loadDates, 8000);
    } catch (e: any) {
      toast.error("Erro ao iniciar backup: " + e.message);
    } finally { setRunning(false); }
  };

  const toggleExpand = async (date: string) => {
    if (expanded === date) { setExpanded(null); return; }
    setExpanded(date);
    setRestorePanel(null);
    if (!(date in manifests)) {
      setLoadingManifest(true);
      try {
        const d = await invoke({ action: "manifest", date });
        setManifests((m) => ({ ...m, [date]: d.manifest }));
      } catch (e: any) {
        toast.error("Erro ao carregar conteúdo: " + e.message);
        setManifests((m) => ({ ...m, [date]: null }));
      } finally { setLoadingManifest(false); }
    }
  };

  const downloadTable = async (date: string, table: string) => {
    setDownloading(`${date}/${table}`);
    try {
      const d = await invoke({ action: "files", date, table });
      const files: { name: string; url: string }[] = d.files || [];
      if (files.length === 0) { toast.error("Nenhum arquivo encontrado"); return; }
      for (const f of files) {
        const a = document.createElement("a");
        a.href = f.url; a.download = f.name; a.target = "_blank";
        document.body.appendChild(a); a.click(); a.remove();
        await new Promise((r) => setTimeout(r, 400));
      }
      toast.success(`${files.length} arquivo(s) de ${table} baixado(s)`);
    } catch (e: any) {
      toast.error("Erro ao baixar: " + e.message);
    } finally { setDownloading(null); }
  };

  const doRestore = async () => {
    if (!restorePanel) return;
    const { date, table } = restorePanel;
    setRestoring(true);
    try {
      let fromPart = 0, total = 0, failed = 0;
      while (true) {
        const d = await invoke({ action: "restore", date, table, mode: restoreMode, fromPart });
        total += d.restored || 0; failed += d.failed_rows || 0;
        if (d.partial) { fromPart = d.next_part; toast.info(`Restaurando ${table}… ${total} linhas`); }
        else break;
      }
      toast.success(`Restauração de ${table} concluída: ${total} linha(s)${failed ? `, ${failed} com falha` : ""}.`);
      setRestorePanel(null);
    } catch (e: any) {
      toast.error("Erro na restauração: " + e.message);
    } finally { setRestoring(false); }
  };

  const fmt = (n?: number) => (n ?? 0).toLocaleString("pt-BR");

  return (
    <div className="space-y-6 mt-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Backups do sistema</CardTitle>
              <CardDescription>Cópias diárias de todos os dados (leads, conversas, agendamentos, configurações). Retenção de 30 dias.</CardDescription>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={loadDates} disabled={loading} title="Atualizar lista">
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </Button>
              <Button size="sm" onClick={runNow} disabled={running} className="gradient-orange text-primary-foreground">
                {running ? <Loader2 className="animate-spin mr-1" size={14} /> : <Database className="mr-1" size={14} />}
                Fazer backup agora
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground"><Loader2 className="inline animate-spin mr-2" size={14} /> Carregando…</div>
          ) : dates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum backup ainda. Clique em “Fazer backup agora” ou aguarde o backup automático (diário, 03:00).</p>
          ) : (
            <div className="space-y-2">
              {dates.map((date) => {
                const man = manifests[date];
                const isOpen = expanded === date;
                return (
                  <div key={date} className="rounded-lg border border-border bg-secondary/30">
                    <button className="w-full flex items-center justify-between gap-2 p-3 text-left" onClick={() => toggleExpand(date)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {isOpen ? <ChevronDown size={16} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={16} className="shrink-0 text-muted-foreground" />}
                        <span className="font-semibold text-foreground">{date}</span>
                        {man?.finished_at ? (
                          <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> completo</span>
                        ) : man ? (
                          <span className="text-xs text-amber-600">parcial</span>
                        ) : null}
                      </div>
                      {man?.total_rows != null && <span className="text-xs text-muted-foreground shrink-0">{fmt(man.total_rows)} linhas</span>}
                    </button>

                    {isOpen && (
                      <div className="border-t border-border/60 p-3 space-y-2">
                        {loadingManifest && !man ? (
                          <div className="text-xs text-muted-foreground"><Loader2 className="inline animate-spin mr-1" size={12} /> Carregando conteúdo…</div>
                        ) : !man ? (
                          <p className="text-xs text-muted-foreground">Manifesto indisponível para este backup.</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 gap-1">
                              {Object.entries(man.tables || {})
                                .filter(([, v]) => v.rows > 0)
                                .sort((a, b) => b[1].rows - a[1].rows)
                                .map(([table, v]) => (
                                  <div key={table} className="flex items-center justify-between gap-2 rounded-md bg-background/50 px-2 py-1.5">
                                    <div className="min-w-0 flex items-center gap-2 text-xs">
                                      <span className="font-mono text-foreground truncate">{table}</span>
                                      <span className="text-muted-foreground shrink-0">{fmt(v.rows)}</span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Baixar" disabled={downloading === `${date}/${table}`}
                                        onClick={() => downloadTable(date, table)}>
                                        {downloading === `${date}/${table}` ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700" title="Restaurar"
                                        onClick={() => { setRestoreMode("insert_missing"); setRestorePanel({ date, table, rows: v.rows }); }}>
                                        <RotateCcw size={12} />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                            </div>

                            {restorePanel && restorePanel.date === date && (
                              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                                <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
                                  <AlertTriangle size={14} /> Restaurar <span className="font-mono">{restorePanel.table}</span> ({fmt(restorePanel.rows)} linhas) do backup {date}
                                </div>
                                <div className="space-y-1.5">
                                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                                    <input type="radio" checked={restoreMode === "insert_missing"} onChange={() => setRestoreMode("insert_missing")} className="mt-0.5" />
                                    <span><b>Recuperar apagados</b> — reinsere apenas linhas que não existem mais. Não altera os dados atuais. (recomendado)</span>
                                  </label>
                                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                                    <input type="radio" checked={restoreMode === "overwrite"} onChange={() => setRestoreMode("overwrite")} className="mt-0.5" />
                                    <span><b>Sobrescrever</b> — repõe as linhas ao estado do backup, <b>descartando alterações feitas depois</b>.</span>
                                  </label>
                                </div>
                                {RESTORE_SENSITIVE.has(restorePanel.table) && (
                                  <p className="text-[11px] text-amber-700/90 leading-snug">
                                    Atenção: restaurar esta tabela pode re-disparar automações. Para recuperação completa do banco, use os backups gerenciados do Supabase.
                                  </p>
                                )}
                                <div className="flex gap-2 pt-1">
                                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => setRestorePanel(null)} disabled={restoring}>Cancelar</Button>
                                  <Button size="sm" className="h-7 text-xs flex-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={doRestore} disabled={restoring}>
                                    {restoring ? <><Loader2 size={12} className="animate-spin mr-1" /> Restaurando…</> : "Confirmar restauração"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Recuperação de desastre (recomendado)</CardTitle>
          <CardDescription>Estes backups são um snapshot lógico complementar. Para restauração point-in-time do banco inteiro, ative os backups gerenciados do Supabase (plano Pro): painel Supabase → Database → Backups (Daily backups + PITR).</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

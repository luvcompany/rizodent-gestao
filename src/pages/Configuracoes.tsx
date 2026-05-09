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
import { Camera, Loader2, Save, Building2, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";

export default function Configuracoes() {
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
        </TabsList>
        <TabsContent value="perfil"><PerfilTab /></TabsContent>
        <TabsContent value="clinicas"><ClinicasTab /></TabsContent>
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

type Clinica = { id: string; nome: string; cidade: string; telefone: string | null; endereco: string | null; ativa: boolean };

function ClinicasTab() {
  const [clinicas, setClinicas] = useState<Clinica[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nome: "", cidade: "", telefone: "", endereco: "" });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("clinicas")
      .select("id, nome, cidade, telefone, endereco, ativa")
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
      ativa: true,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Clínica cadastrada!");
    setForm({ nome: "", cidade: "", telefone: "", endereco: "" });
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

  return (
    <div className="space-y-6 mt-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Cadastrar nova clínica/empresa</CardTitle>
          <CardDescription>Adicione as unidades integradas a este sistema</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label>Nome *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Clínica Centro" className="bg-secondary border-border" /></div>
            <div className="space-y-2"><Label>Cidade *</Label><Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} placeholder="Ex: São Paulo" className="bg-secondary border-border" /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="Opcional" className="bg-secondary border-border" /></div>
            <div className="space-y-2"><Label>Endereço</Label><Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Opcional" className="bg-secondary border-border" /></div>
          </div>
          <Button onClick={create} disabled={saving} className="gradient-orange text-primary-foreground font-semibold">
            {saving ? <Loader2 className="animate-spin mr-2" size={16} /> : <Plus className="mr-2" size={16} />}
            Cadastrar clínica
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Clínicas cadastradas</CardTitle>
          <CardDescription>{clinicas.length} {clinicas.length === 1 ? "clínica" : "clínicas"} no total</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground"><Loader2 className="inline animate-spin mr-2" size={14} /> Carregando...</div>
          ) : clinicas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma clínica cadastrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {clinicas.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">{c.nome}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.cidade}{c.telefone ? ` · ${c.telefone}` : ""}{c.endereco ? ` · ${c.endereco}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch checked={c.ativa} onCheckedChange={() => toggleAtiva(c)} />
                      <span className="text-xs text-muted-foreground">{c.ativa ? "Ativa" : "Inativa"}</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)} className="text-destructive hover:text-destructive">
                      <Trash2 size={14} />
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

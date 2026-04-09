import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Copy, Pencil, Image, FileAudio, FileText, Search, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

type WhatsAppTemplate = {
  id: string; name: string; category: string; language: string; status: string;
  header_type: string | null; header_content: string | null; body_text: string | null;
  footer_text: string | null; buttons: unknown; meta_template_id: string | null;
  created_at: string; updated_at: string;
};

type Integration = {
  id: string;
  key: string;
  config: any;
  status: string;
};

const PAGE_SIZE = 10;

export default function CrmModelos() {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("todos");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>("");
  const [syncing, setSyncing] = useState(false);

  const [form, setForm] = useState({
    id: "", name: "", category: "UTILITY", language: "pt_BR", header_type: "" as string,
    header_content: "", body_text: "", footer_text: "",
    buttons: [] as { type: string; text: string; url?: string }[],
    hasHeader: false,
  });

  // Load integrations
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("integrations").select("*").like("key", "whatsapp_%").eq("status", "connected");
      const list = (data || []) as Integration[];
      setIntegrations(list);
      if (list.length > 0 && !selectedIntegration) {
        setSelectedIntegration(list[0].key);
      }
    };
    load();
  }, []);

  const fetchTemplates = useCallback(async () => {
    if (!selectedIntegration) return;
    setLoading(true);
    // Load from local DB first (instant)
    const { data, error } = await supabase.from("crm_whatsapp_templates").select("*").order("created_at", { ascending: false });
    if (!error) setTemplates((data as WhatsAppTemplate[]) || []);
    setLoading(false);

    // Then sync from Meta API in background (non-blocking)
    try {
      const { data: syncData } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "list", integration_key: selectedIntegration },
      });
      // Reload if sync brought changes
      if (syncData) {
        const { data: refreshed } = await supabase.from("crm_whatsapp_templates").select("*").order("created_at", { ascending: false });
        if (refreshed) setTemplates(refreshed as WhatsAppTemplate[]);
      }
    } catch (e) {
      console.log("[Templates] Meta sync skipped:", e);
    }
  }, [selectedIntegration]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSync = async () => {
    if (!selectedIntegration || syncing) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "list", integration_key: selectedIntegration },
      });
      if (error) throw error;
      const { data: refreshed } = await supabase.from("crm_whatsapp_templates").select("*").order("created_at", { ascending: false });
      if (refreshed) setTemplates(refreshed as WhatsAppTemplate[]);
      toast.success(`Sincronizado! ${data?.count || 0} modelos encontrados na Meta.`);
    } catch (e: any) {
      toast.error("Erro ao sincronizar: " + (e?.message || String(e)));
    } finally {
      setSyncing(false);
    }
  };

  // Helper to extract base name without random suffix
  const baseName = (name: string) => name.replace(/_[a-z0-9]{4,10}$/, '');

  // Deduplicate templates by base name, keeping the most recent one
  const deduped = (() => {
    const map = new Map<string, WhatsAppTemplate>();
    for (const t of templates) {
      const key = baseName(t.name);
      const existing = map.get(key);
      if (!existing || new Date(t.updated_at) > new Date(existing.updated_at)) {
        map.set(key, t);
      }
    }
    return Array.from(map.values());
  })();

  const filtered = deduped.filter(t => {
    if (tab === "aprovados" && t.status !== "APPROVED") return false;
    if (tab === "pendentes" && t.status !== "PENDING" && t.status !== "REJECTED") return false;
    const cleanName = baseName(t.name).toLowerCase();
    if (search && !cleanName.includes(search.toLowerCase()) && !(t.body_text || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const resetForm = () => setForm({
    id: "", name: "", category: "UTILITY", language: "pt_BR", header_type: "",
    header_content: "", body_text: "", footer_text: "", buttons: [], hasHeader: false,
  });

  const openEdit = (t: WhatsAppTemplate) => {
    setForm({
      id: t.id, name: t.name, category: t.category, language: t.language,
      header_type: t.header_type || "", header_content: t.header_content || "",
      body_text: t.body_text || "", footer_text: t.footer_text || "",
      buttons: (t.buttons as { type: string; text: string; url?: string }[]) || [],
      hasHeader: !!t.header_type,
    });
    setModalOpen(true);
  };

  const handleDuplicate = async (t: WhatsAppTemplate) => {
    const { error } = await supabase.from("crm_whatsapp_templates").insert({
      name: t.name + "_copia", category: t.category, language: t.language,
      header_type: t.header_type, header_content: t.header_content,
      body_text: t.body_text, footer_text: t.footer_text, buttons: t.buttons as any,
      status: "PENDING",
    });
    if (error) toast.error("Erro ao duplicar"); else { toast.success("Duplicado"); fetchTemplates(); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const template = templates.find(t => t.id === deleteId);
    if (!template) return;

    // Try to delete from Meta API first
    if (template.meta_template_id) {
      try {
        const { error } = await supabase.functions.invoke("manage-whatsapp-templates", {
          body: { action: "delete", template_name: template.name, integration_key: selectedIntegration },
        });
        if (error) {
          toast.error("Erro ao deletar na Meta. Removendo apenas localmente.");
        }
      } catch {
        toast.warning("API Meta indisponível. Removendo apenas localmente.");
      }
    }

    await supabase.from("crm_whatsapp_templates").delete().eq("id", deleteId);
    toast.success("Template excluído");
    setDeleteId(null);
    fetchTemplates();
  };

  const handleSave = async (submit: boolean) => {
    if (submitting) return;
    const nameRegex = /^[a-z0-9_]+$/;
    if (!form.name || !nameRegex.test(form.name)) {
      toast.error("Nome deve conter apenas letras minúsculas, números e underscore");
      return;
    }
    if (!form.body_text) {
      toast.error("O corpo da mensagem é obrigatório");
      return;
    }
    if (submit) {
      setSubmitting(true);
      setModalOpen(false);
    }

    // If editing, just update locally
    if (form.id) {
      const payload = {
        name: form.name, category: form.category, language: form.language,
        header_type: form.hasHeader ? form.header_type : null,
        header_content: form.hasHeader ? form.header_content : null,
        body_text: form.body_text, footer_text: form.footer_text || null,
        buttons: form.buttons.length > 0 ? form.buttons : null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("crm_whatsapp_templates").update(payload).eq("id", form.id);
      if (error) { toast.error("Erro ao salvar"); return; }
      toast.success("Template atualizado");
      setModalOpen(false);
      resetForm();
      fetchTemplates();
      return;
    }

    // New template: if submit, send directly to Meta via edge function
    if (submit) {
      try {
        const { data, error: fnError } = await supabase.functions.invoke("manage-whatsapp-templates", {
          body: {
            action: "create",
            integration_key: selectedIntegration,
            name: form.name,
            category: form.category,
            language: form.language,
            header_type: form.hasHeader ? form.header_type : null,
            header_content: form.hasHeader ? form.header_content : null,
            body_text: form.body_text,
            footer_text: form.footer_text || null,
            buttons: form.buttons.length > 0 ? form.buttons : null,
          },
        });

        if (fnError) {
          toast.error("Erro ao enviar para Meta: " + fnError.message);
          setSubmitting(false);
          return;
        }

        // Check if the response contains an error from Meta
        if (data?.error) {
          const details = data.details ? JSON.stringify(data.details, null, 2) : "";
          toast.error(`Erro da Meta: ${data.error}\n${details}`, { duration: 10000 });
          setSubmitting(false);
          return;
        }

        toast.success(`Template submetido! Status: ${data?.status || "PENDING"}`);
      } catch (e: any) {
        toast.error("Erro ao enviar: " + (e?.message || String(e)));
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    } else {
      // Save as draft locally only
      const payload = {
        name: form.name, category: form.category, language: form.language,
        header_type: form.hasHeader ? form.header_type : null,
        header_content: form.hasHeader ? form.header_content : null,
        body_text: form.body_text, footer_text: form.footer_text || null,
        buttons: form.buttons.length > 0 ? form.buttons : null,
        status: "DRAFT",
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("crm_whatsapp_templates").insert(payload);
      if (error) { toast.error("Erro ao salvar rascunho"); return; }
      toast.success("Rascunho salvo");
    }

    setModalOpen(false);
    resetForm();
    fetchTemplates();
  };

  const addButton = () => {
    if (form.buttons.length >= 3) return;
    setForm(p => ({ ...p, buttons: [...p.buttons, { type: "QUICK_REPLY", text: "" }] }));
  };

  const insertVariable = () => {
    const varNum = (form.body_text.match(/\{\{\d+\}\}/g) || []).length + 1;
    setForm(p => ({ ...p, body_text: p.body_text + `{{${varNum}}}` }));
  };

  const statusBadge = (s: string) => {
    if (s === "APPROVED") return <span className="text-[10px] bg-green-900/30 text-green-400 px-2 py-0.5 rounded-full font-medium">Aprovado</span>;
    if (s === "PENDING") return <span className="text-[10px] bg-yellow-900/30 text-yellow-400 px-2 py-0.5 rounded-full font-medium">Pendente</span>;
    return <span className="text-[10px] bg-destructive/20 text-destructive px-2 py-0.5 rounded-full font-medium">Rejeitado</span>;
  };

  const categoryBadge = (c: string) => {
    const colors: Record<string, string> = {
      MARKETING: "bg-purple-900/30 text-purple-400",
      UTILITY: "bg-blue-900/30 text-blue-400",
      AUTHENTICATION: "bg-green-900/30 text-green-400",
    };
    return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[c] || "bg-secondary text-muted-foreground"}`}>{c === "MARKETING" ? "Marketing" : c === "UTILITY" ? "Utilidade" : "Autenticação"}</span>;
  };

  const headerIcon = (type: string | null) => {
    if (type === "IMAGE") return <Image size={12} className="text-muted-foreground" />;
    if (type === "AUDIO") return <FileAudio size={12} className="text-muted-foreground" />;
    if (type === "DOCUMENT") return <FileText size={12} className="text-muted-foreground" />;
    return null;
  };

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Header - FIXED */}
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-foreground">Modelos de Mensagem</h1>
          {integrations.length > 0 && (
            <Select value={selectedIntegration} onValueChange={setSelectedIntegration}>
              <SelectTrigger className="w-[220px] h-8 text-sm">
                <SelectValue placeholder="Selecione a integração" />
              </SelectTrigger>
              <SelectContent>
                {integrations.map((intg) => (
                  <SelectItem key={intg.key} value={intg.key}>
                    {(intg.config as any)?.display_name || intg.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={14} className={`mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </Button>
          <Button size="sm" onClick={() => { resetForm(); setModalOpen(true); }}>
            <Plus size={14} className="mr-1" /> Novo Modelo
          </Button>
        </div>
      </div>

      {/* Tabs + Filters - FIXED */}
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1">
            {["todos", "aprovados", "pendentes"].map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(0); }}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${tab === t ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-secondary"}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="pl-7 pr-3 py-1 text-sm border border-border rounded-md bg-secondary text-foreground w-48 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" placeholder="Buscar por nome..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <select className="text-sm border border-border rounded-md px-2 py-1 bg-secondary text-foreground" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(0); }}>
              <option value="all">Todas categorias</option>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utilidade</option>
              <option value="AUTHENTICATION">Autenticação</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid - SCROLLABLE */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? <div className="text-center text-muted-foreground py-10">Carregando...</div> : paginated.length === 0 ? <div className="text-center text-muted-foreground py-10">Nenhum modelo encontrado</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginated.map(t => (
              <div key={t.id} className="bg-card rounded-lg border border-border p-4 hover:border-primary/30 transition-all shadow-card">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-semibold text-sm text-foreground break-all" title={t.name}>{baseName(t.name)}</div>
                  <div className="flex items-center gap-1">{headerIcon(t.header_type)}</div>
                </div>
                <div className="flex items-center gap-2 mb-2">{categoryBadge(t.category)} {statusBadge(t.status)}</div>
                <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{t.body_text || "Sem corpo"}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleDateString("pt-BR")}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(t)} className="p-1 hover:bg-secondary rounded transition-colors"><Pencil size={14} className="text-muted-foreground" /></button>
                    <button onClick={() => handleDuplicate(t)} className="p-1 hover:bg-secondary rounded transition-colors"><Copy size={14} className="text-muted-foreground" /></button>
                    <button onClick={() => setDeleteId(t.id)} className="p-1 hover:bg-destructive/20 rounded transition-colors"><Trash2 size={14} className="text-destructive" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 text-muted-foreground disabled:opacity-30"><ChevronLeft size={18} /></button>
            <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 text-muted-foreground disabled:opacity-30"><ChevronRight size={18} /></button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir modelo?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Editar Modelo" : "Novo Modelo"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Form */}
            <div className="space-y-3">
              <div>
                <Label>Nome do modelo *</Label>
                <Input className="font-mono text-sm" placeholder="boas_vindas_lead" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))} />
                <span className="text-[10px] text-muted-foreground">Apenas letras minúsculas, números e _</span>
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidade</SelectItem>
                    <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Idioma</Label>
                <Select value={form.language} onValueChange={v => setForm(p => ({ ...p, language: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt_BR">Português (BR)</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Header */}
              <div className="flex items-center gap-2">
                <Switch checked={form.hasHeader} onCheckedChange={v => setForm(p => ({ ...p, hasHeader: v }))} />
                <Label>Cabeçalho</Label>
              </div>
              {form.hasHeader && (
                <div className="space-y-2 pl-4 border-l-2 border-border">
                  <Select value={form.header_type} onValueChange={v => setForm(p => ({ ...p, header_type: v }))}>
                    <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEXT">Texto</SelectItem>
                      <SelectItem value="IMAGE">Imagem</SelectItem>
                      <SelectItem value="DOCUMENT">Documento</SelectItem>
                      <SelectItem value="AUDIO">Áudio</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Conteúdo do cabeçalho" value={form.header_content} onChange={e => setForm(p => ({ ...p, header_content: e.target.value }))} />
                </div>
              )}

              {/* Body */}
              <div>
                <div className="flex items-center justify-between">
                  <Label>Corpo da mensagem</Label>
                  <button onClick={insertVariable} className="text-xs text-primary hover:underline">+ Variável</button>
                </div>
                <Textarea rows={5} placeholder="Olá {{1}}, tudo bem?" value={form.body_text} onChange={e => setForm(p => ({ ...p, body_text: e.target.value }))} />
              </div>

              {/* Footer */}
              <div>
                <Label>Rodapé (opcional)</Label>
                <Input placeholder="Enviado por Rizo" value={form.footer_text} onChange={e => setForm(p => ({ ...p, footer_text: e.target.value }))} />
              </div>

              {/* Buttons */}
              <div>
                <div className="flex items-center justify-between">
                  <Label>Botões (máx 3)</Label>
                  {form.buttons.length < 3 && <button onClick={addButton} className="text-xs text-primary hover:underline">+ Botão</button>}
                </div>
                {form.buttons.map((btn, i) => (
                  <div key={i} className="flex gap-2 mt-1 items-center">
                    <select className="text-sm border border-border rounded px-2 py-1 bg-secondary text-foreground" value={btn.type} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], type: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }}>
                      <option value="QUICK_REPLY">Resposta rápida</option>
                      <option value="URL">URL</option>
                    </select>
                    <Input className="flex-1 text-sm" placeholder="Texto" value={btn.text} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], text: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }} />
                    {btn.type === "URL" && <Input className="flex-1 text-sm" placeholder="https://..." value={btn.url || ""} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], url: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }} />}
                    <button onClick={() => setForm(p => ({ ...p, buttons: p.buttons.filter((_, j) => j !== i) }))}><Trash2 size={14} className="text-destructive" /></button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => handleSave(false)}>Salvar rascunho</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => handleSave(true)}>Submeter para aprovação</Button>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="bg-secondary rounded-lg p-4 flex flex-col items-center">
              <span className="text-xs text-muted-foreground mb-3">Preview</span>
              <div className="w-full max-w-[300px]">
                <div className="bg-card rounded-lg shadow-card border border-border p-3 text-sm">
                  {form.hasHeader && form.header_content && (
                    <div className="font-semibold text-foreground mb-1 text-xs">
                      {form.header_type === "IMAGE" ? <div className="bg-secondary rounded h-20 flex items-center justify-center text-muted-foreground mb-1"><Image size={24} /></div> : null}
                      {form.header_type === "TEXT" ? form.header_content : null}
                    </div>
                  )}
                  <p className="text-foreground text-xs whitespace-pre-wrap">{form.body_text || "Corpo da mensagem..."}</p>
                  {form.footer_text && <p className="text-[10px] text-muted-foreground mt-1">{form.footer_text}</p>}
                </div>
                {form.buttons.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {form.buttons.map((btn, i) => (
                      <div key={i} className="bg-card rounded shadow-card border border-border py-2 text-center text-primary text-xs font-medium">{btn.text || "Botão"}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Copy, Pencil, Image, FileAudio, FileText, ArrowLeft, Search, ChevronLeft, ChevronRight } from "lucide-react";

type WhatsAppTemplate = {
  id: string; name: string; category: string; language: string; status: string;
  header_type: string | null; header_content: string | null; body_text: string | null;
  footer_text: string | null; buttons: unknown; meta_template_id: string | null;
  created_at: string; updated_at: string;
};

const PAGE_SIZE = 10;

export default function CrmModelos() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("todos");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    id: "", name: "", category: "UTILITY", language: "pt_BR", header_type: "" as string,
    header_content: "", body_text: "", footer_text: "",
    buttons: [] as { type: string; text: string; url?: string }[],
    hasHeader: false,
  });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("crm_whatsapp_templates").select("*").order("created_at", { ascending: false });
    if (!error) setTemplates((data as WhatsAppTemplate[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const filtered = templates.filter(t => {
    if (tab === "aprovados" && t.status !== "APPROVED") return false;
    if (tab === "pendentes" && t.status !== "PENDING" && t.status !== "REJECTED") return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
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
    await supabase.from("crm_whatsapp_templates").delete().eq("id", deleteId);
    toast.success("Template excluído");
    setDeleteId(null);
    fetchTemplates();
  };

  const handleSave = async (submit: boolean) => {
    const nameRegex = /^[a-z0-9_]+$/;
    if (!form.name || !nameRegex.test(form.name)) {
      toast.error("Nome deve conter apenas letras minúsculas, números e underscore");
      return;
    }
    const payload = {
      name: form.name, category: form.category, language: form.language,
      header_type: form.hasHeader ? form.header_type : null,
      header_content: form.hasHeader ? form.header_content : null,
      body_text: form.body_text, footer_text: form.footer_text || null,
      buttons: form.buttons.length > 0 ? form.buttons : null,
      status: "PENDING",
      updated_at: new Date().toISOString(),
    };

    let error;
    if (form.id) {
      ({ error } = await supabase.from("crm_whatsapp_templates").update(payload).eq("id", form.id));
    } else {
      ({ error } = await supabase.from("crm_whatsapp_templates").insert(payload));
    }

    if (error) { toast.error("Erro ao salvar"); return; }

    if (submit) {
      // Call edge function
      try {
        const { error: fnError } = await supabase.functions.invoke("submit-whatsapp-template", {
          body: { template_name: form.name },
        });
        if (fnError) throw fnError;
        toast.success("Template submetido para aprovação");
      } catch {
        toast.warning("Template salvo mas API não configurada ainda");
      }
    } else {
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
    if (s === "APPROVED") return <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Aprovado</span>;
    if (s === "PENDING") return <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Pendente</span>;
    return <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Rejeitado</span>;
  };

  const categoryBadge = (c: string) => {
    const colors: Record<string, string> = { MARKETING: "bg-purple-100 text-purple-700", UTILITY: "bg-blue-100 text-blue-700", AUTHENTICATION: "bg-green-100 text-green-700" };
    return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[c] || "bg-gray-100 text-gray-600"}`}>{c === "MARKETING" ? "Marketing" : c === "UTILITY" ? "Utilidade" : "Autenticação"}</span>;
  };

  const headerIcon = (type: string | null) => {
    if (type === "IMAGE") return <Image size={12} className="text-gray-400" />;
    if (type === "AUDIO") return <FileAudio size={12} className="text-gray-400" />;
    if (type === "DOCUMENT") return <FileText size={12} className="text-gray-400" />;
    return null;
  };

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-gray-600" onClick={() => navigate("/crm")}>
            <ArrowLeft size={16} className="mr-1" /> Voltar
          </Button>
          <h1 className="text-lg font-bold text-gray-900">Modelos de Mensagem</h1>
        </div>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { resetForm(); setModalOpen(true); }}>
          <Plus size={14} className="mr-1" /> Novo Modelo
        </Button>
      </div>

      {/* Tabs + Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1">
            {["todos", "aprovados", "pendentes"].map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(0); }}
                className={`px-3 py-1 text-sm rounded-md ${tab === t ? "bg-blue-50 text-blue-600 font-medium" : "text-gray-500 hover:bg-gray-50"}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="pl-7 pr-3 py-1 text-sm border rounded-md bg-white text-gray-700 w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="Buscar por nome..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <select className="text-sm border rounded-md px-2 py-1 bg-white text-gray-700" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(0); }}>
              <option value="all">Todas categorias</option>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utilidade</option>
              <option value="AUTHENTICATION">Autenticação</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? <div className="text-center text-gray-400 py-10">Carregando...</div> : paginated.length === 0 ? <div className="text-center text-gray-400 py-10">Nenhum modelo encontrado</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginated.map(t => (
              <div key={t.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-semibold text-sm text-gray-900">{t.name}</div>
                  <div className="flex items-center gap-1">{headerIcon(t.header_type)}</div>
                </div>
                <div className="flex items-center gap-2 mb-2">{categoryBadge(t.category)} {statusBadge(t.status)}</div>
                <p className="text-xs text-gray-500 line-clamp-3 mb-3">{t.body_text || "Sem corpo"}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">{new Date(t.created_at).toLocaleDateString("pt-BR")}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(t)} className="p-1 hover:bg-gray-100 rounded"><Pencil size={14} className="text-gray-500" /></button>
                    <button onClick={() => handleDuplicate(t)} className="p-1 hover:bg-gray-100 rounded"><Copy size={14} className="text-gray-500" /></button>
                    <button onClick={() => setDeleteId(t.id)} className="p-1 hover:bg-red-50 rounded"><Trash2 size={14} className="text-red-400" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 text-gray-500 disabled:opacity-30"><ChevronLeft size={18} /></button>
            <span className="text-sm text-gray-600">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 text-gray-500 disabled:opacity-30"><ChevronRight size={18} /></button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="bg-white text-gray-900 max-w-sm">
          <DialogHeader><DialogTitle>Excluir modelo?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" className="border-gray-300 text-gray-700" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-white text-gray-900 max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Editar Modelo" : "Novo Modelo"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Form */}
            <div className="space-y-3">
              <div>
                <Label className="text-gray-700">Nome do modelo *</Label>
                <Input className="bg-white border-gray-300 text-gray-900 font-mono text-sm" placeholder="boas_vindas_lead" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))} />
                <span className="text-[10px] text-gray-400">Apenas letras minúsculas, números e _</span>
              </div>
              <div>
                <Label className="text-gray-700">Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-gray-900">
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidade</SelectItem>
                    <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-700">Idioma</Label>
                <Select value={form.language} onValueChange={v => setForm(p => ({ ...p, language: v }))}>
                  <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-gray-900">
                    <SelectItem value="pt_BR">Português (BR)</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Header */}
              <div className="flex items-center gap-2">
                <Switch checked={form.hasHeader} onCheckedChange={v => setForm(p => ({ ...p, hasHeader: v }))} />
                <Label className="text-gray-700">Cabeçalho</Label>
              </div>
              {form.hasHeader && (
                <div className="space-y-2 pl-4 border-l-2 border-gray-200">
                  <Select value={form.header_type} onValueChange={v => setForm(p => ({ ...p, header_type: v }))}>
                    <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent className="bg-white text-gray-900">
                      <SelectItem value="TEXT">Texto</SelectItem>
                      <SelectItem value="IMAGE">Imagem</SelectItem>
                      <SelectItem value="DOCUMENT">Documento</SelectItem>
                      <SelectItem value="AUDIO">Áudio</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="bg-white border-gray-300 text-gray-900" placeholder="Conteúdo do cabeçalho" value={form.header_content} onChange={e => setForm(p => ({ ...p, header_content: e.target.value }))} />
                </div>
              )}

              {/* Body */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-gray-700">Corpo da mensagem</Label>
                  <button onClick={insertVariable} className="text-xs text-blue-600 hover:underline">+ Variável</button>
                </div>
                <Textarea className="bg-white border-gray-300 text-gray-900" rows={5} placeholder="Olá {{1}}, tudo bem?" value={form.body_text} onChange={e => setForm(p => ({ ...p, body_text: e.target.value }))} />
              </div>

              {/* Footer */}
              <div>
                <Label className="text-gray-700">Rodapé (opcional)</Label>
                <Input className="bg-white border-gray-300 text-gray-900" placeholder="Enviado por Rizo" value={form.footer_text} onChange={e => setForm(p => ({ ...p, footer_text: e.target.value }))} />
              </div>

              {/* Buttons */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-gray-700">Botões (máx 3)</Label>
                  {form.buttons.length < 3 && <button onClick={addButton} className="text-xs text-blue-600 hover:underline">+ Botão</button>}
                </div>
                {form.buttons.map((btn, i) => (
                  <div key={i} className="flex gap-2 mt-1 items-center">
                    <select className="text-sm border rounded px-2 py-1 bg-white text-gray-700" value={btn.type} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], type: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }}>
                      <option value="QUICK_REPLY">Resposta rápida</option>
                      <option value="URL">URL</option>
                    </select>
                    <Input className="bg-white border-gray-300 text-gray-900 flex-1 text-sm" placeholder="Texto" value={btn.text} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], text: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }} />
                    {btn.type === "URL" && <Input className="bg-white border-gray-300 text-gray-900 flex-1 text-sm" placeholder="https://..." value={btn.url || ""} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], url: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }} />}
                    <button onClick={() => setForm(p => ({ ...p, buttons: p.buttons.filter((_, j) => j !== i) }))}><Trash2 size={14} className="text-red-400" /></button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 border-gray-300 text-gray-700" onClick={() => handleSave(false)}>Salvar rascunho</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => handleSave(true)}>Submeter para aprovação</Button>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="bg-[#e5ddd5] rounded-lg p-4 flex flex-col items-center">
              <span className="text-xs text-gray-500 mb-3">Preview</span>
              <div className="w-full max-w-[300px]">
                <div className="bg-white rounded-lg shadow-sm p-3 text-sm">
                  {form.hasHeader && form.header_content && (
                    <div className="font-semibold text-gray-900 mb-1 text-xs">
                      {form.header_type === "IMAGE" ? <div className="bg-gray-200 rounded h-20 flex items-center justify-center text-gray-400 mb-1"><Image size={24} /></div> : null}
                      {form.header_type === "TEXT" ? form.header_content : null}
                    </div>
                  )}
                  <p className="text-gray-800 text-xs whitespace-pre-wrap">{form.body_text || "Corpo da mensagem..."}</p>
                  {form.footer_text && <p className="text-[10px] text-gray-400 mt-1">{form.footer_text}</p>}
                </div>
                {form.buttons.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {form.buttons.map((btn, i) => (
                      <div key={i} className="bg-white rounded shadow-sm py-2 text-center text-blue-600 text-xs font-medium">{btn.text || "Botão"}</div>
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

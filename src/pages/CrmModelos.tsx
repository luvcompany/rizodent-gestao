import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Copy, Pencil, Image, FileAudio, FileText, Search, ChevronLeft, ChevronRight, RefreshCw, Users } from "lucide-react";
import { cleanTemplateName, deduplicateTemplates } from "@/lib/templateUtils";
import { useAuth } from "@/contexts/AuthContext";

import ShareRoleDialog, { type OwnerRole } from "@/components/crm/ShareRoleDialog";

const TEMPLATE_VARIABLES: { index: number; label: string; sample: string; hint: string }[] = [
  { index: 1, label: "Nome do lead", sample: "Maria Silva", hint: "lead.name (fallback: cliente)" },
  { index: 2, label: "Data e hora do agendamento", sample: "20/05/2026 às 14:00", hint: "próximo agendamento (fallback: data a confirmar)" },
  { index: 3, label: "Serviço de interesse", sample: "Implante dentário", hint: "lead.servico_interesse (fallback: consulta)" },
  { index: 4, label: "Telefone do lead", sample: "(11) 99999-9999", hint: "lead.phone" },
  { index: 5, label: "Origem do lead", sample: "Anúncio", hint: "lead.source" },
];


type WhatsAppTemplate = {
  id: string; name: string; category: string; language: string; status: string;
  header_type: string | null; header_content: string | null; body_text: string | null;
  footer_text: string | null; buttons: unknown; meta_template_id: string | null;
  created_at: string; updated_at: string;
  owner_role?: OwnerRole;
  shared_roles?: string[] | null;
};

const ROLE_LABEL: Record<string, string> = {
  gerente: "Gerente", crc: "CRC", posvenda: "Pós-venda", superadmin: "Superadmin",
};
const ROLE_BADGE_COLOR: Record<string, string> = {
  gerente: "bg-blue-900/30 text-blue-400",
  crc: "bg-purple-900/30 text-purple-400",
  posvenda: "bg-green-900/30 text-green-400",
  superadmin: "bg-red-900/30 text-red-400",
};

type Integration = {
  id: string;
  key: string;
  config: any;
  status: string;
};

const PAGE_SIZE = 10;

export default function CrmModelos() {
  const { userRole } = useAuth();
  const canShare = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";

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
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [shareTarget, setShareTarget] = useState<WhatsAppTemplate | null>(null);

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
    setLoading(true);
    // Load from local DB only — Meta sync moved to manual "Sincronizar" button
    const { data, error } = await supabase
      .from("crm_whatsapp_templates")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setTemplates((data as WhatsAppTemplate[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSync = useCallback(async (silent = false) => {
    if (!selectedIntegration || syncing) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "list", integration_key: selectedIntegration },
      });
      if (error) throw error;
      const { data: refreshed } = await supabase.from("crm_whatsapp_templates").select("*").order("created_at", { ascending: false });
      if (refreshed) setTemplates(refreshed as WhatsAppTemplate[]);
      setLastSyncAt(new Date());
      if (!silent) toast.success(`Sincronizado! ${data?.count || 0} modelos encontrados na Meta.`);
    } catch (e: any) {
      if (!silent) toast.error("Erro ao sincronizar: " + (e?.message || String(e)));
    } finally {
      setSyncing(false);
    }
  }, [selectedIntegration, syncing]);

  // Mapeamento dos 5 modelos antigos (com [colchete]) → novos com {{1}}/{{2}}
  const LEGACY_MIGRATION_MAP: {
    oldNamePrefix: string;
    newName: string;
    payload: {
      name: string;
      language: string;
      category: string;
      header_type: string | null;
      header_content: string | null;
      body_text: string;
      footer_text: string | null;
      buttons: { type: string; text: string; url?: string }[] | null;
    };
  }[] = [
    {
      oldNamePrefix: "agendamento_guanambi",
      newName: "agendamento_guanambi_v2",
      payload: {
        name: "agendamento_guanambi_v2",
        language: "pt_BR",
        category: "UTILITY",
        header_type: "TEXT",
        header_content: "📍 Agendamento Realizado",
        body_text:
          "Olá {{1}}! Seu agendamento foi realizado.\n\nData e horário: {{2}}\nServiço: Check-up odontológico\n\nEstamos localizados na Rua dos Expedicionários, 71 - Centro, ao lado do banco Santander.\n\nEstaremos te esperando 🧡",
        footer_text: "Rizodent",
        buttons: [{ type: "URL", text: "Ver localização", url: "https://maps.app.goo.gl/E8MHDBPVp4Mxr4gr6" }],
      },
    },
    {
      oldNamePrefix: "agendamento_itabuna",
      newName: "agendamento_itabuna_v2",
      payload: {
        name: "agendamento_itabuna_v2",
        language: "pt_BR",
        category: "UTILITY",
        header_type: "TEXT",
        header_content: "📍 Agendamento Realizado",
        body_text:
          "Olá {{1}}! Seu agendamento foi realizado.\n\nData e horário: {{2}}\nServiço: Check-up odontológico\n\nEstamos localizados na Avenida Cinquentenário, 375, ao lado da Jan e Ju e em frente ao banco Bradesco.\n\nEstaremos te esperando 🧡",
        footer_text: "Rizodent",
        buttons: [{ type: "URL", text: "Ver localização", url: "https://maps.app.goo.gl/iAmAiejknxwGLFa86" }],
      },
    },
    {
      oldNamePrefix: "agendamento_vca_1",
      newName: "agendamento_vca_1_v2",
      payload: {
        name: "agendamento_vca_1_v2",
        language: "pt_BR",
        category: "UTILITY",
        header_type: "TEXT",
        header_content: "📍 Agendamento Realizado",
        body_text:
          "Olá {{1}}! Seu agendamento foi realizado.\n\nData e horário: {{2}}\nServiço: Check-up odontológico\n\nEstamos localizados na Rua Francisco Andrade, próximo ao Bigode de Pedral e acima do Ceasa (antiga Meira Gás).\n\nEstaremos te esperando 🧡",
        footer_text: "Rizodent",
        buttons: [{ type: "URL", text: "Ver localização", url: "https://maps.app.goo.gl/R72pSBsKWrRo3F6S8" }],
      },
    },
    {
      oldNamePrefix: "agendamento_vca_2",
      newName: "agendamento_vca_2_v2",
      payload: {
        name: "agendamento_vca_2_v2",
        language: "pt_BR",
        category: "UTILITY",
        header_type: "TEXT",
        header_content: "📍 Agendamento Realizado",
        body_text:
          "Olá {{1}}! Seu agendamento foi realizado.\n\nData e horário: {{2}}\nServiço: Check-up odontológico\n\nEstamos localizados na Rua Monsenhor Olímpio, 37 - Centro, ao lado da Esquina Embalagens.\n\nEstaremos te esperando 🧡",
        footer_text: "Rizodent",
        buttons: [{ type: "URL", text: "Ver localização", url: "https://maps.app.goo.gl/bsDRGmCrgaMkSYB3A" }],
      },
    },
    {
      oldNamePrefix: "confirmacao_de_agenda_segunda",
      newName: "confirmacao_de_agenda_segunda_v2",
      payload: {
        name: "confirmacao_de_agenda_segunda_v2",
        language: "pt_BR",
        category: "UTILITY",
        header_type: null,
        header_content: null,
        body_text:
          "Olá {{1}}! Aqui é da Rizodent 🧡✨\n\nEstamos confirmando sua consulta agendada para segunda-feira, {{2}}.\n\nPor favor, responda \"Sim\" para confirmar ou \"Quero reagendar\" se precisar de outra data.\n\nAguardamos você 😊",
        footer_text: null,
        buttons: [
          { type: "QUICK_REPLY", text: "Sim!" },
          { type: "QUICK_REPLY", text: "Quero reagendar." },
        ],
      },
    },
  ];

  // Detect legacy templates with [bracket] placeholders
  const legacyBroken = templates.filter((t) =>
    LEGACY_MIGRATION_MAP.some((m) => t.name.startsWith(m.oldNamePrefix) && /\[.*\]/.test(t.body_text || ""))
  );

  const handleLegacyMigration = async () => {
    if (migrating) return;
    if (!selectedIntegration) {
      toast.error("Selecione uma integração WhatsApp no topo da página.");
      return;
    }
    const confirm = window.confirm(
      `Vou criar ${LEGACY_MIGRATION_MAP.length} modelos novos na Meta (com placeholders {{1}}/{{2}}) e excluir os ${legacyBroken.length} antigos que estão com colchetes literais. Deseja continuar?`
    );
    if (!confirm) return;

    setMigrating(true);
    const createdNames: string[] = [];
    let createdCount = 0;
    let deletedCount = 0;

    try {
      // 1. Criar os novos modelos
      for (const item of LEGACY_MIGRATION_MAP) {
        // Skip se já existe localmente
        if (templates.some((t) => t.name === item.newName)) {
          toast.info(`${item.newName} já existe, pulando criação.`);
          createdNames.push(item.newName);
          continue;
        }
        try {
          const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", {
            body: {
              action: "create",
              integration_key: selectedIntegration,
              ...item.payload,
            },
          });
          if (error || data?.error) {
            const msg = data?.details ? JSON.stringify(data.details) : error?.message || "erro desconhecido";
            toast.error(`Falha ao criar ${item.newName}: ${msg}`);
            continue;
          }
          createdCount++;
          createdNames.push(item.newName);
          toast.success(`Criado ${item.newName} (status: ${data?.status || "PENDING"})`);
        } catch (e: any) {
          toast.error(`Erro ao criar ${item.newName}: ${e?.message || String(e)}`);
        }
      }

      // 2. Excluir os antigos correspondentes (apenas os que foram substituídos com sucesso)
      for (const old of legacyBroken) {
        const match = LEGACY_MIGRATION_MAP.find((m) => old.name.startsWith(m.oldNamePrefix));
        if (!match || !createdNames.includes(match.newName)) continue;
        try {
          const { error } = await supabase.functions.invoke("manage-whatsapp-templates", {
            body: { action: "delete", template_name: old.name, integration_key: selectedIntegration },
          });
          if (error) {
            toast.warning(`Falha ao excluir ${old.name} na Meta, removendo apenas local.`);
          }
          await supabase.from("crm_whatsapp_templates").delete().eq("id", old.id);
          deletedCount++;
        } catch (e: any) {
          toast.error(`Erro ao excluir ${old.name}: ${e?.message || String(e)}`);
        }
      }

      toast.success(`Migração concluída: ${createdCount} criados, ${deletedCount} antigos excluídos.`);
      fetchTemplates();
    } finally {
      setMigrating(false);
    }
  };


  const filtered = deduplicateTemplates(templates).filter(t => {
    if (tab === "aprovados" && t.status !== "APPROVED") return false;
    if (tab === "pendentes" && t.status !== "PENDING" && t.status !== "REJECTED") return false;
    const clean = cleanTemplateName(t.name).toLowerCase();
    if (search && !clean.includes(search.toLowerCase()) && !(t.body_text || "").toLowerCase().includes(search.toLowerCase())) return false;
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
    const { data: { user } } = await supabase.auth.getUser();
    let ownerRole: string | null = null;
    if (user) {
      const { data: roleRow } = await supabase.rpc("get_user_primary_role", { _user_id: user.id });
      ownerRole = (roleRow as string) || null;
    }
    const { error } = await supabase.from("crm_whatsapp_templates").insert([{
      name: t.name + "_copia", category: t.category, language: t.language,
      header_type: t.header_type, header_content: t.header_content,
      body_text: t.body_text, footer_text: t.footer_text, buttons: t.buttons as any,
      status: "PENDING",
      created_by_user_id: user?.id || null,
      owner_role: ownerRole as any,
    }]);
    if (error) toast.error("Erro ao duplicar"); else { toast.success("Duplicado"); fetchTemplates(); }
  };

  const openShare = (t: WhatsAppTemplate) => {
    setShareTarget(t);
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

        toast.success(
          `Template enviado à Meta (WABA ${data?.waba_id || "?"}). Status: ${data?.status || "PENDING"}. Sincronizando em 5s…`,
          { duration: 6000 }
        );
        setTimeout(() => { handleSync(true); }, 5000);
      } catch (e: any) {
        toast.error("Erro ao enviar: " + (e?.message || String(e)));
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    } else {
      // Save as draft locally only
      const { data: { user } } = await supabase.auth.getUser();
      let ownerRole: string | null = null;
      if (user) {
        const { data: roleRow } = await supabase.rpc("get_user_primary_role", { _user_id: user.id });
        ownerRole = (roleRow as string) || null;
      }
      const payload = {
        name: form.name, category: form.category, language: form.language,
        header_type: form.hasHeader ? form.header_type : null,
        header_content: form.hasHeader ? form.header_content : null,
        body_text: form.body_text, footer_text: form.footer_text || null,
        buttons: form.buttons.length > 0 ? form.buttons : null,
        status: "DRAFT",
        created_by_user_id: user?.id || null,
        owner_role: ownerRole as any,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("crm_whatsapp_templates").insert([payload]);
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

  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [variablePopoverOpen, setVariablePopoverOpen] = useState(false);

  const insertVariableAt = (index: number) => {
    const placeholder = `{{${index}}}`;
    const el = bodyTextareaRef.current;
    if (!el) {
      setForm(p => ({ ...p, body_text: (p.body_text || "") + placeholder }));
      setVariablePopoverOpen(false);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = form.body_text || "";
    const next = current.slice(0, start) + placeholder + current.slice(end);
    setForm(p => ({ ...p, body_text: next }));
    setVariablePopoverOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + placeholder.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Render preview substituindo {{N}} pelos valores de exemplo
  const renderPreviewBody = (text: string) => {
    if (!text) return "Corpo da mensagem...";
    return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
      const v = TEMPLATE_VARIABLES.find(v => v.index === Number(n));
      return v ? v.sample : `{{${n}}}`;
    });
  };

  // Detecta placeholders inválidos digitados manualmente (ex: [nome])
  const hasInvalidPlaceholders = (text: string) => /\[[^\]]+\]/.test(text || "");


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
          {lastSyncAt && (
            <span className="text-[11px] text-muted-foreground" title={lastSyncAt.toLocaleString("pt-BR")}>
              Última sinc: {lastSyncAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => handleSync(false)} disabled={syncing}>
            <RefreshCw size={14} className={`mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar com Meta"}
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
                  <div className="font-semibold text-sm text-foreground break-all" title={t.name}>{cleanTemplateName(t.name)}</div>
                  <div className="flex items-center gap-1">{headerIcon(t.header_type)}</div>
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {categoryBadge(t.category)}
                  {statusBadge(t.status)}
                  {t.owner_role
                    ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE_COLOR[t.owner_role] || "bg-secondary text-muted-foreground"}`}>{ROLE_LABEL[t.owner_role]}</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-secondary text-muted-foreground">Compartilhado</span>}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{t.body_text || "Sem corpo"}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleDateString("pt-BR")}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(t)} className="p-1 hover:bg-secondary rounded transition-colors"><Pencil size={14} className="text-muted-foreground" /></button>
                    <button onClick={() => handleDuplicate(t)} className="p-1 hover:bg-secondary rounded transition-colors"><Copy size={14} className="text-muted-foreground" /></button>
                    {canShare && (
                      <button onClick={() => openShare(t)} title="Compartilhar com papel" className="p-1 hover:bg-secondary rounded transition-colors"><Users size={14} className="text-muted-foreground" /></button>
                    )}
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

      {/* Share with role */}
      <ShareRoleDialog
        open={!!shareTarget}
        onOpenChange={(v) => !v && setShareTarget(null)}
        table="crm_whatsapp_templates"
        rowId={shareTarget?.id ?? null}
        currentOwnerRole={(shareTarget?.owner_role ?? null) as OwnerRole}
        currentSharedRoles={(shareTarget?.shared_roles ?? []) as string[]}
        itemLabel="Modelo"
        onSaved={fetchTemplates}
      />


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
                  <Popover open={variablePopoverOpen} onOpenChange={setVariablePopoverOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-xs text-primary hover:underline">+ Variável</button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-1">
                      <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Inserir variável dinâmica
                      </div>
                      {TEMPLATE_VARIABLES.map(v => (
                        <button
                          key={v.index}
                          type="button"
                          onClick={() => insertVariableAt(v.index)}
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-secondary transition-colors group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground">{v.label}</span>
                            <code className="text-[10px] bg-secondary group-hover:bg-background px-1.5 py-0.5 rounded text-primary font-mono">{`{{${v.index}}}`}</code>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Exemplo: {v.sample}</p>
                        </button>
                      ))}
                      <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] text-muted-foreground">
                        A Meta só substitui <code className="font-mono">{`{{N}}`}</code>. Texto como <code className="font-mono">[nome]</code> é enviado literal.
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <Textarea
                  ref={bodyTextareaRef}
                  rows={5}
                  placeholder="Olá {{1}}, tudo bem?"
                  value={form.body_text}
                  onChange={e => setForm(p => ({ ...p, body_text: e.target.value }))}
                />
                {hasInvalidPlaceholders(form.body_text) && (
                  <p className="text-[11px] text-destructive mt-1">
                    ⚠ Detectamos texto entre colchetes (ex: <code className="font-mono">[nome]</code>). Isso será enviado literalmente ao paciente. Use o botão <strong>+ Variável</strong> e troque por <code className="font-mono">{`{{1}}`}</code>, <code className="font-mono">{`{{2}}`}</code>, etc.
                  </p>
                )}
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
                  <p className="text-foreground text-xs whitespace-pre-wrap">{renderPreviewBody(form.body_text)}</p>
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

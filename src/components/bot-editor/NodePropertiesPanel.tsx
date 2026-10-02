import { useCallback, useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, Trash2, Plus, Minus, Upload, Search, Loader2, AlertTriangle } from "lucide-react";
import { NODE_DEFINITIONS } from "@/types/bot";
import VariableTextarea from "./VariableTextarea";
import { cleanTemplateName, deduplicateTemplates } from "@/lib/templateUtils";
import BotAudioRecorder from "./BotAudioRecorder";
import type { Node } from "@xyflow/react";
import { supabase } from "@/integrations/supabase/client";
import { createChatMediaPath, getUploadedFileUrl } from "@/lib/mediaUtils";
import { compressImage } from "@/components/chat/imageCompressor";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { mensagemDeErroDoUpload, modeloAprovado, rotuloStatusModelo } from "@/lib/bots";

type Props = {
  node: Node;
  allNodes?: Node[];
  onUpdate: (nodeId: string, data: Record<string, any>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
};

export default function NodePropertiesPanel({ node, allNodes = [], onUpdate, onClose, onDelete }: Props) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const def = NODE_DEFINITIONS.find((d) => d.type === node.type);
  const [stages, setStages] = useState<{ id: string; name: string; color: string; pipeline_id: string }[]>([]);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; body_text: string | null; buttons: any; language: string; header_type: string | null; footer_text: string | null }[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [existingSources, setExistingSources] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [publishedBots, setPublishedBots] = useState<{ id: string; name: string }[]>([]);
  const [modelosCarregados, setModelosCarregados] = useState(false);

  useEffect(() => {
    supabase.from("crm_stages").select("id, name, color, pipeline_id").order("position").then(({ data }) => {
      if (data) setStages(data);
    });
    supabase.from("crm_pipelines").select("id, name").then(({ data }) => {
      if (data) setPipelines(data);
    });
    // Só modelo APROVADO sai pelo WhatsApp (AUTO-29): rascunho, pendente ou
    // rejeitado falharia no envio e o bloco seguiria pelo ramo "Timeout".
    supabase.from("crm_whatsapp_templates").select("id, name, body_text, buttons, language, header_type, footer_text, status").eq("status", "APPROVED").order("created_at", { ascending: false }).limit(2000).then(({ data }) => {
      if (data) setTemplates(deduplicateTemplates(data));
      setModelosCarregados(true);
    });
    // Fetch unique tags
    supabase.from("crm_leads").select("tags").then(({ data }) => {
      if (data) {
        const allTags = new Set<string>();
        data.forEach((l: any) => {
          if (Array.isArray(l.tags)) l.tags.forEach((t: string) => allTags.add(t));
        });
        setExistingTags(Array.from(allTags).sort());
      }
    });
    supabase.from("bots").select("id, name").eq("status", "published").order("name").then(({ data }) => {
      if (data) setPublishedBots(data as { id: string; name: string }[]);
    });
    // Fetch unique sources
    supabase.from("crm_leads").select("source").not("source", "is", null).then(({ data }) => {
      if (data) {
        const sources = new Set<string>();
        data.forEach((l: any) => { if (l.source) sources.add(l.source); });
        setExistingSources(Array.from(sources).sort());
      }
    });
  }, []);

  // Collect custom bot variables from all nodes
  const botVariables = useMemo(() => {
    const vars: { key: string; label: string; example: string }[] = [];
    allNodes.forEach((n: any) => {
      if (n.data?.saveToField && typeof n.data.saveToField === "string" && n.data.saveToField.trim()) {
        const key = n.data.saveToField.trim();
        if (!vars.find(v => v.key === key)) {
          vars.push({ key, label: `Variável: ${key}`, example: "Resposta do lead" });
        }
      }
    });
    // Add last_reply as a built-in bot variable
    if (!vars.find(v => v.key === "resposta.ultima")) {
      vars.push({ key: "resposta.ultima", label: "Última Resposta", example: "Texto da última resposta" });
    }
    return vars;
  }, [allNodes]);

  const update = useCallback(
    (key: string, value: any) => {
      onUpdate(node.id, { ...node.data, [key]: value });
    },
    [node, onUpdate]
  );

  const updateMultiple = useCallback(
    (updates: Record<string, any>) => {
      onUpdate(node.id, { ...node.data, ...updates });
    },
    [node, onUpdate]
  );

  const handleTemplateSelect = (templateId: string) => {
    if (!templateId) {
      updateMultiple({ templateId: "", templateName: "", templateLanguage: "", text: "", templateButtons: [] });
      return;
    }
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const btns = Array.isArray(tpl.buttons) ? tpl.buttons.map((b: any, i: number) => ({ id: String(i + 1), title: b.text || b.title || `Botão ${i + 1}` })) : [];
    updateMultiple({ templateId, templateName: tpl.name, templateLanguage: tpl.language || "pt_BR", text: tpl.body_text || "", templateButtons: btns });
  };

  const displayTemplateName = (name: string) => cleanTemplateName(name);

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return templates;
    const q = templateSearch.toLowerCase();
    return templates.filter(t => t.name.toLowerCase().includes(q) || (t.body_text || "").toLowerCase().includes(q));
  }, [templates, templateSearch]);

  const selectedTemplate = useMemo(() => {
    const tid = node.data.templateId as string;
    if (!tid) return null;
    return templates.find(t => t.id === tid) || null;
  }, [node.data.templateId, templates]);

  // Modelo escolhido que NÃO está na lista de aprovados (deixou de ser
  // aprovado, ou foi excluído): busca o status para o aviso do bloco.
  const [modeloForaDaLista, setModeloForaDaLista] = useState<{ id: string; name: string | null; status: string | null } | null>(null);
  useEffect(() => {
    const tid = (node.data.templateId as string) || "";
    if (!tid || selectedTemplate || !modelosCarregados) { setModeloForaDaLista(null); return; }
    let ativo = true;
    supabase.from("crm_whatsapp_templates").select("id, name, status").eq("id", tid).maybeSingle().then(({ data }) => {
      if (!ativo) return;
      setModeloForaDaLista({ id: tid, name: (data as any)?.name ?? null, status: (data as any)?.status ?? null });
    });
    return () => { ativo = false; };
  }, [node.data.templateId, selectedTemplate, modelosCarregados]);
  const modeloNaoAprovado = modeloForaDaLista && !modeloAprovado(modeloForaDaLista.status) ? modeloForaDaLista : null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetField = "fileUrl") => {
    let file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      // WhatsApp API limits
      const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
      const MAX_VIDEO_SIZE = 16 * 1024 * 1024; // 16MB
      const MAX_DOC_SIZE = 100 * 1024 * 1024; // 100MB

      // Compress images
      if (isImage) {
        setUploadProgress(5);
        file = await compressImage(file);
        if (file.size > MAX_IMAGE_SIZE) {
          toast.error(`Imagem muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 5MB.`);
          setUploading(false);
          setUploadProgress(0);
          return;
        }
      }

      // Validate video size
      if (isVideo) {
        if (file.size > MAX_VIDEO_SIZE) {
          toast.error(`Vídeo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). O limite do WhatsApp é 16MB. Comprima o vídeo antes de enviar.`);
          setUploading(false);
          setUploadProgress(0);
          return;
        }
        setUploadProgress(5);
      }

      // Validate document size
      if (!isImage && !isVideo && file.size > MAX_DOC_SIZE) {
        toast.error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 100MB.`);
        setUploading(false);
        setUploadProgress(0);
        return;
      }

      // Caminho por cliente/usuário (<tenant>/<usuário>/bot-files/…), o único
      // que a policy "chat-media scoped upload" aceita (AUTO-10). Antes ia para
      // `bot-files/<data>.<ext>` e todo upload era recusado. O nome já é único:
      // sem x-upsert (sobrescrever exigiria a policy de UPDATE).
      const fileName = await createChatMediaPath("bot-files", file.name, tenant.id, user?.id);

      // Use XMLHttpRequest for progress tracking
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const signedUrl = await new Promise<string | null>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${supabaseUrl}/storage/v1/object/chat-media/${fileName}`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("apikey", anonKey);
        xhr.setRequestHeader("Content-Type", file!.type || "application/octet-stream");

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 90) + 10;
            setUploadProgress(pct);
          }
        };

        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(100);
            const url = await getUploadedFileUrl(fileName);
            resolve(url);
          } else {
            // O motivo real vem no corpo do Storage (ex.: permissão, tamanho).
            reject(new Error(mensagemDeErroDoUpload(xhr.status, xhr.responseText)));
          }
        };

        xhr.onerror = () => reject(new Error("Sem conexão com o servidor. Confira a internet e tente de novo."));
        xhr.send(file);
      });

      if (signedUrl) {
        update(targetField, signedUrl);
      } else {
        toast.error("O arquivo subiu, mas não foi possível gerar o link dele. Tente de novo.");
      }
    } catch (err) {
      console.error("Bot file upload error:", err);
      const motivo = err instanceof Error && err.message ? err.message : "";
      toast.error(motivo ? `Erro ao enviar arquivo: ${motivo}` : "Erro ao enviar arquivo.");
    }
    setUploading(false);
    setUploadProgress(0);
  };

  // Tag suggestions filtered by input
  const tagSuggestions = useMemo(() => {
    if (!tagInput.trim()) return [];
    const q = tagInput.toLowerCase();
    return existingTags.filter(t => t.toLowerCase().includes(q) && t.toLowerCase() !== q);
  }, [tagInput, existingTags]);

  // Render audio recorder component
  const renderAudioRecorder = (urlField = "audioUrl") => (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">Áudio</Label>
      <BotAudioRecorder
        value={(node.data[urlField] as string) || ""}
        onChange={(url) => update(urlField, url)}
      />
    </div>
  );

  // Render file uploader component
  const renderFileUploader = (urlField = "fileUrl") => (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">Tipo de Mídia</Label>
      <Select value={(node.data.fileType as string) || "image"} onValueChange={(v) => update("fileType", v)}>
        <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="image">📷 Imagem</SelectItem>
          <SelectItem value="video">🎬 Vídeo</SelectItem>
          <SelectItem value="document">📄 Documento</SelectItem>
        </SelectContent>
      </Select>
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Arquivo</Label>
        {(node.data[urlField] as string) ? (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground truncate flex-1">{String(node.data[urlField]).split("/").pop()}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => update(urlField, "")}>
              <X size={12} />
            </Button>
          </div>
        ) : (
          <div className="mt-1">
            {uploading ? (
              <div className="space-y-2 px-3 py-3 border border-dashed border-border rounded-xl bg-surface-sunken/60">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">
                    {uploadProgress < 10 ? "Comprimindo..." : uploadProgress >= 100 ? "Finalizando..." : `Enviando... ${uploadProgress}%`}
                  </span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <label className="flex items-center gap-2 min-h-10 px-3 py-2 border border-dashed border-border rounded-xl cursor-pointer text-muted-foreground hover:bg-primary-soft/60 hover:border-primary/40 hover:text-foreground transition-colors">
                <Upload size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Clique para enviar</span>
                <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, urlField)} />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Render timeout fields
  const renderTimeoutFields = (label = "Timeout sem resposta") => (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-3 gap-2 mt-1">
        <div>
          <Label className="text-[10px] text-muted-foreground">Horas</Label>
          <Input type="number" min={0} value={(node.data.timeoutHours as string) ?? ""} onChange={(e) => update("timeoutHours", e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0))} placeholder="0" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Minutos</Label>
          <Input type="number" min={0} max={59} value={(node.data.timeoutMinutes as string) ?? ""} onChange={(e) => update("timeoutMinutes", e.target.value === "" ? "" : Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} placeholder="0" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Segundos</Label>
          <Input type="number" min={0} max={59} value={(node.data.timeoutSeconds as string) ?? ""} onChange={(e) => update("timeoutSeconds", e.target.value === "" ? "" : Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} placeholder="0" />
        </div>
      </div>
    </div>
  );

  // Render tag input with suggestions
  const renderTagInput = (isRemove = false) => {
    const currentValue = (node.data.tag as string) || "";
    return (
      <div className="space-y-3">
        <div className="relative">
          <Label className="text-xs font-medium text-muted-foreground">{isRemove ? "Tag para remover" : "Nome da tag"}</Label>
          <Input
            value={currentValue}
            onChange={(e) => {
              update("tag", e.target.value);
              setTagInput(e.target.value);
            }}
            onFocus={() => setTagInput(currentValue)}
            placeholder="Digite ou selecione uma tag"
            className="mt-1"
          />
          {tagInput && tagSuggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 border border-border rounded-xl bg-popover shadow-float p-1 max-h-32 overflow-y-auto">
              {tagSuggestions.map((tag) => (
                <button
                  key={tag}
                  className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-accent transition-colors"
                  onClick={() => { update("tag", tag); setTagInput(""); }}
                >
                  🏷️ {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        {isRemove && existingTags.length > 0 && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Tags existentes</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {existingTags.slice(0, 20).map((tag) => (
                <button
                  key={tag}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    currentValue === tag
                      ? "border-primary/20 bg-primary-soft text-primary-soft-fg"
                      : "bg-secondary text-secondary-foreground border-border hover:border-primary/50"
                  }`}
                  onClick={() => { update("tag", tag); setTagInput(""); }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
        {!isRemove && existingTags.length > 0 && !currentValue && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Sugestões</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {existingTags.slice(0, 10).map((tag) => (
                <button
                  key={tag}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-secondary text-secondary-foreground hover:border-primary/50 transition-colors"
                  onClick={() => { update("tag", tag); setTagInput(""); }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render condition value field based on selected field
  const renderConditionValue = () => {
    const field = (node.data.field as string) || "";
    const operator = (node.data.operator as string) || "equals";

    // is_empty / not_empty don't need value
    if (operator === "is_empty" || operator === "not_empty") return null;

    if (field === "lead.stage") {
      // Pipeline + stage picker
      const selectedPipeline = (node.data.conditionPipelineId as string) || "";
      const filteredStages = selectedPipeline
        ? stages.filter(s => s.pipeline_id === selectedPipeline)
        : stages;

      return (
        <>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Funil</Label>
            <Select value={selectedPipeline || "__all__"} onValueChange={(v) => {
              updateMultiple({ conditionPipelineId: v === "__all__" ? "" : v, value: "" });
            }}>
              <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Todos os funis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os funis</SelectItem>
                {pipelines.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Etapa</Label>
            <Select value={(node.data.value as string) || ""} onValueChange={(v) => update("value", v)}>
              <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Selecione a etapa..." /></SelectTrigger>
              <SelectContent>
                {filteredStages.map(s => {
                  const pName = pipelines.find(p => p.id === s.pipeline_id)?.name;
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        {s.name}{!selectedPipeline && pName ? ` (${pName})` : ""}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </>
      );
    }

    if (field === "lead.source") {
      return (
        <div>
          <Label className="text-xs font-medium text-muted-foreground">Origem</Label>
          {existingSources.length > 0 ? (
            <Select value={(node.data.value as string) || ""} onValueChange={(v) => update("value", v)}>
              <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Selecione a origem..." /></SelectTrigger>
              <SelectContent>
                {existingSources.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={(node.data.value as string) || ""} onChange={(e) => update("value", e.target.value)} className="mt-1" placeholder="Digite a origem..." />
          )}
        </div>
      );
    }

    if (field === "lead.tags") {
      const currentValue = (node.data.value as string) || "";
      return (
        <div className="relative">
          <Label className="text-xs font-medium text-muted-foreground">Tag</Label>
          {existingTags.length > 0 ? (
            <Select value={currentValue || "__custom__"} onValueChange={(v) => update("value", v === "__custom__" ? "" : v)}>
              <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Selecione a tag..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom__">Digitar manualmente...</SelectItem>
                {existingTags.map(t => (
                  <SelectItem key={t} value={t}>🏷️ {t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={currentValue} onChange={(e) => update("value", e.target.value)} className="mt-1" placeholder="Nome da tag..." />
          )}
          {currentValue === "" && existingTags.length > 0 && (
            <Input value={currentValue} onChange={(e) => update("value", e.target.value)} className="mt-1" placeholder="Digite o nome da tag..." />
          )}
        </div>
      );
    }

    // Default: free text input
    return (
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Valor</Label>
        <Input value={(node.data.value as string) || ""} onChange={(e) => update("value", e.target.value)} className="mt-1.5 rounded-xl" />
      </div>
    );
  };

  const renderFields = () => {
    switch (node.type) {
      case "start":
        return <p className="text-sm text-muted-foreground">Este é o ponto de início do fluxo. Conecte-o ao próximo bloco.</p>;

      case "send_text":
        return (
          <div className="space-y-3">
            {templates.length > 0 && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Usar Modelo (opcional)</Label>
                <div className="relative mt-1 mb-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                  <input
                    className="w-full h-9 pl-8 pr-3 text-xs border border-transparent rounded-xl bg-surface-sunken text-foreground focus:outline-none focus:bg-card focus:border-border focus:ring-2 focus:ring-primary/30 placeholder:text-tertiary"
                    placeholder="Pesquisar modelo..."
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                  />
                </div>
                <Select value={(node.data.templateId as string) || "__none__"} onValueChange={(v) => handleTemplateSelect(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione um modelo..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum (texto livre)</SelectItem>
                    {filteredTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{displayTemplateName(t.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Modelo escolhido que deixou de ser aprovado (ou foi excluído):
                o bot não é publicado enquanto este bloco usar esse modelo. */}
            {modeloNaoAprovado && (
              <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-3 space-y-2" role="alert">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground leading-relaxed">
                    O modelo <strong>{displayTemplateName(modeloNaoAprovado.name || (node.data.templateName as string) || "sem nome")}</strong> não
                    está aprovado ({rotuloStatusModelo(modeloNaoAprovado.status)}). A Meta recusa o envio: escolha um modelo
                    aprovado — o bot não é publicado enquanto este bloco usar esse modelo.
                  </p>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={() => handleTemplateSelect("")}>
                  Tirar o modelo deste bloco
                </Button>
              </div>
            )}
            {/* Aprovado, mas fora da lista (outra versão do mesmo nome). */}
            {modeloForaDaLista && !modeloNaoAprovado && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface-sunken px-3 py-2">
                <span className="text-xs text-foreground truncate">
                  {displayTemplateName(modeloForaDaLista.name || (node.data.templateName as string) || "Modelo")}
                </span>
                <button onClick={() => handleTemplateSelect("")} className="text-muted-foreground hover:text-destructive" title="Tirar o modelo" aria-label="Tirar o modelo">
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Template Preview */}
            {selectedTemplate && (
              <div className="border border-border/60 rounded-xl overflow-hidden bg-card shadow-xs">
                <div className="px-3 py-2 bg-surface-sunken border-b border-border/60 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{displayTemplateName(selectedTemplate.name)}</span>
                  <button onClick={() => handleTemplateSelect("")} className="text-muted-foreground hover:text-destructive">
                    <X size={12} />
                  </button>
                </div>
                <div className="p-3 space-y-2">
                  {selectedTemplate.header_type && (
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {selectedTemplate.header_type === "TEXT" ? "📝 Cabeçalho de texto" : selectedTemplate.header_type === "IMAGE" ? "🖼️ Cabeçalho de imagem" : `📎 ${selectedTemplate.header_type}`}
                    </div>
                  )}
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{selectedTemplate.body_text || "Sem corpo"}</p>
                  {selectedTemplate.footer_text && (
                    <p className="text-[10px] text-muted-foreground italic">{selectedTemplate.footer_text}</p>
                  )}
                  {Array.isArray(selectedTemplate.buttons) && selectedTemplate.buttons.length > 0 && (
                    <div className="border-t border-border pt-2 space-y-1">
                      {(selectedTemplate.buttons as any[]).map((btn: any, i: number) => (
                        <div key={i} className="text-xs font-medium text-primary-soft-fg text-center py-1.5 rounded-lg bg-primary-soft">
                          {btn.text || btn.title || `Botão ${i + 1}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {!(node.data.templateId as string) && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Mensagem</Label>
                <VariableTextarea extraVariables={botVariables}
                  value={(node.data.text as string) || ""}
                  onChange={(v) => update("text", v)}
                  placeholder="Digite a mensagem... Use [ para variáveis"
                  rows={5}
                  className="mt-1"
                />
              </div>
            )}
            {renderTimeoutFields()}
            <p className="text-[10px] text-muted-foreground">
              Se o lead não responder dentro deste tempo, o bot segue pelo ramo "Timeout".
            </p>
          </div>
        );

      case "send_audio":
        return renderAudioRecorder("audioUrl");

      case "send_file":
        return (
          <div className="space-y-3">
            {renderFileUploader("fileUrl")}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Texto junto (opcional)</Label>
              <VariableTextarea extraVariables={botVariables}
                value={(node.data.caption as string) || ""}
                onChange={(v) => update("caption", v)}
                placeholder="Legenda do arquivo..."
                rows={3}
                className="mt-1"
              />
            </div>
          </div>
        );

      case "send_menu": {
        const menuType = (node.data.menuType as string) || "buttons";
        const buttons = (node.data.buttons as { id: string; title: string }[]) || [];
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Tipo</Label>
              <Select value={menuType} onValueChange={(v) => update("menuType", v)}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buttons">Botões (máx. 3)</SelectItem>
                  <SelectItem value="list">Lista de opções</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Texto da mensagem</Label>
              <VariableTextarea extraVariables={botVariables}
                value={(node.data.bodyText as string) || ""}
                onChange={(v) => update("bodyText", v)}
                rows={3}
                className="mt-1"
              />
            </div>
            {menuType === "buttons" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Botões</Label>
                <div className="space-y-1.5 mt-1">
                  {buttons.map((btn, i) => (
                    <div key={btn.id} className="flex items-center gap-1.5">
                      <Input
                        value={btn.title}
                        onChange={(e) => {
                          const newBtns = [...buttons];
                          newBtns[i] = { ...btn, title: e.target.value };
                          update("buttons", newBtns);
                        }}
                        placeholder={`Botão ${i + 1}`}
                        className="h-8 text-xs"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => update("buttons", buttons.filter((_, j) => j !== i))} disabled={buttons.length <= 1}>
                        <Minus size={12} />
                      </Button>
                    </div>
                  ))}
                  {buttons.length < 3 && (
                    <Button variant="outline" size="sm" className="w-full gap-1 h-7 text-xs" onClick={() => update("buttons", [...buttons, { id: String(Date.now()), title: "" }])}>
                      <Plus size={12} /> Adicionar botão
                    </Button>
                  )}
                </div>
              </div>
            )}
            {menuType === "list" && (() => {
              const sections = (node.data.listSections as { title: string; rows: { id: string; title: string; description: string }[] }[]) || [{ title: "Seção 1", rows: [{ id: "1", title: "Item 1", description: "" }] }];
              const updateSections = (newSections: typeof sections) => update("listSections", newSections);
              return (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Cabeçalho (opcional)</Label>
                    <Input value={(node.data.headerText as string) || ""} onChange={(e) => update("headerText", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Título da mensagem..." />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Rodapé (opcional)</Label>
                    <Input value={(node.data.footerText as string) || ""} onChange={(e) => update("footerText", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Rodapé..." />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Texto do botão de ação</Label>
                    <Input value={(node.data.buttonLabel as string) || "Menu"} onChange={(e) => update("buttonLabel", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Ver opções" />
                  </div>

                  {sections.map((section, si) => (
                    <div key={si} className="border border-primary/25 rounded-xl p-3 space-y-2 bg-primary-soft/50">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={section.title}
                          onChange={(e) => {
                            const ns = [...sections];
                            ns[si] = { ...ns[si], title: e.target.value };
                            updateSections(ns);
                          }}
                          placeholder="Título da seção"
                          className="h-7 text-xs font-semibold flex-1"
                        />
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive" onClick={() => updateSections(sections.filter((_, j) => j !== si))} disabled={sections.length <= 1}>
                          <Trash2 size={12} />
                        </Button>
                      </div>

                      {section.rows.map((row, ri) => (
                        <div key={row.id} className="pl-2 border-l-2 border-primary/20 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Input
                              value={row.title}
                              onChange={(e) => {
                                const ns = [...sections];
                                ns[si] = { ...ns[si], rows: ns[si].rows.map((r, j) => j === ri ? { ...r, title: e.target.value } : r) };
                                updateSections(ns);
                              }}
                              placeholder={`Opção ${ri + 1}`}
                              className="h-7 text-xs flex-1"
                            />
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => {
                              const ns = [...sections];
                              ns[si] = { ...ns[si], rows: ns[si].rows.filter((_, j) => j !== ri) };
                              updateSections(ns);
                            }} disabled={section.rows.length <= 1}>
                              <Minus size={12} />
                            </Button>
                          </div>
                          <Input
                            value={row.description}
                            onChange={(e) => {
                              const ns = [...sections];
                              ns[si] = { ...ns[si], rows: ns[si].rows.map((r, j) => j === ri ? { ...r, description: e.target.value } : r) };
                              updateSections(ns);
                            }}
                            placeholder="Descrição (opcional)"
                            className="h-6 text-[10px] text-muted-foreground"
                          />
                        </div>
                      ))}

                      <Button variant="outline" size="sm" className="w-full gap-1 h-6 text-[10px]" onClick={() => {
                        const ns = [...sections];
                        ns[si] = { ...ns[si], rows: [...ns[si].rows, { id: String(Date.now()), title: "", description: "" }] };
                        updateSections(ns);
                      }}>
                        <Plus size={10} /> Adicionar opção
                      </Button>
                    </div>
                  ))}

                  <Button variant="outline" size="sm" className="w-full gap-1 h-7 text-xs" onClick={() => updateSections([...sections, { title: "", rows: [{ id: String(Date.now()), title: "", description: "" }] }])}>
                    <Plus size={12} /> Adicionar seção
                  </Button>
                </div>
              );
            })()}
            {renderTimeoutFields()}
          </div>
        );
      }

      case "delay":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Tempo de espera</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
                  min={1}
                  value={(node.data.delaySeconds as number) || 5}
                  onChange={(e) => update("delaySeconds", parseInt(e.target.value) || 1)}
                  className="w-24"
                />
                <Select value={(node.data.unit as string) || "seconds"} onValueChange={(v) => update("unit", v)}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds">Segundos</SelectItem>
                    <SelectItem value="minutes">Minutos</SelectItem>
                    <SelectItem value="hours">Horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );

      case "wait_reply": {
        const validateAs = (node.data.validateAs as string) || "none";
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Salva a resposta do lead em uma variável para uso em mensagens e condições futuras.</p>
            {renderTimeoutFields("Timeout")}
            <SaveToVariableField
              currentField={(node.data.saveToField as string) || ""}
              allNodes={allNodes}
              onChange={(v) => update("saveToField", v)}
            />

            <div className="border-t border-border pt-3">
              <Label className="text-xs font-medium text-muted-foreground">Validar resposta como</Label>
              <Select value={validateAs} onValueChange={(v) => update("validateAs", v)}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  <SelectItem value="full_name">Nome completo</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Se ativado, respostas que parecem perguntas ou saudações não avançam o fluxo — o bot re-pergunta até 2 vezes. Na 3ª resposta, guarda o que veio e segue.
              </p>
            </div>

            {validateAs !== "none" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Mensagem de re-pergunta</Label>
                <VariableTextarea
                  extraVariables={botVariables}
                  value={(node.data.invalidReplyMessage as string) || ""}
                  onChange={(v) => update("invalidReplyMessage", v)}
                  rows={2}
                  placeholder="Ex: Só pra confirmar, me diga seu nome completo (nome e sobrenome), por favor 🙂"
                  className="mt-1"
                />
              </div>
            )}
          </div>
        );
      }

      case "schedule": {
        const msgType = (node.data.messageType as string) || "text";
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Modo</Label>
              <Select value={(node.data.scheduleMode as string) || "next_day"} onValueChange={(v) => update("scheduleMode", v)}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="next_day">Próximo dia</SelectItem>
                  <SelectItem value="next_business_day">Próximo dia útil</SelectItem>
                  <SelectItem value="custom">Data específica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Horário de envio</Label>
              <Input type="time" value={(node.data.scheduleTime as string) || "09:00"} onChange={(e) => update("scheduleTime", e.target.value)} className="mt-1.5 rounded-xl" />
            </div>
            {(node.data.scheduleMode as string) === "custom" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Data</Label>
                <Input type="date" value={(node.data.scheduleDate as string) || ""} onChange={(e) => update("scheduleDate", e.target.value)} className="mt-1.5 rounded-xl" />
              </div>
            )}

            <div className="border-t border-border pt-3">
              <Label className="text-xs font-semibold">Mensagem a enviar</Label>
              <Select value={msgType} onValueChange={(v) => update("messageType", v)}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">💬 Texto</SelectItem>
                  <SelectItem value="audio">🎙️ Áudio</SelectItem>
                  <SelectItem value="file">📎 Arquivo / Mídia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {msgType === "text" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Mensagem</Label>
                <VariableTextarea extraVariables={botVariables} value={(node.data.text as string) || ""} onChange={(v) => update("text", v)} rows={4} className="mt-1" />
              </div>
            )}
            {msgType === "audio" && renderAudioRecorder("audioUrl")}
            {msgType === "file" && (
              <>
                {renderFileUploader("fileUrl")}
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Legenda</Label>
                  <VariableTextarea extraVariables={botVariables} value={(node.data.caption as string) || ""} onChange={(v) => update("caption", v)} rows={2} className="mt-1" />
                </div>
              </>
            )}
          </div>
        );
      }

      case "condition":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Campo</Label>
              <Select value={(node.data.field as string) || ""} onValueChange={(v) => {
                updateMultiple({ field: v, value: "", conditionPipelineId: "" });
              }}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_reply">Última resposta</SelectItem>
                  <SelectItem value="lead.name">Nome do lead</SelectItem>
                  <SelectItem value="lead.source">Origem</SelectItem>
                  <SelectItem value="lead.tags">Tags</SelectItem>
                  <SelectItem value="lead.stage">Etapa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Operador</Label>
              <Select value={(node.data.operator as string) || "equals"} onValueChange={(v) => update("operator", v)}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equals">Igual a</SelectItem>
                  <SelectItem value="not_equals">Diferente de</SelectItem>
                  <SelectItem value="contains">Contém</SelectItem>
                  <SelectItem value="not_contains">Não contém</SelectItem>
                  <SelectItem value="starts_with">Começa com</SelectItem>
                  <SelectItem value="is_empty">Está vazio</SelectItem>
                  <SelectItem value="not_empty">Não está vazio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {renderConditionValue()}
          </div>
        );

      case "move_stage": {
        const currentStageId = (node.data.stageId as string) || "";
        const inferredPipeline = stages.find(s => s.id === currentStageId)?.pipeline_id || "";
        const selectedPipelineId = (node.data.pipelineId as string) || inferredPipeline || "";
        const filteredStages = selectedPipelineId
          ? stages.filter(s => s.pipeline_id === selectedPipelineId)
          : stages;
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Funil</Label>
              <Select
                value={selectedPipelineId}
                onValueChange={(v) => {
                  update("pipelineId", v);
                  // clear stage if it doesn't belong to the new pipeline
                  if (currentStageId && !stages.some(s => s.id === currentStageId && s.pipeline_id === v)) {
                    update("stageId", "");
                  }
                }}
              >
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Selecione o funil..." /></SelectTrigger>
                <SelectContent>
                  {pipelines.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Etapa de destino</Label>
              <Select
                value={currentStageId}
                onValueChange={(v) => update("stageId", v)}
                disabled={!selectedPipelineId}
              >
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder={selectedPipelineId ? "Selecione a etapa..." : "Selecione o funil primeiro"} /></SelectTrigger>
                <SelectContent>
                  {filteredStages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      }

      case "add_tag":
        return renderTagInput(false);

      case "remove_tag":
        return renderTagInput(true);

      case "add_note":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Nota</Label>
              <VariableTextarea extraVariables={botVariables} value={(node.data.note as string) || ""} onChange={(v) => update("note", v)} placeholder="Texto da nota... Use [ para variáveis" rows={4} className="mt-1" />
            </div>
          </div>
        );

      case "create_task":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Título da tarefa</Label>
              <VariableTextarea extraVariables={botVariables}
                value={(node.data.title as string) || ""}
                onChange={(v) => update("title", v)}
                placeholder="Ex: Ligar para [lead.nome] - [resposta.ultima]. Use [ para variáveis"
                rows={2}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Tipo da tarefa</Label>
              <Select value={(node.data.taskType as string) || "personalizado"} onValueChange={(v) => update("taskType", v)}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personalizado">📋 Personalizado</SelectItem>
                  <SelectItem value="agendamento">📅 Agendamento</SelectItem>
                  <SelectItem value="ligacao">📞 Ligação</SelectItem>
                  <SelectItem value="follow_up">🔄 Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Quando agendar</Label>
              <Select value={(node.data.dueMode as string) || "hours"} onValueChange={(v) => update("dueMode", v)}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Em X horas</SelectItem>
                  <SelectItem value="days">Em X dias</SelectItem>
                  <SelectItem value="days_at_time">Em X dias às X horas</SelectItem>
                  <SelectItem value="next_day_first">Primeiro horário do dia seguinte</SelectItem>
                  <SelectItem value="next_business_day">Próximo dia útil às X horas</SelectItem>
                  <SelectItem value="specific">Data e horário específicos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(node.data.dueMode === "hours" || !node.data.dueMode) && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Horas a partir de agora</Label>
                <Input type="number" min={1} value={(node.data.dueHours as number) || 24} onChange={(e) => update("dueHours", parseInt(e.target.value) || 24)} className="mt-1.5 rounded-xl" />
              </div>
            )}

            {node.data.dueMode === "days" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Dias a partir de agora</Label>
                <Input type="number" min={1} value={(node.data.dueDays as number) || 1} onChange={(e) => update("dueDays", parseInt(e.target.value) || 1)} className="mt-1.5 rounded-xl" />
              </div>
            )}

            {node.data.dueMode === "days_at_time" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Dias a partir de agora</Label>
                  <Input type="number" min={1} value={(node.data.dueDays as number) || 1} onChange={(e) => update("dueDays", parseInt(e.target.value) || 1)} className="mt-1.5 rounded-xl" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Horário</Label>
                  <Input type="time" value={(node.data.dueTime as string) || "09:00"} onChange={(e) => update("dueTime", e.target.value)} className="mt-1.5 rounded-xl" />
                </div>
              </div>
            )}

            {node.data.dueMode === "next_day_first" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Primeiro horário</Label>
                <Input type="time" value={(node.data.dueTime as string) || "08:00"} onChange={(e) => update("dueTime", e.target.value)} className="mt-1.5 rounded-xl" />
                <p className="text-[10px] text-muted-foreground mt-1">Será agendado para o dia seguinte neste horário</p>
              </div>
            )}

            {node.data.dueMode === "next_business_day" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Horário</Label>
                <Input type="time" value={(node.data.dueTime as string) || "09:00"} onChange={(e) => update("dueTime", e.target.value)} className="mt-1.5 rounded-xl" />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Será agendado para o próximo dia em que a clínica abre, neste horário — segue o horário de atendimento de Configurações e pula os feriados cadastrados da clínica.
                </p>
              </div>
            )}

            {node.data.dueMode === "specific" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Data</Label>
                  <Input type="date" value={(node.data.dueDate as string) || ""} onChange={(e) => update("dueDate", e.target.value)} className="mt-1.5 rounded-xl" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Horário</Label>
                  <Input type="time" value={(node.data.dueTime as string) || "09:00"} onChange={(e) => update("dueTime", e.target.value)} className="mt-1.5 rounded-xl" />
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs font-medium text-muted-foreground">Observações (opcional)</Label>
              <VariableTextarea extraVariables={botVariables}
                value={(node.data.taskNotes as string) || ""}
                onChange={(v) => update("taskNotes", v)}
                placeholder="Notas adicionais... Use [ para variáveis do lead ou respostas"
                rows={3}
                className="mt-1"
              />
            </div>
            <div className="bg-info-soft/60 rounded-xl p-3 border border-info/20">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                💡 <strong>Dica:</strong> Use variáveis como <code className="bg-secondary px-1 rounded">[lead.nome]</code>, <code className="bg-secondary px-1 rounded">[resposta.ultima]</code> para criar tarefas dinâmicas baseadas nas respostas do lead.
              </p>
            </div>
          </div>
        );

      case "transfer_human":
        return (
          <p className="text-sm text-muted-foreground">
            O bot é encerrado e a conversa volta ao modo manual. O responsável pelo lead — ou, sem responsável, o(a) gestor(a) da equipe — recebe uma notificação, e a conversa ganha a mensagem "Bot transferiu para atendimento humano".
          </p>
        );

      case "trigger_bot":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Bot a acionar</Label>
              <Select
                value={(node.data.botId as string) || ""}
                onValueChange={(v) => {
                  const bot = publishedBots.find(b => b.id === v);
                  updateMultiple({ botId: v, botName: bot?.name || "" });
                }}
              >
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="Selecione o bot..." /></SelectTrigger>
                <SelectContent>
                  {publishedBots.length === 0 && <SelectItem value="none" disabled>Nenhum bot publicado</SelectItem>}
                  {publishedBots.filter(b => b.id !== (node as any)._botId).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[10px] text-muted-foreground">O bot atual será encerrado e o bot selecionado será iniciado para o mesmo lead.</p>
          </div>
        );

      default:
        return <p className="text-sm text-muted-foreground">Tipo de bloco não configurável.</p>;
    }
  };

  return (
    <div
      className="w-[320px] border-l border-border/60 bg-card flex flex-col h-full"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-border/60">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-base"
            style={def ? { backgroundColor: `color-mix(in srgb, ${def.color} 14%, transparent)` } : undefined}
          >{def?.icon}</span>
          <h3 className="text-base font-semibold leading-tight text-foreground">{def?.label || "Propriedades"}</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="space-y-3 pb-4 border-b border-border/60">
        <div>
          <Label className="text-xs text-tertiary">Tipo: {def?.label || node.type}</Label>
        </div>
        <div>
          <Label className="text-xs font-medium text-muted-foreground">Descrição do bloco (opcional)</Label>
          <Input
            value={(node.data.description as string) || ""}
            onChange={(e) => update("description", e.target.value)}
            className="mt-1.5 rounded-xl"
            placeholder="Descreva o que este bloco faz..."
          />
        </div>
        </div>

        {renderFields()}
      </div>

      {node.type !== "start" && (
        <div className="p-4 border-t border-border/60">
          <Button variant="outline" size="sm" className="w-full h-10 gap-1.5 rounded-xl border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive" onClick={() => onDelete(node.id)}>
            <Trash2 size={14} /> Excluir bloco
          </Button>
        </div>
      )}
    </div>
  );
}

function SaveToVariableField({
  currentField,
  allNodes,
  onChange,
}: {
  currentField: string;
  allNodes: any[];
  onChange: (value: string) => void;
}) {
  const [varInput, setVarInput] = useState(currentField);
  const [varDropdownOpen, setVarDropdownOpen] = useState(false);

  useEffect(() => {
    setVarInput(currentField);
  }, [currentField]);

  const allBotVars = useMemo(() => {
    const vars = new Set<string>();
    allNodes.forEach((n: any) => {
      if (n.data?.saveToField && typeof n.data.saveToField === "string" && n.data.saveToField.trim()) {
        vars.add(n.data.saveToField.trim());
      }
    });
    return Array.from(vars).sort();
  }, [allNodes]);

  const filteredVars = varInput.trim()
    ? allBotVars.filter((v) => v.toLowerCase().includes(varInput.toLowerCase()))
    : allBotVars;

  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">Salvar resposta na variável</Label>
      <div className="relative mt-1">
        <Input
          value={varInput}
          onChange={(e) => {
            setVarInput(e.target.value);
            onChange(e.target.value);
            setVarDropdownOpen(true);
          }}
          onFocus={() => setVarDropdownOpen(true)}
          onBlur={() => setTimeout(() => setVarDropdownOpen(false), 200)}
          placeholder="Digite o nome da variável (ex: horario_preferido)"
        />
        {varDropdownOpen && filteredVars.length > 0 && (
          <div className="absolute z-50 w-full mt-1 border border-border rounded-xl bg-popover shadow-float p-1 max-h-32 overflow-y-auto">
            {filteredVars.map((v) => (
              <button
                key={v}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-accent transition-colors ${v === currentField ? "bg-accent/50 font-medium" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setVarInput(v);
                  onChange(v);
                  setVarDropdownOpen(false);
                }}
              >
                💾 {v}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        Use <kbd className="px-1 py-0.5 rounded bg-secondary text-[10px]">[{currentField || "variável"}]</kbd> em mensagens para exibir o valor salvo
      </p>
      {allBotVars.length > 0 && !varInput && (
        <div className="mt-2">
          <Label className="text-[10px] text-muted-foreground">Variáveis existentes</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {allBotVars.map((v) => (
              <button
                key={v}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  currentField === v
                    ? "border-primary/20 bg-primary-soft text-primary-soft-fg"
                    : "bg-secondary text-secondary-foreground border-border hover:border-primary/50"
                }`}
                onClick={() => { setVarInput(v); onChange(v); }}
              >
                💾 {v}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

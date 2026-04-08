import { useCallback, useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, Trash2, Plus, Minus, Upload, Search } from "lucide-react";
import { NODE_DEFINITIONS } from "@/types/bot";
import VariableTextarea from "./VariableTextarea";
import BotAudioRecorder from "./BotAudioRecorder";
import type { Node } from "@xyflow/react";
import { supabase } from "@/integrations/supabase/client";
import { getUploadedFileUrl } from "@/lib/mediaUtils";
import { compressImage } from "@/components/chat/imageCompressor";

type Props = {
  node: Node;
  allNodes?: Node[];
  onUpdate: (nodeId: string, data: Record<string, any>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
};

export default function NodePropertiesPanel({ node, allNodes = [], onUpdate, onClose, onDelete }: Props) {
  const def = NODE_DEFINITIONS.find((d) => d.type === node.type);
  const [stages, setStages] = useState<{ id: string; name: string; color: string; pipeline_id: string }[]>([]);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; body_text: string | null; buttons: any; language: string; header_type: string | null; footer_text: string | null }[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [existingSources, setExistingSources] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [publishedBots, setPublishedBots] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    supabase.from("crm_stages").select("id, name, color, pipeline_id").order("position").then(({ data }) => {
      if (data) setStages(data);
    });
    supabase.from("crm_pipelines").select("id, name").then(({ data }) => {
      if (data) setPipelines(data);
    });
    supabase.from("crm_whatsapp_templates").select("id, name, body_text, buttons, language, header_type, footer_text").eq("status", "APPROVED").then(({ data }) => {
      if (data) setTemplates(data);
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

  const displayTemplateName = (name: string) => name.replace(/_[a-z0-9]{4,8}$/, '');

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetField = "fileUrl") => {
    let file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Compress images before upload (same logic as chat)
      const isImage = file.type.startsWith("image/");
      if (isImage) {
        file = await compressImage(file);
      }
      const ext = file.name.split(".").pop() || "bin";
      const fileName = `bot-files/${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from("chat-media").upload(fileName, file);
      if (!error && data) {
        const signedUrl = await getUploadedFileUrl(data.path);
        update(targetField, signedUrl);
      }
    } catch (err) {
      console.error("Bot file upload error:", err);
    }
    setUploading(false);
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
      <Label className="text-xs">Áudio</Label>
      <BotAudioRecorder
        value={(node.data[urlField] as string) || ""}
        onChange={(url) => update(urlField, url)}
      />
    </div>
  );

  // Render file uploader component
  const renderFileUploader = (urlField = "fileUrl") => (
    <div className="space-y-2">
      <Label className="text-xs">Tipo de Mídia</Label>
      <Select value={(node.data.fileType as string) || "image"} onValueChange={(v) => update("fileType", v)}>
        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="image">📷 Imagem</SelectItem>
          <SelectItem value="video">🎬 Vídeo</SelectItem>
          <SelectItem value="document">📄 Documento</SelectItem>
        </SelectContent>
      </Select>
      <div>
        <Label className="text-xs">Arquivo</Label>
        {(node.data[urlField] as string) ? (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground truncate flex-1">{String(node.data[urlField]).split("/").pop()}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => update(urlField, "")}>
              <X size={12} />
            </Button>
          </div>
        ) : (
          <div className="mt-1">
            <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-md cursor-pointer hover:bg-secondary/50 transition-colors">
              <Upload size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Clique para enviar</span>
              <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, urlField)} />
            </label>
          </div>
        )}
      </div>
    </div>
  );

  // Render timeout fields
  const renderTimeoutFields = (label = "Timeout sem resposta") => (
    <div>
      <Label className="text-xs">{label}</Label>
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
          <Label className="text-xs">{isRemove ? "Tag para remover" : "Nome da tag"}</Label>
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
            <div className="absolute z-50 w-full mt-1 border border-border rounded-md bg-popover shadow-md max-h-32 overflow-y-auto">
              {tagSuggestions.map((tag) => (
                <button
                  key={tag}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
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
                      ? "bg-primary text-primary-foreground border-primary"
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
            <Label className="text-xs">Funil</Label>
            <Select value={selectedPipeline || "__all__"} onValueChange={(v) => {
              updateMultiple({ conditionPipelineId: v === "__all__" ? "" : v, value: "" });
            }}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Todos os funis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os funis</SelectItem>
                {pipelines.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Etapa</Label>
            <Select value={(node.data.value as string) || ""} onValueChange={(v) => update("value", v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a etapa..." /></SelectTrigger>
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
          <Label className="text-xs">Origem</Label>
          {existingSources.length > 0 ? (
            <Select value={(node.data.value as string) || ""} onValueChange={(v) => update("value", v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a origem..." /></SelectTrigger>
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
          <Label className="text-xs">Tag</Label>
          {existingTags.length > 0 ? (
            <Select value={currentValue || "__custom__"} onValueChange={(v) => update("value", v === "__custom__" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a tag..." /></SelectTrigger>
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
        <Label className="text-xs">Valor</Label>
        <Input value={(node.data.value as string) || ""} onChange={(e) => update("value", e.target.value)} className="mt-1" />
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
                <Label className="text-xs">Usar Modelo (opcional)</Label>
                <div className="relative mt-1 mb-1">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="w-full pl-7 pr-3 py-1.5 text-xs border border-border rounded-md bg-secondary text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
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

            {/* Template Preview */}
            {selectedTemplate && (
              <div className="border border-border rounded-lg overflow-hidden bg-secondary/30">
                <div className="px-3 py-2 bg-secondary/50 border-b border-border flex items-center justify-between">
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
                        <div key={i} className="text-xs text-primary text-center py-1 border border-primary/20 rounded-md bg-primary/5">
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
                <Label className="text-xs">Mensagem</Label>
                <VariableTextarea extraVariables={botVariables}
                  value={(node.data.text as string) || ""}
                  onChange={(v) => update("text", v)}
                  placeholder="Digite a mensagem... Use [ para variáveis"
                  rows={5}
                  className="mt-1"
                />
              </div>
            )}
            {(node.data.templateId as string) && (node.data.templateButtons as any[])?.length > 0 && (
              <>
                {renderTimeoutFields()}
                <p className="text-[10px] text-muted-foreground">
                  Cada botão do modelo cria um ramo. O ramo "Sem resposta" ativa após este tempo.
                </p>
              </>
            )}
          </div>
        );

      case "send_audio":
        return renderAudioRecorder("audioUrl");

      case "send_file":
        return (
          <div className="space-y-3">
            {renderFileUploader("fileUrl")}
            <div>
              <Label className="text-xs">Texto junto (opcional)</Label>
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
              <Label className="text-xs">Tipo</Label>
              <Select value={menuType} onValueChange={(v) => update("menuType", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buttons">Botões (máx. 3)</SelectItem>
                  <SelectItem value="list">Lista de opções</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Texto da mensagem</Label>
              <VariableTextarea extraVariables={botVariables}
                value={(node.data.bodyText as string) || ""}
                onChange={(v) => update("bodyText", v)}
                rows={3}
                className="mt-1"
              />
            </div>
            {menuType === "buttons" && (
              <div>
                <Label className="text-xs">Botões</Label>
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
                    <Label className="text-xs">Cabeçalho (opcional)</Label>
                    <Input value={(node.data.headerText as string) || ""} onChange={(e) => update("headerText", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Título da mensagem..." />
                  </div>
                  <div>
                    <Label className="text-xs">Rodapé (opcional)</Label>
                    <Input value={(node.data.footerText as string) || ""} onChange={(e) => update("footerText", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Rodapé..." />
                  </div>
                  <div>
                    <Label className="text-xs">Texto do botão de ação</Label>
                    <Input value={(node.data.buttonLabel as string) || "Menu"} onChange={(e) => update("buttonLabel", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Ver opções" />
                  </div>

                  {sections.map((section, si) => (
                    <div key={si} className="border border-primary/30 rounded-lg p-2.5 space-y-2 bg-primary/5">
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
              <Label className="text-xs">Tempo de espera</Label>
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

      case "wait_reply":
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Salva a resposta do lead em uma variável para uso em mensagens e condições futuras.</p>
            {renderTimeoutFields("Timeout")}
            {(() => {
              const currentField = (node.data.saveToField as string) || "";
              const [varInput, setVarInput] = useState(currentField);
              const [varDropdownOpen, setVarDropdownOpen] = useState(false);

              // Collect all variable names used across all nodes in the flow
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
                ? allBotVars.filter(v => v.toLowerCase().includes(varInput.toLowerCase()))
                : allBotVars;

              return (
                <div>
                  <Label className="text-xs">Salvar resposta na variável</Label>
                  <div className="relative mt-1">
                    <Input
                      value={varInput}
                      onChange={(e) => {
                        setVarInput(e.target.value);
                        update("saveToField", e.target.value);
                        setVarDropdownOpen(true);
                      }}
                      onFocus={() => setVarDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setVarDropdownOpen(false), 200)}
                      placeholder="Digite o nome da variável (ex: horario_preferido)"
                    />
                    {varDropdownOpen && filteredVars.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 border border-border rounded-md bg-popover shadow-md max-h-32 overflow-y-auto">
                        {filteredVars.map((v) => (
                          <button
                            key={v}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${v === currentField ? "bg-accent/50 font-medium" : ""}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setVarInput(v);
                              update("saveToField", v);
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
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-secondary text-secondary-foreground border-border hover:border-primary/50"
                            }`}
                            onClick={() => { setVarInput(v); update("saveToField", v); }}
                          >
                            💾 {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );

      case "schedule": {
        const msgType = (node.data.messageType as string) || "text";
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Modo</Label>
              <Select value={(node.data.scheduleMode as string) || "next_day"} onValueChange={(v) => update("scheduleMode", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="next_day">Próximo dia</SelectItem>
                  <SelectItem value="next_business_day">Próximo dia útil</SelectItem>
                  <SelectItem value="custom">Data específica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Horário de envio</Label>
              <Input type="time" value={(node.data.scheduleTime as string) || "09:00"} onChange={(e) => update("scheduleTime", e.target.value)} className="mt-1" />
            </div>
            {(node.data.scheduleMode as string) === "custom" && (
              <div>
                <Label className="text-xs">Data</Label>
                <Input type="date" value={(node.data.scheduleDate as string) || ""} onChange={(e) => update("scheduleDate", e.target.value)} className="mt-1" />
              </div>
            )}

            <div className="border-t border-border pt-3">
              <Label className="text-xs font-semibold">Mensagem a enviar</Label>
              <Select value={msgType} onValueChange={(v) => update("messageType", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">💬 Texto</SelectItem>
                  <SelectItem value="audio">🎙️ Áudio</SelectItem>
                  <SelectItem value="file">📎 Arquivo / Mídia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {msgType === "text" && (
              <div>
                <Label className="text-xs">Mensagem</Label>
                <VariableTextarea extraVariables={botVariables} value={(node.data.text as string) || ""} onChange={(v) => update("text", v)} rows={4} className="mt-1" />
              </div>
            )}
            {msgType === "audio" && renderAudioRecorder("audioUrl")}
            {msgType === "file" && (
              <>
                {renderFileUploader("fileUrl")}
                <div>
                  <Label className="text-xs">Legenda</Label>
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
              <Label className="text-xs">Campo</Label>
              <Select value={(node.data.field as string) || ""} onValueChange={(v) => {
                updateMultiple({ field: v, value: "", conditionPipelineId: "" });
              }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
              <Label className="text-xs">Operador</Label>
              <Select value={(node.data.operator as string) || "equals"} onValueChange={(v) => update("operator", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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

      case "move_stage":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Etapa de destino</Label>
              <Select value={(node.data.stageId as string) || ""} onValueChange={(v) => update("stageId", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a etapa..." /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
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

      case "add_tag":
        return renderTagInput(false);

      case "remove_tag":
        return renderTagInput(true);

      case "add_note":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nota</Label>
              <VariableTextarea extraVariables={botVariables} value={(node.data.note as string) || ""} onChange={(v) => update("note", v)} placeholder="Texto da nota... Use [ para variáveis" rows={4} className="mt-1" />
            </div>
          </div>
        );

      case "create_task":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Título da tarefa</Label>
              <VariableTextarea extraVariables={botVariables}
                value={(node.data.title as string) || ""}
                onChange={(v) => update("title", v)}
                placeholder="Ex: Ligar para [lead.nome] - [resposta.ultima]. Use [ para variáveis"
                rows={2}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Tipo da tarefa</Label>
              <Select value={(node.data.taskType as string) || "personalizado"} onValueChange={(v) => update("taskType", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personalizado">📋 Personalizado</SelectItem>
                  <SelectItem value="agendamento">📅 Agendamento</SelectItem>
                  <SelectItem value="ligacao">📞 Ligação</SelectItem>
                  <SelectItem value="follow_up">🔄 Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Quando agendar</Label>
              <Select value={(node.data.dueMode as string) || "hours"} onValueChange={(v) => update("dueMode", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Em X horas</SelectItem>
                  <SelectItem value="days">Em X dias</SelectItem>
                  <SelectItem value="days_at_time">Em X dias às X horas</SelectItem>
                  <SelectItem value="next_day_first">Primeiro horário do dia seguinte</SelectItem>
                  <SelectItem value="specific">Data e horário específicos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(node.data.dueMode === "hours" || !node.data.dueMode) && (
              <div>
                <Label className="text-xs">Horas a partir de agora</Label>
                <Input type="number" min={1} value={(node.data.dueHours as number) || 24} onChange={(e) => update("dueHours", parseInt(e.target.value) || 24)} className="mt-1" />
              </div>
            )}

            {node.data.dueMode === "days" && (
              <div>
                <Label className="text-xs">Dias a partir de agora</Label>
                <Input type="number" min={1} value={(node.data.dueDays as number) || 1} onChange={(e) => update("dueDays", parseInt(e.target.value) || 1)} className="mt-1" />
              </div>
            )}

            {node.data.dueMode === "days_at_time" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Dias a partir de agora</Label>
                  <Input type="number" min={1} value={(node.data.dueDays as number) || 1} onChange={(e) => update("dueDays", parseInt(e.target.value) || 1)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Horário</Label>
                  <Input type="time" value={(node.data.dueTime as string) || "09:00"} onChange={(e) => update("dueTime", e.target.value)} className="mt-1" />
                </div>
              </div>
            )}

            {node.data.dueMode === "next_day_first" && (
              <div>
                <Label className="text-xs">Primeiro horário</Label>
                <Input type="time" value={(node.data.dueTime as string) || "08:00"} onChange={(e) => update("dueTime", e.target.value)} className="mt-1" />
                <p className="text-[10px] text-muted-foreground mt-1">Será agendado para o dia seguinte neste horário</p>
              </div>
            )}

            {node.data.dueMode === "specific" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={(node.data.dueDate as string) || ""} onChange={(e) => update("dueDate", e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Horário</Label>
                  <Input type="time" value={(node.data.dueTime as string) || "09:00"} onChange={(e) => update("dueTime", e.target.value)} className="mt-1" />
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">Observações (opcional)</Label>
              <VariableTextarea extraVariables={botVariables}
                value={(node.data.taskNotes as string) || ""}
                onChange={(v) => update("taskNotes", v)}
                placeholder="Notas adicionais... Use [ para variáveis do lead ou respostas"
                rows={3}
                className="mt-1"
              />
            </div>
            <div className="bg-secondary/50 rounded-md p-2 border border-border">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                💡 <strong>Dica:</strong> Use variáveis como <code className="bg-secondary px-1 rounded">[lead.nome]</code>, <code className="bg-secondary px-1 rounded">[resposta.ultima]</code> para criar tarefas dinâmicas baseadas nas respostas do lead.
              </p>
            </div>
          </div>
        );

      case "transfer_human":
        return <p className="text-sm text-muted-foreground">O bot será encerrado e a conversa voltará ao modo manual.</p>;

      case "trigger_bot":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Bot a acionar</Label>
              <Select
                value={(node.data.botId as string) || ""}
                onValueChange={(v) => {
                  const bot = publishedBots.find(b => b.id === v);
                  updateMultiple({ botId: v, botName: bot?.name || "" });
                }}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o bot..." /></SelectTrigger>
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
      className="w-[320px] border-l border-border bg-card flex flex-col h-full"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span>{def?.icon}</span>
          <h3 className="font-semibold text-sm">{def?.label || "Propriedades"}</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Tipo: {def?.label || node.type}</Label>
        </div>
        <div>
          <Label className="text-xs">Descrição do bloco (opcional)</Label>
          <Input
            value={(node.data.description as string) || ""}
            onChange={(e) => update("description", e.target.value)}
            className="mt-1"
            placeholder="Descreva o que este bloco faz..."
          />
        </div>

        {renderFields()}
      </div>

      {node.type !== "start" && (
        <div className="p-4 border-t border-border">
          <Button variant="destructive" size="sm" className="w-full gap-1.5" onClick={() => onDelete(node.id)}>
            <Trash2 size={14} /> Excluir bloco
          </Button>
        </div>
      )}
    </div>
  );
}

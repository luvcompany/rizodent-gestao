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

type Props = {
  node: Node;
  onUpdate: (nodeId: string, data: Record<string, any>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
};

export default function NodePropertiesPanel({ node, onUpdate, onClose, onDelete }: Props) {
  const def = NODE_DEFINITIONS.find((d) => d.type === node.type);
  const [stages, setStages] = useState<{ id: string; name: string; color: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; body_text: string | null; buttons: any; language: string; header_type: string | null; footer_text: string | null }[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    supabase.from("crm_stages").select("id, name, color").order("position").then(({ data }) => {
      if (data) setStages(data);
    });
    supabase.from("crm_whatsapp_templates").select("id, name, body_text, buttons, language, header_type, footer_text").eq("status", "APPROVED").then(({ data }) => {
      if (data) setTemplates(data);
    });
  }, []);

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
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop() || "bin";
    const fileName = `bot-files/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage.from("chat-media").upload(fileName, file);
    if (!error && data) {
      const signedUrl = await getUploadedFileUrl(data.path);
      update(targetField, signedUrl);
    }
    setUploading(false);
  };

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
                <Select value={(node.data.templateId as string) || "__none__"} onValueChange={(v) => handleTemplateSelect(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um modelo..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum (texto livre)</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!(node.data.templateId as string) && (
              <div>
                <Label className="text-xs">Mensagem</Label>
                <VariableTextarea
                  value={(node.data.text as string) || ""}
                  onChange={(v) => update("text", v)}
                  placeholder="Digite a mensagem... Use [ para variáveis"
                  rows={5}
                  className="mt-1"
                />
              </div>
            )}
            {(node.data.templateId as string) && (node.data.templateButtons as any[])?.length > 0 && (
              <div>
                <Label className="text-xs">Timeout sem resposta (minutos)</Label>
                <Input
                  type="number"
                  min={1}
                  value={(node.data.noResponseTimeoutMinutes as number) || 60}
                  onChange={(e) => update("noResponseTimeoutMinutes", parseInt(e.target.value) || 60)}
                  className="mt-1 w-24"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Cada botão do modelo cria um ramo. O ramo "Sem resposta" ativa após este tempo.
                </p>
              </div>
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
              <VariableTextarea
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
              <VariableTextarea
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
            {menuType === "list" && (
              <div>
                <Label className="text-xs">Título do menu</Label>
                <Input value={(node.data.buttonLabel as string) || "Menu"} onChange={(e) => update("buttonLabel", e.target.value)} className="mt-1 h-8 text-xs" />
                <Label className="text-xs mt-2 block">Itens da lista (um por linha: título | descrição)</Label>
                <VariableTextarea
                  value={(node.data.listItems as string) || ""}
                  onChange={(v) => update("listItems", v)}
                  placeholder={"Opção 1 | Descrição\nOpção 2 | Descrição"}
                  rows={4}
                  className="mt-1"
                />
              </div>
            )}
            <div>
              <Label className="text-xs">Timeout sem resposta (minutos)</Label>
              <Input
                type="number"
                min={1}
                value={(node.data.noResponseTimeoutMinutes as number) || 60}
                onChange={(e) => update("noResponseTimeoutMinutes", parseInt(e.target.value) || 60)}
                className="mt-1 w-24"
              />
            </div>
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
            <div>
              <Label className="text-xs">Timeout</Label>
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
            <div>
              <Label className="text-xs">Salvar resposta em campo (opcional)</Label>
              <Input value={(node.data.saveToField as string) || ""} onChange={(e) => update("saveToField", e.target.value)} placeholder="Nome do campo personalizado" className="mt-1" />
            </div>
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
                <VariableTextarea value={(node.data.text as string) || ""} onChange={(v) => update("text", v)} rows={4} className="mt-1" />
              </div>
            )}
            {msgType === "audio" && renderAudioRecorder("audioUrl")}
            {msgType === "file" && (
              <>
                {renderFileUploader("fileUrl")}
                <div>
                  <Label className="text-xs">Legenda</Label>
                  <VariableTextarea value={(node.data.caption as string) || ""} onChange={(v) => update("caption", v)} rows={2} className="mt-1" />
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
              <Select value={(node.data.field as string) || ""} onValueChange={(v) => update("field", v)}>
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
            <div>
              <Label className="text-xs">Valor</Label>
              <Input value={(node.data.value as string) || ""} onChange={(e) => update("value", e.target.value)} className="mt-1" />
            </div>
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
      case "remove_tag":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tag</Label>
              <Input value={(node.data.tag as string) || ""} onChange={(e) => update("tag", e.target.value)} placeholder="Nome da tag" className="mt-1" />
            </div>
          </div>
        );

      case "add_note":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nota</Label>
              <VariableTextarea value={(node.data.note as string) || ""} onChange={(v) => update("note", v)} placeholder="Texto da nota..." rows={4} className="mt-1" />
            </div>
          </div>
        );

      case "create_task":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Título da tarefa</Label>
              <Input value={(node.data.title as string) || ""} onChange={(e) => update("title", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Prazo (horas a partir de agora)</Label>
              <Input type="number" min={1} value={(node.data.dueHours as number) || 24} onChange={(e) => update("dueHours", parseInt(e.target.value) || 24)} className="mt-1" />
            </div>
          </div>
        );

      case "transfer_human":
        return <p className="text-sm text-muted-foreground">O bot será encerrado e a conversa voltará ao modo manual.</p>;

      default:
        return <p className="text-sm text-muted-foreground">Tipo de bloco não configurável.</p>;
    }
  };

  return (
    <div className="w-[320px] border-l border-border bg-card flex flex-col h-full">
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
          <Label className="text-xs">Nome do bloco</Label>
          <Input
            value={(node.data.label as string) || def?.label || ""}
            onChange={(e) => update("label", e.target.value)}
            className="mt-1"
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

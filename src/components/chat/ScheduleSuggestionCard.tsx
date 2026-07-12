import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, CalendarIcon, Check, Loader2, Send, X, ThumbsDown, MessageSquareText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  createConfirmedAppointment,
  detectRescheduleMode,
  resolveAppointmentTemplate,
  type AppointmentTemplateOption,
} from "@/lib/appointmentScheduling";

type ScheduleSuggestion = {
  id: string;
  lead_id: string;
  suggested_text: string;
  action_reason: string | null;
  suggested_date?: string | null; // 'YYYY-MM-DD'
  suggested_time?: string | null; // 'HH:MM'
};

interface Props {
  suggestion: ScheduleSuggestion;
  leadPhone: string | null;
  assistantName: string;
  onDone: () => void;
}

function parseDate(d?: string | null): Date | undefined {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
  return new Date(d + "T12:00:00");
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function ScheduleSuggestionCard({ suggestion, leadPhone, assistantName, onDone }: Props) {
  const [date, setDate] = useState<Date | undefined>(parseDate(suggestion.suggested_date));
  const [time, setTime] = useState<string>((suggestion.suggested_time || "09:00").slice(0, 5));
  const [notes, setNotes] = useState("");
  const [options, setOptions] = useState<AppointmentTemplateOption[]>([]);
  const [templateName, setTemplateName] = useState<string>("");
  const [templateBody, setTemplateBody] = useState<string>("");
  const [leadName, setLeadName] = useState<string>("");
  const [leadCidade, setLeadCidade] = useState<string>("");
  const [isReschedule, setIsReschedule] = useState(false);

  const [step, setStep] = useState<"propose" | "send">("propose");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Carrega lead (cidade/nome), resolve modelo por cidade e detecta reagendamento.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: lead } = await supabase
        .from("crm_leads")
        .select("name, cidade, tenant_id")
        .eq("id", suggestion.lead_id)
        .maybeSingle();
      if (!alive || !lead) return;
      setLeadName((lead as any).name || "");
      setLeadCidade((lead as any).cidade || "");
      const { options, resolved } = await resolveAppointmentTemplate((lead as any).tenant_id, (lead as any).cidade);
      if (!alive) return;
      setOptions(options);
      setTemplateName(resolved || "");
      detectRescheduleMode(suggestion.lead_id).then((r) => { if (alive) setIsReschedule(r); });
    })();
    return () => { alive = false; };
  }, [suggestion.lead_id]);

  // Carrega o corpo do modelo selecionado para pré-visualização.
  useEffect(() => {
    let alive = true;
    if (!templateName) { setTemplateBody(""); return; }
    (async () => {
      const { data } = await supabase
        .from("crm_whatsapp_templates" as any)
        .select("name, body_text")
        .ilike("name", `${templateName}%`)
        .eq("status", "APPROVED")
        .limit(1)
        .maybeSingle();
      if (alive) setTemplateBody(((data as any)?.body_text || "").trim());
    })();
    return () => { alive = false; };
  }, [templateName]);

  const dateLabel = useMemo(() => (date ? capitalize(format(date, "EEEE, dd/MM/yyyy", { locale: ptBR })) : ""), [date]);

  const confirmSchedule = async () => {
    if (!date) { toast.error("Selecione a data do agendamento"); return; }
    setSaving(true);
    try {
      await createConfirmedAppointment({ leadId: suggestion.lead_id, date, time, notes, isRescheduleMode: isReschedule });
      toast.success(`${isReschedule ? "Reagendamento" : "Agendamento"} confirmado — ${format(date, "dd/MM")} às ${time}`);
      setStep("send");
    } catch (e: any) {
      toast.error("Erro ao agendar: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const closeSuggestion = async (status: "scheduled" | "dismissed") => {
    const { data: u } = await supabase.auth.getUser();
    await supabase
      .from("ai_reply_suggestions" as any)
      .update({
        status,
        decided_at: new Date().toISOString(),
        decided_by: u.user?.id || null,
        ...(status === "scheduled" ? { final_text: suggestion.suggested_text } : {}),
      })
      .eq("id", suggestion.id);
  };

  const sendTemplate = async () => {
    if (!templateName) { toast.error("Selecione o modelo de agendamento"); return; }
    if (!leadPhone) { toast.error("Lead sem telefone para enviar o modelo"); return; }
    setSending(true);
    try {
      // As variáveis do modelo são preenchidas pelo PRÓPRIO servidor a partir do
      // agendamento recém-criado, na convenção real destes modelos: {{1}} = nome do
      // lead e {{2}} = data+hora. É o MESMO preenchimento já usado pelo compositor e
      // pelas automações (não reinventamos aqui) — por isso enviamos sem componentes
      // explícitos e deixamos o servidor resolver.
      const { error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: { lead_id: suggestion.lead_id, to: leadPhone, type: "template", template_name: templateName, template_language: "pt_BR" },
      });
      if (error) throw error;
      await closeSuggestion("scheduled");
      toast.success("Modelo de confirmação enviado ao paciente 🧡");
      onDone();
    } catch (e: any) {
      toast.error("Falha ao enviar o modelo: " + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  const finishWithoutSending = async () => {
    await closeSuggestion("scheduled");
    onDone();
  };

  const discard = async (bad: boolean) => {
    await closeSuggestion("dismissed");
    if (bad) toast.success("Descartada. Dica: para a Bia aprender o certo, responda/agende do jeito correto.");
    onDone();
  };

  return (
    <div className="px-3 py-2.5 border-t border-border bg-emerald-500/10">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          <CalendarClock size={14} className="text-emerald-600" />
          <span className="text-emerald-700 dark:text-emerald-400">
            {step === "propose" ? `${assistantName} sugere agendar` : "Agendado — enviar confirmação"}
          </span>
        </div>
        {step === "propose" && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" title="Descartar sugestão" onClick={() => discard(true)}>
              <ThumbsDown size={12} /><span className="hidden sm:inline">Ruim</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Fechar sem agendar" onClick={() => discard(false)}>
              <X size={14} />
            </Button>
          </div>
        )}
      </div>

      {/* Texto que a Bia enviaria (contexto) */}
      {suggestion.suggested_text && (
        <p className="text-xs text-muted-foreground mb-2 flex items-start gap-1.5">
          <MessageSquareText size={12} className="mt-0.5 shrink-0" />
          <span>{suggestion.suggested_text}</span>
        </p>
      )}

      {step === "propose" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Data</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("h-8 text-xs w-full justify-start", !date && "text-muted-foreground")}>
                    <CalendarIcon size={12} className="mr-1.5" />
                    {date ? format(date, "dd/MM/yyyy") : "Selecionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} locale={ptBR} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Horário</label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">
              Modelo de confirmação {leadCidade ? `(cidade: ${leadCidade})` : ""}
            </label>
            {options.length > 0 ? (
              <Select value={templateName} onValueChange={setTemplateName}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar modelo" /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.templateName} value={o.templateName} className="text-xs">
                      {o.templateName}{o.cidade ? ` · ${o.cidade}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-[11px] text-amber-600">Nenhum modelo de agendamento por cidade configurado. O agendamento será criado; envie a confirmação manualmente se quiser.</p>
            )}
          </div>

          <div className="flex gap-2 pt-0.5">
            <Button size="sm" className="flex-1 h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmSchedule} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {saving ? "Agendando..." : "Confirmar agendamento"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-md border border-emerald-500/30 bg-background/60 p-2 text-xs">
            <p className="font-medium text-emerald-700 dark:text-emerald-400 mb-1">
              ✅ {isReschedule ? "Reagendado" : "Agendado"}: {dateLabel} às {time}
            </p>
            {templateName ? (
              <>
                <p className="text-muted-foreground mb-1">Modelo pronto p/ enviar: <span className="font-mono">{templateName}</span></p>
                {templateBody && (
                  <p className="text-[11px] whitespace-pre-wrap text-foreground/80 border-l-2 border-emerald-500/30 pl-2">
                    {templateBody}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">Variáveis preenchidas automaticamente: {"{{1}}"} = nome do paciente, {"{{2}}"} = data e hora do agendamento.</p>
              </>
            ) : (
              <p className="text-muted-foreground">Sem modelo configurado para esta cidade — envie a confirmação manualmente pelo compositor.</p>
            )}
          </div>
          <div className="flex gap-2">
            {templateName && leadPhone && (
              <Button size="sm" className="flex-1 h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={sendTemplate} disabled={sending}>
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {sending ? "Enviando..." : "Enviar modelo"}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={finishWithoutSending} disabled={sending}>
              {templateName && leadPhone ? "Agora não" : "Concluir"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

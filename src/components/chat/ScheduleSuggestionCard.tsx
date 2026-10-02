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
import { useModule } from "@/hooks/useModule";
import { useEnvioDoLead } from "@/hooks/useEnvioDoLead";
import { envioFalhou, motivoDoEnvio } from "@/lib/erroDoEnvio";
import { preencherCorpo, valoresPadraoDoModelo } from "@/lib/modeloDoChat";
import { diaNoFuso } from "@/lib/fuso";
import { SeloDoEnvio } from "./AvisoDeEnvio";
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

export default function ScheduleSuggestionCard({ suggestion, leadPhone, assistantName: nomeRecebido, onDone }: Props) {
  // Nome configurado da assistente (vem do AiSuggestionStrip); vazio → padrão.
  const assistantName = nomeRecebido?.trim() || "Assistente";
  // Módulo de IA desligado para o cliente: o cartão some (só com false explícito).
  const { ligado: iaLigada } = useModule("ia");
  // WABA pausada / cliente sem número: "Enviar modelo" fica travado (S29P-3c).
  const envio = useEnvioDoLead(suggestion.lead_id);
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

  // Prévia com as variáveis como o servidor vai preencher (nome e a consulta
  // recém-criada) — mesma regra do envio pelo chat (CONV-15).
  const previaDoModelo = useMemo(() => {
    if (!templateBody) return "";
    const consulta = date ? { scheduled_date: format(date, "yyyy-MM-dd"), scheduled_time: time || null } : null;
    return preencherCorpo(templateBody, valoresPadraoDoModelo(templateBody, { name: leadName }, consulta, diaNoFuso(Date.now())));
  }, [templateBody, leadName, date, time]);

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

  const closeSuggestion = async (status: "scheduled" | "dismissed"): Promise<boolean> => {
    const acao = status === "dismissed" ? "descartar" : "concluir";
    const { data: u } = await supabase.auth.getUser();
    // O `.select()` torna a resposta verificável: RLS que recusa devolve
    // sucesso com ZERO linhas, não erro.
    const { data, error } = await supabase
      .from("ai_reply_suggestions" as any)
      .update({
        status,
        decided_at: new Date().toISOString(),
        decided_by: u.user?.id || null,
        ...(status === "scheduled" ? { final_text: suggestion.suggested_text } : {}),
      })
      .eq("id", suggestion.id)
      .select("id");
    if (error) {
      toast.error(`Erro ao ${acao} a sugestão: ` + error.message);
      return false;
    }
    if (!data || (data as any[]).length === 0) {
      toast.error(`Seu perfil não tem permissão para ${acao} esta sugestão.`);
      return false;
    }
    return true;
  };

  const sendTemplate = async () => {
    if (!templateName) { toast.error("Selecione o modelo de agendamento"); return; }
    if (!leadPhone) { toast.error("Lead sem telefone para enviar o modelo"); return; }
    if (envio.bloqueio) { toast.error(envio.bloqueio.texto); return; }
    setSending(true);
    try {
      // As variáveis do modelo são preenchidas pelo PRÓPRIO servidor a partir do
      // agendamento recém-criado, pela posição (1ª = nome do lead, 2ª = data e
      // hora — a convenção do editor de Modelos). É o mesmo preenchimento das
      // automações, e a prévia acima usa a mesma regra (valoresPadraoDoModelo);
      // por isso enviamos sem componentes explícitos.
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: { lead_id: suggestion.lead_id, to: leadPhone, type: "template", template_name: templateName, template_language: "pt_BR" },
      });
      // CONV-7: recusa da Meta volta 200 com ok:false. A sugestão só é
      // concluída quando o modelo SAIU; senão o cartão fica para tentar de novo.
      // 'enviado_sem_registro' (a Meta aceitou; só o histórico não gravou)
      // segue como ENVIADO: o card sai, pelo mesmo motivo de logo abaixo.
      const motivo = envioFalhou(data, error)
        ? await motivoDoEnvio(data, error, "Não foi possível enviar o modelo")
        : null;
      if (motivo && !motivo.semRegistro) {
        if (motivo.pausado) envio.reconsultar();
        toast.error(`Modelo não enviado: ${motivo.texto}`);
        return;
      }
      // O envio já aconteceu — a partir daqui o card SEMPRE sai da tela, mesmo
      // que a marcação da sugestão falhe: mantê-lo com o botão ativo convidaria
      // a um segundo clique, e o paciente receberia o modelo DUAS vezes.
      const closed = await closeSuggestion("scheduled");
      if (motivo?.semRegistro) {
        toast.warning(motivo.texto);
      } else if (closed) {
        toast.success("Modelo de confirmação enviado ao paciente 🧡");
      } else {
        toast.warning(
          "Modelo enviado, mas a sugestão não pôde ser marcada como concluída. Se ela reaparecer, use \"Concluir sem enviar\" — não envie de novo.",
        );
      }
      onDone();
    } catch {
      toast.error("Não foi possível enviar o modelo. Confira a conexão e tente de novo.");
    } finally {
      setSending(false);
    }
  };

  const finishWithoutSending = async () => {
    if (await closeSuggestion("scheduled")) onDone();
  };

  const discard = async (bad: boolean) => {
    if (!(await closeSuggestion("dismissed"))) return;
    if (bad) toast.success(`Descartada. Dica: para ${assistantName} aprender o certo, responda/agende do jeito correto.`);
    onDone();
  };

  if (iaLigada === false) return null;

  return (
    <div className="mx-3 my-2 rounded-2xl border border-success/25 bg-success-soft px-3 py-3 shadow-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
           <span className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-success shadow-xs"><CalendarClock size={14} /></span>
           <span className="text-success-soft-foreground">
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

      {/* Texto que a assistente enviaria (contexto) */}
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
                 <PopoverContent className="w-auto rounded-xl p-0 shadow-float" align="start">
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
              <p className="text-[11px] text-warning">Nenhum modelo de agendamento por cidade configurado. O agendamento será criado; envie a confirmação manualmente se quiser.</p>
            )}
          </div>

          <div className="flex gap-2 pt-0.5">
             <Button size="sm" className="h-8 flex-1 gap-1.5 rounded-full text-xs" onClick={confirmSchedule} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {saving ? "Agendando..." : "Confirmar agendamento"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
           <div className="min-w-0 overflow-hidden rounded-xl border border-success/25 bg-card p-3 text-xs shadow-xs">
             <p className="mb-1 font-medium text-success-soft-foreground">
              ✅ {isReschedule ? "Reagendado" : "Agendado"}: {dateLabel} às {time}
            </p>
            {templateName ? (
              <>
                <p className="text-muted-foreground mb-1">Modelo pronto p/ enviar: <span className="font-mono">{templateName}</span></p>
                {templateBody && (
                   <p className="break-words border-l-2 border-success/30 pl-2 text-[11px] text-foreground/80 whitespace-pre-wrap">
                    {previaDoModelo || templateBody}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">Prévia com o nome do paciente e a data e hora deste agendamento, como o servidor preenche.</p>
              </>
            ) : (
              <p className="text-muted-foreground">Sem modelo configurado para esta cidade — envie a confirmação manualmente pelo compositor.</p>
            )}
          </div>
          {envio.bloqueio && templateName && leadPhone && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <SeloDoEnvio bloqueio={envio.bloqueio} />
              <span>{envio.bloqueio.texto}.</span>
            </div>
          )}
          <div className="flex gap-2">
            {templateName && leadPhone && (
              <Button
                size="sm"
                 className="h-8 flex-1 gap-1.5 rounded-full text-xs"
                onClick={sendTemplate}
                disabled={sending || !!envio.bloqueio}
                title={envio.bloqueio ? envio.bloqueio.texto : undefined}
              >
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

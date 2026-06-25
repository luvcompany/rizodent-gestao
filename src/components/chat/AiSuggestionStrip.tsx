import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, X, Loader2, AlertTriangle, Send } from "lucide-react";
import { toast } from "sonner";

type Suggestion = {
  id: string;
  lead_id: string;
  suggested_text: string;
  action: "reply" | "handoff";
  action_reason: string | null;
  status: string;
  created_at: string;
  model: string | null;
};

// Registro global de gerações em andamento por lead. Persiste quando o usuário troca de conversa
// para que a IA continue rodando em background e a sugestão apareça ao voltar.
const inFlightByLead = new Map<string, Promise<void>>();
const inFlightListeners = new Set<() => void>();
function notifyInFlight() { inFlightListeners.forEach((fn) => { try { fn(); } catch {} }); }

interface Props {
  leadId: string;
  leadPhone: string | null;
  onSent?: () => void;
}

export default function AiSuggestionStrip({ leadId, leadPhone, onSent }: Props) {
  const { user } = useAuth();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [editedText, setEditedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [assistantName, setAssistantName] = useState("Bia");
  const editedRef = useRef("");

  // Load assistant name
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ai_assistant_config" as any)
        .select("assistant_display_name, copilot_enabled, is_active")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && (data as any).assistant_display_name) setAssistantName((data as any).assistant_display_name);
    })();
  }, []);

  const currentLeadRef = useRef(leadId);
  useEffect(() => { currentLeadRef.current = leadId; }, [leadId]);

  const loadPending = useCallback(async (targetLeadId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("ai_reply_suggestions" as any)
      .select("*")
      .eq("lead_id", targetLeadId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Discard stale results from a previous lead
    if (currentLeadRef.current !== targetLeadId) return;
    const s = (data as any) || null;
    if (s && s.lead_id !== targetLeadId) { setSuggestion(null); setLoading(false); return; }
    setSuggestion(s);
    if (s) {
      setEditedText(s.suggested_text);
      editedRef.current = s.suggested_text;
    } else {
      setEditedText("");
      editedRef.current = "";
    }
    setLoading(false);
  }, []);

  // Reset immediately when switching leads to avoid showing previous lead's suggestion
  useEffect(() => {
    setSuggestion(null);
    setEditedText("");
    editedRef.current = "";
    setLoading(true);
    loadPending(leadId);
  }, [leadId, loadPending]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel(`ai-sugg-${leadId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_reply_suggestions", filter: `lead_id=eq.${leadId}` },
        () => { loadPending(leadId); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [leadId, loadPending]);

  // Reflete o estado de geração em background para este lead. Se a IA estiver
  // gerando uma sugestão para o lead atual (mesmo que tenha sido iniciada antes
  // de trocar de conversa), mostramos o indicador "gerando".
  useEffect(() => {
    const update = () => setGenerating(inFlightByLead.has(leadId));
    update();
    inFlightListeners.add(update);
    return () => { inFlightListeners.delete(update); };
  }, [leadId]);

  const generate = () => {
    const target = leadId;
    if (inFlightByLead.has(target)) return; // já rodando em background
    const p = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("generate-reply-suggestion", {
          body: { lead_id: target },
        });
        if (error) throw error;
        if ((data as any)?.skipped === "copilot_disabled") {
          if (currentLeadRef.current === target) toast.info("Copiloto da IA está desligado nas configurações.");
        } else if ((data as any)?.skipped) {
          if (currentLeadRef.current === target) toast.info("Sem mensagens suficientes para sugerir.");
        } else {
          // Realtime já vai disparar loadPending, mas garantimos uma busca imediata
          // se o usuário ainda está olhando este lead.
          if (currentLeadRef.current === target) await loadPending(target);
        }
      } catch (e: any) {
        if (currentLeadRef.current === target) {
          toast.error(`Falha ao gerar sugestão: ${e?.message || e}`);
        } else {
          // Notifica de forma neutra para não confundir na conversa em que o usuário está agora
          toast.error("Falha ao gerar sugestão (conversa anterior).");
        }
      } finally {
        inFlightByLead.delete(target);
        notifyInFlight();
      }
    })();
    inFlightByLead.set(target, p);
    notifyInFlight();
  };

  const send = async () => {
    if (!suggestion || !leadPhone) return;
    const text = editedText.trim();
    if (!text) { toast.error("Mensagem vazia"); return; }
    const wasEdited = text !== suggestion.suggested_text;
    setSending(true);
    try {
      const { error: sendErr } = await supabase.functions.invoke("send-whatsapp-message", {
        body: { lead_id: leadId, to: leadPhone, message: text, type: "text" },
      });
      if (sendErr) throw sendErr;
      await supabase
        .from("ai_reply_suggestions" as any)
        .update({
          status: "sent",
          decided_at: new Date().toISOString(),
          decided_by: user?.id || null,
          final_text: text,
          was_edited: wasEdited,
        })
        .eq("id", suggestion.id);
      // 7C: registra exemplo bom em background (não bloqueia)
      supabase.functions.invoke("record-good-example", {
        body: { lead_id: leadId, ideal_reply: text },
      }).catch(() => {});
      setSuggestion(null);
      onSent?.();
      toast.success(`${assistantName} enviou a resposta`);
    } catch (e: any) {
      toast.error(`Erro ao enviar: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    if (!suggestion) return;
    await supabase
      .from("ai_reply_suggestions" as any)
      .update({ status: "discarded", decided_at: new Date().toISOString(), decided_by: user?.id || null })
      .eq("id", suggestion.id);
    setSuggestion(null);
  };

  if (loading) return null;

  if (!suggestion) {
    return (
      <div className="px-3 py-2 border-t border-border bg-secondary/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles size={14} className="text-primary" />
          <span>Copiloto {assistantName}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={generate} disabled={generating} className="h-7 text-xs gap-1.5">
          {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          Sugerir resposta ({assistantName})
        </Button>
      </div>
    );
  }

  const isHandoff = suggestion.action === "handoff";

  return (
    <div className={`px-3 py-2.5 border-t border-border ${isHandoff ? "bg-amber-500/10" : "bg-primary/5"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          {isHandoff ? (
            <><AlertTriangle size={14} className="text-amber-500" />
              <span className="text-amber-700 dark:text-amber-400">{assistantName} sugere atendimento humano</span></>
          ) : (
            <><Sparkles size={14} className="text-primary" />
              <span>Sugestão da {assistantName}</span></>
          )}
          {suggestion.model && <Badge variant="outline" className="h-4 text-[10px] px-1">{suggestion.model.split("/").pop()}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Descartar" onClick={discard}>
            <X size={14} />
          </Button>
          <Button
            size="sm"
            variant={isHandoff ? "outline" : "default"}
            className="h-7 gap-1.5 text-xs"
            onClick={send}
            disabled={sending || !leadPhone}
            title={isHandoff ? "Enviar mesmo assim" : "Enviar"}
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : isHandoff ? <Send size={12} /> : <Check size={12} />}
            {isHandoff ? "Enviar mesmo assim" : "Enviar"}
          </Button>
        </div>
      </div>

      {isHandoff && suggestion.action_reason && (
        <p className="text-xs text-amber-700 dark:text-amber-400 mb-1.5">Motivo: {suggestion.action_reason}</p>
      )}

      <Textarea
        value={editedText}
        onChange={(e) => { setEditedText(e.target.value); editedRef.current = e.target.value; }}
        rows={2}
        className="text-sm bg-background"
        placeholder="Mensagem sugerida..."
      />
    </div>
  );
}

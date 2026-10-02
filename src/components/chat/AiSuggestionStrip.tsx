import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, X, Loader2, AlertTriangle, Send, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import ScheduleSuggestionCard from "./ScheduleSuggestionCard";
import { useModule } from "@/hooks/useModule";
import { useEnvioDoLead } from "@/hooks/useEnvioDoLead";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { envioFalhou, motivoDoEnvio, traduzirMotivo } from "@/lib/erroDoEnvio";
import { abreTelaDeIa, motivoDoPuloSemTelaDeIa, PULOS_DA_TELA_DE_IA } from "@/lib/telaDeIa";
import { SeloDoEnvio } from "./AvisoDeEnvio";

/** Nome exibido quando o cliente não configurou (ou o perfil não lê) a assistente. */
const NOME_PADRAO_ASSISTENTE = "Assistente";

type Suggestion = {
  id: string;
  lead_id: string;
  suggested_text: string;
  action: "reply" | "handoff" | "schedule";
  action_reason: string | null;
  status: string;
  created_at: string;
  model: string | null;
  suggested_date?: string | null;
  suggested_time?: string | null;
};

// Registro global de gerações em andamento por lead. Persiste quando o usuário troca de conversa
// para que a IA continue rodando em background e a sugestão apareça ao voltar.
const inFlightByLead = new Map<string, Promise<void>>();
const inFlightListeners = new Set<() => void>();
function notifyInFlight() { inFlightListeners.forEach((fn) => { try { fn(); } catch {} }); }

/**
 * Por que a IA não sugeriu (códigos fixos do generate-reply-suggestion, P11).
 * O servidor já manda `mensagem` em PT-BR; estas são a reserva — AUTO-33.
 */
const MOTIVO_DO_PULO: Record<string, string> = {
  copilot_disabled: "O copiloto da IA está desligado em I.A → Assistente.",
  no_kb: "Configure a base de conhecimento em I.A → Assistente para a IA sugerir respostas.",
  no_config: "Assistente de IA desativada nesta clínica (I.A → Assistente).",
  feature_off: "Sugestões desativadas em I.A → Funções.",
  modulo_desligado: "O módulo de IA está desligado para esta clínica.",
  no_messages: "Esta conversa ainda não tem mensagens para a IA sugerir uma resposta.",
  no_text_history: "Sem mensagens de texto suficientes para sugerir.",
};

const JANELA_24H_MS = 24 * 60 * 60 * 1000;

interface Props {
  leadId: string;
  leadPhone: string | null;
  onSent?: () => void;
  /**
   * Última mensagem do paciente no WhatsApp (a mesma do compositor). Com a
   * janela de 24h fechada, "Enviar" vira aviso — a Meta recusaria o texto
   * livre (CONV-7). Opcional: sem ela a tira consulta sozinha.
   */
  lastInboundWaAt?: string | null;
}

export default function AiSuggestionStrip({ leadId, leadPhone, onSent, lastInboundWaAt }: Props) {
  const { user, userRole } = useAuth();
  // Atalho "Abrir I.A" e o caminho da tela só para quem tem a tela no menu.
  const podeAbrirIa = abreTelaDeIa(userRole);
  const navigate = useNavigate();
  // Módulo de IA desligado para o cliente: a tira some (só com false explícito).
  const { ligado: iaLigada } = useModule("ia");
  // WABA pausada / cliente sem número: o envio da sugestão fica travado (S29P-3c).
  const envio = useEnvioDoLead(leadId);
  // Janela de 24h: da prop, ou da consulta própria (feita junto de cada sugestão).
  const [ultimaEntradaWa, setUltimaEntradaWa] = useState<string | null | undefined>(undefined);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const referenciaDaJanela = lastInboundWaAt !== undefined ? lastInboundWaAt : ultimaEntradaWa;
  // undefined = ainda não se sabe: não trava (o servidor recusa se for o caso).
  const janelaFechada = useMemo(() => {
    if (referenciaDaJanela === undefined) return false;
    if (!referenciaDaJanela) return true;
    return agora - new Date(referenciaDaJanela).getTime() >= JANELA_24H_MS;
  }, [referenciaDaJanela, agora]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [editedText, setEditedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [assistantName, setAssistantName] = useState(NOME_PADRAO_ASSISTENTE);
  const editedRef = useRef("");

  // Nome configurado da assistente (ai_assistant_config.assistant_display_name).
  // Perfis sem leitura dessa config (RLS) ficam com o nome padrão.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from("ai_assistant_config" as any)
        .select("assistant_display_name, copilot_enabled, is_active")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nome = String((data as { assistant_display_name?: string | null } | null)?.assistant_display_name ?? "").trim();
      if (vivo && nome) setAssistantName(nome);
    })();
    return () => { vivo = false; };
  }, []);

  const currentLeadRef = useRef(leadId);
  useEffect(() => { currentLeadRef.current = leadId; }, [leadId]);
  const lastInboundWaAtRef = useRef(lastInboundWaAt);
  useEffect(() => { lastInboundWaAtRef.current = lastInboundWaAt; }, [lastInboundWaAt]);

  const consultarUltimaEntradaWa = useCallback(async (targetLeadId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("created_at")
      .eq("lead_id", targetLeadId)
      .eq("direction", "inbound")
      .eq("channel", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || currentLeadRef.current !== targetLeadId) return;
    setUltimaEntradaWa((data as { created_at?: string } | null)?.created_at ?? null);
  }, []);

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
      // Sugestão nova normalmente vem de mensagem nova do paciente: confere a janela.
      if (lastInboundWaAtRef.current === undefined) void consultarUltimaEntradaWa(targetLeadId);
    } else {
      setEditedText("");
      editedRef.current = "";
    }
    setLoading(false);
  }, [consultarUltimaEntradaWa]);

  // Reset immediately when switching leads to avoid showing previous lead's suggestion
  useEffect(() => {
    setUltimaEntradaWa(undefined);
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
        if (error || (data as any)?.error) {
          const motivo = await motivoDoServidor(data, error, "Não foi possível gerar a sugestão");
          const texto = traduzirMotivo(motivo, "Não foi possível gerar a sugestão");
          toast.error(currentLeadRef.current === target ? `Sugestão não gerada: ${texto}` : "Falha ao gerar sugestão (conversa anterior).");
          return;
        }
        const pulo = (data as any)?.skipped as string | undefined;
        if (pulo) {
          // AUTO-33: cada motivo com a frase dele (antes tudo virava "Sem mensagens suficientes").
          if (currentLeadRef.current === target) {
            if (PULOS_DA_TELA_DE_IA.has(pulo) && !podeAbrirIa) {
              // SDR/closer/recepção: sem o caminho de uma tela que não abrem.
              toast.info(motivoDoPuloSemTelaDeIa(pulo));
            } else {
              const texto = String((data as any)?.mensagem || MOTIVO_DO_PULO[pulo] || "A IA não gerou sugestão para esta conversa.");
              if (PULOS_DA_TELA_DE_IA.has(pulo)) {
                toast.info(texto, { action: { label: "Abrir I.A", onClick: () => navigate("/crm/ia-config") } });
              } else {
                toast.info(texto);
              }
            }
          }
        } else {
          // Realtime já vai disparar loadPending, mas garantimos uma busca imediata
          // se o usuário ainda está olhando este lead.
          if (currentLeadRef.current === target) await loadPending(target);
        }
      } catch {
        // Notifica de forma neutra quando o usuário já está em outra conversa
        toast.error(currentLeadRef.current === target
          ? "Não foi possível gerar a sugestão. Confira a conexão e tente de novo."
          : "Falha ao gerar sugestão (conversa anterior).");
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
    if (envio.bloqueio) { toast.error(envio.bloqueio.texto); return; }
    if (janelaFechada) { toast.error("Janela de 24h fechada — envie um modelo."); return; }
    const wasEdited = text !== suggestion.suggested_text;
    setSending(true);
    try {
      const { data, error: sendErr } = await supabase.functions.invoke("send-whatsapp-message", {
        body: { lead_id: leadId, to: leadPhone, message: text, type: "text" },
      });
      // CONV-7: recusa da Meta volta 200 com ok:false. Antes de marcar a
      // sugestão como enviada e de ensinar a IA, confere que SAIU mesmo.
      // 'enviado_sem_registro' (a Meta aceitou; só o histórico não gravou)
      // conta como enviada: a sugestão sai e a IA aprende do mesmo jeito.
      const motivo = envioFalhou(data, sendErr)
        ? await motivoDoEnvio(data, sendErr, "Não foi possível enviar a sugestão")
        : null;
      if (motivo && !motivo.semRegistro) {
        if (motivo.pausado) envio.reconsultar();
        toast.error(`Sugestão não enviada: ${motivo.texto}`);
        return;
      }
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
        body: {
          lead_id: leadId,
          ideal_reply: text,
          rejected_reply: wasEdited ? suggestion.suggested_text : null,
          source_suggestion_id: suggestion.id,
          source: wasEdited ? "human_correction" : "approved_reply",
        },
      }).catch(() => {});
      setSuggestion(null);
      onSent?.();
      if (motivo?.semRegistro) toast.warning(motivo.texto);
      else toast.success(`${assistantName} enviou a resposta`);
    } catch {
      toast.error("Não foi possível enviar a sugestão. Confira a conexão e tente de novo.");
    } finally {
      setSending(false);
    }
  };

  const dismiss = async () => {
    if (!suggestion) return;
    // Fechar sem enviar NÃO significa que a sugestão era ruim — apenas descarta a exibição.
    await supabase
      .from("ai_reply_suggestions" as any)
      .update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: user?.id || null })
      .eq("id", suggestion.id);
    setSuggestion(null);
  };

  const discardAsBad = async () => {
    if (!suggestion) return;
    await supabase
      .from("ai_reply_suggestions" as any)
      .update({ status: "discarded", decided_at: new Date().toISOString(), decided_by: user?.id || null })
      .eq("id", suggestion.id);
    setSuggestion(null);
    toast.success(`Descartada. Dica: para ${assistantName} aprender o certo, edite a resposta e envie — a correção vira exemplo.`);
  };


  if (iaLigada === false) return null;
  if (loading) return null;

  if (!suggestion) {
    return (
      <div className="mx-3 my-2 flex items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary-soft px-3 py-2 shadow-xs">
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

  // Sugestão de agendamento: card dedicado (human-in-the-loop) que cria o agendamento
  // e prepara o modelo de confirmação da cidade para o operador enviar.
  if (suggestion.action === "schedule") {
    return (
      <ScheduleSuggestionCard
        suggestion={suggestion}
        leadPhone={leadPhone}
        assistantName={assistantName}
        onDone={() => loadPending(leadId)}
      />
    );
  }

  const isHandoff = suggestion.action === "handoff";

  return (
    <div className={`mx-3 my-2 rounded-2xl border px-3 py-2.5 shadow-xs ${isHandoff ? "border-warning/25 bg-warning-soft" : "border-primary/15 bg-primary-soft"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          {isHandoff ? (
            <><AlertTriangle size={14} className="text-warning" />
              <span className="text-foreground dark:text-warning">{assistantName} sugere atendimento humano</span></>
          ) : (
            <><Sparkles size={14} className="text-primary" />
              <span>Sugestão · {assistantName}</span></>
          )}
          {suggestion.model && <Badge variant="outline" className="h-4 text-[10px] px-1">{suggestion.model.split("/").pop()}</Badge>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" title={`Marcar como ruim (${assistantName} aprende a evitar)`} onClick={discardAsBad}>
            <ThumbsDown size={12} />
            <span className="hidden sm:inline">Ruim</span>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Fechar sem enviar" onClick={dismiss}>
            <X size={14} />
          </Button>

          {envio.bloqueio ? (
            <SeloDoEnvio bloqueio={envio.bloqueio} />
          ) : janelaFechada ? (
            <span className="max-w-full rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-medium leading-snug text-warning-soft-foreground" title="A Meta só aceita texto livre até 24h depois da última mensagem do paciente.">
              Janela de 24h fechada — envie um modelo
            </span>
          ) : (
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
          )}
        </div>
      </div>

      {isHandoff && suggestion.action_reason && (
        <p className="text-xs text-foreground mb-1.5">Motivo: {suggestion.action_reason}</p>
      )}

      <Textarea
        value={editedText}
        onChange={(e) => { setEditedText(e.target.value); editedRef.current = e.target.value; }}
        rows={2}
        className="rounded-xl border-border/60 bg-card text-sm shadow-xs"
        placeholder="Mensagem sugerida..."
      />
    </div>
  );
}

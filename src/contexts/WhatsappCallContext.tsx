import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { WhatsappCallSession } from "@/lib/whatsapp-call-session";
import { IncomingWhatsappCallModal } from "@/components/whatsapp-calls/IncomingWhatsappCallModal";
import { ActiveWhatsappCallBar } from "@/components/whatsapp-calls/ActiveWhatsappCallBar";
import { toast } from "sonner";
import { playIncomingRingtone, playOutgoingDialTone } from "@/lib/call-tones";

export interface WhatsappCallRow {
  id: string;
  tenant_id: string;
  phone_number_id: string;
  wa_call_id: string;
  lead_id: string | null;
  from_phone: string | null;
  to_phone: string | null;
  direction: "inbound" | "outbound";
  status: string;
  event: string | null;
  sdp_offer: string | null;
  sdp_answer: string | null;
  started_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
}

type CallState =
  | { phase: "idle" }
  | { phase: "ringing"; call: WhatsappCallRow }
  | { phase: "connecting"; call: WhatsappCallRow }
  | { phase: "active"; call: WhatsappCallRow; startedAt: number };

interface Ctx {
  state: CallState;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  hangupCall: () => Promise<void>;
  toggleMute: () => void;
  muted: boolean;
  initiateCall: (params: { toPhone: string; leadId?: string | null; leadName?: string | null; phoneNumberId?: string }) => Promise<void>;
}

const WhatsappCallContext = createContext<Ctx | null>(null);

export const useWhatsappCall = () => {
  const ctx = useContext(WhatsappCallContext);
  if (!ctx) throw new Error("useWhatsappCall must be used within WhatsappCallProvider");
  return ctx;
};

// ID desta aba — usado para ignorar ecos no BroadcastChannel
const TAB_ID = (typeof crypto !== "undefined" && "randomUUID" in crypto)
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2);

type SyncMsg = {
  type: "handling" | "accepted" | "rejected" | "dismissed";
  callId: string;
  tabId: string;
};

export const WhatsappCallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const [state, setState] = useState<CallState>({ phase: "idle" });
  const [muted, setMuted] = useState(false);
  const sessionRef = useRef<WhatsappCallSession | null>(null);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  const publishSync = useCallback((msg: Omit<SyncMsg, "tabId">) => {
    try {
      syncChannelRef.current?.postMessage({ ...msg, tabId: TAB_ID } satisfies SyncMsg);
    } catch (e) {
      console.warn("[wa-call] sync publish error", e);
    }
  }, []);

  // Silencia local (para a mesma call.id) quando outra aba assume/dismissa
  const silenceIfMatches = useCallback((callId: string) => {
    setState((prev) => {
      if (prev.phase === "ringing" && prev.call.id === callId) {
        return { phase: "idle" };
      }
      return prev;
    });
  }, []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<{ stop: () => void } | null>(null);
  const dialToneRef = useRef<{ stop: () => void } | null>(null);

  // --- Realtime: escuta whatsapp_calls do tenant
  useEffect(() => {
    if (!user || !tenantId) return;
    const channel = supabase
      .channel(`wa-calls-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_calls", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const row = (payload.new || payload.old) as WhatsappCallRow;
          if (!row) return;

          setState((prev) => {
            // Ligação entrante: connect + inbound + sdp_offer
            if (
              row.direction === "inbound" &&
              (row.status === "ringing" || row.event === "connect") &&
              row.sdp_offer &&
              prev.phase === "idle"
            ) {
              return { phase: "ringing", call: row };
            }

            // Outbound: recebeu SDP answer → aplica no peer
            if (
              row.direction === "outbound" &&
              row.sdp_answer &&
              prev.phase !== "idle" &&
              "call" in prev &&
              prev.call.id === row.id &&
              sessionRef.current
            ) {
              sessionRef.current.applyRemoteAnswer(row.sdp_answer).catch((e) =>
                console.error("[wa-call] applyRemoteAnswer error", e),
              );
            }

            // Outbound: consumidor aceitou → active
            if (
              row.direction === "outbound" &&
              (row.event === "accept" || row.status === "accepted" || row.status === "connected") &&
              prev.phase === "connecting" &&
              "call" in prev &&
              prev.call.id === row.id
            ) {
              return { phase: "active", call: { ...prev.call, ...row }, startedAt: Date.now() };
            }
            // Inbound tocando: outra sessão/aba atendeu → silencia local
            if (
              row.direction === "inbound" &&
              (row.event === "accept" ||
                row.status === "accepted" ||
                row.status === "connected" ||
                row.status === "in-progress") &&
              prev.phase === "ringing" &&
              prev.call.id === row.id
            ) {
              ringtoneRef.current?.stop(); ringtoneRef.current = null;
              return { phase: "idle" };
            }


            // Terminate remoto durante ringing/active → limpa
            if (
              (row.status === "completed" ||
                row.status === "missed" ||
                row.status === "rejected" ||
                row.status === "failed" ||
                row.status === "canceled") &&
              prev.phase !== "idle" &&
              "call" in prev &&
              prev.call.id === row.id
            ) {
              sessionRef.current?.cleanup();
              sessionRef.current = null;
              ringtoneRef.current?.stop(); ringtoneRef.current = null;
              dialToneRef.current?.stop(); dialToneRef.current = null;
              return { phase: "idle" };
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, tenantId]);

  // --- BroadcastChannel: sincroniza abas do mesmo navegador
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("wa-call-sync");
    syncChannelRef.current = ch;
    ch.onmessage = (ev) => {
      const msg = ev.data as SyncMsg;
      if (!msg || msg.tabId === TAB_ID) return;
      if (msg.type === "handling" || msg.type === "accepted" || msg.type === "rejected" || msg.type === "dismissed") {
        silenceIfMatches(msg.callId);
      }
    };
    return () => {
      try { ch.close(); } catch { /* noop */ }
      if (syncChannelRef.current === ch) syncChannelRef.current = null;
    };
  }, [silenceIfMatches]);




  // --- Ringtone (entrante) + dial tone (saindo)
  useEffect(() => {
    // Ringtone só toca em "ringing" (entrante aguardando o usuário atender)
    if (state.phase === "ringing") {
      if (!ringtoneRef.current) ringtoneRef.current = playIncomingRingtone();
    } else {
      ringtoneRef.current?.stop();
      ringtoneRef.current = null;
    }

    // Dial tone toca em "connecting" para chamadas outbound (aguardando o remoto atender)
    const isOutboundConnecting =
      state.phase === "connecting" && "call" in state && state.call.direction === "outbound";
    if (isOutboundConnecting) {
      if (!dialToneRef.current) dialToneRef.current = playOutgoingDialTone();
    } else {
      dialToneRef.current?.stop();
      dialToneRef.current = null;
    }
  }, [state.phase, (state as any).call?.direction]);

  useEffect(() => {
    return () => {
      ringtoneRef.current?.stop();
      dialToneRef.current?.stop();
    };
  }, []);


  const acceptCall = useCallback(async () => {
    if (state.phase !== "ringing") return;
    const call = state.call;
    publishSync({ type: "accepted", callId: call.id });
    setState({ phase: "connecting", call });
    try {
      const session = new WhatsappCallSession(call.id, {
        onRemoteStream: (stream) => {
          if (audioRef.current) {
            audioRef.current.srcObject = stream;
            void audioRef.current.play().catch(() => { /* noop */ });
          }
        },
        onConnectionStateChange: (s) => {
          if (s === "connected") {
            setState((prev) => (prev.phase === "connecting" ? { phase: "active", call: prev.call, startedAt: Date.now() } : prev));
          }
          if (s === "failed" || s === "disconnected" || s === "closed") {
            sessionRef.current?.cleanup();
            sessionRef.current = null;
            setState({ phase: "idle" });
          }
        },
      });
      sessionRef.current = session;
      await session.accept(call.sdp_offer || "");
      // se não emitiu 'connected' rapidamente, ainda assim marca active — Meta pode não emitir state
      setTimeout(() => {
        setState((prev) => (prev.phase === "connecting" ? { phase: "active", call: prev.call, startedAt: Date.now() } : prev));
      }, 1500);
    } catch (e: any) {
      console.error("[wa-call] accept error:", e);
      if (e?.code === "no_call_permission") {
        toast.error("Este contato ainda não autorizou receber ligações.");
      } else {
        toast.error(`Falha ao atender: ${e?.message ?? e}`);
      }
      sessionRef.current?.cleanup();
      sessionRef.current = null;
      setState({ phase: "idle" });
    }
  }, [state, publishSync]);

  const rejectCall = useCallback(async () => {
    if (state.phase !== "ringing") return;
    const call = state.call;
    publishSync({ type: "rejected", callId: call.id });
    try {
      const session = new WhatsappCallSession(call.id);
      await session.reject();
    } catch (e) {
      console.error("[wa-call] reject error:", e);
    }
    setState({ phase: "idle" });
  }, [state, publishSync]);

  const hangupCall = useCallback(async () => {
    const session = sessionRef.current;
    if (session) {
      try { await session.terminate(); } catch (e) { console.error(e); }
    }
    sessionRef.current = null;
    setState({ phase: "idle" });
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }, [muted]);

  const initiateCall = useCallback(async (params: { toPhone: string; leadId?: string | null; leadName?: string | null; phoneNumberId?: string }) => {
    if (state.phase !== "idle") {
      toast.error("Já existe uma chamada em andamento");
      return;
    }
    const toPhone = params.toPhone.replace(/\D/g, "");
    if (!toPhone) {
      toast.error("Número inválido");
      return;
    }
    // placeholder para exibir barra imediatamente
    const placeholder: WhatsappCallRow = {
      id: "pending",
      tenant_id: tenantId!,
      phone_number_id: "",
      wa_call_id: "",
      lead_id: params.leadId ?? null,
      from_phone: null,
      to_phone: toPhone,
      direction: "outbound",
      status: "connecting",
      event: "connect",
      sdp_offer: null,
      sdp_answer: null,
      started_at: new Date().toISOString(),
      connected_at: null,
      ended_at: null,
      duration_seconds: null,
    };
    setState({ phase: "connecting", call: placeholder });
    try {
      const session = new WhatsappCallSession("pending", {
        onRemoteStream: (stream) => {
          if (audioRef.current) {
            audioRef.current.srcObject = stream;
            void audioRef.current.play().catch(() => { /* noop */ });
          }
        },
        onConnectionStateChange: (s) => {
          if (s === "connected") {
            setState((prev) => (prev.phase === "connecting" ? { phase: "active", call: prev.call, startedAt: Date.now() } : prev));
          }
          if (s === "failed" || s === "disconnected" || s === "closed") {
            sessionRef.current?.cleanup();
            sessionRef.current = null;
            setState({ phase: "idle" });
          }
        },
      });
      sessionRef.current = session;
      const { callDbId } = await session.initiate({ toPhone, phoneNumberId: params.phoneNumberId, leadId: params.leadId });
      setState((prev) => (prev.phase !== "idle" && "call" in prev ? { ...prev, call: { ...prev.call, id: callDbId, to_phone: toPhone } } : prev));
      toast.success(`Ligando para ${params.leadName || toPhone}...`);
    } catch (e: any) {
      console.error("[wa-call] initiate error:", e);
      if (e?.code === "no_call_permission") {
        toast.error("Este contato ainda não autorizou receber ligações.", {
          description: "Peça para ele aceitar a solicitação de permissão de chamada no WhatsApp e tente novamente.",
        });
      } else {
        toast.error(`Falha ao iniciar chamada: ${e?.message ?? e}`);
      }
      sessionRef.current?.cleanup();
      sessionRef.current = null;
      setState({ phase: "idle" });
    }
  }, [state.phase, tenantId]);

  const value = useMemo<Ctx>(() => ({ state, acceptCall, rejectCall, hangupCall, toggleMute, muted, initiateCall }), [state, acceptCall, rejectCall, hangupCall, toggleMute, muted, initiateCall]);

  return (
    <WhatsappCallContext.Provider value={value}>
      {children}
      {/* Áudio remoto invisível */}
      <audio ref={audioRef} autoPlay playsInline hidden />
      {state.phase === "ringing" && (
        <IncomingWhatsappCallModal
          call={state.call}
          onAccept={acceptCall}
          onReject={rejectCall}
          onInteract={() => publishSync({ type: "handling", callId: state.call.id })}
        />
      )}
      {(state.phase === "connecting" || state.phase === "active") && (
        <ActiveWhatsappCallBar
          call={state.call}
          startedAt={state.phase === "active" ? state.startedAt : null}
          onHangup={hangupCall}
          muted={muted}
          onToggleMute={toggleMute}
        />
      )}
    </WhatsappCallContext.Provider>
  );
};

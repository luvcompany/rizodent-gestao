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

export const WhatsappCallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const [state, setState] = useState<CallState>({ phase: "idle" });
  const [muted, setMuted] = useState(false);
  const sessionRef = useRef<WhatsappCallSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

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
              stopRingtone();
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


  // --- Ringtone
  useEffect(() => {
    if (state.phase === "ringing") playRingtone();
    else stopRingtone();
  }, [state.phase]);

  const playRingtone = () => {
    try {
      if (!ringtoneRef.current) {
        // Ringtone sintético via data URI (tom simples)
        ringtoneRef.current = new Audio(
          "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAGAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA",
        );
        ringtoneRef.current.loop = true;
      }
      void ringtoneRef.current.play().catch(() => { /* autoplay policy */ });
    } catch { /* ignore */ }
  };
  const stopRingtone = () => {
    try {
      ringtoneRef.current?.pause();
      if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    } catch { /* ignore */ }
  };

  const acceptCall = useCallback(async () => {
    if (state.phase !== "ringing") return;
    const call = state.call;
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
      toast.error(`Falha ao atender: ${e?.message ?? e}`);
      sessionRef.current?.cleanup();
      sessionRef.current = null;
      setState({ phase: "idle" });
    }
  }, [state]);

  const rejectCall = useCallback(async () => {
    if (state.phase !== "ringing") return;
    const call = state.call;
    try {
      const session = new WhatsappCallSession(call.id);
      await session.reject();
    } catch (e) {
      console.error("[wa-call] reject error:", e);
    }
    setState({ phase: "idle" });
  }, [state]);

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
      toast.error(`Falha ao iniciar chamada: ${e?.message ?? e}`);
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
        <IncomingWhatsappCallModal call={state.call} onAccept={acceptCall} onReject={rejectCall} />
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

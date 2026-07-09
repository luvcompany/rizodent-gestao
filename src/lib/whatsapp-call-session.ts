// WhatsApp Calling — WebRTC session manager
// Cria/gerencia RTCPeerConnection para uma chamada inbound.
// - Recebe SDP offer + ICE (da Meta via webhook / Realtime)
// - Solicita mic, gera SDP answer
// - Chama edge function `whatsapp-call-signaling` para forward do answer
import { supabase } from "@/integrations/supabase/client";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export interface WhatsappCallSessionHandlers {
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (err: Error) => void;
}

export class WhatsappCallSession {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream = new MediaStream();
  private handlers: WhatsappCallSessionHandlers;
  private callDbId: string;

  constructor(callDbId: string, handlers: WhatsappCallSessionHandlers = {}) {
    this.callDbId = callDbId;
    this.handlers = handlers;
  }

  setCallDbId(id: string) {
    this.callDbId = id;
  }

  getRemoteStream() {
    return this.remoteStream;
  }

  /** Aceita a chamada: pede mic, cria answer e envia para Meta via edge function. */
  async accept(sdpOffer: string): Promise<void> {
    if (!sdpOffer) throw new Error("SDP offer ausente");

    // 1) mic
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // 2) PeerConnection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.oniceconnectionstatechange = () => {
      console.log("[wa-call] iceConnectionState:", pc.iceConnectionState);
    };
    pc.onconnectionstatechange = () => {
      console.log("[wa-call] connectionState:", pc.connectionState);
      this.handlers.onConnectionStateChange?.(pc.connectionState);
    };
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach((t) => {
        if (!this.remoteStream.getTracks().find((x) => x.id === t.id)) {
          this.remoteStream.addTrack(t);
        }
      });
      this.handlers.onRemoteStream?.(this.remoteStream);
    };

    // 3) Adiciona faixas locais
    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    // 4) Set remote (offer da Meta)
    await pc.setRemoteDescription({ type: "offer", sdp: sdpOffer });

    // 5) Cria answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // 6) Aguarda ICE gathering completo (SDP não-trickle)
    await this.waitForIceGathering(pc);

    const finalSdp = pc.localDescription?.sdp;
    if (!finalSdp) throw new Error("Falha ao gerar SDP answer");

    // 7) Envia para Meta via edge function
    const { data, error } = await supabase.functions.invoke("whatsapp-call-signaling", {
      body: { call_id: this.callDbId, action: "accept", sdp: finalSdp },
    });
    if (error) {
      this.cleanup();
      throw new Error(`Signaling error: ${error.message}`);
    }
    if ((data as any)?.ok === false) {
      this.cleanup();
      const err: any = new Error((data as any).user_message || (data as any).code || "call error");
      err.code = (data as any).code;
      throw err;
    }
    if ((data as any)?.error) {
      this.cleanup();
      throw new Error((data as any).error);
    }
  }

  /** Inicia uma chamada de saída: cria offer, envia à Meta, aguarda answer via applyRemoteAnswer(). */
  async initiate(params: { toPhone: string; phoneNumberId?: string; leadId?: string | null }): Promise<{ callDbId: string; waCallId: string | null }> {
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.oniceconnectionstatechange = () => console.log("[wa-call] iceConnectionState:", pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      console.log("[wa-call] connectionState:", pc.connectionState);
      this.handlers.onConnectionStateChange?.(pc.connectionState);
    };
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach((t) => {
        if (!this.remoteStream.getTracks().find((x) => x.id === t.id)) this.remoteStream.addTrack(t);
      });
      this.handlers.onRemoteStream?.(this.remoteStream);
    };

    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc);
    const finalSdp = pc.localDescription?.sdp;
    if (!finalSdp) throw new Error("Falha ao gerar SDP offer");

    const { data, error } = await supabase.functions.invoke("whatsapp-call-signaling", {
      body: {
        action: "connect",
        sdp: finalSdp,
        to_phone: params.toPhone,
        phone_number_id: params.phoneNumberId,
        lead_id: params.leadId ?? null,
      },
    });
    if (error) { this.cleanup(); throw new Error(`Signaling error: ${error.message}`); }
    if ((data as any)?.error) { this.cleanup(); throw new Error((data as any).error); }

    const callDbId = (data as any).call_id as string;
    const waCallId = (data as any).wa_call_id ?? null;
    if (callDbId) this.callDbId = callDbId;
    return { callDbId, waCallId };
  }

  /** Aplica o SDP answer recebido via webhook (para outbound). */
  async applyRemoteAnswer(sdpAnswer: string): Promise<void> {
    if (!this.pc) throw new Error("PeerConnection não iniciada");
    if (this.pc.currentRemoteDescription) return; // já aplicado
    await this.pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
  }

  /** Rejeita a chamada sem abrir mídia. */
  async reject(): Promise<void> {
    await supabase.functions.invoke("whatsapp-call-signaling", {
      body: { call_id: this.callDbId, action: "reject" },
    });
  }

  /** Encerra a chamada em andamento. */
  async terminate(): Promise<void> {
    try {
      await supabase.functions.invoke("whatsapp-call-signaling", {
        body: { call_id: this.callDbId, action: "terminate" },
      });
    } finally {
      this.cleanup();
    }
  }

  /** Muta/desmuta o microfone local. */
  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  cleanup() {
    try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { this.pc?.close(); } catch { /* noop */ }
    this.localStream = null;
    this.pc = null;
  }

  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const timeout = setTimeout(() => resolve(), 3500); // fallback
      const onChange = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timeout);
          pc.removeEventListener("icegatheringstatechange", onChange);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", onChange);
    });
  }
}

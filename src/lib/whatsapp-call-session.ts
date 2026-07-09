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

  // Gravação — mix (playback) + faixas separadas (diarização)
  private recorder: MediaRecorder | null = null;
  private recorderChunks: Blob[] = [];
  private agentRecorder: MediaRecorder | null = null;
  private agentChunks: Blob[] = [];
  private leadRecorder: MediaRecorder | null = null;
  private leadChunks: Blob[] = [];
  private mixerCtx: AudioContext | null = null;
  private recordingStartedAt: number | null = null;
  private recordingPromise: Promise<void> | null = null;

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

  private pickMime(): string {
    return MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
  }

  /** Inicia gravação: um recorder do mix (playback) + um por canal (diarização). */
  private startRecordingIfReady() {
    if (this.recorder || !this.localStream) return;
    if (this.remoteStream.getAudioTracks().length === 0) return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(this.localStream).connect(dest);
      ctx.createMediaStreamSource(this.remoteStream).connect(dest);
      this.mixerCtx = ctx;

      const mime = this.pickMime();
      const make = (stream: MediaStream) =>
        mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

      // 1) mix (para playback do áudio da ligação)
      const rec = make(dest.stream);
      this.recorder = rec;
      this.recorderChunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.recorderChunks.push(e.data); };
      rec.start(1000);

      // 2) atendente (microfone local isolado)
      try {
        const agentRec = make(this.localStream);
        this.agentRecorder = agentRec;
        this.agentChunks = [];
        agentRec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.agentChunks.push(e.data); };
        agentRec.start(1000);
      } catch (e) {
        console.warn("[wa-call] agent recorder failed:", e);
      }

      // 3) lead (áudio remoto isolado)
      try {
        const leadRec = make(this.remoteStream);
        this.leadRecorder = leadRec;
        this.leadChunks = [];
        leadRec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.leadChunks.push(e.data); };
        leadRec.start(1000);
      } catch (e) {
        console.warn("[wa-call] lead recorder failed:", e);
      }

      this.recordingStartedAt = Date.now();
      console.log("[wa-call] recording started (mix + agent + lead)");
    } catch (e) {
      console.warn("[wa-call] failed to start recording:", e);
    }
  }

  private stopRecorder(rec: MediaRecorder | null, chunks: Blob[]): Promise<Blob> {
    return new Promise((resolve) => {
      if (!rec) return resolve(new Blob([], { type: "audio/webm" }));
      const mime = rec.mimeType || "audio/webm";
      rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
      try { rec.stop(); } catch { resolve(new Blob(chunks, { type: mime })); }
    });
  }

  /** Para o recorder, faz upload no bucket e atualiza a mensagem da chamada. */
  private async stopAndUploadRecording(): Promise<void> {
    const rec = this.recorder;
    if (!rec) return;
    const agentRec = this.agentRecorder;
    const leadRec = this.leadRecorder;
    this.recorder = null;
    this.agentRecorder = null;
    this.leadRecorder = null;

    const [mixBlob, agentBlob, leadBlob] = await Promise.all([
      this.stopRecorder(rec, this.recorderChunks),
      this.stopRecorder(agentRec, this.agentChunks),
      this.stopRecorder(leadRec, this.leadChunks),
    ]);
    this.recorderChunks = [];
    this.agentChunks = [];
    this.leadChunks = [];
    const started = this.recordingStartedAt;
    this.recordingStartedAt = null;

    try { this.mixerCtx?.close(); } catch { /* noop */ }
    this.mixerCtx = null;

    if (mixBlob.size < 1000) {
      console.warn("[wa-call] recording too small, skipping upload");
      return;
    }

    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("id", uid).maybeSingle();
      const tenantId = prof?.tenant_id;
      if (!tenantId) return;

      const ts = Date.now();
      const uploadTrack = async (blob: Blob, suffix: string): Promise<string | null> => {
        if (!blob || blob.size < 500) return null;
        const filename = `${tenantId}/${this.callDbId}-${ts}${suffix}.webm`;
        const { error: upErr } = await supabase.storage
          .from("call-recordings")
          .upload(filename, blob, { contentType: blob.type || "audio/webm", upsert: true });
        if (upErr) { console.error("[wa-call] upload error:", suffix, upErr); return null; }
        const { data: signed } = await supabase.storage
          .from("call-recordings")
          .createSignedUrl(filename, 60 * 60 * 24 * 365);
        return signed?.signedUrl || filename;
      };

      const [mixUrl, agentUrl, leadUrl] = await Promise.all([
        uploadTrack(mixBlob, ""),
        uploadTrack(agentBlob, "-agent"),
        uploadTrack(leadBlob, "-lead"),
      ]);

      if (!mixUrl) return;

      await supabase.from("whatsapp_calls").update({
        recording_url: mixUrl,
        recording_url_agent: agentUrl,
        recording_url_lead: leadUrl,
      } as any).eq("id", this.callDbId);
      const { data: waCall } = await supabase
        .from("whatsapp_calls").select("wa_call_id").eq("id", this.callDbId).maybeSingle();
      if (waCall?.wa_call_id) {
        await supabase.from("messages")
          .update({ media_url: mixUrl })
          .eq("whatsapp_message_id", `call:${waCall.wa_call_id}`);
      }
      const dur = started ? Math.round((Date.now() - started) / 1000) : null;
      console.log(`[wa-call] recording uploaded (${dur}s):`, { agentUrl: !!agentUrl, leadUrl: !!leadUrl });
    } catch (e) {
      console.error("[wa-call] upload flow error:", e);
    }
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
      this.startRecordingIfReady();
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
      this.startRecordingIfReady();
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
    if ((data as any)?.ok === false) {
      this.cleanup();
      const err: any = new Error((data as any).user_message || (data as any).code || "call error");
      err.code = (data as any).code;
      throw err;
    }
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
    // Dispara upload da gravação em paralelo (não bloqueia UI)
    if (this.recorder && !this.recordingPromise) {
      this.recordingPromise = this.stopAndUploadRecording().catch((e) =>
        console.error("[wa-call] recording upload failed:", e),
      );
    }
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

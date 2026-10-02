import { Lock, PauseCircle, WifiOff } from "lucide-react";
import type { BloqueioDoEnvio } from "@/hooks/useEnvioDoLead";

/**
 * Selo e aviso de "não dá para enviar por este WhatsApp agora" — S29P-3c
 * (WABA pausada pelo suporte), CRC-11 (cliente sem número conectado) e
 * número de envio fora do acesso de quem está no chat. Usado
 * pelo compositor e pelos cartões do chat, sempre com o bloqueio calculado por
 * useEnvioDoLead.
 */

export function SeloDoEnvio({ bloqueio }: { bloqueio: BloqueioDoEnvio }) {
  const pausado = bloqueio.tipo === "pausado";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        pausado ? "bg-warning-soft text-warning-soft-foreground" : "bg-destructive-soft text-destructive-soft-foreground"
      }`}
      title={bloqueio.texto}
    >
      {pausado ? <PauseCircle size={11} /> : bloqueio.tipo === "sem_acesso" ? <Lock size={11} /> : <WifiOff size={11} />}
      {bloqueio.selo}
    </span>
  );
}

export default function AvisoDeEnvio({ bloqueio, className = "" }: { bloqueio: BloqueioDoEnvio; className?: string }) {
  const pausado = bloqueio.tipo === "pausado";
  return (
    <div
      role="status"
       className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs ${
         pausado ? "border-warning/30 bg-warning-soft text-warning-soft-foreground" : "border-destructive/20 bg-destructive-soft text-destructive-soft-foreground"
      } ${className}`}
    >
      <SeloDoEnvio bloqueio={bloqueio} />
      <span className="flex-1">{bloqueio.texto}.</span>
    </div>
  );
}

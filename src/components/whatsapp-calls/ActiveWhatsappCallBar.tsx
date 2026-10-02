import { Mic, MicOff, PhoneOff, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WhatsappCallRow } from "@/contexts/WhatsappCallContext";
import { useEffect, useState } from "react";

interface Props {
  call: WhatsappCallRow;
  startedAt: number | null;
  onHangup: () => void;
  muted: boolean;
  onToggleMute: () => void;
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatPhone(p: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  if (d.length >= 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

export const ActiveWhatsappCallBar: React.FC<Props> = ({ call, startedAt, onHangup, muted, onToggleMute }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const durationSecs = startedAt ? Math.floor((now - startedAt) / 1000) : 0;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] flex h-14 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border border-border/60 bg-card pl-2 pr-2 shadow-2xl ring-1 ring-border/40 animate-in slide-in-from-top">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-soft">
        <Phone className="h-[18px] w-[18px] text-success" />
      </div>
      <div className="flex min-w-0 flex-col pr-1 leading-tight">
        <span className="truncate text-sm font-semibold tabular-nums text-foreground">
          {formatPhone(call.direction === "inbound" ? call.from_phone : call.to_phone)}
        </span>
        <span className="mt-0.5 text-xs font-medium tabular-nums text-success-soft-foreground">
          {startedAt ? fmtDuration(durationSecs) : "Conectando..."}
        </span>
      </div>
      <Button
        size="sm"
        variant={muted ? "default" : "outline"}
        onClick={onToggleMute}
        className="h-10 w-10 shrink-0 rounded-full p-0"
      >
        {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={onHangup}
        className="h-10 w-10 shrink-0 rounded-full bg-destructive p-0 text-destructive-foreground hover:bg-destructive/90"
      >
        <PhoneOff className="h-4 w-4" />
      </Button>
    </div>
  );
};

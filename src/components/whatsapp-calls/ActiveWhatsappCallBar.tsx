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
    <div className="fixed left-1/2 top-4 z-[9998] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-2 shadow-float animate-in slide-in-from-top">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-success-soft">
        <Phone className="h-4 w-4 text-success-soft-foreground" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium">
          {formatPhone(call.direction === "inbound" ? call.from_phone : call.to_phone)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {startedAt ? fmtDuration(durationSecs) : "Conectando..."}
        </span>
      </div>
      <Button
        size="sm"
        variant={muted ? "default" : "outline"}
        onClick={onToggleMute}
        className="h-9 w-9 rounded-full p-0"
      >
        {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={onHangup}
        className="h-9 w-9 rounded-full p-0"
      >
        <PhoneOff className="h-4 w-4" />
      </Button>
    </div>
  );
};

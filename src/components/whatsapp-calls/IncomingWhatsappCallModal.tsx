import { Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { WhatsappCallRow } from "@/contexts/WhatsappCallContext";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  call: WhatsappCallRow;
  onAccept: () => void;
  onReject: () => void;
  onInteract?: () => void;
}

function formatPhone(p: string | null): string {
  if (!p) return "Desconhecido";
  const d = p.replace(/\D/g, "");
  // 55 + DDD + número
  if (d.length >= 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

export const IncomingWhatsappCallModal: React.FC<Props> = ({ call, onAccept, onReject, onInteract }) => {
  const [leadName, setLeadName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (call.lead_id) {
      supabase
        .from("crm_leads")
        .select("nome")
        .eq("id", call.lead_id)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setLeadName((data as any)?.nome ?? null);
        });
    }
    return () => { cancelled = true; };
  }, [call.lead_id]);

  const displayName = leadName || formatPhone(call.from_phone);
  const initials = (leadName || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in"
      onMouseDown={onInteract}
      onKeyDown={onInteract}
    >
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6 flex flex-col items-center gap-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground animate-pulse">
          Chamada WhatsApp recebida
        </div>
        <Avatar className="h-24 w-24 ring-4 ring-primary/30 animate-pulse">
          <AvatarFallback className="text-2xl bg-primary/10">{initials}</AvatarFallback>
        </Avatar>
        <div className="text-center">
          <div className="text-xl font-semibold">{displayName}</div>
          {leadName && (
            <div className="text-sm text-muted-foreground">{formatPhone(call.from_phone)}</div>
          )}
        </div>
        <div className="flex items-center gap-6 mt-3">
          <Button
            size="lg"
            variant="destructive"
            onClick={onReject}
            className="h-14 w-14 rounded-full p-0"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
          <Button
            size="lg"
            onClick={onAccept}
            className="h-14 w-14 rounded-full p-0 bg-green-600 hover:bg-green-700"
          >
            <Phone className="h-6 w-6" />
          </Button>
        </div>
        <div className="flex gap-8 text-[10px] text-muted-foreground uppercase tracking-wide">
          <span>Recusar</span>
          <span>Atender</span>
        </div>
      </div>
    </div>
  );
};

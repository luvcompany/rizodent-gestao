import { Phone, PhoneOff, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WhatsappCallRow } from "@/contexts/WhatsappCallContext";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  call: WhatsappCallRow;
  onAccept: () => void;
  onReject: () => void;
  onExpand: () => void;
}

function formatPhone(p: string | null): string {
  if (!p) return "Desconhecido";
  const d = p.replace(/\D/g, "");
  if (d.length >= 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

/**
 * Chamada entrante recolhida no canto inferior direito: silenciada (o ringtone
 * só toca no modal cheio) e NÃO-bloqueante — flutua sobre o CRM sem impedir o uso.
 * Mostra só nome/número + atender/recusar, e expande de volta ao clicar no nome.
 */
export const MinimizedIncomingCall: React.FC<Props> = ({ call, onAccept, onReject, onExpand }) => {
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

  return (
    // Acima da faixa de toasts (Sonner fica no canto inferior direito) para não
    // cobrir os botões atender/recusar.
    <div className="fixed bottom-24 right-4 z-[9999] w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-card border border-border shadow-xl p-3 flex items-center gap-3 animate-in slide-in-from-bottom-2">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expandir chamada"
        className="flex-1 min-w-0 text-left"
        title="Expandir chamada"
      >
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Chamada recebida
          <ChevronUp className="h-3 w-3 opacity-70" />
        </div>
        <div className="truncate text-sm font-semibold">{displayName}</div>
        {leadName && (
          <div className="truncate text-xs text-muted-foreground">{formatPhone(call.from_phone)}</div>
        )}
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="icon"
          variant="destructive"
          onClick={onReject}
          aria-label="Recusar chamada"
          title="Recusar"
          className="h-9 w-9 rounded-full p-0"
        >
          <PhoneOff className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          onClick={onAccept}
          aria-label="Atender chamada"
          title="Atender"
          className="h-9 w-9 rounded-full p-0 bg-green-600 hover:bg-green-700"
        >
          <Phone className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

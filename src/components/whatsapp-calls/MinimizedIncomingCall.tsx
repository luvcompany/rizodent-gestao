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
      // crm_leads tem "name" ("nome" é de profiles): com "nome" vinha 42703 e o
      // card mostrava o telefone no lugar do nome do lead.
      supabase
        .from("crm_leads")
        .select("name")
        .eq("id", call.lead_id)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setLeadName(data?.name ?? null);
        });
    }
    return () => { cancelled = true; };
  }, [call.lead_id]);

  const displayName = leadName || formatPhone(call.from_phone);

  return (
    // Acima da faixa de toasts (Sonner fica no canto inferior direito) para não
    // cobrir os botões atender/recusar.
    <div className="fixed bottom-24 right-4 z-[9999] flex w-80 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 pl-4 shadow-2xl ring-1 ring-border/40 animate-in slide-in-from-bottom-2">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expandir chamada"
        className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Expandir chamada"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-success-soft-foreground">
          <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" />
          Chamada recebida
          <ChevronUp className="h-3.5 w-3.5 text-tertiary" />
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{displayName}</div>
        {leadName && (
          <div className="truncate text-xs tabular-nums text-muted-foreground">{formatPhone(call.from_phone)}</div>
        )}
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="icon"
          variant="destructive"
          onClick={onReject}
          aria-label="Recusar chamada"
          title="Recusar"
          className="h-10 w-10 rounded-full bg-destructive p-0 text-destructive-foreground hover:bg-destructive/90"
        >
          <PhoneOff className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          onClick={onAccept}
          aria-label="Atender chamada"
          title="Atender"
          className="h-10 w-10 rounded-full bg-success p-0 text-success-foreground hover:bg-success/90"
        >
          <Phone className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

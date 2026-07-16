import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import api4comLogo from "@/assets/api4com-logo.png";

// Consulta uma única vez por sessão se a telefonia está pronta (conectada + ramal).
let enabledPromise: Promise<boolean> | null = null;
function checkDialEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    enabledPromise = supabase.rpc("api4com_dial_enabled")
      .then(({ data }) => !!data)
      .catch(() => false);
  }
  return enabledPromise;
}

// Botão de ligar por telefone (Api4Com). Origina a chamada via /dialer: a extensão/
// webphone toca como "aparelho", disca o lead, e a ligação (com gravação/transcrição)
// aparece na conversa e na aba Ligações. Separado do botão de ligar do WhatsApp.
export default function Api4ComDialButton({ leadId, phone }: { leadId: string; phone: string }) {
  const [dialing, setDialing] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => { let ok = true; checkDialEnabled().then((v) => { if (ok) setEnabled(v); }); return () => { ok = false; }; }, []);
  if (!enabled) return null;

  const dial = async () => {
    setDialing(true);
    try {
      const { data, error } = await supabase.functions.invoke("api4com-dial", {
        body: { lead_id: leadId, phone },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Ligando… atenda no webphone da Api4Com que ela disca o lead.");
    } catch (e: any) {
      toast.error(e.message || "Falha ao iniciar a ligação");
    } finally {
      setDialing(false);
    }
  };

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-muted"
          disabled={dialing}
          onClick={dial}
          aria-label="Ligar por telefone (Api4Com)"
        >
          {dialing
            ? <Loader2 size={16} className="animate-spin text-muted-foreground" />
            : <img src={api4comLogo} alt="Api4Com" width={18} height={18} className="rounded-[3px]" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px]">
        <span className="flex items-center gap-1.5 font-medium">
          <img src={api4comLogo} alt="" width={14} height={14} className="rounded-[2px]" /> Ligar por telefone (Api4Com)
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">Toca no webphone da extensão e disca o lead</span>
      </TooltipContent>
    </Tooltip>
  );
}

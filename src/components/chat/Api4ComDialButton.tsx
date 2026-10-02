import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import api4comLogo from "@/assets/api4com-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { motivoDoServidor } from "@/lib/erroDeFuncao";

// Consulta se a telefonia está pronta para ESTE usuário: api4com_dial_enabled()
// olha a telefonia do cliente E o ramal (o da clínica ou o do próprio usuário,
// INTEG-10). Por isso o cache é por usuário, não um só para o módulo: antes, quem
// entrasse depois (troca de conta na mesma aba) herdava o resultado do anterior —
// o botão sumia para quem tem ramal próprio ou aparecia para quem não tem.
// Cacheia só o RESULTADO definitivo (true/false), por 5 min (o ramal cadastrado
// agora em Integrações aparece sem recarregar); em ERRO (ex.: cache do PostgREST
// no 1º load) NÃO fixa — tenta de novo no próximo lead aberto (evita o botão
// sumir a sessão inteira por causa de uma falha momentânea).
const VALIDADE_MS = 5 * 60_000;
const cachePorUsuario = new Map<string, { promessa: Promise<boolean>; ate: number }>();

function checkDialEnabled(userId: string): Promise<boolean> {
  const emCache = cachePorUsuario.get(userId);
  if (emCache && emCache.ate > Date.now()) return emCache.promessa;
  const esquecer = () => {
    if (cachePorUsuario.get(userId)?.promessa === promessa) cachePorUsuario.delete(userId);
  };
  // Promise.resolve().then: um throw síncrono do cliente também cai no catch.
  const promessa: Promise<boolean> = Promise.resolve()
    .then(() => supabase.rpc("api4com_dial_enabled"))
    .then(({ data, error }) => {
      if (error) { esquecer(); return false; }
      return !!data;
    })
    .catch(() => { esquecer(); return false; });
  cachePorUsuario.set(userId, { promessa, ate: Date.now() + VALIDADE_MS });
  return promessa;
}

const FALHA_AO_LIGAR = "Não foi possível iniciar a ligação. Tente de novo.";
const TEXTO_TECNICO = /non-2xx|edge function|failed to send a request|failed to fetch/i;

// Botão de ligar por telefone (Api4Com). Origina a chamada via /dialer: a extensão/
// webphone toca como "aparelho", disca o lead, e a ligação (com gravação/transcrição)
// aparece na conversa e na aba Ligações. Separado do botão de ligar do WhatsApp.
export default function Api4ComDialButton({ leadId, phone }: { leadId: string; phone: string }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [dialing, setDialing] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let ok = true;
    setEnabled(false);
    if (!userId) return () => { ok = false; };
    checkDialEnabled(userId).then((v) => { if (ok) setEnabled(v); });
    return () => { ok = false; };
  }, [userId]);
  if (!enabled) return null;

  const dial = async () => {
    setDialing(true);
    try {
      const { data, error } = await supabase.functions.invoke("api4com-dial", {
        body: { lead_id: leadId, phone },
      });
      // Erros de negócio vêm no corpo (não-2xx) — motivoDoServidor lê a mensagem
      // real; sem corpo legível, frase em PT-BR (nunca o "non-2xx" do supabase-js).
      if (error || (data as { error?: unknown } | null)?.error) {
        const motivo = await motivoDoServidor(data, error, FALHA_AO_LIGAR);
        throw new Error(TEXTO_TECNICO.test(motivo) ? FALHA_AO_LIGAR : motivo);
      }
      toast.success("Ligando… atenda no webphone da Api4Com que ela disca o lead.");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : FALHA_AO_LIGAR);
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
          className="h-8 w-8 rounded-lg hover:bg-surface-sunken"
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

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { conversaRpcDisponivel, fecharConversa, reabrirConversa } from "@/lib/fecharConversa";
import { CheckCircle2, Loader2, Star, Unlock } from "lucide-react";

/**
 * "Fechar conversa" / "Reabrir conversa" (Fase 2 do rodízio).
 *
 * O banco decide (RPC conversa_fechar / conversa_reabrir, SECURITY DEFINER):
 * só a dona do lead (assigned_to) ou a gestão (crc/gerente/superadmin). Fechar
 * grava crm_leads.conversa_fechada_em/por e uma mensagem de sistema no chat;
 * qualquer mensagem nova do lead reabre sozinha (gatilho em messages) — a tela
 * não precisa fazer nada além de refletir a coluna.
 *
 * Pesquisa de satisfação: quando a clínica a tem ligada, a RPC devolve o
 * texto pronto e o ENVIO sai daqui pelo caminho que já existe
 * (send-whatsapp-message, type "text") — nenhum fluxo novo de envio. Se o
 * envio falhar, pesquisa_envio_falhou apaga a linha para não contar como
 * enviada, e a conversa continua fechada.
 *
 * Duas apresentações: ícone no cabeçalho da conversa (com diálogo e a caixa
 * "enviar a pesquisa") e itens do menu de contexto da lista (confirm nativo,
 * como o "Bloquear lead" ao lado — um AlertDialog dentro de DropdownMenuItem
 * some junto com o menu). No menu são DOIS itens — "Fechar conversa" e "Fechar
 * e enviar pesquisa" — para as duas entradas oferecerem a mesma escolha.
 *
 * O texto não promete a regra de realocação: para crc/gerente/superadmin
 * fechando a conversa de um lead de uma SDR o lead continua com a SDR, e a
 * realocação só existe com o motor ligado.
 *
 * Janela entre o site publicado e a migration da Fase 2 aplicada: as RPCs
 * ainda não existem (PGRST202) e o botão/itens somem (useConversaRpcDisponivel,
 * uma sonda por sessão) em vez de abrir um diálogo que vai falhar.
 */

const PAPEIS_QUE_FECHAM = new Set(["sdr", "crc", "gerente", "superadmin"]);

const TEXTO_FECHAR =
  "O atendimento é dado como concluído e o lead continua com a responsável atual; se ele mandar qualquer mensagem nova, a conversa reabre sozinha.";

type Props = {
  leadId: string;
  fechadaEm: string | null | undefined;
  onChange: (fechadaEm: string | null) => void;
};

/** true enquanto não se sabe (otimista); false só quando o banco disse que a RPC não existe. */
function useConversaRpcDisponivel(): boolean {
  const [disponivel, setDisponivel] = useState(true);
  useEffect(() => {
    let vivo = true;
    void conversaRpcDisponivel().then((ok) => {
      if (vivo) setDisponivel(ok);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return disponivel;
}

/** Selo "Conversa fechada" para o cabeçalho (ao lado da etapa). */
export function ConversaFechadaBadge({ fechadaEm }: { fechadaEm: string | null | undefined }) {
  if (!fechadaEm) return null;
  const quando = new Date(fechadaEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
      title={`Fechada em ${quando}. Uma mensagem nova do lead reabre sozinha.`}
    >
      <CheckCircle2 size={11} /> Fechada
    </span>
  );
}

/** Ícone no cabeçalho da conversa (fechar com diálogo; reabrir direto). */
export default function FecharConversaButton({ leadId, fechadaEm, onChange }: Props) {
  const { userRole } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const [enviarPesquisa, setEnviarPesquisa] = useState(true);
  const disponivel = useConversaRpcDisponivel();
  if (!userRole || !PAPEIS_QUE_FECHAM.has(userRole)) return null;
  if (!disponivel) return null;

  if (fechadaEm) {
    return (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Reabrir conversa" disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              const ok = await reabrirConversa(leadId);
              setOcupado(false);
              if (ok) onChange(null);
            }}
          >
            {ocupado ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span className="inline-flex items-center gap-1.5"><Unlock size={14} /> Reabrir conversa</span>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <AlertDialog>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
              aria-label="Fechar conversa" disabled={ocupado}
            >
              {ocupado ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-600" /> Fechar conversa</span>
        </TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fechar esta conversa?</AlertDialogTitle>
          <AlertDialogDescription>{TEXTO_FECHAR}</AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <Checkbox checked={enviarPesquisa} onCheckedChange={(v) => setEnviarPesquisa(v === true)} className="mt-0.5" />
          <span>
            Enviar a pesquisa de satisfação
            <span className="block text-xs text-muted-foreground">
              Só sai se a clínica tiver a pesquisa ligada e o lead tiver WhatsApp.
            </span>
          </span>
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              setOcupado(true);
              const quando = await fecharConversa(leadId, enviarPesquisa);
              setOcupado(false);
              if (quando) onChange(quando);
            }}
          >
            Fechar conversa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Itens do menu de contexto da lista de conversas (confirm nativo, como
 * "Bloquear lead"): "Fechar conversa" e "Fechar e enviar pesquisa" — a mesma
 * escolha que o diálogo do cabeçalho dá pela caixa de seleção.
 */
export function FecharConversaMenuItem({ leadId, fechadaEm, onChange }: Props) {
  const { userRole } = useAuth();
  const disponivel = useConversaRpcDisponivel();
  if (!userRole || !PAPEIS_QUE_FECHAM.has(userRole)) return null;
  if (!disponivel) return null;
  if (fechadaEm) {
    return (
      <DropdownMenuItem onClick={async (e) => {
        e.stopPropagation();
        if (await reabrirConversa(leadId)) onChange(null);
      }}>
        <Unlock size={14} className="mr-2" /> Reabrir conversa
      </DropdownMenuItem>
    );
  }
  const fechar = async (enviarPesquisa: boolean) => {
    const quando = await fecharConversa(leadId, enviarPesquisa);
    if (quando) onChange(quando);
  };
  return (
    <>
      <DropdownMenuItem onClick={async (e) => {
        e.stopPropagation();
        if (!window.confirm(`Fechar esta conversa?\n\n${TEXTO_FECHAR}`)) return;
        await fechar(false);
      }}>
        <CheckCircle2 size={14} className="mr-2 text-emerald-600" /> Fechar conversa
      </DropdownMenuItem>
      <DropdownMenuItem onClick={async (e) => {
        e.stopPropagation();
        if (!window.confirm(
          `Fechar esta conversa e enviar a pesquisa de satisfação?\n\n${TEXTO_FECHAR}\n\nA pesquisa só sai se a clínica a tiver ligada e o lead tiver WhatsApp.`,
        )) return;
        await fechar(true);
      }}>
        <Star size={14} className="mr-2 text-emerald-600" /> Fechar e enviar pesquisa
      </DropdownMenuItem>
    </>
  );
}

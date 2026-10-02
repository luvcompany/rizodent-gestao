import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cleanTemplateName } from "@/lib/templateUtils";
import { diaNoFuso } from "@/lib/fuso";
import {
  componentesDoCorpo,
  preencherCorpo,
  rotuloDaVariavel,
  valoresPadraoDoModelo,
  variaveisDoCorpo,
  variaveisInvalidas,
  type ConsultaDoModelo,
  type LeadDoModelo,
} from "@/lib/modeloDoChat";
import { useEnvioDoLead } from "@/hooks/useEnvioDoLead";
import AvisoDeEnvio from "./AvisoDeEnvio";

/**
 * Confirmação do envio de um modelo (template) pelo chat — CONV-15 (e CONV-1:
 * é o que o "/" abre ao escolher um modelo).
 *
 * Mostra a prévia JÁ PREENCHIDA (os mesmos valores que o servidor usaria: nome,
 * data da próxima consulta, serviço, telefone, origem, pela posição da
 * variável) e um campo por {{n}}, pré-preenchido. O que está nos campos vai
 * em template_components — o paciente recebe exatamente a prévia.
 *
 * Quem chama decide COMO enviar (onEnviar): o hook useChatConversation
 * (sendTemplate) ou o compositor. Adoção no Sheet de modelos de
 * CrmConversas/CrmConversa: P16.
 */

export type ModeloParaEnviar = {
  id?: string;
  name: string;
  language?: string | null;
  body_text?: string | null;
  header_type?: string | null;
  header_content?: string | null;
  footer_text?: string | null;
};

export type ComponentesDoModelo = ReturnType<typeof componentesDoCorpo>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  modelo: ModeloParaEnviar | null;
  onEnviar: (modelo: ModeloParaEnviar, componentes: ComponentesDoModelo) => Promise<unknown> | unknown;
};

/** Próxima consulta (hoje em diante); sem nenhuma futura, a mais recente — a regra do servidor. */
function escolherConsulta(lista: ConsultaDoModelo[], hoje: string): ConsultaDoModelo | null {
  return lista.find((a) => a.scheduled_date >= hoje) || lista[lista.length - 1] || null;
}

export default function EnviarModeloDialog({ open, onOpenChange, leadId, modelo, onEnviar }: Props) {
  const { bloqueio } = useEnvioDoLead(leadId, { ativo: open });
  const [lead, setLead] = useState<LeadDoModelo | null>(null);
  const [consulta, setConsulta] = useState<ConsultaDoModelo | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [valores, setValores] = useState<Record<number, string>>({});
  const [enviando, setEnviando] = useState(false);
  const editadosRef = useRef<Set<number>>(new Set());

  const corpo = modelo?.body_text ?? "";
  const hoje = useMemo(() => diaNoFuso(Date.now()), []);
  const variaveis = useMemo(() => variaveisDoCorpo(corpo), [corpo]);

  // Dados do lead e da próxima consulta (mesmas colunas que o servidor lê).
  useEffect(() => {
    if (!open || !leadId) return;
    let vivo = true;
    setCarregado(false);
    editadosRef.current = new Set();
    (async () => {
      const [{ data: l }, { data: consultas }] = await Promise.all([
        supabase.from("crm_leads").select("name, phone, source, servico_interesse").eq("id", leadId).maybeSingle(),
        supabase
          .from("crm_appointments")
          .select("scheduled_date, scheduled_time")
          .eq("lead_id", leadId)
          .in("status", ["confirmed", "pending"])
          .order("scheduled_date", { ascending: true })
          .order("scheduled_time", { ascending: true })
          .limit(20),
      ]);
      if (!vivo) return;
      setLead((l as LeadDoModelo | null) ?? null);
      setConsulta(escolherConsulta((consultas as ConsultaDoModelo[] | null) ?? [], hoje));
      setCarregado(true);
    })();
    return () => { vivo = false; };
  }, [open, leadId, hoje, modelo?.name]);

  // Valores padrão; o que a pessoa já editou não é sobrescrito.
  useEffect(() => {
    if (!open) return;
    const padrao = valoresPadraoDoModelo(corpo, lead, consulta, hoje);
    setValores((antes) => {
      const novo: Record<number, string> = {};
      for (const n of variaveis) novo[n] = editadosRef.current.has(n) ? antes[n] ?? "" : padrao[n] ?? "";
      return novo;
    });
  }, [open, corpo, lead, consulta, hoje, variaveis]);

  const previa = useMemo(() => preencherCorpo(corpo, valores), [corpo, valores]);
  const cabecalhoTexto =
    String(modelo?.header_type || "").toUpperCase() === "TEXT" ? (modelo?.header_content || "").trim() : "";
  const cabecalhoMidia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(String(modelo?.header_type || "").toUpperCase());

  const enviar = async () => {
    if (!modelo) return;
    if (bloqueio) {
      toast.error(bloqueio.texto);
      return;
    }
    const invalidas = variaveisInvalidas(corpo, valores);
    if (invalidas.length > 0) {
      toast.error(
        `Preencha ${invalidas.map((n) => `{{${n}}} (${rotuloDaVariavel(corpo, n).toLowerCase()})`).join(", ")} antes de enviar.`,
      );
      return;
    }
    setEnviando(true);
    try {
      await onEnviar(modelo, componentesDoCorpo(corpo, valores));
      onOpenChange(false);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!enviando) onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl border-border/60 p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle>Enviar modelo</DialogTitle>
          <DialogDescription className="font-mono text-xs">{modelo ? cleanTemplateName(modelo.name) : ""}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5">
        {bloqueio && <AvisoDeEnvio bloqueio={bloqueio} />}

        <div className="min-w-0 overflow-hidden rounded-2xl rounded-tl-md border border-border/60 bg-surface-sunken p-3.5 text-sm shadow-xs">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prévia do que o paciente recebe</p>
          {cabecalhoMidia && <p className="mb-1 text-xs italic text-muted-foreground">[mídia do cabeçalho do modelo]</p>}
          {cabecalhoTexto && <p className="mb-1 font-semibold text-foreground">{cabecalhoTexto}</p>}
           <p className="break-words whitespace-pre-wrap text-foreground">{carregado ? previa || "(modelo sem texto)" : "Carregando os dados do lead…"}</p>
          {modelo?.footer_text && <p className="mt-1 text-xs text-muted-foreground">{modelo.footer_text}</p>}
        </div>

        {variaveis.length > 0 && (
          <div className="space-y-2">
            {variaveis.map((n) => (
              <div key={n} className="space-y-1">
                <Label htmlFor={`modelo-var-${n}`} className="text-xs">
                  {`{{${n}}}`} · {rotuloDaVariavel(corpo, n)}
                </Label>
                <Input
                  id={`modelo-var-${n}`}
                  value={valores[n] ?? ""}
                  disabled={!carregado || enviando}
                  onChange={(e) => {
                    editadosRef.current.add(n);
                    const v = e.target.value;
                    setValores((antes) => ({ ...antes, [n]: v }));
                  }}
                   className="h-10 rounded-xl text-sm"
                />
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">Os valores vão exatamente como estão nos campos.</p>
          </div>
        )}</div>

        <DialogFooter className="border-t border-border/60 px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={!modelo || !carregado || enviando || !!bloqueio} className="gap-1.5">
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

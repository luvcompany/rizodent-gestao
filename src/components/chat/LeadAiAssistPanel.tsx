import { useEffect, useState } from "react";
import { Sparkles, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { traduzirMotivo } from "@/lib/erroDoEnvio";
import { abreTelaDeIa, motivoDoPuloSemTelaDeIa, PULOS_DA_TELA_DE_IA } from "@/lib/telaDeIa";
import { useAuth } from "@/contexts/AuthContext";
import { useModule } from "@/hooks/useModule";

/**
 * Pulos do ai-conversation-assist (códigos fixos combinados com o P11). O
 * servidor manda `mensagem` em PT-BR; estas frases são a reserva — CONV-4.
 */
const MOTIVO_DO_PULO: Record<string, string> = {
  no_config: "A IA ainda não foi configurada para esta clínica (I.A → Assistente).",
  feature_off: "Esta função da IA está desligada em I.A → Funções.",
};

/** Recusa do servidor em PT-BR (CONV-3); módulo desligado com a frase da clínica. */
async function motivoDaIa(data: unknown, error: unknown): Promise<string> {
  const texto = await motivoDoServidor(data, error, "Não foi possível consultar a IA");
  if (/m[óo]dulo desligado/i.test(texto)) return "O módulo de IA não está contratado para a sua clínica.";
  return traduzirMotivo(texto, "Não foi possível consultar a IA");
}

type Mode = "summary_and_suggestions" | "summary" | "suggestions" | "ask";

interface Props {
  leadId: string;
  leadName?: string;
  trigger?: React.ReactNode;
}

export default function LeadAiAssistPanel({ leadId, leadName, trigger }: Props) {
  // CRC-12/CONV-4: com o módulo de IA desligado o botão nem aparece (o
  // servidor recusaria com 403); enquanto a config carrega, também não.
  const { ligado: iaLigada } = useModule("ia");
  const { userRole } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Mode>("summary_and_suggestions");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState(false);

  const loadCached = async (mode: Mode, q: string) => {
    if (mode === "ask" && !q.trim()) {
      setResult("");
      setCachedAt(null);
      return;
    }
    const { data } = await supabase
      .from("ai_conversation_analysis")
      .select("result, updated_at")
      .eq("lead_id", leadId)
      .eq("mode", mode)
      .eq("question", mode === "ask" ? q : "")
      .maybeSingle();
    if (data?.result) {
      setResult(data.result);
      setCachedAt(data.updated_at);
    } else {
      setResult("");
      setCachedAt(null);
    }
  };

  useEffect(() => {
    if (open) loadCached(tab, question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, leadId]);

  const run = async (mode: Mode, force = false) => {
    setLoading(true);
    setResult("");
    setCachedAt(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-conversation-assist", {
        body: { lead_id: leadId, mode, question: mode === "ask" ? question : undefined, force },
      });
      if (error || (data as any)?.error) {
        toast.error(await motivoDaIa(data, error));
        return;
      }
      const pulo = (data as any)?.skipped as string | undefined;
      if (pulo) {
        // Antes o painel voltava ao texto inicial sem dizer nada. Quem não
        // abre a tela de I.A recebe a frase sem o caminho dela.
        toast.info(
          PULOS_DA_TELA_DE_IA.has(pulo) && !abreTelaDeIa(userRole)
            ? motivoDoPuloSemTelaDeIa(pulo)
            : String((data as any)?.mensagem || MOTIVO_DO_PULO[pulo] || "A IA não analisou esta conversa."),
        );
        return;
      }
      setResult((data as any)?.result || "");
      setCachedAt((data as any)?.cached_at || new Date().toISOString());
    } catch {
      toast.error("Não foi possível consultar a IA. Confira a conexão e tente de novo.");
    } finally {
      setLoading(false);
    }
  };

  const onTabChange = (v: string) => {
    setTab(v as Mode);
    setResult("");
    setCachedAt(null);
  };

  if (iaLigada !== true) return null;

  const copyAll = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Sparkles size={14} className="text-primary" />
            IA
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden rounded-2xl border-border/60 p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            Assistente IA {leadName ? `— ${leadName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-4">
          <TabsList className="grid h-auto grid-cols-2 gap-1 rounded-2xl border border-border/60 bg-surface-sunken p-1 sm:grid-cols-4">
            <TabsTrigger value="summary_and_suggestions">Resumo + Sugestões</TabsTrigger>
            <TabsTrigger value="summary">Só Resumo</TabsTrigger>
            <TabsTrigger value="suggestions">Sugestões</TabsTrigger>
            <TabsTrigger value="ask">Perguntar</TabsTrigger>
          </TabsList>

          <TabsContent value="ask" className="space-y-2">
            <Textarea
              placeholder="Ex: Esse paciente parece pronto para fechar? Como abordar?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-[80px] rounded-xl border-border/60 bg-card"
            />
          </TabsContent>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Button
              onClick={() => run(tab, !!result)}
              disabled={loading || (tab === "ask" && !question.trim())}
              className="gradient-brand text-primary-foreground"
              size="sm"
            >
              {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : <Sparkles size={14} className="mr-2" />}
              {result ? "Gerar novamente" : "Analisar conversa"}
            </Button>
            {result && (
              <Button onClick={copyAll} variant="outline" size="sm">
                {copied ? <Check size={14} className="mr-2" /> : <Copy size={14} className="mr-2" />}
                {copied ? "Copiado!" : "Copiar tudo"}
              </Button>
            )}
            {result && (
              <Button onClick={() => run(tab, true)} variant="ghost" size="icon" title="Forçar nova análise">
                <RefreshCw size={14} />
              </Button>
            )}
            {cachedAt && result && !loading && (
              <span className="text-xs text-muted-foreground ml-auto">
                Análise salva — {new Date(cachedAt).toLocaleString("pt-BR")}
              </span>
            )}
          </div>

          <ScrollArea className="mt-3 min-h-[200px] flex-1 rounded-xl border border-border/60 bg-surface-sunken p-4">
            {loading && !result ? (
              <div className="flex items-center justify-center h-full text-muted-foreground gap-2 py-8">
                <Loader2 size={16} className="animate-spin" /> Analisando conversa...
              </div>
            ) : result ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Clique em "Analisar conversa" para que a IA leia todo o histórico e gere o resumo + sugestões de atendimento.
              </p>
            )}
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

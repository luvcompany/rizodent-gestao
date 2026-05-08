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

type Mode = "summary_and_suggestions" | "summary" | "suggestions" | "ask";

interface Props {
  leadId: string;
  leadName?: string;
  trigger?: React.ReactNode;
}

export default function LeadAiAssistPanel({ leadId, leadName, trigger }: Props) {
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
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult((data as any)?.result || "");
      setCachedAt((data as any)?.cached_at || new Date().toISOString());
    } catch (e: any) {
      toast.error(e.message || "Erro ao consultar a IA");
    } finally {
      setLoading(false);
    }
  };

  const onTabChange = (v: string) => {
    setTab(v as Mode);
    setResult("");
    setCachedAt(null);
  };

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
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            Assistente IA {leadName ? `— ${leadName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={onTabChange} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-4">
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
              className="min-h-[80px]"
            />
          </TabsContent>

          <div className="flex items-center gap-2 mt-2">
            <Button
              onClick={() => run(tab)}
              disabled={loading || (tab === "ask" && !question.trim())}
              className="gradient-orange text-primary-foreground"
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
              <Button onClick={() => run(tab)} variant="ghost" size="icon" title="Atualizar">
                <RefreshCw size={14} />
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1 mt-3 rounded-md border border-border bg-secondary/30 p-4 min-h-[200px]">
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useGestorEquipe } from "@/hooks/useGestorEquipe";
import { mensagemDeErroRpc } from "@/lib/relatorioSdr";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Info, Loader2, MessageSquareHeart, RefreshCw, Save } from "lucide-react";

/**
 * Pesquisa de satisfação — configuração pelo gestor da equipe (Fase 2 do rodízio).
 *
 * Quem entra: só quem is_gestor_equipe() devolve true (mesmo gate da aba
 * Equipe; o guard de rota não protege /crm/equipe/*, a página repete a
 * checagem e as RPCs recusam por dentro).
 *
 * O que configura (crm_pesquisa_config, uma linha por clínica):
 *   ativa  — se desligada, "Fechar conversa" não envia nada;
 *   texto  — a mensagem enviada ao lead; {{nome}} vira o primeiro nome e
 *            {{escala}} vira "de 1 a 5" (ou a escala escolhida);
 *   escala — 1-5, 0-10 ou 1-10: a resposta do lead só é registrada como nota
 *            quando é um número dentro dela.
 * O envio usa o mesmo caminho do chat (send-whatsapp-message); a resposta do
 * lead (só o número) vira nota em crm_pesquisa_respostas pelo gatilho do banco
 * e alimenta o relatório das SDRs.
 *
 * RPC ainda não publicada (PGRST202, janela entre o site e a migration da
 * Fase 2): o aviso diz isso em PT-BR (mensagemDeErroRpc, a mesma detecção do
 * relatório) em vez de vazar "could not find the function".
 */

type Config = {
  existe: boolean;
  ativa: boolean;
  texto: string;
  escala: string;
  atraso_min: number;
  updated_at: string | null;
  enviadas_30d: number;
  respondidas_30d: number;
  media_30d: number | null;
};

const ESCALAS = [
  { valor: "1-5", rotulo: "1 a 5" },
  { valor: "0-10", rotulo: "0 a 10 (NPS)" },
  { valor: "1-10", rotulo: "1 a 10" },
];

type RespostaRpc = { data: unknown; error: unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nome: string, args?: Record<string, unknown>): Promise<RespostaRpc> => (supabase as any).rpc(nome, args);

const TEXTO_RPC_AUSENTE = "A pesquisa de satisfação ainda não está instalada no banco (migration da Fase 2 pendente).";
const mensagemDe = (e: unknown, fallback: string): string => mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE);

const escalaTexto = (escala: string) => {
  const m = /^(\d+)-(\d+)$/.exec(escala);
  return m ? `de ${m[1]} a ${m[2]}` : "de 1 a 5";
};

export default function CrmPesquisaConfig() {
  const { isGestor, resolved, erro: erroGestor, tentarDeNovo } = useGestorEquipe();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [ativa, setAtiva] = useState(false);
  const [texto, setTexto] = useState("");
  const [escala, setEscala] = useState("1-5");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await rpc("pesquisa_config_ler");
    setCarregando(false);
    if (error) {
      setErro(mensagemDe(error, "Não foi possível carregar a configuração da pesquisa."));
      return;
    }
    const c = data as Config;
    setErro(null);
    setCfg(c);
    setAtiva(!!c.ativa);
    setTexto(c.texto ?? "");
    setEscala(c.escala || "1-5");
  }, []);

  useEffect(() => {
    if (resolved && isGestor) void carregar();
  }, [resolved, isGestor, carregar]);

  const salvar = async () => {
    if (ativa && !texto.trim()) {
      toast.error("Escreva a mensagem da pesquisa antes de ligá-la.");
      return;
    }
    setSalvando(true);
    const { data, error } = await rpc("pesquisa_config_salvar", { p_ativa: ativa, p_texto: texto, p_escala: escala });
    setSalvando(false);
    if (error) {
      toast.error(mensagemDe(error, "Não foi possível salvar."));
      return;
    }
    setCfg(data as Config);
    toast.success(ativa ? "Pesquisa salva e ligada." : "Pesquisa salva (desligada).");
  };

  const previa = useMemo(
    () => texto.replace(/\{\{nome\}\}/g, "Maria").replace(/\{\{escala\}\}/g, escalaTexto(escala)),
    [texto, escala],
  );
  const mudou = !!cfg && (ativa !== !!cfg.ativa || texto !== (cfg.texto ?? "") || escala !== (cfg.escala || "1-5"));

  if (!resolved) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        {erroGestor ? (
          <>
            <p className="text-sm">Não foi possível confirmar sua permissão para gerir a equipe.</p>
            <Button variant="outline" size="sm" onClick={tentarDeNovo}>
              <RefreshCw size={14} className="mr-1" /> Tentar de novo
            </Button>
          </>
        ) : (
          <span className="flex items-center"><Loader2 className="mr-2 animate-spin" size={16} /> Carregando...</span>
        )}
      </div>
    );
  }
  if (!isGestor) return <Navigate to="/crm" replace />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[820px] flex-col gap-5 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <Link to="/crm/equipe" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft size={12} /> Equipe
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <MessageSquareHeart size={22} className="text-primary" /> Pesquisa de satisfação
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Mensagem enviada ao lead quando a SDR fecha a conversa. A resposta vira nota no relatório.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando} title="Atualizar">
              <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
            </Button>
            <Button size="sm" onClick={salvar} disabled={salvando || !cfg || !mudou}>
              {salvando ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
              Salvar
            </Button>
          </div>
        </header>

        {erro ? (
          <section className="rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm">
            <p className="font-semibold text-foreground">Não foi possível carregar</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{erro}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void carregar()}>Tentar de novo</Button>
          </section>
        ) : !cfg ? (
          <section className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-16 text-muted-foreground shadow-sm">
            <Loader2 className="animate-spin" size={16} /> Carregando...
          </section>
        ) : (
          <>
            <section className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Enviadas · 30 dias</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">{cfg.enviadas_30d}</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Respondidas</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
                  {cfg.respondidas_30d}
                  {cfg.enviadas_30d > 0 && (
                    <span className="ml-1.5 text-sm font-medium text-muted-foreground">
                      ({Math.round((cfg.respondidas_30d / cfg.enviadas_30d) * 100)}%)
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Nota média</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
                  {cfg.media_30d == null ? "—" : Number(cfg.media_30d).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                </p>
              </div>
            </section>

            <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
                <div>
                  <Label htmlFor="pesquisa-ativa" className="text-sm font-semibold">Pesquisa ligada</Label>
                  <p className="text-xs text-muted-foreground">
                    Desligada, o botão "Fechar conversa" só fecha — não envia nada ao lead.
                  </p>
                </div>
                <Switch id="pesquisa-ativa" checked={ativa} onCheckedChange={setAtiva} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pesquisa-escala">Escala da nota</Label>
                <Select value={escala} onValueChange={setEscala}>
                  <SelectTrigger id="pesquisa-escala" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESCALAS.map((e) => (
                      <SelectItem key={e.valor} value={e.valor}>{e.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Só uma resposta que seja apenas um número dentro da escala é registrada como nota
                  (e não reabre a conversa). Qualquer outra mensagem reabre a conversa normalmente.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pesquisa-texto">Mensagem enviada ao lead</Label>
                <Textarea
                  id="pesquisa-texto"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={5}
                  maxLength={1000}
                  placeholder="Olá, {{nome}}! {{escala}}, como você avalia o nosso atendimento? Responda só com o número."
                />
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  <span>
                    <code className="rounded bg-muted px-1">{"{{nome}}"}</code> vira o primeiro nome do lead e{" "}
                    <code className="rounded bg-muted px-1">{"{{escala}}"}</code> vira "{escalaTexto(escala)}".
                    Peça a resposta só com o número — é assim que a nota é reconhecida. {texto.length}/1000
                  </span>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Prévia (como o lead recebe)</Label>
                <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100">
                  {previa.trim() || <span className="text-muted-foreground">Escreva a mensagem acima.</span>}
                </div>
              </div>
            </section>

            <p className="text-xs text-muted-foreground">
              A pesquisa sai pelo número principal da clínica, como qualquer mensagem do chat. Leads pelo Instagram
              ou sem telefone não a recebem. O envio é imediato ao fechar a conversa.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Power, RefreshCw, Shuffle } from "lucide-react";
import { mensagemDeErroRpc } from "@/lib/relatorioSdr";

/**
 * Painel do motor do rodízio, dentro da aba Equipe (só o gestor chega aqui).
 *
 * Três modos, lidos e gravados no banco (crm_rodizio_config.modo):
 *   desligado — nada se move (estado de nascimento);
 *   sombra    — o motor só anota no livro quem TERIA recebido cada lead;
 *   ligado    — distribui de verdade.
 * O interruptor é a RPC rodizio_definir_modo; o retrato é rodizio_estado.
 * A distribuição inicial dos leads sem resposta passa SEMPRE por um dry-run
 * que mostra a lista antes de mover alguém.
 */

type Modo = "desligado" | "sombra" | "ligado";

interface MembroEstado {
  user_id: string; nome: string; estado: string; aberta: boolean; carga: number; reservas: number;
}
interface Estado {
  modo: Modo; modo_alterado_em: string | null; em_expediente: boolean; dia_util: boolean;
  agora_local: string; fuso: string; reservas_pendentes: number; reservas_aviso: string | null;
  realocar_sem_resposta_min: number; hora_corte: string; corte_ate: string; equipe: MembroEstado[];
}
interface LinhaDistribuicao {
  lead_id: string; lead_nome: string | null; lead_telefone: string | null; etapa: string | null;
  ultima_mensagem_em: string | null; acao: string; para_user_id: string | null; para_nome: string | null;
}

const TEXTO_AUSENTE = "O motor do rodízio ainda não foi instalado no banco (migration da Fase 3 pendente).";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);

const ROTULO: Record<Modo, string> = { desligado: "Desligado", sombra: "Modo sombra", ligado: "Ligado" };
const COR: Record<Modo, string> = {
  desligado: "bg-muted text-muted-foreground",
  sombra: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  ligado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};
const ESTADO_PONTO: Record<string, string> = {
  aberta: "Em expediente", pausada: "Em pausa", encerrada: "Encerrou o expediente",
  fechada: "Sem expediente aberto", ausente: "Não abriu hoje",
};

const fmtHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function RodizioPainel({ aoMudar }: { aoMudar?: () => void }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [alvo, setAlvo] = useState<Modo | null>(null);
  const [mudando, setMudando] = useState(false);
  const [previa, setPrevia] = useState<LinhaDistribuicao[] | null>(null);
  const [distribuindo, setDistribuindo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await rpc("rodizio_estado");
    setCarregando(false);
    if (error) { setErro(mensagemDeErroRpc(error, "Não foi possível ler o estado do rodízio.", TEXTO_AUSENTE)); return; }
    setErro(null);
    setEstado(data as Estado);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const definirModo = async () => {
    if (!alvo) return;
    setMudando(true);
    const { data, error } = await rpc("rodizio_definir_modo", { p_modo: alvo });
    setMudando(false);
    setAlvo(null);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível mudar o modo.", TEXTO_AUSENTE)); return; }
    const r = data as { modo: Modo; elegiveis: number; abertas: number };
    if (r.modo === "ligado" && r.elegiveis === 0) {
      toast.warning("Rodízio ligado, mas nenhuma SDR está no rodízio: os leads continuam com o administrador até alguém entrar.");
    } else if (r.modo === "ligado" && r.abertas === 0) {
      toast.success("Rodízio ligado. Ninguém está em expediente agora: os leads novos ficam reservados e são entregues quando cada SDR abrir.");
    } else {
      toast.success(`Rodízio: ${ROTULO[r.modo].toLowerCase()}.`);
    }
    await carregar();
    aoMudar?.();
  };

  const simular = async () => {
    setDistribuindo(true);
    const { data, error } = await rpc("rodizio_distribuir_sem_resposta_agora", { p_dry_run: true });
    setDistribuindo(false);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível simular a distribuição.", TEXTO_AUSENTE)); return; }
    setPrevia((data ?? []) as LinhaDistribuicao[]);
  };

  const distribuir = async () => {
    setDistribuindo(true);
    const { data, error } = await rpc("rodizio_distribuir_sem_resposta_agora", { p_dry_run: false });
    setDistribuindo(false);
    setPrevia(null);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível distribuir.", TEXTO_AUSENTE)); return; }
    const linhas = (data ?? []) as LinhaDistribuicao[];
    const movidos = linhas.filter((l) => l.acao !== "fica").length;
    toast.success(`${movidos} lead${movidos === 1 ? "" : "s"} sem resposta distribuído${movidos === 1 ? "" : "s"}.`);
    await carregar();
    aoMudar?.();
  };

  if (erro) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {erro}
        <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={carregar}>Tentar de novo</Button>
      </div>
    );
  }
  if (!estado) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={14} /> Lendo o estado do rodízio...
      </div>
    );
  }

  const modo = estado.modo;
  const descricao: Record<Modo, string> = {
    desligado: "Nada é distribuído. Leads novos continuam com o administrador.",
    sombra: "O motor só anota, no livro de atribuições, quem teria recebido cada lead. Ninguém muda de dona.",
    ligado: `Leads novos do funil vão para a SDR em expediente com menos entregas; fora do expediente ficam reservados. Corte às ${estado.hora_corte.slice(0, 5)}, realocação após ${estado.realocar_sem_resposta_min} min sem resposta humana.`,
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Power size={18} className="text-primary" />
          <h2 className="font-semibold text-foreground">Distribuição automática</h2>
          <Badge variant="outline" className={COR[modo]}>{ROTULO[modo]}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {estado.em_expediente ? "Em horário comercial" : "Fora do horário comercial"}
          {" · "}{estado.dia_util ? "dia útil" : "não é dia útil"}
          {estado.modo_alterado_em && ` · modo desde ${fmtHora(estado.modo_alterado_em)}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={carregando} title="Atualizar">
            <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
          </Button>
          {(["desligado", "sombra", "ligado"] as Modo[]).filter((m) => m !== modo).map((m) => (
            <Button key={m} size="sm" variant={m === "ligado" ? "default" : "outline"} onClick={() => setAlvo(m)}>
              {m === "desligado" ? "Desligar" : m === "sombra" ? "Modo sombra" : "Ligar"}
            </Button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{descricao[modo]}</p>
      {estado.reservas_aviso && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{estado.reservas_aviso}</p>
      )}

      {estado.equipe.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SDR</TableHead>
                <TableHead>Expediente</TableHead>
                <TableHead className="text-right">Entregas no ciclo</TableHead>
                <TableHead className="text-right">Reservados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estado.equipe.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="font-medium">{m.nome}</TableCell>
                  <TableCell>{ESTADO_PONTO[m.estado] ?? m.estado}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.carga}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.reservas}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {modo !== "desligado" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={simular} disabled={distribuindo}>
            <Shuffle size={14} className="mr-1" /> Distribuir os leads sem resposta agora
          </Button>
          <span className="text-xs text-muted-foreground">
            Mostra a lista antes de mover. {modo === "sombra" && "Em modo sombra só anota, não move."}
          </span>
        </div>
      )}

      <AlertDialog open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alvo === "ligado" ? "Ligar a distribuição automática?" : alvo === "sombra" ? "Passar para o modo sombra?" : "Desligar a distribuição?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alvo === "ligado" && "A partir de agora os leads novos do funil vão para as SDRs no rodízio. Os leads que já existem continuam onde estão até você usar a distribuição inicial."}
              {alvo === "sombra" && "O motor passa a registrar quem teria recebido cada lead, sem mudar dona nenhuma. Use por alguns dias para conferir a distribuição antes de ligar."}
              {alvo === "desligado" && "Reservas pendentes são canceladas sem mover ninguém. Leads já entregues continuam com as SDRs."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mudando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); definirModo(); }} disabled={mudando}>
              {mudando ? <Loader2 className="animate-spin" size={14} /> : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={previa !== null} onOpenChange={(o) => !o && setPrevia(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Distribuição inicial dos leads sem resposta</AlertDialogTitle>
            <AlertDialogDescription>
              {previa && previa.length === 0
                ? "Nenhum lead do administrador está aguardando resposta agora."
                : `${previa?.length ?? 0} lead${(previa?.length ?? 0) === 1 ? "" : "s"} aguardando resposta. ${modo === "sombra" ? "Em modo sombra, a confirmação só anota no livro." : "Ao confirmar, cada um vai para a SDR indicada (ou fica reservado se ela não estiver em expediente)."}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {previa && previa.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Última mensagem</TableHead>
                    <TableHead>Vai para</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previa.map((l) => (
                    <TableRow key={l.lead_id}>
                      <TableCell className="font-medium">{l.lead_nome || l.lead_telefone || "—"}</TableCell>
                      <TableCell>{l.etapa ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{fmtHora(l.ultima_mensagem_em)}</TableCell>
                      <TableCell>{l.para_nome ?? l.acao}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={distribuindo}>Fechar</AlertDialogCancel>
            {previa && previa.length > 0 && (
              <AlertDialogAction onClick={(e) => { e.preventDefault(); distribuir(); }} disabled={distribuindo}>
                {distribuindo ? <Loader2 className="animate-spin" size={14} /> : "Confirmar distribuição"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

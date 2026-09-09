import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGestorEquipe } from "@/hooks/useGestorEquipe";
import RodizioPainel from "@/components/sdr/RodizioPainel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Info, KeyRound, Loader2, Plus, RefreshCw, UserCheck, UserX, Users } from "lucide-react";

/**
 * Equipe — gestão das SDRs do rodízio pelo gestor do cliente.
 *
 * Quem entra: só quem `is_gestor_equipe()` devolve true (superadmin ou o gestor
 * NOMEADO em crm_rodizio_config.gestor_user_id). Papel nenhum abre esta tela
 * sozinho — nem crc (o usuário do Meta App Review também é crc), nem gerente
 * (a mesma função é a porta de criar conta e redefinir senha em
 * admin-manage-user). O guard de verdade está no servidor: toda RPC abaixo
 * repete a checagem e responde "sem permissão"; aqui só evitamos mostrar uma
 * tela que não funcionaria.
 *
 * Contrato (Fase 1 do rodízio) — RPCs SECURITY DEFINER, só usuários do tenant
 * atual com papel sdr:
 *   equipe_listar()                        → linhas da tabela
 *   equipe_bloquear(p_user_id, p_bloquear)
 *   equipe_rodizio(p_user_id, p_ativo)
 *
 * Criar usuária e redefinir senha mexem em auth.users (Auth Admin API) e, por
 * decisão documentada no topo da migration da Fase 1, NÃO são RPCs: a tela
 * chama a edge function `admin-manage-user` (create / reset_password), que
 * aceita o gestor do tenant (is_gestor_equipe() no banco) criando SÓ papel
 * sdr no próprio tenant. Nada de "tentar RPC primeiro": a senha temporária só
 * sai daqui para essa função (antes ia parar num endpoint inexistente).
 *
 * Senha: digitada pelo gestor no formulário, vai direto para a função e é
 * apagada do estado no mesmo instante. Nunca aparece em toast, log ou lista.
 * A usuária troca a senha no primeiro login (must_change_password).
 *
 * Rodízio: a distribuição automática ainda está DESLIGADA (crm_rodizio_config
 * .modo = 'desligado'); o interruptor só define quem vai participar quando
 * ela for ligada (Fase 2). A página avisa isso.
 */

type Membro = {
  user_id: string;
  nome: string;
  email: string;
  bloqueado: boolean;
  no_rodizio: boolean;
  criado_em: string | null;
  ultimo_login: string | null;
  leads_hoje: number;
};

const MIN_SENHA = 8;

type RespostaRpc = { data: unknown; error: unknown };
/** Corpo devolvido por admin-manage-user (create/reset_password). */
type RespostaFuncao = { error?: string; user_id?: string; role?: string } | null | undefined;
type ErroLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  context?: { json?: unknown; clone?: () => { json: () => Promise<{ error?: unknown }> } };
};

// RPCs da Fase 1 ainda não estão em types.ts (arquivo gerado pelo Lovable);
// mesmo padrão do resto do projeto para RPC não tipada.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nome: string, args?: Record<string, unknown>): Promise<RespostaRpc> => (supabase as any).rpc(nome, args);

const comoErro = (e: unknown): ErroLike => (e && typeof e === "object" ? (e as ErroLike) : {});

/** Mensagem legível de um erro do PostgREST/Supabase (RAISE EXCEPTION chega em `message`). */
const mensagemDe = (e: unknown, fallback: string): string => {
  const err = comoErro(e);
  const m = err.message || err.details || err.hint;
  return typeof m === "string" && m.trim() ? m : fallback;
};

/** Extrai o erro de uma edge function (corpo JSON `{ error }` ou contexto da resposta). */
const erroDaFuncao = async (data: RespostaFuncao, error: unknown, fallback: string): Promise<string> => {
  if (data?.error) return String(data.error);
  const err = comoErro(error);
  const context = err.context;
  if (context?.json && typeof context.clone === "function") {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch { /* usa a mensagem abaixo */ }
  }
  return err.message || fallback;
};

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca");

export default function CrmEquipe() {
  const { profile } = useAuth();
  const { isGestor, resolved, erro: erroGestor, tentarDeNovo } = useGestorEquipe();

  const [membros, setMembros] = useState<Membro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null); // user_id da linha em ação

  // Diálogos
  const [novaAberta, setNovaAberta] = useState(false);
  const [nova, setNova] = useState({ nome: "", email: "", senha: "" });
  const [criando, setCriando] = useState(false);
  const [senhaDe, setSenhaDe] = useState<Membro | null>(null);
  const [senhaNova, setSenhaNova] = useState("");
  const [redefinindo, setRedefinindo] = useState(false);
  const [bloqueioDe, setBloqueioDe] = useState<Membro | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await rpc("equipe_listar");
    setCarregando(false);
    if (error) {
      setErroLista(mensagemDe(error, "Não foi possível carregar a equipe."));
      return;
    }
    setErroLista(null);
    setMembros(((data ?? []) as Membro[]).map((m) => ({ ...m, leads_hoje: Number(m.leads_hoje ?? 0) })));
  }, []);

  useEffect(() => {
    if (resolved && isGestor) carregar();
  }, [resolved, isGestor, carregar]);

  // ---------------------------------------------------------------- criar
  const criarSdr = async () => {
    const nome = nova.nome.trim();
    const email = nova.email.trim().toLowerCase();
    const senha = nova.senha;
    if (!nome) return toast.error("Informe o nome da SDR.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Informe um e-mail válido.");
    if (senha.length < MIN_SENHA) return toast.error(`A senha temporária precisa ter ao menos ${MIN_SENHA} caracteres.`);

    setCriando(true);
    // A senha sai do estado ANTES da chamada: se a tela re-renderizar ou o
    // diálogo fechar por erro, não sobra senha em campo nenhum.
    setNova((n) => ({ ...n, senha: "" }));
    try {
      // admin-manage-user: para o gestor, a função ignora tenant_id (usa o do
      // gestor) e só aceita role 'sdr'; para o superadmin, tenant_id é o alvo.
      const tenantId = profile?.tenant_id ?? undefined;
      const { data, error: fnErr } = await supabase.functions.invoke<RespostaFuncao>("admin-manage-user", {
        body: { action: "create", tenant_id: tenantId, nome, email, password: senha, role: "sdr" },
      });
      if (fnErr || data?.error) {
        // O campo de senha já foi esvaziado acima. Sem dizer isso, o gestor
        // corrige o e-mail, clica de novo e leva "a senha precisa ter ao menos
        // N caracteres" — um erro que não tem nada a ver com o que aconteceu.
        const motivo = await erroDaFuncao(data, fnErr, "Não foi possível criar a SDR.");
        toast.error(`${motivo} Digite a senha temporária de novo.`);
        requestAnimationFrame(() => {
          document.getElementById("sdr-senha")?.focus();
        });
        return;
      }
      const papelEfetivo = data?.role;
      if (papelEfetivo && papelEfetivo !== "sdr") {
        // Nunca deixar passar calado: papel diferente do pedido = permissão diferente.
        toast.error(`Atenção: a conta foi criada com o papel "${papelEfetivo}", não como SDR. Avise o administrador.`);
      } else {
        toast.success(`SDR ${nome} criada. Ela troca a senha no primeiro acesso.`);
      }
      setNovaAberta(false);
      setNova({ nome: "", email: "", senha: "" });
      await carregar();
    } finally {
      setCriando(false);
    }
  };

  // ------------------------------------------------------- redefinir senha
  const redefinirSenha = async () => {
    if (!senhaDe) return;
    const senha = senhaNova;
    if (senha.length < MIN_SENHA) return toast.error(`A nova senha precisa ter ao menos ${MIN_SENHA} caracteres.`);
    setRedefinindo(true);
    setSenhaNova("");
    try {
      // admin-manage-user: para o gestor, o alvo precisa ser do tenant dele e
      // ter SÓ o papel sdr (a função confere).
      const { data, error: fnErr } = await supabase.functions.invoke<RespostaFuncao>("admin-manage-user", {
        body: { action: "reset_password", user_id: senhaDe.user_id, password: senha },
      });
      if (fnErr || data?.error) {
        // Mesmo cuidado do criarSdr: o campo já foi esvaziado antes da chamada.
        const motivo = await erroDaFuncao(data, fnErr, "Não foi possível redefinir a senha.");
        toast.error(`${motivo} Digite a nova senha de novo.`);
        requestAnimationFrame(() => {
          document.getElementById("sdr-senha-nova")?.focus();
        });
        return;
      }
      toast.success(`Senha de ${senhaDe.nome} redefinida. Ela troca no próximo acesso.`);
      setSenhaDe(null);
    } finally {
      setRedefinindo(false);
    }
  };

  // ------------------------------------------------------------ bloquear
  const alternarBloqueio = async (m: Membro) => {
    const bloquear = !m.bloqueado;
    setOcupado(m.user_id);
    const { error } = await rpc("equipe_bloquear", { p_user_id: m.user_id, p_bloquear: bloquear });
    setOcupado(null);
    if (error) {
      toast.error(mensagemDe(error, bloquear ? "Não foi possível bloquear." : "Não foi possível desbloquear."));
      return;
    }
    toast.success(bloquear ? `${m.nome} bloqueada. Ela não entra mais no sistema.` : `${m.nome} desbloqueada.`);
    setMembros((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, bloqueado: bloquear, no_rodizio: bloquear ? false : x.no_rodizio } : x)));
    carregar(); // o banco decide se bloquear também tira do rodízio
  };

  // ------------------------------------------------------------- rodízio
  const alternarRodizio = async (m: Membro, ativo: boolean) => {
    if (ativo && m.bloqueado) {
      toast.error("Desbloqueie a SDR antes de colocá-la no rodízio.");
      return;
    }
    setOcupado(m.user_id);
    // Otimista: o interruptor responde na hora; se o banco recusar, volta.
    setMembros((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, no_rodizio: ativo } : x)));
    const { error } = await rpc("equipe_rodizio", { p_user_id: m.user_id, p_ativo: ativo });
    setOcupado(null);
    if (error) {
      setMembros((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, no_rodizio: !ativo } : x)));
      toast.error(mensagemDe(error, "Não foi possível alterar o rodízio."));
      return;
    }
    toast.success(
      ativo
        ? `${m.nome} vai participar do rodízio quando a distribuição automática for ligada.`
        : `${m.nome} não vai participar do rodízio.`,
    );
  };

  // --------------------------------------------------------------- gate
  // Só `false` vindo do banco fecha a rota. Erro de rede/5xx na RPC NÃO é
  // "não é gestor": fica em carregando com "Tentar de novo" (nunca expulsar
  // por uma decisão tomada por negação sobre um estado de erro).
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

  const ativasNoRodizio = membros.filter((m) => m.no_rodizio && !m.bloqueado).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <Users size={22} className="text-primary" /> Equipe
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              SDRs do rodízio de leads. {membros.length > 0 && `${ativasNoRodizio} de ${membros.length} no rodízio.`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={carregar} disabled={carregando} title="Atualizar">
              <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
            </Button>
            <Button size="sm" onClick={() => setNovaAberta(true)}>
              <Plus size={14} className="mr-1" /> Nova SDR
            </Button>
          </div>
        </header>

        <RodizioPainel aoMudar={carregar} />

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {erroLista ? (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold text-foreground">Não foi possível carregar a equipe</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{erroLista}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={carregar}>Tentar de novo</Button>
            </div>
          ) : carregando && membros.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="animate-spin" size={16} /> Carregando a equipe...
            </div>
          ) : membros.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
                <Users className="text-primary" size={22} />
              </div>
              <p className="mt-3 font-semibold text-foreground">Nenhuma SDR cadastrada</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Crie a primeira SDR. Ela entra fora do rodízio e você liga o interruptor quando quiser.
              </p>
              <Button size="sm" className="mt-4" onClick={() => setNovaAberta(true)}>
                <Plus size={14} className="mr-1" /> Nova SDR
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Rodízio</TableHead>
                    <TableHead className="text-right" title="Leads atribuídos a ela hoje">Leads hoje</TableHead>
                    <TableHead>Último login</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {membros.map((m) => {
                    const emAcao = ocupado === m.user_id;
                    return (
                      <TableRow key={m.user_id} className={m.bloqueado ? "opacity-70" : ""}>
                        <TableCell className="font-medium text-foreground">{m.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{m.email}</TableCell>
                        <TableCell>
                          {m.bloqueado
                            ? <Badge variant="destructive">Bloqueada</Badge>
                            : <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">Ativa</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={m.no_rodizio && !m.bloqueado}
                              disabled={emAcao || m.bloqueado}
                              onCheckedChange={(v) => alternarRodizio(m, v)}
                              aria-label={m.no_rodizio ? "Tirar do rodízio" : "Pôr no rodízio"}
                            />
                            <span className="text-xs text-muted-foreground">{m.no_rodizio && !m.bloqueado ? "Sim" : "Não"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{m.leads_hoje}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtData(m.ultimo_login)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm" variant="ghost" title="Redefinir senha" disabled={emAcao}
                              onClick={() => { setSenhaNova(""); setSenhaDe(m); }}
                            >
                              <KeyRound size={14} />
                            </Button>
                            {m.bloqueado ? (
                              <Button size="sm" variant="ghost" title="Desbloquear" disabled={emAcao} onClick={() => alternarBloqueio(m)}>
                                {emAcao ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" title="Bloquear" disabled={emAcao} onClick={() => setBloqueioDe(m)}>
                                {emAcao ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <p className="text-xs text-muted-foreground">
          Bloquear tira a SDR do sistema na hora (e do rodízio). Tirar do rodízio só interrompe a
          entrega de leads novos quando a distribuição automática estiver ligada — os que já são
          dela continuam com ela.
        </p>
      </div>

      {/* ---------------------------------------------------------- Nova SDR */}
      <Dialog open={novaAberta} onOpenChange={(v) => { if (!criando) { setNovaAberta(v); if (!v) setNova({ nome: "", email: "", senha: "" }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova SDR</DialogTitle>
            <DialogDescription>
              A conta nasce fora do rodízio e com acesso só ao número principal. A SDR vai ser
              obrigada a trocar a senha no primeiro acesso.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(e) => { e.preventDefault(); criarSdr(); }}
          >
            <div className="space-y-1">
              <Label htmlFor="sdr-nome">Nome</Label>
              <Input id="sdr-nome" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Nome completo" autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sdr-email">E-mail</Label>
              <Input id="sdr-email" type="email" value={nova.email} onChange={(e) => setNova({ ...nova, email: e.target.value })} placeholder="nome@clinica.com.br" autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sdr-senha">Senha temporária</Label>
              <Input
                id="sdr-senha" type="password" value={nova.senha}
                onChange={(e) => setNova({ ...nova, senha: e.target.value })}
                placeholder={`Mínimo ${MIN_SENHA} caracteres`} minLength={MIN_SENHA} autoComplete="new-password"
              />
              <p className="text-[11px] text-muted-foreground">
                Passe esta senha para a SDR por um canal seguro. Ela não fica salva aqui e não aparece de novo.
              </p>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setNovaAberta(false)} disabled={criando}>Cancelar</Button>
              <Button type="submit" disabled={criando}>
                {criando ? <><Loader2 size={14} className="mr-1 animate-spin" /> Criando...</> : "Criar SDR"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- Redefinir senha */}
      <Dialog open={!!senhaDe} onOpenChange={(v) => { if (!redefinindo && !v) { setSenhaDe(null); setSenhaNova(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              {senhaDe ? `${senhaDe.nome} (${senhaDe.email})` : ""}. Ela vai precisar trocar esta senha no próximo acesso.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); redefinirSenha(); }}>
            <div className="space-y-1">
              <Label htmlFor="sdr-senha-nova">Nova senha temporária</Label>
              <Input
                id="sdr-senha-nova" type="password" value={senhaNova}
                onChange={(e) => setSenhaNova(e.target.value)}
                placeholder={`Mínimo ${MIN_SENHA} caracteres`} minLength={MIN_SENHA} autoComplete="new-password" autoFocus
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => { setSenhaDe(null); setSenhaNova(""); }} disabled={redefinindo}>Cancelar</Button>
              <Button type="submit" disabled={redefinindo}>
                {redefinindo ? <><Loader2 size={14} className="mr-1 animate-spin" /> Redefinindo...</> : "Redefinir"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------- Bloquear */}
      <AlertDialog open={!!bloqueioDe} onOpenChange={(v) => !v && setBloqueioDe(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear {bloqueioDe?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela perde o acesso ao sistema imediatamente e sai do rodízio. Os leads que já são dela
              continuam atribuídos a ela até alguém transferir. Dá para desbloquear depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const m = bloqueioDe; setBloqueioDe(null); if (m) alternarBloqueio(m); }}
            >
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

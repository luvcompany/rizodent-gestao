import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Search, Bot, MoreHorizontal, Pencil, Copy, Archive, Trash2, Users, Eye, RotateCcw, Loader2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Bot as BotType, BotStatus } from "@/types/bot";
import ShareRoleDialog, { OwnerRoleBadge, type OwnerRole } from "@/components/crm/ShareRoleDialog";
import { useAuth } from "@/contexts/AuthContext";
import { botsQueAcionam, mensagemDeErroDoBot } from "@/lib/bots";

// Onde o bot é usado, para avisar antes de arquivar/excluir (AUTO-30): as
// automações "Enviar bot" (action_config.bot_id, sem FK) e os blocos "Acionar
// outro bot" de outros bots. Sem o aviso, a automação continuava "normal" na
// tela e não disparava nada.
type AutomacaoQueUsa = { id: string; ativa: boolean; onde: string };
type Referencias = { automacoes: AutomacaoQueUsa[]; bots: { id: string; name: string }[]; erro: string | null };
type AcaoNoBot = { tipo: "arquivar" | "excluir"; bot: BotType; refs: Referencias | null };

export default function CrmBots() {
  const navigate = useNavigate();
  const { userRole } = useAuth();
  const canShare = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
  // A SDR vive no mundo do crc: vê os bots dele, mas não escreve (policies
  // sdr_sem_insert/update/delete em `bots`). Sem esconder, todo botão de
  // escrita seria um clique que só devolve erro de permissão.
  const canWriteBots = userRole !== "sdr";
  const [bots, setBots] = useState<BotType[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [aba, setAba] = useState<"ativos" | "arquivados">("ativos");
  const [shareTarget, setShareTarget] = useState<BotType | null>(null);

  // "Novo Bot" pede o nome ANTES de gravar (REC-14): antes, cada clique criava
  // um "Novo Bot" no banco, mesmo se a pessoa desistisse.
  const [novoAberto, setNovoAberto] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoDescricao, setNovoDescricao] = useState("");
  const [criando, setCriando] = useState(false);

  const [acao, setAcao] = useState<AcaoNoBot | null>(null);
  const [desativarAutomacoes, setDesativarAutomacoes] = useState(true);
  const [executando, setExecutando] = useState(false);

  const fetchBots = async () => {
    const { data, error } = await supabase
      .from("bots")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      setErroLista(mensagemDeErroDoBot(error, "Não foi possível carregar os bots. Tente de novo."));
    } else {
      setErroLista(null);
      if (data) setBots(data as any);
    }
    setLoading(false);
  };

  useEffect(() => { fetchBots(); }, []);

  const abrirNovo = () => {
    setNovoNome("");
    setNovoDescricao("");
    setNovoAberto(true);
  };

  const handleCreate = async () => {
    const nome = novoNome.trim();
    if (!nome || criando) return;
    setCriando(true);
    const { data, error } = await supabase.from("bots").insert({
      name: nome,
      description: novoDescricao.trim() || null,
      status: "draft",
      flow_json: {
        nodes: [{ id: "start-1", type: "start", position: { x: 400, y: 50 }, data: {} }],
        edges: [],
      },
    }).select().single();
    setCriando(false);
    if (error) { toast.error(mensagemDeErroDoBot(error, "Não foi possível criar o bot. Tente de novo.")); return; }
    setNovoAberto(false);
    navigate(`/crm/bots/${data.id}`);
  };

  const handleDuplicate = async (bot: BotType) => {
    const { error } = await supabase.from("bots").insert({
      name: `${bot.name} (cópia)`,
      description: bot.description,
      status: "draft",
      flow_json: bot.flow_json,
      mark_as_read: bot.mark_as_read !== false,
      channels: Array.isArray(bot.channels) && bot.channels.length ? bot.channels : ["whatsapp"],
    } as any);
    if (error) { toast.error(mensagemDeErroDoBot(error, "Não foi possível duplicar o bot. Tente de novo.")); return; }
    toast.success("Bot duplicado (como rascunho)");
    fetchBots();
  };

  const buscarReferencias = async (bot: BotType): Promise<Referencias> => {
    const refs: Referencias = { automacoes: [], bots: [], erro: null };
    // Blocos "Acionar outro bot" dos bots que este perfil enxerga (os
    // arquivados não rodam).
    refs.bots = botsQueAcionam(bots.filter((b) => b.status !== "archived"), bot.id)
      .map((b) => ({ id: b.id, name: b.name }));

    const { data: autos, error } = await (supabase as any)
      .from("crm_automations")
      .select("id, is_active, stage_id")
      .eq("action_config->>bot_id", bot.id);
    if (error) {
      refs.erro = mensagemDeErroDoBot(error, "Não foi possível conferir as automações que usam este bot.");
      return refs;
    }
    const lista = (autos || []) as { id: string; is_active: boolean; stage_id: string }[];
    if (!lista.length) return refs;

    // Nome da etapa e do funil (a RLS pode esconder algum: fica o genérico).
    const stageIds = [...new Set(lista.map((a) => a.stage_id).filter(Boolean))];
    const { data: etapas } = await supabase.from("crm_stages").select("id, name, pipeline_id").in("id", stageIds);
    const pipeIds = [...new Set((etapas || []).map((e: any) => e.pipeline_id).filter(Boolean))] as string[];
    const { data: funis } = pipeIds.length
      ? await supabase.from("crm_pipelines").select("id, name").in("id", pipeIds)
      : { data: [] as { id: string; name: string }[] };
    const etapaPorId = new Map((etapas || []).map((e: any) => [e.id as string, e]));
    const funilPorId = new Map((funis || []).map((f: any) => [f.id as string, f.name as string]));
    refs.automacoes = lista.map((a) => {
      const etapa: any = etapaPorId.get(a.stage_id);
      const onde = etapa
        ? `Etapa "${etapa.name}"${funilPorId.get(etapa.pipeline_id) ? ` · ${funilPorId.get(etapa.pipeline_id)}` : ""}`
        : "Etapa de um funil que você não acessa";
      return { id: a.id, ativa: !!a.is_active, onde };
    });
    return refs;
  };

  const pedirConfirmacao = async (tipo: AcaoNoBot["tipo"], bot: BotType) => {
    setDesativarAutomacoes(true);
    setAcao({ tipo, bot, refs: null });
    const refs = await buscarReferencias(bot);
    setAcao((atual) => (atual && atual.bot.id === bot.id && atual.tipo === tipo ? { ...atual, refs } : atual));
  };

  const confirmarAcao = async () => {
    if (!acao || !acao.refs || executando) return;
    const { tipo, bot, refs } = acao;
    setExecutando(true);
    try {
      // Bot de outro papel: a RLS devolve sucesso com 0 linhas — o .select() torna isso visível.
      if (tipo === "arquivar") {
        const { data, error } = await supabase.from("bots").update({ status: "archived" }).eq("id", bot.id).select("id");
        if (error) { toast.error(mensagemDeErroDoBot(error, "Não foi possível arquivar o bot. Tente de novo.")); return; }
        if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para arquivar este bot."); return; }
      } else {
        const { data, error } = await supabase.from("bots").delete().eq("id", bot.id).select("id");
        if (error) { toast.error(mensagemDeErroDoBot(error, "Não foi possível excluir o bot. Tente de novo.")); return; }
        if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para excluir este bot."); return; }
      }

      // Automações ativas que enviavam este bot: desativa, se pedido. A RLS de
      // crm_automations decide quais este perfil pode desligar.
      const ativas = refs.automacoes.filter((a) => a.ativa).map((a) => a.id);
      let resumoAutomacoes = "";
      if (desativarAutomacoes && ativas.length) {
        const { data: desligadas, error } = await supabase
          .from("crm_automations").update({ is_active: false }).in("id", ativas).select("id");
        const n = error ? 0 : (desligadas?.length ?? 0);
        const faltam = ativas.length - n;
        resumoAutomacoes = n === 0 ? "" : n === 1 ? " 1 automação desativada." : ` ${n} automações desativadas.`;
        if (faltam > 0) {
          toast.warning(
            faltam === 1
              ? "1 automação que usava este bot não pôde ser desativada pelo seu perfil. Peça à gestão da clínica."
              : `${faltam} automações que usavam este bot não puderam ser desativadas pelo seu perfil. Peça à gestão da clínica.`,
            { duration: 8000 },
          );
        }
      }

      toast.success(
        tipo === "arquivar"
          ? `Bot arquivado.${resumoAutomacoes} Ele pode ser restaurado na aba Arquivados.`
          : `Bot excluído.${resumoAutomacoes}`,
      );
      setAcao(null);
      fetchBots();
    } finally {
      setExecutando(false);
    }
  };

  const handleRestore = async (bot: BotType) => {
    const { data, error } = await supabase.from("bots").update({ status: "draft" }).eq("id", bot.id).select("id");
    if (error) { toast.error(mensagemDeErroDoBot(error, "Não foi possível restaurar o bot. Tente de novo.")); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para restaurar este bot."); return; }
    toast.success("Bot restaurado como rascunho. Abra e salve para publicar de novo.");
    setAba("ativos");
    fetchBots();
  };

  const contagem = useMemo(() => ({
    ativos: bots.filter((b) => b.status !== "archived").length,
    arquivados: bots.filter((b) => b.status === "archived").length,
  }), [bots]);

  const filtered = bots.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) &&
    (aba === "arquivados" ? b.status === "archived" : b.status !== "archived")
  );

  const statusBadge = (s: BotStatus) => {
    const map = {
      draft: { label: "Rascunho", variant: "secondary" as const },
      published: { label: "Publicado", variant: "default" as const },
      archived: { label: "Arquivado", variant: "outline" as const },
    };
    const { label, variant } = map[s] || map.draft;
    return (
      <Badge
        variant={variant}
        className={cn(
          "h-7 shrink-0 whitespace-nowrap rounded-full border-transparent px-3 text-xs font-medium shadow-none before:mr-1.5 before:inline-block before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-['']",
          variant === "default"
            ? "bg-success-soft text-success-soft-foreground hover:bg-success-soft"
            : "bg-slate-soft text-slate-soft-foreground hover:bg-slate-soft",
        )}
      >
        {label}
      </Badge>
    );
  };

  const refs = acao?.refs ?? null;
  const automacoesAtivas = refs ? refs.automacoes.filter((a) => a.ativa).length : 0;
  const temReferencias = !!refs && (refs.automacoes.length > 0 || refs.bots.length > 0);

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-2 sm:-m-4 lg:-m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex-shrink-0 px-4 lg:px-6 pt-5 lg:pt-6 pb-4">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Bot size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">Construtor de Bots</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Crie fluxos de automação de conversas</p>
            </div>
          </div>
          {canWriteBots && (
            <Button onClick={abrirNovo} className="gap-2 shrink-0 h-11 rounded-xl px-5 font-semibold shadow-crm-brand">
              <Plus size={18} /> Novo Bot
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={aba} onValueChange={(v) => setAba(v as "ativos" | "arquivados")}>
            <TabsList variant="pill">
              <TabsTrigger value="ativos">Ativos <span className="tab-count">{contagem.ativos}</span></TabsTrigger>
              <TabsTrigger value="arquivados">Arquivados <span className="tab-count">{contagem.arquivados}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full max-w-sm">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <Input
              placeholder="Buscar bots..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-xl border-border/60 bg-card pl-10 shadow-xs placeholder:text-tertiary"
              aria-label="Buscar bots"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 lg:px-6 pb-6">
        {loading ? (
          <div className="rounded-card border border-border/60 bg-card shadow-card text-muted-foreground text-center py-12">Carregando...</div>
        ) : erroLista ? (
          <div className="rounded-card border border-border/60 bg-card shadow-card text-center py-16 px-4 space-y-3">
            <p className="text-muted-foreground">{erroLista}</p>
            <Button variant="outline" className="rounded-xl" onClick={() => { setLoading(true); fetchBots(); }}>Tentar de novo</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-card border border-border/60 bg-card shadow-card text-center py-14 px-4">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
              <Bot size={26} />
            </span>
            <p className="text-[15px] font-semibold text-foreground">
              {aba === "arquivados"
                ? (search ? "Nenhum bot arquivado com esse nome" : "Nenhum bot arquivado")
                : (search ? "Nenhum bot com esse nome" : "Nenhum bot encontrado")}
            </p>
            {canWriteBots && aba === "ativos" && !search && (
              <Button variant="outline" onClick={abrirNovo} className="mt-5 gap-2 rounded-xl">
                <Plus size={16} /> Criar primeiro bot
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-card border border-border/60 bg-card shadow-card overflow-hidden">
            {filtered.map((bot) => {
              const arquivado = bot.status === "archived";
              return (
                <div
                  key={bot.id}
                  className="group flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 last:border-b-0 px-4 sm:px-5 py-4 hover:bg-surface-sunken/60 transition-colors cursor-pointer"
                  onClick={() => navigate(`/crm/bots/${bot.id}`)}
                >
                  <div className="contents">
                    <div className="order-1 flex items-center gap-3 min-w-0 grow basis-[calc(100%-3rem)] sm:basis-0">
                      <div className="h-10 w-10 shrink-0 rounded-xl bg-primary-soft text-primary-soft-fg flex items-center justify-center">
                        <Bot size={20} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate">{bot.name}</h3>
                        <p className="text-[13px] text-muted-foreground truncate">
                          {bot.description || "Sem descrição"}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="order-2 sm:order-4 h-8 w-8 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label={`Ações do bot ${bot.name}`}
                        >
                          <MoreHorizontal size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        {/* Para a SDR o editor é só leitura: salvar e publicar gravam
                            em `bots`, e a RESTRICTIVE sdr_sem_update_bots recusa —
                            seria de novo "botão que só devolve erro". O rótulo diz o
                            que a tela realmente faz para cada papel. Bot arquivado
                            também abre só para ver (restaurar antes de editar). */}
                        <DropdownMenuItem onClick={() => navigate(`/crm/bots/${bot.id}`)}>
                          {canWriteBots && !arquivado
                            ? <><Pencil size={14} className="mr-2" /> Editar</>
                            : <><Eye size={14} className="mr-2" /> Ver fluxo</>}
                        </DropdownMenuItem>
                        {canWriteBots && arquivado && (
                          <DropdownMenuItem onClick={() => handleRestore(bot)}>
                            <RotateCcw size={14} className="mr-2" /> Restaurar
                          </DropdownMenuItem>
                        )}
                        {canWriteBots && !arquivado && (
                          <>
                            <DropdownMenuItem onClick={() => handleDuplicate(bot)}>
                              <Copy size={14} className="mr-2" /> Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => pedirConfirmacao("arquivar", bot)}>
                              <Archive size={14} className="mr-2" /> Arquivar
                            </DropdownMenuItem>
                          </>
                        )}
                        {canShare && (
                          <DropdownMenuItem onClick={() => setShareTarget(bot)}>
                            <Users size={14} className="mr-2" /> Compartilhar com papel
                          </DropdownMenuItem>
                        )}
                        {canWriteBots && (
                          <DropdownMenuItem className="text-destructive" onClick={() => pedirConfirmacao("excluir", bot)}>
                            <Trash2 size={14} className="mr-2" /> Excluir
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="contents">
                    <div className="order-3 sm:order-2 flex items-center gap-2 pl-[52px] sm:pl-0">
                      {statusBadge(bot.status)}
                      <OwnerRoleBadge ownerRole={(bot.owner_role ?? null) as OwnerRole} />
                    </div>
                    <span className="order-4 sm:order-3 w-full sm:w-[84px] pl-[52px] sm:pl-0 sm:text-right text-xs tabular-nums text-tertiary">
                      {new Date(bot.updated_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Novo bot: nome antes de gravar (REC-14). Cancelar não cria nada. */}
      <Dialog open={novoAberto} onOpenChange={(o) => { if (!criando) setNovoAberto(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo bot</DialogTitle>
            <DialogDescription>Dê um nome ao bot. Em seguida você monta o fluxo no editor.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="novo-bot-nome">Nome</Label>
              <Input
                id="novo-bot-nome"
                autoFocus
                maxLength={80}
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Ex.: Boas-vindas"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="novo-bot-descricao">Descrição (opcional)</Label>
              <Input
                id="novo-bot-descricao"
                maxLength={200}
                value={novoDescricao}
                onChange={(e) => setNovoDescricao(e.target.value)}
                placeholder="Para que serve este bot"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovoAberto(false)} disabled={criando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!novoNome.trim() || criando} className="gap-2">
                {criando && <Loader2 size={14} className="animate-spin" />}
                {criando ? "Criando..." : "Criar e abrir"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Arquivar / excluir: mostra onde o bot é usado e pede confirmação (AUTO-30). */}
      <AlertDialog open={!!acao} onOpenChange={(o) => { if (!o && !executando) setAcao(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {acao?.tipo === "excluir" ? "Excluir" : "Arquivar"} o bot "{acao?.bot.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  {acao?.tipo === "excluir"
                    ? "Esta ação não pode ser desfeita. O bot e todas as suas execuções serão removidos."
                    : "O bot deixa de rodar. Depois você pode restaurá-lo na aba Arquivados (ele volta como rascunho)."}
                </p>
                {!refs ? (
                  <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Procurando onde este bot é usado…</p>
                ) : refs.erro ? (
                  <p className="text-destructive">{refs.erro}</p>
                ) : temReferencias ? (
                  <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
                    <p className="font-medium text-foreground">Este bot é usado por:</p>
                    <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
                      {refs.automacoes.map((a) => (
                        <li key={a.id}>Automação "Enviar bot" · {a.onde}{a.ativa ? "" : " (já desativada)"}</li>
                      ))}
                      {refs.bots.map((b) => (
                        <li key={b.id}>Bloco "Acionar outro bot" do bot "{b.name}"</li>
                      ))}
                    </ul>
                    <p>
                      {acao?.tipo === "excluir" ? "Depois de excluído" : "Enquanto estiver arquivado"}, essas automações e blocos não disparam nada.
                    </p>
                    {automacoesAtivas > 0 && (
                      <label className="flex items-start gap-2 pt-1 text-foreground cursor-pointer">
                        <Checkbox
                          checked={desativarAutomacoes}
                          onCheckedChange={(v) => setDesativarAutomacoes(v === true)}
                          className="mt-0.5"
                        />
                        <span>
                          Desativar também {automacoesAtivas === 1 ? "a automação ativa" : `as ${automacoesAtivas} automações ativas`} que envia{automacoesAtivas === 1 ? "" : "m"} este bot
                        </span>
                      </label>
                    )}
                  </div>
                ) : (
                  <p>Nenhuma automação nem outro bot usa este bot.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!refs || executando}
              onClick={(e) => { e.preventDefault(); void confirmarAcao(); }}
              className={acao?.tipo === "excluir" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {executando ? "Aguarde..." : acao?.tipo === "excluir" ? "Excluir" : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShareRoleDialog
        open={!!shareTarget}
        onOpenChange={(v) => !v && setShareTarget(null)}
        table="bots"
        rowId={shareTarget?.id ?? null}
        currentOwnerRole={((shareTarget as any)?.owner_role ?? null) as OwnerRole}
        currentSharedRoles={(((shareTarget as any)?.shared_roles) ?? []) as string[]}
        itemLabel="Bot"
        onSaved={fetchBots}
      />
    </div>
  );
}

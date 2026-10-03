import { useState, useEffect, useRef, useMemo } from "react";
import { hojeNoFusoDaClinica } from "@/lib/horaDaConsulta";
import { instanteNoFusoMs } from "@/lib/fuso";
import { NavLink, useNavigate, useLocation, Outlet } from "react-router-dom";
import {
  LayoutGrid, MessageSquare, Bot, FileText, Link2, BarChart3,
  Menu, X, CalendarDays, ChevronLeft, ChevronRight, RefreshCw,
  Home, Settings, ChevronDown, Send, Sun, Moon, Sparkles, Heart, Shield, LogOut,
  Activity, Phone, Users, Clock, UserCog, Lock,
} from "lucide-react";
import { useCanaisInternos } from "@/hooks/useChatInterno";
import { useFaltaRegistrar } from "@/pages/recepcao/AgendaRecepcao";
import { useFilaRemarcar } from "@/pages/SdrRemarcar";
import { useAuth } from "@/contexts/AuthContext";
import { useGestorEquipe } from "@/hooks/useGestorEquipe";
import { itensDoGrupoEquipe, ROTA_USUARIOS_DA_CLINICA, type ItemDoGrupoEquipe } from "@/lib/acessoUsuariosDaClinica";
import { useTheme } from "@/hooks/useTheme";
import { CRCLIN_DEFAULT_LOGO } from "@/contexts/TenantContext";
import { useBrand, type SystemBrand, type TenantBrand } from "@/contexts/BrandContext";
import { SISTEMA_PADRAO } from "@/lib/brand/theme";
import { useModulos, podeMostrar } from "@/hooks/useModule";
import { useVocab, type Vocab } from "@/hooks/useVocab";
import { moduloDaRota, type ModuloKey } from "@/lib/modulos";
import { supabase } from "@/integrations/supabase/client";
import NotificationBell from "@/components/chat/NotificationBell";
import SeletorCliente from "@/components/SeletorCliente";
import AtalhoChegando from "@/components/setores/AtalhoChegando";
import TaskReminderWatcher from "@/components/chat/TaskReminderWatcher";
import AvisoFimExpediente from "@/components/sdr/AvisoFimExpediente";
import EditProfileDialog from "@/components/EditProfileDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import crclinLogoLight from "@/assets/crclin-logo-light.png";
import ErrorBoundary from "@/components/ErrorBoundary";
import { usePageTitle } from "@/hooks/usePageTitle";
import { tituloDaAba } from "@/lib/tituloDaAba";

type NavItem = {
  to: string;
  icon: any;
  label: string;
  end?: boolean;
  badgeKey?: string;
  /** Query string do destino (ex.: "?view=tarefas"). Dois itens podem apontar
   *  para o mesmo caminho com queries diferentes; só o da query atual acende. */
  search?: string;
};

type NavGroup = {
  label: string;
  icon: any;
  children: NavItem[];
};

type SidebarEntry = NavItem | NavGroup;

function isGroup(entry: SidebarEntry): entry is NavGroup {
  return "children" in entry;
}

/**
 * Tira do menu os itens de módulo desligado. Só esconde com `false` explícito
 * (módulo resolvido e desligado): enquanto a config não chegou, tudo aparece.
 * Grupo que fica sem filhos some.
 */
const ROTAS_SO_DO_V2 = ["/crm/interno", "/crm/equipe/usuarios", "/crm/sdr/remarcar", "/crm/recepcao/agenda", "/crm/fechamento", "/crm/todos", "/crm/chegando"];
function semRecursosDoV2(entries: SidebarEntry[]): SidebarEntry[] {
  const fora = (to: string) => ROTAS_SO_DO_V2.some((r) => to === r || to.startsWith(r + "/") || to.startsWith(r + "?"));
  const saida: SidebarEntry[] = [];
  for (const entry of entries) {
    if (isGroup(entry)) {
      const children = entry.children.filter((c) => !fora(c.to));
      if (children.length > 0) saida.push({ ...entry, children });
    } else if (!fora(entry.to)) {
      saida.push(entry);
    }
  }
  return saida;
}

function filtrarPorModulo(
  entries: SidebarEntry[],
  ligado: (key: ModuloKey) => boolean | undefined,
): SidebarEntry[] {
  const visivel = (to: string) => {
    const modulo = moduloDaRota(to);
    return !modulo || podeMostrar(ligado(modulo));
  };
  const saida: SidebarEntry[] = [];
  for (const entry of entries) {
    if (isGroup(entry)) {
      const children = entry.children.filter((c) => visivel(c.to));
      if (children.length > 0) saida.push({ ...entry, children });
    } else if (visivel(entry.to)) {
      saida.push(entry);
    }
  }
  return saida;
}

/**
 * Logo da barra lateral:
 *  - cliente: no escuro, logo escura → logo clara; no claro, logo clara;
 *  - cliente white-label (sem "Powered by") e sem logo: lockup de texto;
 *  - sistema: logo do sistema do modo (no escuro, a escura → a clara);
 *  - sistema ainda com o nome padrão e sem logo cadastrada: logo local do CRClin;
 *  - nada disso: null (lockup de texto).
 */
function escolherLogo(
  escuro: boolean,
  cliente: TenantBrand | null,
  sistema: SystemBrand,
  poweredBy: boolean,
): string | null {
  const limpo = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const doCliente = escuro
    ? limpo(cliente?.logo_dark_url) ?? limpo(cliente?.logo_url)
    : limpo(cliente?.logo_url);
  if (doCliente) return doCliente;
  if (cliente && !poweredBy) return null;
  const doSistema = escuro
    ? limpo(sistema.logo_dark_url) ?? limpo(sistema.logo_url)
    : limpo(sistema.logo_url);
  if (doSistema) return doSistema;
  if ((limpo(sistema.name) ?? SISTEMA_PADRAO.name) === SISTEMA_PADRAO.name) {
    return escuro ? CRCLIN_DEFAULT_LOGO : crclinLogoLight;
  }
  return null;
}

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? partes[0][0] + partes[1][0] : (partes[0] ?? "").slice(0, 2);
  return letras.toUpperCase() || "?";
}

/** Logo (ou lockup de texto) no topo da barra lateral. */
function MarcaDaBarra({ logo, nome, nomeCurto }: { logo: string | null; nome: string; nomeCurto: string }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [logo]);
  if (logo && !falhou) {
    return (
      <span className="inline-flex max-w-full items-center justify-center">
        <img
          src={logo}
          alt={nome}
          className={
            logo === CRCLIN_DEFAULT_LOGO
              ? "h-8 w-[125px] max-w-full object-cover object-[50%_42%]"
              : "h-10 max-w-full object-contain object-center"
          }
          onError={() => setFalhou(true)}
        />
      </span>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2.5" title={nome}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
        {iniciaisDe(nomeCurto)}
      </span>
      <span className="truncate text-[15px] font-semibold text-white">{nomeCurto}</span>
    </div>
  );
}

// Itens do grupo Equipe (a escolha de quais aparecem: itensDoGrupoEquipe).
const ITENS_DA_EQUIPE: Record<ItemDoGrupoEquipe, NavItem> = {
  sdrs: { to: "/crm/equipe", icon: Users, label: "SDRs", end: true },
  "relatorio-sdr": { to: "/crm/equipe/relatorio-sdr", icon: BarChart3, label: "Relatório das SDRs" },
  ponto: { to: "/crm/equipe/ponto", icon: Clock, label: "Ponto e pausas" },
  pesquisa: { to: "/crm/equipe/pesquisa", icon: Heart, label: "Pesquisa de satisfação" },
  usuarios: { to: ROTA_USUARIOS_DA_CLINICA, icon: UserCog, label: "Usuários" },
};

const buildCrmNavItems = (role: string | null, isGestorEquipe: boolean, vocab: Vocab): SidebarEntry[] => {
  // SDR do rodízio: base da recepção, isolada por "leads dela" (não por número).
  // Sem Transmissão/Conexões/Pacientes/Relatórios; com Calendário e Tarefas
  // porque agenda e faz follow-up dos próprios leads. Bots/modelos/respostas
  // são os do mundo do CRC (compartilhados). Automações entra em Ferramentas:
  // é onde ela cria funil, etapa, gatilho e disparo, e até agora só se chegava
  // lá pelo botão AUTOMATIZE do funil (que o guarda barrava).
  // Guard espelho: ProtectedRoute (SDR_PREFIXES).
  if (role === "sdr") {
    return [
      { to: "/crm/sdr", icon: Home, label: "Início", end: true },
      { to: "/crm/sdr/remarcar", icon: CalendarDays, label: "Remarcar", badgeKey: "remarcar" },
      { to: "/crm/conversas", icon: MessageSquare, label: "Conversas", badgeKey: "unread" },
      { to: "/crm", icon: LayoutGrid, label: "Funil", end: true },
      { to: "/crm/calendario", icon: CalendarDays, label: "Calendário" },
      { to: "/crm/ligacoes", icon: Phone, label: "Ligações" },
      // Só os números dela (RPC relatorio_sdr_minha) — não é a aba Relatórios do crc.
      { to: "/crm/sdr/desempenho", icon: BarChart3, label: "Meu desempenho" },
      {
        label: "Ferramentas",
        icon: Bot,
        children: [
          // Mesmo rótulo e ícone que os outros papéis usam para Automações (Bot).
          // Dentro de um grupo o renderNavGroup só pinta o rótulo, mas o ícone é
          // obrigatório no tipo NavItem — fica igual ao dos demais menus.
          { to: "/crm/bots", icon: Bot, label: "Bots" },
          { to: "/crm/modelos", icon: FileText, label: "Modelos" },
          { to: "/crm/respostas-rapidas", icon: FileText, label: "Respostas Rápidas" },
        ],
      },
    ];
  }
  // Closer: espelho da recepção (mesma tela de Início, sem Instagram), com Conexões —
  // cada closer conecta o próprio número de WhatsApp.
  // O guard correspondente fica em ProtectedRoute (CLOSER_PREFIXES).
  if (role === "closer") {
    return [
      { to: "/crm/closer", icon: Home, label: "Início", end: true },
      { to: "/crm/conversas", icon: MessageSquare, label: "Conversas", badgeKey: "unread" },
      { to: "/crm", icon: LayoutGrid, label: "Funil", end: true },
      { to: "/crm/calendario", icon: CalendarDays, label: "Calendário" },
      { to: "/crm/closer/pacientes", icon: Users, label: vocab.pessoaPlural },
      {
        label: "Ferramentas",
        icon: Bot,
        children: [
          { to: "/crm/campanhas", icon: Send, label: "Transmissão" },
          { to: "/crm/modelos", icon: FileText, label: "Modelos" },
          { to: "/crm/respostas-rapidas", icon: FileText, label: "Respostas Rápidas" },
          { to: "/crm/bots", icon: Bot, label: "Bots" },
        ],
      },
      { to: "/crm/conexoes", icon: Link2, label: "Conexões" },
    ];
  }
  // Recepção: menu enxuto — sem Kanban/Dashboard/Relatórios/Integrações/Config.
  // O guard correspondente fica em ProtectedRoute (RECEPCAO_PREFIXES).
  if (role === "recepcao") {
    // Menu próprio do balcão: começa pelo resumo do turno, depois o atendimento
    // (conversas e funil) e só então as ferramentas. Não é o menu dos outros
    // perfis com itens escondidos — é uma lista pensada para este trabalho.
    return [
      { to: "/crm/recepcao", icon: Home, label: "Início", end: true },
      { to: "/crm/recepcao/agenda", icon: CalendarDays, label: "Agenda do dia", badgeKey: "falta" },
      { to: "/crm/conversas", icon: MessageSquare, label: "Conversas", badgeKey: "unread" },
      { to: "/crm", icon: LayoutGrid, label: "Funil", end: true },
      {
        label: "Ferramentas",
        icon: Bot,
        children: [
          { to: "/crm/campanhas", icon: Send, label: "Transmissão" },
          { to: "/crm/modelos", icon: FileText, label: "Modelos" },
          { to: "/crm/respostas-rapidas", icon: FileText, label: "Respostas Rápidas" },
          { to: "/crm/bots", icon: Bot, label: "Bots" },
          
        ],
      },
      { to: "/crm/conexoes", icon: Link2, label: "Conexões" },
    ];
  }
  const items: SidebarEntry[] = [
    { to: "/crm/dashboard", icon: Home, label: "Dashboard" },
    { to: "/crm", icon: LayoutGrid, label: "Kanban", end: true },
    { to: "/crm/conversas", icon: MessageSquare, label: "Conversas", badgeKey: "unread" },
    { to: "/crm/calendario", icon: CalendarDays, label: "Calendário", badgeKey: "tasks" },
    { to: "/crm/ligacoes", icon: Phone, label: "Ligações" },
  ];
  // Pós-Venda só no menu do usuário de pós-venda (os demais não veem a aba).
  if (role === "posvenda") {
    items.push({ to: "/crm/posvenda", icon: Heart, label: "Pós-Venda" });
  }
  // "Funil e automações" saiu do menu: acesso pelo botão Automatize no Kanban.
  items.push(
    {
      label: "Automações",
      icon: Bot,
      children: [
        { to: "/crm/bots", icon: Bot, label: "Bots" },
        { to: "/crm/modelos", icon: FileText, label: "Modelos" },
        { to: "/crm/respostas-rapidas", icon: FileText, label: "Respostas Rápidas" },
        { to: "/crm/campanhas", icon: Send, label: "Transmissão" },
      ],
    },
  );
  if (role !== "posvenda") {
    items.push({ to: "/crm/integracoes", icon: Link2, label: "Integrações" });
  }
  if (role === "gerente" || role === "crc" || role === "superadmin") {
    items.push({ to: "/crm/recepcao/agenda", icon: CalendarDays, label: "Registro de consultas", badgeKey: "falta" });
    items.push({ to: "/crm/fechamento", icon: FileText, label: "Fechamento" });
  }
  items.push({ to: "/crm/relatorios", icon: BarChart3, label: "Relatórios" });
  // Equipe: as telas das SDRs (cadastro, relatório do rodízio, ponto e
  // pesquisa) só para quem o servidor confirma como gestor (is_gestor_equipe).
  // Papel não basta — o usuário do Meta App Review é crc. "Usuários" (P25: a
  // clínica cria as próprias contas) é do(a) gerente (dono) e do(a) gestor(a).
  // A regra mora em itensDoGrupoEquipe (testada); cada página repete o gate
  // por dentro e o servidor decide de verdade.
  const equipe = itensDoGrupoEquipe(role, isGestorEquipe).map((item) => ITENS_DA_EQUIPE[item]);
  if (equipe.length > 0) {
    items.push({ label: "Equipe", icon: Users, children: equipe });
  }
  items.push(
    { to: "/crm/ia-config", icon: Sparkles, label: "I.A" },
    { to: "/crm/configuracoes", icon: Settings, label: "Configurações" },
  );
  return items;
};

// (Instagram pipeline id agora é resolvido dinamicamente via crm_pipelines.is_instagram — fallback dentro de CrmConversas)

const CrmLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { userRole, signOut, profile, user, refreshProfile } = useAuth();
  const { isGestor: isGestorEquipe } = useGestorEquipe();
  const { system, tenant: marcaCliente, effective } = useBrand();
  const { ligado: moduloLigado } = useModulos();
  const vocab = useVocab();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  // A barra lateral é escura nos dois temas: a logo é sempre a do fundo escuro
  // (logo escura → logo clara numa placa → lockup de iniciais).
  const logo = escolherLogo(true, marcaCliente, system, effective.poweredBy);
  const temLogoCliente = !!(marcaCliente?.logo_dark_url?.trim() || marcaCliente?.logo_url?.trim());
  const tagline = system.tagline?.trim() || null;
  // "Powered by" só faz sentido dentro de um cliente (sem cliente, a marca já é a do sistema).
  const mostrarPoweredBy = !!marcaCliente && effective.poweredBy;
  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };
  const initials = profile?.nome?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const [unreadCount, setUnreadCount] = useState(0);
  const { totalNaoLidas: internoNaoLidas } = useCanaisInternos();
  const registraConsulta = ["recepcao", "gerente", "crc", "superadmin"].includes(userRole ?? "");
  const faltaRegistrar = useFaltaRegistrar(registraConsulta).data?.length ?? 0;
  const filaRemarcar = useFilaRemarcar(userRole === "sdr").data?.length ?? 0;
  const [todayTaskCount, setTodayTaskCount] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["Automações", "Ferramentas", "Equipe"]));
  const unreadFetchSeq = useRef(0);
  const unreadRefreshTimer = useRef<number | null>(null);
  const crmNavItems = useMemo(
    () => {
      const base = filtrarPorModulo(buildCrmNavItems(userRole, isGestorEquipe, vocab), moduloLigado);
      // CRClin: chat interno, fila "Remarcar", agenda/registro de consultas e
      // fechamento são recursos do v2 sem rota aqui — fora do menu.
      return semRecursosDoV2(base);
    },
    [userRole, isGestorEquipe, vocab, moduloLigado],
  );
  const itensDoTitulo = crmNavItems.flatMap((e) => (isGroup(e) ? e.children : [e]));
  usePageTitle(
    tituloDaAba(location.pathname, location.search, itensDoTitulo, {
      "/crm/conversa": "Conversa",
      "/crm/metricas": "Métricas",
    }),
  );


  /** NavLink acende por caminho; itens que só diferem na query (Calendário ×
   *  Tarefas) precisam desempatar pela query atual. */
  const itemAtivo = (item: NavItem, isActive: boolean) => {
    if (!isActive) return false;
    if (item.search) return location.search === item.search;
    const irmaoComQueryAtiva = crmNavItems.some(
      (e) => !isGroup(e) && e !== item && e.to === item.to && !!e.search && location.search === e.search,
    );
    return !irmaoComQueryAtiva;
  };

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  useEffect(() => {
    const fetchUnread = async () => {
      const seq = ++unreadFetchSeq.current;
      if (!user?.id || seq !== unreadFetchSeq.current) return;
      // RPC conta leads aguardando resposta com last_inbound_at nos últimos 60 dias
      // (migração 20260708030000) — mesma janela das abas/lista em Conversas.
      const { data, error } = await (supabase as any).rpc("get_crm_unread_leads_count");
      if (!error && seq === unreadFetchSeq.current) {
        setUnreadCount(Number(data || 0));
      }
    };
    const scheduleFetchUnread = () => {
      // Debounce longo: com webhook ativo, crm_leads muda várias vezes por
      // segundo. 3s agrupa a rajada em UMA recontagem (era 600ms).
      if (unreadRefreshTimer.current) window.clearTimeout(unreadRefreshTimer.current);
      unreadRefreshTimer.current = window.setTimeout(fetchUnread, 3_000);
    };
    fetchUnread();
    const ch = supabase.channel("unread-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, scheduleFetchUnread)
      .subscribe();
    // Conversas avisa ao fechar/marcar respondida: reconta na hora.
    const aoMudarNaoLidas = () => { fetchUnread(); };
    window.addEventListener("crm:nao-lidas-mudou", aoMudarNaoLidas);
    return () => {
      window.removeEventListener("crm:nao-lidas-mudou", aoMudarNaoLidas);
      if (unreadRefreshTimer.current) window.clearTimeout(unreadRefreshTimer.current);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  useEffect(() => {
    const fetchTodayTasks = async () => {
      if (!user?.id) { setTodayTaskCount(0); return; }
      // Fim do dia no fuso da clínica (não em UTC).
      const [y, m, d] = hojeNoFusoDaClinica().split("-").map(Number);
      const fim = new Date(instanteNoFusoMs(y, m, d, 23, 59) + 59_999).toISOString();
      const { count } = await supabase
        .from("crm_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("assigned_to", user.id)
        .lte("due_date", fim);
      setTodayTaskCount(count || 0);
    };
    // Mesma ideia do badge de não lidas: agrupa rajadas de mudanças em tarefas
    // em uma única contagem, em vez de uma consulta por evento.
    let taskTimer: number | null = null;
    const scheduleFetchTasks = () => {
      if (taskTimer) window.clearTimeout(taskTimer);
      taskTimer = window.setTimeout(fetchTodayTasks, 3_000);
    };
    fetchTodayTasks();
    const ch = supabase.channel("task-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_tasks" }, scheduleFetchTasks)
      .subscribe();
    return () => {
      if (taskTimer) window.clearTimeout(taskTimer);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const renderNavItem = (item: NavItem) => (
    <NavLink
      key={item.to + (item.search ?? "")}
      to={item.to + (item.search ?? "")}
      end={item.end}
      onClick={() => setSidebarOpen(false)}
      className={({ isActive }) =>
        `group flex h-10 items-center gap-3 rounded-control px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50 ${
          item.to === "/crm/integracoes"
            ? "relative !mt-7 before:pointer-events-none before:absolute before:-top-[15px] before:left-3 before:right-3 before:border-t before:border-sidebar-border"
            : ""
        } ${
          itemAtivo(item, isActive)
            ? "crm-nav-ativo bg-sidebar-accent font-semibold text-sidebar-accent-foreground ring-1 ring-inset ring-sidebar-primary/25"
            : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`
      }
    >
      <item.icon size={18} />
      {item.label}
      {"badgeKey" in item && item.badgeKey === "unread" && unreadCount > 0 && (
        <span
          title="Conversas não lidas (últimos 60 dias)"
          className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-[11px] font-semibold leading-none text-sidebar-primary-foreground group-[.crm-nav-ativo]:bg-white/25 group-[.crm-nav-ativo]:text-white"
        >
          {unreadCount > 999 ? "999+" : unreadCount}
        </span>
      )}
      {"badgeKey" in item && ((item.badgeKey === "falta" && faltaRegistrar > 0) || (item.badgeKey === "remarcar" && filaRemarcar > 0)) && (
        <span title={item.badgeKey === "falta" ? "Consultas sem registro" : "Pacientes para remarcar"} className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-none text-destructive-foreground">
          {item.badgeKey === "falta" ? faltaRegistrar : filaRemarcar}
        </span>
      )}
      {"badgeKey" in item && item.badgeKey === "interno" && internoNaoLidas > 0 && (
        <span title="Mensagens internas não lidas" className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-internal-accent px-1.5 text-[11px] font-semibold leading-none text-background">
          {internoNaoLidas > 99 ? "99+" : internoNaoLidas}
        </span>
      )}
      {"badgeKey" in item && item.badgeKey === "tasks" && todayTaskCount > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-[11px] font-semibold leading-none text-sidebar-primary-foreground group-[.crm-nav-ativo]:bg-white/25 group-[.crm-nav-ativo]:text-white">
          {todayTaskCount > 99 ? "99+" : todayTaskCount}
        </span>
      )}
    </NavLink>
  );

  const renderNavGroup = (group: NavGroup) => {
    const isExpanded = expandedGroups.has(group.label);
    return (
      <div key={group.label}>
        <button
          onClick={() => toggleGroup(group.label)}
          className="flex h-10 w-full items-center gap-3 rounded-control px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50"
        >
          <group.icon size={18} />
          {group.label}
          <ChevronDown size={14} className={`ml-auto text-sidebar-muted transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
        </button>
        {isExpanded && (
          <div className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
            {group.children.map(child => (
              <NavLink
                key={child.to}
                to={child.to}
                end={child.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex h-9 items-center gap-3 rounded-control px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50 ${
                    isActive
                      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground ring-1 ring-inset ring-sidebar-primary/25"
                      : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`
                }
              >
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="crm-shell flex min-h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Collapse toggle for desktop */}
      {!sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(true)}
          className="hidden lg:flex fixed top-5 left-[248px] [body:has(.crm-faixa-suporte)_&]:top-[60px] z-[51] h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:text-foreground"
          title="Ocultar menu"
        >
          <ChevronLeft size={14} />
        </button>
      )}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="hidden lg:flex fixed top-5 left-3 [body:has(.crm-faixa-suporte)_&]:top-[60px] z-[51] h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:text-foreground"
          title="Mostrar menu"
        >
          <ChevronRight size={14} />
        </button>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform ${
          sidebarCollapsed ? "-translate-x-full" : "crm-sidebar-aberta lg:translate-x-0"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="relative flex items-center gap-3 px-5 pb-4 pt-6">
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <MarcaDaBarra logo={logo} nome={effective.name} nomeCurto={effective.shortName} />
          </div>
          <button
            className="absolute right-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-white lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="mx-3 flex min-h-[3rem] items-center px-1 pb-2">
          {!temLogoCliente && (
            <div className="min-w-0">
              <h2 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-white">{effective.name}</h2>
              {tagline && <p className="mt-0.5 line-clamp-2 break-words text-xs text-sidebar-muted">{tagline}</p>}
            </div>
          )}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {userRole !== "posvenda" && userRole !== "recepcao" && userRole !== "closer" && userRole !== "sdr" && (
            <div className="mb-2 border-b border-sidebar-border pb-2.5">
              <button
                onClick={() => {
                  navigate("/dashboard");
                  setSidebarOpen(false);
                }}
                className="flex h-10 w-full items-center gap-3 rounded-control px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50"
                title="Página inicial do sistema"
              >
                <Home size={18} />
                Página inicial
              </button>
            </div>
          )}
          <div className="space-y-1">
            {crmNavItems.map((entry) =>
              isGroup(entry) ? renderNavGroup(entry) : renderNavItem(entry)
            )}
          </div>
        </nav>

        <div className="space-y-0.5 border-t border-sidebar-border p-3">
          {profile && (
            <button
              onClick={() => setEditProfileOpen(true)}
              className="group mb-1.5 flex w-full items-center gap-3 rounded-card bg-white/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50"
            >
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage src={profile.avatar_url || undefined} />
                <AvatarFallback className="bg-primary text-sm font-bold text-primary-foreground">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left min-w-0">
                <p className="truncate text-[13px] font-semibold text-white">{profile.nome}</p>
                <p className="truncate text-xs text-sidebar-muted">{profile.email}</p>
              </div>
              <Settings size={14} className="shrink-0 text-sidebar-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <button
            onClick={toggleTheme}
            className="flex h-9 w-full items-center gap-3 rounded-control px-3 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
          </button>
          <button
            onClick={handleLogout}
            className="flex h-9 w-full items-center gap-3 rounded-control px-3 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50"
          >
            <LogOut size={18} />
            Sair
          </button>
          {mostrarPoweredBy && (
            <p className="px-3 pt-2 text-[10px] text-sidebar-muted">Powered by {system.name}</p>
          )}
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col transition-all ${sidebarCollapsed ? "lg:pl-0" : "lg:pl-64"}`}>
        <header className="flex min-w-0 h-16 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur lg:px-6">
          <button
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-control text-foreground transition-colors hover:bg-muted lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <SeletorCliente />
            <AtalhoChegando />
            <NotificationBell />
            <span className="hidden md:inline border-l border-border/60 pl-3 text-sm font-medium text-foreground">
              {tagline ? `${effective.name} — ${tagline}` : effective.name}
            </span>
          </div>
        </header>

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-background p-2 sm:p-4 lg:p-6">
          <TaskReminderWatcher />
          {/* Aviso de fim de expediente da SDR: vive AQUI, no layout, e não no
              cartão da home. O cartão só existe em /crm/sdr, e a SDR passa o dia
              em Conversas — o aviso não a alcançava e o expediente encerrava
              sozinho sem perguntar. Montado uma única vez; ele mesmo se cala
              para os outros papéis. */}
          <AvisoFimExpediente />
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {user && profile && (
        <EditProfileDialog
          open={editProfileOpen}
          onOpenChange={setEditProfileOpen}
          userId={user.id}
          currentNome={profile.nome}
          currentCargo={profile.cargo}
          currentAvatarUrl={profile.avatar_url}
          currentEmail={profile.email}
          onSaved={refreshProfile}
        />
      )}
    </div>
  );
};

export default CrmLayout;

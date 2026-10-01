import { useState, useEffect, useRef, useMemo } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { NavLink, useNavigate, useLocation, Outlet } from "react-router-dom";
import {
  LayoutGrid, MessageSquare, Bot, FileText, Link2, BarChart3,
  ArrowLeft, Menu, X, CalendarDays, ChevronLeft, ChevronRight, RefreshCw,
  Home, Settings, ChevronDown, Send, Sun, Moon, Sparkles, Heart, Shield, LogOut,
  Activity, Phone, Users, Clock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useGestorEquipe } from "@/hooks/useGestorEquipe";
import { useTheme } from "@/hooks/useTheme";
import { CRCLIN_DEFAULT_LOGO } from "@/contexts/TenantContext";
import { useBrand, type SystemBrand, type TenantBrand } from "@/contexts/BrandContext";
import { SISTEMA_PADRAO } from "@/lib/brand/theme";
import { useModulos, podeMostrar } from "@/hooks/useModule";
import { useVocab, type Vocab } from "@/hooks/useVocab";
import { moduloDaRota, type ModuloKey } from "@/lib/modulos";
import { supabase } from "@/integrations/supabase/client";
import NotificationBell from "@/components/chat/NotificationBell";
import TaskReminderWatcher from "@/components/chat/TaskReminderWatcher";
import AvisoFimExpediente from "@/components/sdr/AvisoFimExpediente";
import EditProfileDialog from "@/components/EditProfileDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import crclinLogoLight from "@/assets/crclin-logo-light.png";

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
    return <img src={logo} alt={nome} className="h-7 max-w-full object-contain" onError={() => setFalhou(true)} />;
  }
  return (
    <div className="flex min-w-0 items-center gap-2" title={nome}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-brand text-xs font-bold text-primary-foreground">
        {iniciaisDe(nomeCurto)}
      </span>
      <span className="truncate text-sm font-semibold text-sidebar-foreground">{nomeCurto}</span>
    </div>
  );
}

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
          { to: "/crm/automacoes", icon: Bot, label: "Automações" },
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
  if (role === "posvenda") {
    items.push({ to: "/crm/posvenda", icon: Heart, label: "Pós-Venda" });
  }
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
    
    { to: "/crm/integracoes", icon: Link2, label: "Integrações" },
    { to: "/crm/relatorios", icon: BarChart3, label: "Relatórios" },
  );
  // Equipe (SDRs do rodízio): só para quem o servidor confirma como gestor
  // (is_gestor_equipe). Papel não basta — o usuário do Meta App Review é crc.
  // Grupo com as três telas do gestor: cadastro das SDRs, relatório do rodízio
  // e pesquisa de satisfação (cada página repete o gate por dentro).
  if (isGestorEquipe) {
    items.push({
      label: "Equipe",
      icon: Users,
      children: [
        { to: "/crm/equipe", icon: Users, label: "SDRs", end: true },
        { to: "/crm/equipe/relatorio-sdr", icon: BarChart3, label: "Relatório das SDRs" },
        { to: "/crm/equipe/ponto", icon: Clock, label: "Ponto e pausas" },
        { to: "/crm/equipe/pesquisa", icon: Heart, label: "Pesquisa de satisfação" },
      ],
    });
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
  const logo = escolherLogo(theme === "dark", marcaCliente, system, effective.poweredBy);
  const tagline = system.tagline?.trim() || null;
  // "Powered by" só faz sentido dentro de um cliente (sem cliente, a marca já é a do sistema).
  const mostrarPoweredBy = !!marcaCliente && effective.poweredBy;
  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };
  const initials = profile?.nome?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const [unreadCount, setUnreadCount] = useState(0);
  const [todayTaskCount, setTodayTaskCount] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["Automações", "Ferramentas", "Equipe"]));
  const unreadFetchSeq = useRef(0);
  const unreadRefreshTimer = useRef<number | null>(null);
  const crmNavItems = useMemo(
    () => filtrarPorModulo(buildCrmNavItems(userRole, isGestorEquipe, vocab), moduloLigado),
    [userRole, isGestorEquipe, vocab, moduloLigado],
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
    return () => {
      if (unreadRefreshTimer.current) window.clearTimeout(unreadRefreshTimer.current);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  useEffect(() => {
    const fetchTodayTasks = async () => {
      const today = toLocalDateISO();
      if (!user?.id) { setTodayTaskCount(0); return; }
      const { count } = await supabase
        .from("crm_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("assigned_to", user.id)
        .lte("due_date", `${today}T23:59:59`);
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
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          itemAtivo(item, isActive)
            ? "gradient-brand text-primary-foreground shadow-brand"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`
      }
    >
      <item.icon size={18} />
      {item.label}
      {"badgeKey" in item && item.badgeKey === "unread" && unreadCount > 0 && (
        <span
          title="Conversas não lidas (últimos 60 dias)"
          className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1"
        >
          {unreadCount > 999 ? "999+" : unreadCount}
        </span>
      )}
      {"badgeKey" in item && item.badgeKey === "tasks" && todayTaskCount > 0 && (
        <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
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
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <group.icon size={18} />
          {group.label}
          <ChevronDown size={14} className={`ml-auto transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
        </button>
        {isExpanded && (
          <div className="ml-4 space-y-0.5">
            {group.children.map(child => (
              <NavLink
                key={child.to}
                to={child.to}
                end={child.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "gradient-brand text-primary-foreground shadow-brand"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
    <div className="flex min-h-screen">
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
          className="hidden lg:flex fixed top-4 left-[248px] z-[51] h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground hover:text-primary transition-colors"
          title="Ocultar menu"
        >
          <ChevronLeft size={14} />
        </button>
      )}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="hidden lg:flex fixed top-4 left-3 z-[51] h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-primary transition-colors"
          title="Mostrar menu"
        >
          <ChevronRight size={14} />
        </button>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform ${
          sidebarCollapsed ? "-translate-x-full" : "lg:translate-x-0"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-3">
          <div className="flex flex-1 items-center justify-center">
            <MarcaDaBarra logo={logo} nome={effective.name} nomeCurto={effective.shortName} />
          </div>
          <button
            className="ml-auto text-sidebar-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-sidebar-border flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-primary tracking-wide">{effective.name}</h2>
            {tagline && <p className="truncate text-xs text-muted-foreground">{tagline}</p>}
          </div>
          {userRole !== "posvenda" && userRole !== "recepcao" && userRole !== "closer" && userRole !== "sdr" && (
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
              title="Voltar ao Sistema"
            >
              <ArrowLeft size={14} />
              Sistema
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
          {crmNavItems.map((entry) =>
            isGroup(entry) ? renderNavGroup(entry) : renderNavItem(entry)
          )}
        </nav>

        <div className="border-t border-sidebar-border p-4 space-y-1">
          {profile && (
            <button
              onClick={() => setEditProfileOpen(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 mb-1 hover:bg-sidebar-accent transition-colors group"
            >
              <Avatar className="h-9 w-9 border border-border">
                <AvatarImage src={profile.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{profile.nome}</p>
                <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
              </div>
              <Settings size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
          </button>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut size={18} />
            Sair
          </button>
          {mostrarPoweredBy && (
            <p className="px-3 pt-2 text-[10px] text-muted-foreground">Powered by {system.name}</p>
          )}
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col transition-all ${sidebarCollapsed ? "lg:pl-0" : "lg:pl-64"}`}>
        <header className="flex min-w-0 h-16 items-center gap-4 border-b border-border px-6">
          <button
            className="text-foreground lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <span className="hidden md:inline text-sm text-muted-foreground">
              {tagline ? `${effective.name} — ${tagline}` : effective.name}
            </span>
          </div>
        </header>

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden p-2 sm:p-4 lg:p-6">
          <TaskReminderWatcher />
          {/* Aviso de fim de expediente da SDR: vive AQUI, no layout, e não no
              cartão da home. O cartão só existe em /crm/sdr, e a SDR passa o dia
              em Conversas — o aviso não a alcançava e o expediente encerrava
              sozinho sem perguntar. Montado uma única vez; ele mesmo se cala
              para os outros papéis. */}
          <AvisoFimExpediente />
          <Outlet />
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

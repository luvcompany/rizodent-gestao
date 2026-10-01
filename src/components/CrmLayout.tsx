import { useState, useEffect, useRef } from "react";
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
import { useTenant, CRCLIN_DEFAULT_LOGO } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import NotificationBell from "@/components/chat/NotificationBell";
import TaskReminderWatcher from "@/components/chat/TaskReminderWatcher";
import AvisoFimExpediente from "@/components/sdr/AvisoFimExpediente";
import EditProfileDialog from "@/components/EditProfileDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import crclinLogoLight from "@/assets/crclin-logo-light.png";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

const buildCrmNavItems = (role: string | null, isGestorEquipe: boolean): SidebarEntry[] => {
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
      { to: "/crm/closer/pacientes", icon: Users, label: "Pacientes" },
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
  const { tenant } = useTenant();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const { theme, toggleTheme, setTheme } = useTheme();
  const isDefaultLogo = !tenant.logo_url || tenant.logo_url === CRCLIN_DEFAULT_LOGO;
  const logo = tenant.logo_dark_url || (isDefaultLogo ? crclinLogoLight : tenant.logo_url) || CRCLIN_DEFAULT_LOGO;
  const logoNeedsPlaque = !tenant.logo_dark_url;
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
  const crmNavItems = buildCrmNavItems(userRole, isGestorEquipe);

  useEffect(() => {
    document.body.classList.add("crm-ui-active");
    return () => document.body.classList.remove("crm-ui-active");
  }, []);

  useEffect(() => {
    const migrationKey = "crm-visual-light-default-v1";
    if (localStorage.getItem(migrationKey)) return;
    localStorage.setItem(migrationKey, "1");
    setTheme("light");
  }, [setTheme]);

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

  const renderNavItem = (item: NavItem) => {
    const link = (
      <NavLink
        key={item.to + (item.search ?? "")}
        to={item.to + (item.search ?? "")}
        end={item.end}
        onClick={() => setSidebarOpen(false)}
        aria-label={sidebarCollapsed ? item.label : undefined}
        className={({ isActive }) =>
          `relative flex h-10 items-center rounded-control text-sm font-medium transition-colors ${
            sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"
          } ${
            itemAtivo(item, isActive)
              ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-primary"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`
        }
      >
        <item.icon size={18} className="shrink-0" />
        <span className={sidebarCollapsed ? "hidden" : "truncate"}>{item.label}</span>
        {"badgeKey" in item && item.badgeKey === "unread" && unreadCount > 0 && (
          <span
            title="Conversas não lidas (últimos 60 dias)"
            className={`${sidebarCollapsed ? "absolute -right-1 -top-1 h-4 min-w-4 text-[9px]" : "ml-auto h-5 min-w-5 text-[10px]"} flex items-center justify-center rounded-full bg-primary px-1 font-bold text-primary-foreground`}
          >
            {unreadCount > 999 ? "999+" : unreadCount}
          </span>
        )}
        {"badgeKey" in item && item.badgeKey === "tasks" && todayTaskCount > 0 && (
          <span className={`${sidebarCollapsed ? "absolute -right-1 -top-1 h-4 min-w-4 text-[9px]" : "ml-auto h-5 min-w-5 text-[10px]"} flex items-center justify-center rounded-full bg-primary px-1 font-bold text-primary-foreground`}>
            {todayTaskCount > 99 ? "99+" : todayTaskCount}
          </span>
        )}
      </NavLink>
    );

    if (!sidebarCollapsed) return link;
    return (
      <Tooltip key={item.to + (item.search ?? "")}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  };

  const renderNavGroup = (group: NavGroup) => {
    const isExpanded = expandedGroups.has(group.label);
    return (
      <div key={group.label} className="border-t border-sidebar-border/70 pt-2 first:border-t-0 first:pt-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={() => sidebarCollapsed ? setSidebarCollapsed(false) : toggleGroup(group.label)}
              aria-label={sidebarCollapsed ? group.label : undefined}
              className={`h-10 w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${sidebarCollapsed ? "justify-center px-2" : "justify-start gap-3 px-3"}`}
            >
              <group.icon size={18} className="shrink-0" />
              <span className={sidebarCollapsed ? "hidden" : "truncate"}>{group.label}</span>
              {!sidebarCollapsed && <ChevronDown size={14} className={`ml-auto transition-transform ${isExpanded ? "" : "-rotate-90"}`} />}
            </Button>
          </TooltipTrigger>
          {sidebarCollapsed && <TooltipContent side="right">{group.label}</TooltipContent>}
        </Tooltip>
        {isExpanded && !sidebarCollapsed && (
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
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-primary"
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
    <div className="crm-ui flex min-h-screen w-full bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar shadow-float transition-[transform,width] duration-200 lg:translate-x-0 ${
          sidebarCollapsed ? "lg:w-16" : "lg:w-64"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex min-h-20 items-center gap-3 border-b border-sidebar-border px-3 py-3 ${sidebarCollapsed ? "lg:justify-center" : ""}`}>
          <div className={`flex min-w-0 flex-1 flex-col items-center gap-2 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
            <div className={`flex h-10 w-full items-center justify-center overflow-hidden rounded-control px-2 ${logoNeedsPlaque ? "bg-card" : ""}`}>
              <img src={logo} alt={tenant.name} className="max-h-8 max-w-full object-contain" />
            </div>
            <p className="w-full truncate text-center text-xs font-semibold text-sidebar-foreground">{tenant.name}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </Button>
          {sidebarCollapsed && (
            <div className={`hidden h-10 w-10 items-center justify-center overflow-hidden rounded-control p-1.5 lg:flex ${logoNeedsPlaque ? "bg-card" : ""}`}>
              <img src={logo} alt={tenant.name} className="max-h-full max-w-full object-contain" />
            </div>
          )}
        </div>

        <div className={`border-b border-sidebar-border px-4 py-3 ${sidebarCollapsed ? "lg:hidden" : "flex items-center justify-between gap-2"}`}>
          <div>
            <h2 className="text-sm font-bold text-primary tracking-wide">CRM</h2>
            <p className="text-xs text-muted-foreground">Gestão de Leads & Vendas</p>
          </div>
          {userRole !== "posvenda" && userRole !== "recepcao" && userRole !== "closer" && userRole !== "sdr" && (
            <Button
              variant="ghost"
              onClick={() => navigate("/dashboard")}
              className="h-8 gap-1 px-2 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title="Voltar ao Sistema"
            >
              <ArrowLeft size={14} />
              Sistema
            </Button>
          )}
        </div>

        <nav className={`flex-1 space-y-2 overflow-y-auto py-3 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          {crmNavItems.map((entry) =>
            isGroup(entry) ? renderNavGroup(entry) : renderNavItem(entry)
          )}
        </nav>

        <div className={`space-y-1 border-t border-sidebar-border py-3 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          {profile && (
            <Button
              variant="ghost"
              onClick={() => setEditProfileOpen(true)}
              className={`group mb-1 h-auto w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${sidebarCollapsed ? "justify-center px-1 py-2" : "justify-start gap-3 px-3 py-2"}`}
              aria-label={sidebarCollapsed ? "Editar perfil" : undefined}
            >
              <Avatar className="h-9 w-9 border border-border">
                <AvatarImage src={profile.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div className={`min-w-0 flex-1 text-left ${sidebarCollapsed ? "hidden" : ""}`}>
                <p className="text-sm font-medium text-sidebar-foreground truncate">{profile.nome}</p>
                <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
              </div>
              <Settings size={14} className={`${sidebarCollapsed ? "hidden" : ""} text-sidebar-foreground/60 opacity-0 transition-opacity group-hover:opacity-100`} />
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={toggleTheme}
            className={`w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${sidebarCollapsed ? "justify-center px-2" : "justify-start gap-3 px-3"}`}
            aria-label={theme === "dark" ? "Modo Claro" : "Modo Escuro"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {!sidebarCollapsed && (theme === "dark" ? "Modo Claro" : "Modo Escuro")}
          </Button>
          <Button
            variant="ghost"
            onClick={handleLogout}
            className={`w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${sidebarCollapsed ? "justify-center px-2" : "justify-start gap-3 px-3"}`}
            aria-label="Sair"
          >
            <LogOut size={18} />
            {!sidebarCollapsed && "Sair"}
          </Button>
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${sidebarCollapsed ? "lg:pl-16" : "lg:pl-64"}`}>
        <header className="flex h-16 min-w-0 shrink-0 items-center gap-3 border-b border-border/60 bg-card px-3 sm:px-5 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="text-foreground lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu size={22} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden text-muted-foreground hover:bg-primary-soft hover:text-primary-soft-foreground lg:inline-flex"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </Button>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <span className="hidden text-sm text-muted-foreground md:inline">CRM — Gestão de Leads</span>
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

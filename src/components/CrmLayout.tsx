import { useState, useEffect, useRef } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutGrid, MessageSquare, Bot, FileText, Link2, BarChart3,
  ArrowLeft, Menu, X, CalendarDays, ChevronLeft, ChevronRight, RefreshCw,
  Home, Settings, ChevronDown, Send, Sun, Moon, Sparkles, Heart, Shield, LogOut,
  Activity, Phone,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { useTenant, CRCLIN_DEFAULT_LOGO } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import NotificationBell from "@/components/chat/NotificationBell";
import TaskReminderWatcher from "@/components/chat/TaskReminderWatcher";
import EditProfileDialog from "@/components/EditProfileDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import crclinLogoLight from "@/assets/crclin-logo-light.png";

type NavItem = {
  to: string;
  icon: any;
  label: string;
  end?: boolean;
  badgeKey?: string;
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

const buildCrmNavItems = (role: string | null): SidebarEntry[] => {
  const items: SidebarEntry[] = [
    { to: "/crm/dashboard", icon: Home, label: "Dashboard" },
    { to: "/crm", icon: LayoutGrid, label: "Kanban", end: true },
    { to: "/crm/conversas", icon: MessageSquare, label: "Conversas", badgeKey: "unread" },
    { to: "/crm/calendario", icon: CalendarDays, label: "Calendário", badgeKey: "tasks" },
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
    
    { to: "/crm/ia-config", icon: Sparkles, label: "I.A" },
    { to: "/crm/configuracoes", icon: Settings, label: "Configurações" },
  );
  return items;
};

// (Instagram pipeline id agora é resolvido dinamicamente via crm_pipelines.is_instagram — fallback dentro de CrmConversas)

const CrmLayout = () => {
  const navigate = useNavigate();
  const { userRole, signOut, profile, user, refreshProfile } = useAuth();
  const { tenant } = useTenant();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const isDefaultLogo = !tenant.logo_url || tenant.logo_url === CRCLIN_DEFAULT_LOGO;
  const logo = isDefaultLogo
    ? (theme === "light" ? crclinLogoLight : CRCLIN_DEFAULT_LOGO)
    : tenant.logo_url!;
  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };
  const initials = profile?.nome?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const [unreadCount, setUnreadCount] = useState(0);
  const [todayTaskCount, setTodayTaskCount] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["Automações"]));
  const unreadFetchSeq = useRef(0);
  const unreadRefreshTimer = useRef<number | null>(null);
  const crmNavItems = buildCrmNavItems(userRole);

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
      if (unreadRefreshTimer.current) window.clearTimeout(unreadRefreshTimer.current);
      unreadRefreshTimer.current = window.setTimeout(fetchUnread, 600);
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
      const { count } = await supabase
        .from("crm_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("due_date", `${today}T23:59:59`);
      setTodayTaskCount(count || 0);
    };
    fetchTodayTasks();
    const ch = supabase.channel("task-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_tasks" }, fetchTodayTasks)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const renderNavItem = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={() => setSidebarOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive
            ? "gradient-orange text-primary-foreground shadow-orange"
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
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "gradient-orange text-primary-foreground shadow-orange"
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
            <img src={logo} alt={tenant.name} className="h-7 max-w-full object-contain" />
          </div>
          <button
            className="ml-auto text-sidebar-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-sidebar-border flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-primary tracking-wide">CRM</h2>
            <p className="text-xs text-muted-foreground">Gestão de Leads & Vendas</p>
          </div>
          {userRole !== "posvenda" && (
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
            <span className="hidden md:inline text-sm text-muted-foreground">CRM — Gestão de Leads</span>
          </div>
        </header>

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden p-2 sm:p-4 lg:p-6">
          <TaskReminderWatcher />
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

import { useState, useEffect, useRef } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutGrid, MessageSquare, Bot, FileText, Link2, BarChart3,
  ArrowLeft, Menu, X, CalendarDays, ChevronLeft, ChevronRight, RefreshCw,
  Home, Settings, ChevronDown, Send, Sun, Moon, Sparkles, Heart, Shield, LogOut,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { useTenant, CRCLIN_DEFAULT_LOGO } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import NotificationBell from "@/components/chat/NotificationBell";
import TaskReminderWatcher from "@/components/chat/TaskReminderWatcher";
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
    { to: "/crm/followups", icon: RefreshCw, label: "Follow Ups" },
    { to: "/crm/integracoes", icon: Link2, label: "Integrações" },
    { to: "/crm/relatorios", icon: BarChart3, label: "Relatórios" },
    { to: "/crm/ia-config", icon: Sparkles, label: "I.A" },
  );
  if (role === "superadmin") {
    items.push({ to: "/crm/usuarios", icon: Shield, label: "Usuários" });
  }
  items.push({ to: "/crm/configuracoes", icon: Settings, label: "Configurações" });
  return items;
};

const INSTAGRAM_PIPELINE_ID = "c2d3e4f5-0001-4000-8000-000000000002";

const CrmLayout = () => {
  const navigate = useNavigate();
  const { userRole, signOut } = useAuth();
  const { tenant } = useTenant();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const isDefaultLogo = !tenant.logo_url || tenant.logo_url === CRCLIN_DEFAULT_LOGO;
  const logo = isDefaultLogo
    ? (theme === "light" ? crclinLogoLight : CRCLIN_DEFAULT_LOGO)
    : tenant.logo_url!;
  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };
  const [unreadCount, setUnreadCount] = useState(0);
  const [todayTaskCount, setTodayTaskCount] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["Automações"]));
  const unreadFetchSeq = useRef(0);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || seq !== unreadFetchSeq.current) return;
      const PAGE_SIZE = 1000;
      let unreadTotal = 0;
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: unreadCandidates, error } = await supabase
          .from("crm_leads")
          .select("id, last_inbound_at, last_outbound_at")
          .eq("is_blocked", false)
          .neq("pipeline_id", INSTAGRAM_PIPELINE_ID)
          .not("last_inbound_at", "is", null)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (seq !== unreadFetchSeq.current || error || !unreadCandidates?.length) break;
        unreadTotal += unreadCandidates.filter(
          (l: any) => !l.last_outbound_at || new Date(l.last_inbound_at) > new Date(l.last_outbound_at)
        ).length;
        if (unreadCandidates.length < PAGE_SIZE) break;
      }
      if (seq === unreadFetchSeq.current) {
        setUnreadCount(unreadTotal);
      }
    };
    fetchUnread();
    const ch = supabase.channel("unread-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, fetchUnread)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

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
        <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
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
            <span className="text-sm text-muted-foreground">CRM — Gestão de Leads</span>
          </div>
        </header>

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden p-6">
          <TaskReminderWatcher />
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default CrmLayout;

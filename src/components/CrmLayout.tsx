import { useState, useEffect } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutGrid, MessageSquare, Bot, FileText, Link2, BarChart3,
  ArrowLeft, Menu, X, CalendarDays, ChevronLeft, ChevronRight, RefreshCw,
  Home, Settings, ChevronDown, Send, Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/integrations/supabase/client";
import NotificationBell from "@/components/chat/NotificationBell";
import TaskReminderWatcher from "@/components/chat/TaskReminderWatcher";

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

const crmNavItems: SidebarEntry[] = [
  { to: "/crm/dashboard", icon: Home, label: "Dashboard" },
  { to: "/crm", icon: LayoutGrid, label: "Kanban", end: true },
  { to: "/crm/conversas", icon: MessageSquare, label: "Conversas", badgeKey: "unread" },
  { to: "/crm/calendario", icon: CalendarDays, label: "Calendário", badgeKey: "tasks" },
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
  { to: "/crm/configuracoes", icon: Settings, label: "Configurações" },
];

const CrmLayout = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);
  const [todayTaskCount, setTodayTaskCount] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["Automações"]));

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const PAGE_SIZE = 1000;
      // No outbound yet → unread
      const { count: noReplyCount } = await supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("is_blocked", false)
        .not("last_inbound_at", "is", null)
        .is("last_outbound_at", null);
      // Has outbound but inbound is newer → unread.
      // PostgREST caps responses at 1000 rows, so page through all candidates.
      let newerInboundCount = 0;
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: bothData, error } = await supabase
          .from("crm_leads")
          .select("id, last_inbound_at, last_outbound_at")
          .eq("is_blocked", false)
          .not("last_inbound_at", "is", null)
          .not("last_outbound_at", "is", null)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error || !bothData?.length) break;
        newerInboundCount += bothData.filter(
          (l: any) => new Date(l.last_inbound_at) > new Date(l.last_outbound_at)
        ).length;
        if (bothData.length < PAGE_SIZE) break;
      }
      setUnreadCount((noReplyCount || 0) + newerInboundCount);
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
          {unreadCount > 99 ? "99+" : unreadCount}
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
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-sm font-medium text-sidebar-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft size={16} />
            Voltar ao Sistema
          </button>
          <button
            className="ml-auto text-sidebar-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-sidebar-border">
          <h2 className="text-sm font-bold text-primary tracking-wide">CRM</h2>
          <p className="text-xs text-muted-foreground">Gestão de Leads & Vendas</p>
        </div>

        <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
          {crmNavItems.map((entry) =>
            isGroup(entry) ? renderNavGroup(entry) : renderNavItem(entry)
          )}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
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

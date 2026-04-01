import { useState, useEffect } from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutGrid, MessageSquare, Bot, FileText, Link2, BarChart3,
  ArrowLeft, Menu, X, CalendarDays, ChevronLeft, ChevronRight, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const crmNavItems = [
  { to: "/crm", icon: LayoutGrid, label: "Kanban", end: true },
  { to: "/crm/conversas", icon: MessageSquare, label: "Conversas", badgeKey: "unread" },
  { to: "/crm/calendario", icon: CalendarDays, label: "Calendário" },
  
  { to: "/crm/followups", icon: RefreshCw, label: "Follow Ups" },
  { to: "/crm/automacoes", icon: Bot, label: "Automações" },
  { to: "/crm/modelos", icon: FileText, label: "Modelos" },
  { to: "/crm/integracoes", icon: Link2, label: "Integrações" },
  { to: "/crm/relatorios", icon: BarChart3, label: "Relatórios" },
];

const CrmLayout = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = async () => {
      // PostgREST .or() can't compare two columns, so we fetch both timestamps
      // and count client-side
      const { data } = await supabase
        .from("crm_leads")
        .select("last_inbound_at, last_outbound_at")
        .not("last_inbound_at", "is", null);
      const count = (data || []).filter((l) => {
        if (!l.last_outbound_at) return true;
        return new Date(l.last_inbound_at!) > new Date(l.last_outbound_at);
      }).length;
      setUnreadCount(count);
    };
    fetchUnread();
    const ch = supabase.channel("unread-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, fetchUnread)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

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

        <nav className="flex-1 space-y-1 p-4">
          {crmNavItems.map((item) => (
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
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col transition-all ${sidebarCollapsed ? "lg:pl-0" : "lg:pl-64"}`}>
        <header className="flex min-w-0 h-16 items-center gap-4 border-b border-border px-6">
          <button
            className="text-foreground lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="ml-auto text-sm text-muted-foreground">
            CRM — Gestão de Leads
          </div>
        </header>

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default CrmLayout;

import { useState } from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutDashboard, UserPlus, Users, FileBarChart, Megaphone, LogOut, Menu, X, TrendingUp, Shield, Stethoscope, Settings, ClipboardList, Sun, Moon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import EditProfileDialog from "@/components/EditProfileDialog";
import { useTheme } from "@/hooks/useTheme";
import { useTenant, CRCLIN_DEFAULT_LOGO } from "@/contexts/TenantContext";
import crclinLogoLight from "@/assets/crclin-logo-light.png";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/atendimento", icon: UserPlus, label: "Atendimento" },
  { to: "/pacientes", icon: Users, label: "Pacientes" },
  { to: "/relatorios", icon: FileBarChart, label: "Relatórios" },
  { to: "/marketing", icon: Megaphone, label: "Marketing" },
  { to: "/crm", icon: Users, label: "CRM" },
  { to: "/procedimentos", icon: Stethoscope, label: "Procedimentos" },
  { to: "/usuarios", icon: Shield, label: "Usuários" },
  { to: "/configuracoes", icon: Settings, label: "Configurações" },
];

const AppLayout = () => {
  const navigate = useNavigate();
  const { signOut, profile, user, refreshProfile } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { tenant } = useTenant();
  const isDefaultLogo = !tenant.logo_url || tenant.logo_url === CRCLIN_DEFAULT_LOGO;
  const logo = isDefaultLogo
    ? (theme === "light" ? crclinLogoLight : CRCLIN_DEFAULT_LOGO)
    : tenant.logo_url!;
  

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const initials = profile?.nome?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-sidebar-border px-3">
          <div className="flex-1 rounded-2xl bg-[#0b1226] p-2 shadow-lg shadow-black/30 ring-1 ring-white/5 transition-transform hover:scale-[1.02]">
            <img src={logo} alt={tenant.name} className="h-12 w-full object-contain" />
          </div>
          <button
            className="ml-auto text-sidebar-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          {profile && (
            <button
              onClick={() => setEditProfileOpen(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 mb-2 hover:bg-sidebar-accent transition-colors group"
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

      <div className="flex flex-1 flex-col lg:ml-64">
        <header className="flex h-16 items-center gap-4 border-b border-border px-6">
          <button
            className="text-foreground lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="ml-auto text-sm text-muted-foreground">
            {tenant.name} — Sistema de Gestão
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Self-edit profile dialog */}
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

export default AppLayout;

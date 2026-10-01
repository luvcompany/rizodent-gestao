import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutDashboard, UserPlus, Users, FileBarChart, Megaphone, LogOut, Menu, X, TrendingUp, Shield, Stethoscope, Settings, ClipboardList, Sun, Moon, ScrollText,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import EditProfileDialog from "@/components/EditProfileDialog";
import { useTheme } from "@/hooks/useTheme";
import { CRCLIN_DEFAULT_LOGO } from "@/contexts/TenantContext";
import { useBrand, type SystemBrand, type TenantBrand } from "@/contexts/BrandContext";
import { SISTEMA_PADRAO } from "@/lib/brand/theme";
import { useModulos, podeMostrar } from "@/hooks/useModule";
import { useVocab, type Vocab } from "@/hooks/useVocab";
import { moduloDaRota } from "@/lib/modulos";
import crclinLogoLight from "@/assets/crclin-logo-light.png";

type ItemDoMenu = { to: string; icon: any; label: string; roles?: string[] };

// Rótulos de pessoa e serviço vêm do vocabulário do segmento do cliente.
const montarItens = (vocab: Vocab): ItemDoMenu[] => [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/atendimento", icon: UserPlus, label: "Atendimento" },
  { to: "/pacientes", icon: Users, label: vocab.pessoaPlural },
  { to: "/relatorios", icon: FileBarChart, label: "Relatórios" },
  { to: "/marketing", icon: Megaphone, label: "Marketing" },
  { to: "/crm", icon: Users, label: "CRM" },
  { to: "/procedimentos", icon: Stethoscope, label: vocab.servicoPlural },
  { to: "/acessos", icon: ScrollText, label: "Logs de acesso", roles: ["crc", "gerente", "superadmin"] },
  { to: "/configuracoes", icon: Settings, label: "Configurações" },
];

/**
 * Logo da barra lateral (mesma regra do CrmLayout):
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

const AppLayout = () => {
  const navigate = useNavigate();
  const { signOut, profile, user, refreshProfile, userRole } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { system, tenant: marcaCliente, effective } = useBrand();
  const { ligado: moduloLigado } = useModulos();
  const vocab = useVocab();
  const logo = escolherLogo(theme === "dark", marcaCliente, system, effective.poweredBy);
  const tagline = system.tagline?.trim() || null;
  const mostrarPoweredBy = !!marcaCliente && effective.poweredBy;

  // Filtra por papel e por módulo. Módulo só esconde o item quando resolveu
  // DESLIGADO (false); enquanto a config carrega, o item aparece.
  const itensVisiveis = useMemo(
    () =>
      montarItens(vocab).filter((item) => {
        if (item.roles && !(userRole && item.roles.includes(userRole))) return false;
        const modulo = moduloDaRota(item.to);
        return !modulo || podeMostrar(moduloLigado(modulo));
      }),
    [vocab, userRole, moduloLigado],
  );

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

        <nav className="flex-1 space-y-1 p-4">
          {itensVisiveis.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "gradient-brand text-primary-foreground shadow-brand"
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
          {mostrarPoweredBy && (
            <p className="px-3 pt-2 text-[10px] text-muted-foreground">Powered by {system.name}</p>
          )}
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
            {tagline ? `${effective.name} — ${tagline}` : effective.name}
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

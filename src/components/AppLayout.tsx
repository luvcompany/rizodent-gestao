import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useLocation, Outlet } from "react-router-dom";
import {
  LayoutDashboard, UserPlus, Users, FileBarChart, LogOut, Menu, X, TrendingUp, Shield, Stethoscope, Settings, ClipboardList, Sun, Moon, ScrollText,
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
import ErrorBoundary from "@/components/ErrorBoundary";
import NotificationBell from "@/components/chat/NotificationBell";
import TaskReminderWatcher from "@/components/chat/TaskReminderWatcher";
import { usePageTitle } from "@/hooks/usePageTitle";
import { tituloDaAba } from "@/lib/tituloDaAba";

type ItemDoMenu = { to: string; icon: any; label: string; roles?: string[] };

// Rótulos de pessoa e serviço vêm do vocabulário do segmento do cliente.
const montarItens = (vocab: Vocab): ItemDoMenu[] => [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/atendimento", icon: UserPlus, label: "Atendimento" },
  { to: "/pacientes", icon: Users, label: vocab.pessoaPlural },
  { to: "/relatorios", icon: FileBarChart, label: "Relatórios" },
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
function MarcaDaBarra({ logo, nome, nomeCurto, naPlaca }: { logo: string | null; nome: string; nomeCurto: string; naPlaca: boolean }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [logo]);
  if (logo && !falhou) {
    return (
      <span className={naPlaca ? "inline-flex max-w-full rounded-lg bg-white/95 px-2 py-1" : "inline-flex max-w-full"}>
        <img
          src={logo}
          alt={nome}
          className={
            logo === CRCLIN_DEFAULT_LOGO
              ? "h-8 w-[125px] max-w-full object-cover object-[50%_42%]"
              : naPlaca
                ? "h-6 max-w-full object-contain object-left"
                : "h-8 max-w-full object-contain object-left"
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

const AppLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, profile, user, refreshProfile, userRole } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { system, tenant: marcaCliente, effective } = useBrand();
  const { ligado: moduloLigado } = useModulos();
  const vocab = useVocab();
  // A barra lateral é escura nos dois temas: a logo é sempre a do fundo escuro
  // (logo escura → logo clara numa placa → lockup de iniciais).
  const logo = escolherLogo(true, marcaCliente, system, effective.poweredBy);
  const logoNaPlaca =
    !!logo &&
    logo !== CRCLIN_DEFAULT_LOGO &&
    logo !== (marcaCliente?.logo_dark_url?.trim() || null) &&
    logo !== (system.logo_dark_url?.trim() || null);
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
  usePageTitle(tituloDaAba(location.pathname, location.search, itensVisiveis));


  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const initials = profile?.nome?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";

  return (
    <div className="crm-shell flex min-h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform crm-sidebar-aberta lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <div className="flex min-w-0 flex-1 items-center justify-start">
            <MarcaDaBarra logo={logo} nome={effective.name} nomeCurto={effective.shortName} naPlaca={logoNaPlaca} />
          </div>
          <button
            className="ml-auto -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-white lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {itensVisiveis.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex h-10 items-center gap-3 rounded-control px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50 ${
                  item.to === (itensVisiveis.some((i) => i.to === "/acessos") ? "/acessos" : "/configuracoes")
                    ? "relative !mt-7 before:pointer-events-none before:absolute before:-top-[15px] before:left-3 before:right-3 before:border-t before:border-sidebar-border"
                    : ""
                } ${
                  isActive
                    ? "bg-sidebar-active font-semibold text-sidebar-active-foreground"
                    : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
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

      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <header className="flex h-16 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur lg:px-6">
          <button
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-control text-foreground transition-colors hover:bg-muted lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="shrink-0">
              <NotificationBell />
            </div>
            <div className="min-w-0 truncate border-l border-border/60 pl-3 text-sm font-medium text-foreground">
              {tagline ? `${effective.name} — ${tagline}` : effective.name}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-background p-3 sm:p-4 lg:p-6">
          <TaskReminderWatcher />
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
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

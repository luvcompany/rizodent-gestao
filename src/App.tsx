import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TenantProvider, useTenant } from "@/contexts/TenantContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import CrmLayout from "./components/CrmLayout";

type PreloadableComponent<T extends ComponentType<any> = ComponentType<any>> = LazyExoticComponent<T> & {
  preload: () => Promise<unknown>;
};

const lazyWithPreload = <T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) => {
  const Component = lazy(loader) as PreloadableComponent<T>;
  Component.preload = loader;
  return Component;
};

const TenantLogin = lazyWithPreload(() => import("./pages/TenantLogin"));
const Dashboard = lazyWithPreload(() => import("./pages/Dashboard"));
const Atendimento = lazyWithPreload(() => import("./pages/Atendimento"));
const Pacientes = lazyWithPreload(() => import("./pages/Pacientes"));
const PacienteDetalhe = lazyWithPreload(() => import("./pages/PacienteDetalhe"));
const Relatorios = lazyWithPreload(() => import("./pages/Relatorios"));
const Marketing = lazyWithPreload(() => import("./pages/Marketing"));
const CadastroLeads = lazyWithPreload(() => import("./pages/CadastroLeads"));
const Usuarios = lazyWithPreload(() => import("./pages/Usuarios"));
const AcessosLog = lazyWithPreload(() => import("./pages/AcessosLog"));
const TiposProcedimento = lazyWithPreload(() => import("./pages/TiposProcedimento"));
const RegistroDiario = lazyWithPreload(() => import("./pages/RegistroDiario"));
const Configuracoes = lazyWithPreload(() => import("./pages/Configuracoes"));
const CrmKanban = lazyWithPreload(() => import("./pages/CrmKanban"));
const CrmAutomacoes = lazyWithPreload(() => import("./pages/CrmAutomacoes"));
const CrmModelos = lazyWithPreload(() => import("./pages/CrmModelos"));
const CrmConversa = lazyWithPreload(() => import("./pages/CrmConversa"));
const CrmIntegracoes = lazyWithPreload(() => import("./pages/CrmIntegracoes"));
const CrmRelatorios = lazyWithPreload(() => import("./pages/CrmRelatorios"));
const CrmConversas = lazyWithPreload(() => import("./pages/CrmConversas"));
const CrmCalendario = lazyWithPreload(() => import("./pages/CrmCalendario"));

const CrmBots = lazyWithPreload(() => import("./pages/CrmBots"));
const CrmBotEditor = lazyWithPreload(() => import("./pages/CrmBotEditor"));
const CrmDashboard = lazyWithPreload(() => import("./pages/CrmDashboard"));
const CrmPosVendaDashboard = lazyWithPreload(() => import("./pages/CrmPosVendaDashboard"));
const CrmExtras = lazyWithPreload(() => import("./pages/CrmExtras"));
const CrmConfiguracoes = lazyWithPreload(() => import("./pages/CrmConfiguracoes"));
const CrmRespostasRapidas = lazyWithPreload(() => import("./pages/CrmRespostasRapidas"));
const CrmCampanhas = lazyWithPreload(() => import("./pages/CrmCampanhas"));
const CrmIaConfig = lazyWithPreload(() => import("./pages/CrmIaConfig"));
const CrmMetricas = lazyWithPreload(() => import("./pages/CrmMetricas"));
const CrclinLanding = lazyWithPreload(() => import("./pages/CrclinLanding"));
const ChangePassword = lazyWithPreload(() => import("./pages/ChangePassword"));
const AdminLayout = lazyWithPreload(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminLayout })));
const AdminClientes = lazyWithPreload(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminClientes })));
const AdminPlanos = lazyWithPreload(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminPlanos })));
const AdminMetricas = lazyWithPreload(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminMetricas })));
const AdminCobranca = lazyWithPreload(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminCobranca })));
const AdminClienteDetalhe = lazyWithPreload(() => import("./pages/admin/AdminClienteDetalhe"));
const AdminLogs = lazyWithPreload(() => import("./pages/admin/AdminLogs"));
const AdminLogin = lazyWithPreload(() => import("./pages/admin/AdminLogin"));
const NotFound = lazyWithPreload(() => import("./pages/NotFound"));
const OAuthConsent = lazyWithPreload(() => import("./pages/OAuthConsent"));
const Privacidade = lazyWithPreload(() => import("./pages/legal/Privacidade"));
const Termos = lazyWithPreload(() => import("./pages/legal/Termos"));
const ExclusaoDados = lazyWithPreload(() => import("./pages/legal/ExclusaoDados"));
const OAuthClose = lazyWithPreload(() => import("./pages/OAuthClose"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30s: navegar para tela já visitada não refaz fetch
      gcTime: 5 * 60_000,       // 5min: mantém em memória mesmo sem componentes ativos
      refetchOnWindowFocus: false, // evita re-fetch quando o usuário troca de aba do browser
      retry: 1,
    },
  },
});

const PageLoader = () => <div className="min-h-screen bg-background" />;
const RouteLoader = () => <div className="min-h-full bg-background" />;
const withRouteSuspense = (node: ReactNode) => (
  <Suspense fallback={<RouteLoader />}>{node}</Suspense>
);

const preloadTenantRoutes = () => {
  const preloadPrimary = () => {
    [
      Dashboard,
    ].forEach((component) => component.preload().catch(() => undefined));
  };
  const preloadSecondary = () => {
    [
      Atendimento,
      CrmDashboard,
      CrmKanban,
      CrmConversas,
      CrmCalendario,
      CrmConversa,
    ].forEach((component) => component.preload().catch(() => undefined));
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preloadPrimary, { timeout: 1_200 });
    window.setTimeout(() => window.requestIdleCallback(preloadSecondary, { timeout: 12_000 }), 8_000);
  } else {
    globalThis.setTimeout(preloadPrimary, 700);
    globalThis.setTimeout(preloadSecondary, 9_000);
  }
};

/** Após o login, dispara em background a primeira carga das telas.
 *  Estratégia em ondas para NÃO competir com o fetch nativo do Dashboard
 *  (que monta na tela logo após o login):
 *   1) Conversas em paralelo com o Dashboard nativo (tela já em render);
 *   2) Após Conversas terminar, prefetch das demais telas secundárias.
 *  O Dashboard NÃO entra como prefetch porque é a primeira rota — seu próprio
 *  fetchAll já está rodando e duplicar a query só satura conexões. */
const DataPrefetcher = () => {
  const { user, userRole, loading: authLoading } = useAuth();
  const { tenant } = useTenant();
  useEffect(() => {
    if (authLoading) return;
    if (!user?.id || !tenant?.id) return;
    let cancelled = false;
    const run = async () => {
      // Onda 1: Conversas (provável próxima navegação após Dashboard), mas só
      // depois do primeiro render do Dashboard para não competir com ele.
      try {
        const { prefetchConversasData } = await import("./pages/CrmConversas");
        if (!cancelled) await prefetchConversasData(tenant.id, user.id);
      } catch {}
      if (cancelled) return;
      // Onda 2: telas secundárias, em paralelo entre si mas DEPOIS do Dashboard
      // inicial já ter terminado de carregar.
      const [dashboard, crmDashboard, calendario, posVenda] = await Promise.all([
        import("./pages/Dashboard"),
        import("./pages/CrmDashboard"),
        import("./pages/CrmCalendario"),
        import("./pages/CrmPosVendaDashboard"),
      ]);
      if (cancelled) return;
      dashboard.prefetchDashboardData().catch(() => undefined);
      crmDashboard.prefetchCrmDashboardData(user.id, userRole).catch(() => undefined);
      calendario.prefetchCrmCalendarioData(user.id).catch(() => undefined);
      posVenda.prefetchPosVendaData(user.id, userRole).catch(() => undefined);
    };
    // Espera o Dashboard inicial liberar a thread/conexões antes de começar.
    const schedule = () => {
      if ("requestIdleCallback" in window) {
        (window as any).requestIdleCallback(run, { timeout: 8_000 });
      } else {
        globalThis.setTimeout(run, 5_000);
      }
    };
    const t = globalThis.setTimeout(schedule, 8_000);
    return () => { cancelled = true; globalThis.clearTimeout(t); };
  }, [authLoading, user?.id, tenant?.id, userRole]);
  return null;
};

const Providers = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {children}
    </TooltipProvider>
  </QueryClientProvider>
);

/** Public shell — landing + admin panel. No tenant context required. */
export const PublicApp = ({ basename }: { basename: string }) => (
  <Providers>
    <BrowserRouter basename={basename}>
      <TenantProvider slugOverride={null}>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<CrclinLanding />} />
            <Route path="/privacidade" element={<Privacidade />} />
            <Route path="/termos" element={<Termos />} />
            <Route path="/exclusao-de-dados" element={<ExclusaoDados />} />
            <Route path="/oauth-close" element={<OAuthClose />} />
            <Route path="/.lovable/oauth/consent" element={withRouteSuspense(<OAuthConsent />)} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<AdminClientes />} />
              <Route path="/admin/clientes/:id" element={<AdminClienteDetalhe />} />
              <Route path="/admin/planos" element={<AdminPlanos />} />
              <Route path="/admin/metricas" element={<AdminMetricas />} />
              <Route path="/admin/cobranca" element={<AdminCobranca />} />
              <Route path="/admin/logs" element={<AdminLogs />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </TenantProvider>
    </BrowserRouter>
  </Providers>
);

/** Tenant shell — client login + full app. Slug-bound. */
export const TenantApp = ({ slug, basename }: { slug: string; basename: string }) => {
  useEffect(() => {
    preloadTenantRoutes();
  }, []);

  return (
  <Providers>
    <BrowserRouter basename={basename}>
      <TenantProvider slugOverride={slug}>
        <AuthProvider>
          <DataPrefetcher />
          <Routes>
            <Route path="/" element={withRouteSuspense(<TenantLogin />)} />
            <Route path="/oauth-close" element={withRouteSuspense(<OAuthClose />)} />
            <Route path="/.lovable/oauth/consent" element={withRouteSuspense(<OAuthConsent />)} />
            <Route path="/change-password" element={<ProtectedRoute>{withRouteSuspense(<ChangePassword />)}</ProtectedRoute>} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={withRouteSuspense(<Dashboard />)} />
              <Route path="/atendimento" element={withRouteSuspense(<Atendimento />)} />
              <Route path="/pacientes" element={withRouteSuspense(<Pacientes />)} />
              <Route path="/pacientes/:id" element={withRouteSuspense(<PacienteDetalhe />)} />
              <Route path="/relatorios" element={withRouteSuspense(<Relatorios />)} />
              <Route path="/marketing" element={withRouteSuspense(<Marketing />)} />
              <Route path="/leads" element={withRouteSuspense(<CadastroLeads />)} />
              <Route path="/usuarios" element={withRouteSuspense(<Usuarios />)} />
              <Route path="/acessos" element={withRouteSuspense(<AcessosLog />)} />
              <Route path="/procedimentos" element={withRouteSuspense(<TiposProcedimento />)} />
              <Route path="/registro-diario" element={withRouteSuspense(<RegistroDiario />)} />
              <Route path="/configuracoes" element={withRouteSuspense(<Configuracoes />)} />
            </Route>
            <Route
              element={
                <ProtectedRoute>
                  <CrmLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/crm" element={withRouteSuspense(<CrmKanban />)} />
              <Route path="/crm/dashboard" element={withRouteSuspense(<CrmDashboard />)} />
              <Route path="/crm/posvenda" element={withRouteSuspense(<CrmPosVendaDashboard />)} />
              <Route path="/crm/conversas" element={withRouteSuspense(<CrmConversas />)} />
              <Route path="/crm/conversa/:id" element={withRouteSuspense(<CrmConversa />)} />
              <Route path="/crm/automacoes" element={withRouteSuspense(<CrmAutomacoes />)} />
              <Route path="/crm/modelos" element={withRouteSuspense(<CrmModelos />)} />
              <Route path="/crm/integracoes" element={withRouteSuspense(<CrmIntegracoes />)} />
              <Route path="/crm/relatorios" element={withRouteSuspense(<CrmRelatorios />)} />
              <Route path="/crm/calendario" element={withRouteSuspense(<CrmCalendario />)} />
              
              <Route path="/crm/bots" element={withRouteSuspense(<CrmBots />)} />
              <Route path="/crm/bots/:id" element={withRouteSuspense(<CrmBotEditor />)} />
              <Route path="/crm/extras" element={withRouteSuspense(<CrmExtras />)} />
              <Route path="/crm/configuracoes" element={withRouteSuspense(<CrmConfiguracoes />)} />
              <Route path="/crm/respostas-rapidas" element={withRouteSuspense(<CrmRespostasRapidas />)} />
              <Route path="/crm/campanhas" element={withRouteSuspense(<CrmCampanhas />)} />
              <Route path="/crm/ia-config" element={withRouteSuspense(<CrmIaConfig />)} />
              <Route path="/crm/metricas" element={withRouteSuspense(<CrmMetricas />)} />
              <Route path="/crm/usuarios" element={withRouteSuspense(<Usuarios />)} />
            </Route>
            <Route path="*" element={withRouteSuspense(<NotFound />)} />
          </Routes>
        </AuthProvider>
      </TenantProvider>
    </BrowserRouter>
  </Providers>
  );
};

export default PublicApp;

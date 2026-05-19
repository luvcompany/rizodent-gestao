import { Suspense, lazy, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import CrmLayout from "./components/CrmLayout";

// Eager-load CRM core pages and the tenant login so tab switches inside the CRM
// are instantaneous (no white screen / no Suspense fallback flash).
import TenantLogin from "./pages/TenantLogin";
import CrmKanban from "./pages/CrmKanban";
import CrmConversas from "./pages/CrmConversas";
import CrmConversa from "./pages/CrmConversa";
import CrmDashboard from "./pages/CrmDashboard";
import CrmCalendario from "./pages/CrmCalendario";
import CrmFollowUps from "./pages/CrmFollowUps";
import CrmRelatorios from "./pages/CrmRelatorios";
import CrmConfiguracoes from "./pages/CrmConfiguracoes";
import CrmPosVendaDashboard from "./pages/CrmPosVendaDashboard";
import CrmModelos from "./pages/CrmModelos";
import CrmRespostasRapidas from "./pages/CrmRespostasRapidas";
import CrmIntegracoes from "./pages/CrmIntegracoes";

// Eager-load main app (Dashboard) pages too — same reasoning as CRM pages: avoids
// the white Suspense flash when switching tabs.
import Dashboard from "./pages/Dashboard";
import Atendimento from "./pages/Atendimento";
import Pacientes from "./pages/Pacientes";
import PacienteDetalhe from "./pages/PacienteDetalhe";
import Relatorios from "./pages/Relatorios";
import Marketing from "./pages/Marketing";
import CadastroLeads from "./pages/CadastroLeads";
import Usuarios from "./pages/Usuarios";
import TiposProcedimento from "./pages/TiposProcedimento";
import RegistroDiario from "./pages/RegistroDiario";
import Configuracoes from "./pages/Configuracoes";
import CrmAutomacoes from "./pages/CrmAutomacoes";
import CrmBots from "./pages/CrmBots";
import CrmExtras from "./pages/CrmExtras";
import CrmCampanhas from "./pages/CrmCampanhas";
import CrmIaConfig from "./pages/CrmIaConfig";

// Keep lazy loading only for heavier / less-frequent screens.
const CrmBotEditor = lazy(() => import("./pages/CrmBotEditor"));
const CrclinLanding = lazy(() => import("./pages/CrclinLanding"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const AdminLayout = lazy(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminLayout })));
const AdminClientes = lazy(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminClientes })));
const AdminPlanos = lazy(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminPlanos })));
const AdminMetricas = lazy(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminMetricas })));
const AdminCobranca = lazy(() => import("./pages/admin/AdminPanel").then((m) => ({ default: m.AdminCobranca })));
const AdminClienteDetalhe = lazy(() => import("./pages/admin/AdminClienteDetalhe"));
const AdminLogs = lazy(() => import("./pages/admin/AdminLogs"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const NotFound = lazy(() => import("./pages/NotFound"));

const RouteFallback = () => null;

const queryClient = new QueryClient();

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
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<CrclinLanding />} />
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
export const TenantApp = ({ slug, basename }: { slug: string; basename: string }) => (
  <Providers>
    <BrowserRouter basename={basename}>
      <TenantProvider slugOverride={slug}>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<TenantLogin />} />
              <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/atendimento" element={<Atendimento />} />
                <Route path="/pacientes" element={<Pacientes />} />
                <Route path="/pacientes/:id" element={<PacienteDetalhe />} />
                <Route path="/relatorios" element={<Relatorios />} />
                <Route path="/marketing" element={<Marketing />} />
                <Route path="/leads" element={<CadastroLeads />} />
                <Route path="/usuarios" element={<Usuarios />} />
                <Route path="/procedimentos" element={<TiposProcedimento />} />
                <Route path="/registro-diario" element={<RegistroDiario />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
              </Route>
              <Route
                element={
                  <ProtectedRoute>
                    <CrmLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/crm" element={<CrmKanban />} />
                <Route path="/crm/dashboard" element={<CrmDashboard />} />
                <Route path="/crm/posvenda" element={<CrmPosVendaDashboard />} />
                <Route path="/crm/conversas" element={<CrmConversas />} />
                <Route path="/crm/conversa/:id" element={<CrmConversa />} />
                <Route path="/crm/automacoes" element={<CrmAutomacoes />} />
                <Route path="/crm/modelos" element={<CrmModelos />} />
                <Route path="/crm/integracoes" element={<CrmIntegracoes />} />
                <Route path="/crm/relatorios" element={<CrmRelatorios />} />
                <Route path="/crm/calendario" element={<CrmCalendario />} />
                <Route path="/crm/followups" element={<CrmFollowUps />} />
                <Route path="/crm/bots" element={<CrmBots />} />
                <Route path="/crm/bots/:id" element={<CrmBotEditor />} />
                <Route path="/crm/extras" element={<CrmExtras />} />
                <Route path="/crm/configuracoes" element={<CrmConfiguracoes />} />
                <Route path="/crm/respostas-rapidas" element={<CrmRespostasRapidas />} />
                <Route path="/crm/campanhas" element={<CrmCampanhas />} />
                <Route path="/crm/ia-config" element={<CrmIaConfig />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </TenantProvider>
    </BrowserRouter>
  </Providers>
);

export default PublicApp;

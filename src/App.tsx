import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import AppLayout from "./components/AppLayout";
import CrmLayout from "./components/CrmLayout";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Atendimento = lazy(() => import("./pages/Atendimento"));
const Pacientes = lazy(() => import("./pages/Pacientes"));
const PacienteDetalhe = lazy(() => import("./pages/PacienteDetalhe"));
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Marketing = lazy(() => import("./pages/Marketing"));
const CadastroLeads = lazy(() => import("./pages/CadastroLeads"));
const Usuarios = lazy(() => import("./pages/Usuarios"));
const TiposProcedimento = lazy(() => import("./pages/TiposProcedimento"));
const RegistroDiario = lazy(() => import("./pages/RegistroDiario"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const CrmKanban = lazy(() => import("./pages/CrmKanban"));
const CrmAutomacoes = lazy(() => import("./pages/CrmAutomacoes"));
const CrmModelos = lazy(() => import("./pages/CrmModelos"));
const CrmConversa = lazy(() => import("./pages/CrmConversa"));
const CrmIntegracoes = lazy(() => import("./pages/CrmIntegracoes"));
const CrmRelatorios = lazy(() => import("./pages/CrmRelatorios"));
const CrmConversas = lazy(() => import("./pages/CrmConversas"));
const CrmCalendario = lazy(() => import("./pages/CrmCalendario"));
const CrmFollowUps = lazy(() => import("./pages/CrmFollowUps"));
const CrmBots = lazy(() => import("./pages/CrmBots"));
const CrmBotEditor = lazy(() => import("./pages/CrmBotEditor"));
const CrmDashboard = lazy(() => import("./pages/CrmDashboard"));
const CrmExtras = lazy(() => import("./pages/CrmExtras"));
const CrmConfiguracoes = lazy(() => import("./pages/CrmConfiguracoes"));
const CrmRespostasRapidas = lazy(() => import("./pages/CrmRespostasRapidas"));
const CrmCampanhas = lazy(() => import("./pages/CrmCampanhas"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
    Carregando módulo...
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Login />} />
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
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

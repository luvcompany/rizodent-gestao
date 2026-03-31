import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "./pages/Login";
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
import CrmKanban from "./pages/CrmKanban";
import CrmAutomacoes from "./pages/CrmAutomacoes";
import CrmModelos from "./pages/CrmModelos";
import CrmConversa from "./pages/CrmConversa";
import CrmIntegracoes from "./pages/CrmIntegracoes";
import CrmRelatorios from "./pages/CrmRelatorios";
import CrmConversas from "./pages/CrmConversas";
import CrmCalendario from "./pages/CrmCalendario";
import CrmBots from "./pages/CrmBots";
import CrmBotEditor from "./pages/CrmBotEditor";
import CrmFollowUps from "./pages/CrmFollowUps";
import AppLayout from "./components/AppLayout";
import CrmLayout from "./components/CrmLayout";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
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
              <Route path="/crm/conversas" element={<CrmConversas />} />
              <Route path="/crm/conversa/:id" element={<CrmConversa />} />
              <Route path="/crm/automacoes" element={<CrmAutomacoes />} />
              <Route path="/crm/modelos" element={<CrmModelos />} />
              <Route path="/crm/integracoes" element={<CrmIntegracoes />} />
              <Route path="/crm/relatorios" element={<CrmRelatorios />} />
              <Route path="/crm/calendario" element={<CrmCalendario />} />
              <Route path="/crm/bots" element={<CrmBots />} />
              <Route path="/crm/bots/:id" element={<CrmBotEditor />} />
              <Route path="/crm/followups" element={<CrmFollowUps />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

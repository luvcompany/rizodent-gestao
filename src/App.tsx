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
import Relatorios from "./pages/Relatorios";
import Marketing from "./pages/Marketing";
import CadastroLeads from "./pages/CadastroLeads";
import Usuarios from "./pages/Usuarios";
import TiposProcedimento from "./pages/TiposProcedimento";
import AppLayout from "./components/AppLayout";
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
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/leads" element={<CadastroLeads />} />
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/procedimentos" element={<TiposProcedimento />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

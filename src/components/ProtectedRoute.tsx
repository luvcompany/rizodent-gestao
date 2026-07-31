import { Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";

// Rotas liberadas para o papel Recepção (chat + disparos + modelos + bots).
// Qualquer outra rota redireciona para Conversas.
const RECEPCAO_PREFIXES = [
  "/crm/recepcao",
  "/crm/conversas",
  "/crm/conversa",
  "/crm/campanhas",
  "/crm/modelos",
  "/crm/respostas-rapidas",
  "/crm/bots",
  "/crm/conexoes",
];
/** O Kanban é rota exata "/crm" — prefixo liberaria o CRM inteiro. */
const RECEPCAO_ROTAS_EXATAS = ["/crm"];

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading, profile, signOut, user, userRole, roleResolved } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const location = useLocation();

  // Bloqueio cross-tenant: se logou com conta de outro cliente nesta URL,
  // desloga imediatamente para impedir o acesso.
  useEffect(() => {
    if (loading || tenantLoading) return;
    if (!user) return;
    if (!tenant.id) return;
    const userTenantId = (profile as any)?.tenant_id;
    if (userTenantId && userTenantId !== tenant.id) {
      toast.error("Esta conta não pertence a este cliente.");
      signOut();
    }
  }, [user, profile, tenant.id, loading, tenantLoading, signOut]);

  useEffect(() => {
    if (profile?.is_blocked) {
      toast.error("Seu acesso foi bloqueado pelo administrador.");
      signOut();
    }
  }, [profile?.is_blocked, signOut]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  if (profile?.is_blocked) {
    return <Navigate to="/" replace />;
  }

  if (profile?.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  // Guards de papel só decidem com o papel resolvido (cache válido ou 1º fetch).
  // Sem isso, um deep-link renderia (e consultaria dados de) uma rota proibida
  // na janela entre o boot e a chegada do papel.
  if (!roleResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  // Pós-venda só acessa o CRM
  if (
    userRole === "posvenda" &&
    !location.pathname.startsWith("/crm") &&
    location.pathname !== "/change-password"
  ) {
    return <Navigate to="/crm" replace />;
  }

  // Recepção só acessa Conversas/Transmissão/Modelos/Respostas Rápidas/Bots
  if (userRole === "recepcao") {
    const path = location.pathname;
    const allowed =
      path === "/change-password" ||
      RECEPCAO_ROTAS_EXATAS.includes(path) ||
      RECEPCAO_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
    if (!allowed) {
      return <Navigate to="/crm/recepcao" replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;

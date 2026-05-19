import { Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading, profile, signOut, user, userRole } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const location = useLocation();

  // Bloqueio cross-tenant: se logou com conta de outro cliente nesta URL,
  // desloga imediatamente para impedir o acesso.
  useEffect(() => {
    if (loading || tenantLoading) return;
    if (!user) return;
    if (!tenant.id) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      const userTenantId = (data as any)?.tenant_id;
      if (userTenantId && userTenantId !== tenant.id) {
        toast.error("Esta conta não pertence a este cliente.");
        await signOut();
      }
    })();
  }, [user, tenant.id, loading, tenantLoading, signOut]);

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

  // Pós-venda só acessa o CRM
  if (
    userRole === "posvenda" &&
    !location.pathname.startsWith("/crm") &&
    location.pathname !== "/change-password"
  ) {
    return <Navigate to="/crm" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

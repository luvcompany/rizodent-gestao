import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function InstagramAuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      const search = location.search || "";
      if (data.session) {
        navigate(`/crm/integracoes${search}`, { replace: true });
      } else {
        navigate(`/?redirect=/crm/integracoes${encodeURIComponent(search)}`, { replace: true });
      }
    };
    run();
  }, [navigate, location.search]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Finalizando conexão com o Instagram...</p>
      </div>
    </div>
  );
}

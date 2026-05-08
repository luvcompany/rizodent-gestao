import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import crclinIcon from "@/assets/crclin-icon.png";

const AdminLogin = () => {
  const navigate = useNavigate();
  const { signIn, session, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // If already logged in as superadmin, jump straight to the panel
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "superadmin")
        .maybeSingle();
      if (data) navigate("/admin", { replace: true });
    })();
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      setLoading(false);
      toast.error("Erro ao entrar: " + error);
      return;
    }
    // Verify superadmin role before navigating
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) { setLoading(false); return; }
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.id)
      .eq("role", "superadmin")
      .maybeSingle();
    if (!role) {
      await supabase.auth.signOut();
      setLoading(false);
      toast.error("Esta conta não tem acesso ao painel CRClin.");
      return;
    }
    const { enforceBlockCheck } = await import("@/lib/accessLog");
    const blocked = await enforceBlockCheck(u.id, u.email ?? email, "admin");
    setLoading(false);
    if (blocked) { toast.error("Acesso bloqueado."); return; }
    navigate("/admin", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur p-8 shadow-2xl">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/30">
              <Shield className="h-7 w-7 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">CRClin Admin</h1>
              <p className="text-sm text-slate-400 mt-1">Painel de gestão de clientes</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@crclin.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-slate-800 border-slate-700 text-white pr-10 placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold"
            >
              {loading ? "Entrando..." : "Acessar Painel"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            Acesso restrito à equipe CRClin
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;

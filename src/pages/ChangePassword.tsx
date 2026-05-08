import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const ChangePassword = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!user) navigate("/"); }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 6) return toast.error("Senha mínimo 6 caracteres");
    if (pwd !== pwd2) return toast.error("Senhas não conferem");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) { setLoading(false); return toast.error(error.message); }
    if (user) await supabase.from("profiles").update({ must_change_password: false } as any).eq("id", user.id);
    await refreshProfile();
    toast.success("Senha atualizada!");
    navigate("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8">
        <h1 className="text-xl font-bold">Defina sua nova senha</h1>
        <p className="text-sm text-muted-foreground">Esta é sua primeira vez. Crie uma senha pessoal para continuar.</p>
        <div><Label>Nova senha</Label><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></div>
        <div><Label>Confirme a senha</Label><Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} /></div>
        <Button type="submit" disabled={loading} className="w-full">{loading ? "Salvando..." : "Salvar e continuar"}</Button>
      </form>
    </div>
  );
};

export default ChangePassword;

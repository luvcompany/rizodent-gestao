import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface ProfileData {
  nome: string;
  email: string;
  cargo: string | null;
  avatar_url: string | null;
  signature_enabled: boolean;
  must_change_password: boolean;
  is_blocked: boolean;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: ProfileData | null;
  userRole: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const [{ data: prof, error: profErr }, { data: role, error: roleErr }] = await Promise.all([
        supabase.from("profiles").select("nome, email, cargo, avatar_url, signature_enabled, must_change_password, is_blocked").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      ]);
      if (profErr) console.warn("[AuthContext] fetch profile error:", profErr.message);
      if (roleErr) console.warn("[AuthContext] fetch role error:", roleErr.message);
      setProfile(prof ? { ...prof, signature_enabled: (prof as any).signature_enabled ?? false, must_change_password: (prof as any).must_change_password ?? false, is_blocked: (prof as any).is_blocked ?? false } : null);
      setUserRole(role?.role ?? null);
    } catch (e: any) {
      console.error("[AuthContext] fetchProfile failed:", e?.message || e);
      // Keep previous profile/role state on transient network errors.
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchProfile(session.user.id), 0);
        } else {
          setProfile(null);
          setUserRole(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    // Block sign-in if profile is flagged as blocked.
    if (data?.user) {
      const { data: prof } = await supabase
        .from("profiles").select("is_blocked").eq("id", data.user.id).maybeSingle();
      if ((prof as any)?.is_blocked) {
        await supabase.auth.signOut();
        return { error: "Sua conta foi bloqueada pelo administrador." };
      }
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, userRole, loading, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface ProfileData {
  nome: string;
  email: string;
  cargo: string | null;
  avatar_url: string | null;
  tenant_id: string | null;
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
const AUTH_PROFILE_CACHE_TTL = 15 * 60_000;
const AUTH_PROFILE_CACHE_KEY = "crm:auth_profile_cache_v1";

function readCachedAuth(userId: string | undefined) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${AUTH_PROFILE_CACHE_KEY}:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > AUTH_PROFILE_CACHE_TTL) return null;
    return parsed.data as { profile: ProfileData | null; userRole: string | null };
  } catch {
    return null;
  }
}

function writeCachedAuth(userId: string, data: { profile: ProfileData | null; userRole: string | null }) {
  try {
    localStorage.setItem(`${AUTH_PROFILE_CACHE_KEY}:${userId}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastProfileFetchRef = useRef<{ userId: string; at: number } | null>(null);

  const fetchProfile = async (userId: string, force = false) => {
    const last = lastProfileFetchRef.current;
    if (!force && last?.userId === userId && Date.now() - last.at < 30_000) return;
    lastProfileFetchRef.current = { userId, at: Date.now() };
    try {
      const [{ data: prof, error: profErr }, { data: role, error: roleErr }] = await Promise.all([
        supabase.from("profiles").select("nome, email, cargo, avatar_url, tenant_id, signature_enabled, must_change_password, is_blocked").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      ]);
      if (profErr) console.warn("[AuthContext] fetch profile error:", profErr.message);
      if (roleErr) console.warn("[AuthContext] fetch role error:", roleErr.message);
      const normalizedProfile = prof ? { ...prof, signature_enabled: (prof as any).signature_enabled ?? false, must_change_password: (prof as any).must_change_password ?? false, is_blocked: (prof as any).is_blocked ?? false } : null;
      const normalizedRole = role?.role ?? null;
      setProfile(normalizedProfile);
      setUserRole(normalizedRole);
      writeCachedAuth(userId, { profile: normalizedProfile, userRole: normalizedRole });
    } catch (e: any) {
      console.error("[AuthContext] fetchProfile failed:", e?.message || e);
      // Keep previous profile/role state on transient network errors.
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id, true);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (_event === "INITIAL_SESSION") return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          const cached = readCachedAuth(session.user.id);
          if (cached) {
            setProfile(cached.profile);
            setUserRole(cached.userRole);
          }
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
        const cached = readCachedAuth(session.user.id);
        if (cached) {
          setProfile(cached.profile);
          setUserRole(cached.userRole);
        }
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
    // Limpa TODOS os caches e preferências do CRM no localStorage antes de
    // sair, para evitar que o próximo usuário (login no mesmo navegador)
    // veja dados, filtros ou estado de UX do usuário anterior.
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("crm:")) toRemove.push(key);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch {
      // localStorage indisponível em alguns contextos (private mode, SSR) — ignora
    }
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

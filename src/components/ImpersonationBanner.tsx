/**
 * Faixa de "acesso de suporte": aparece no topo do app do cliente quando esta
 * aba foi aberta pelo "entrar como cliente" do painel admin.
 *
 * A marca vem do sessionStorage (src/lib/impersonacao.ts). A faixa também
 * confere a sessão ativa: se ela acabar ou passar a ser de outro usuário, a
 * marca é apagada e a faixa some (não afirma "vendo como" sem estar vendo).
 *
 * "Sair" encerra SÓ a sessão deste navegador (scope 'local'): o signOut
 * padrão é global e derrubaria as sessões do usuário do cliente em todos os
 * aparelhos dele.
 */
import { useEffect, useState } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  EVENTO_IMPERSONACAO,
  lerImpersonacao,
  limparCachesDoUsuarioAnterior,
  limparImpersonacao,
  type Impersonacao,
} from "@/lib/impersonacao";

export function ImpersonationBanner() {
  const [imp, setImp] = useState<Impersonacao | null>(() => lerImpersonacao());
  const [saindo, setSaindo] = useState(false);

  // Acompanha a marca (Impersonar.tsx marca/limpa nesta mesma aba).
  useEffect(() => {
    const atualizar = () => setImp(lerImpersonacao());
    window.addEventListener(EVENTO_IMPERSONACAO, atualizar);
    return () => window.removeEventListener(EVENTO_IMPERSONACAO, atualizar);
  }, []);

  // A marca só vale enquanto a sessão for a do usuário visto.
  useEffect(() => {
    if (!imp) return;
    const idVisto = imp.usuario.id ?? null;
    const conferir = (userId: string | null) => {
      if (!userId || (idVisto && userId !== idVisto)) limparImpersonacao();
    };
    let vivo = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (vivo) conferir(data.session?.user?.id ?? null);
      })
      .catch(() => undefined);
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === "SIGNED_OUT") {
        limparImpersonacao();
        return;
      }
      if (sessao?.user?.id) conferir(sessao.user.id);
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [imp]);

  if (!imp) return null;

  const sair = async () => {
    if (saindo) return;
    setSaindo(true);
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // mesmo sem resposta do servidor a sessão local é descartada
    }
    limparCachesDoUsuarioAnterior();
    limparImpersonacao();
    // /admin/login fica fora do basename do cliente: navegação do documento.
    window.location.assign("/admin/login");
  };

  const nome = imp.usuario.nome || imp.usuario.email;
  const email = imp.usuario.nome && imp.usuario.email ? ` (${imp.usuario.email})` : "";

  return (
    <div
      role="region"
      aria-label="Acesso de suporte"
      className="flex w-full items-center gap-2 bg-warning px-4 py-1.5 text-xs text-warning-foreground sm:text-sm"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate" title={`Você está vendo como ${nome}${email} — acesso de suporte`}>
        Você está vendo como <strong className="font-semibold">{nome}</strong>
        {email} — acesso de suporte
      </p>
      <button
        type="button"
        onClick={sair}
        disabled={saindo}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warning-foreground/40 px-2 py-0.5 font-medium transition-colors hover:bg-warning-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning-foreground disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {saindo ? "Saindo…" : "Sair"}
      </button>
    </div>
  );
}

export default ImpersonationBanner;

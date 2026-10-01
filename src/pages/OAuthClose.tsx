import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Status = "connected" | "error" | "pending" | "";

const avisoMotivo: Record<string, string> = {
  config: "O login não está configurado no servidor.",
  negado: "A autorização foi cancelada.",
  state: "O link de conexão expirou ou já foi usado.",
  sessao: "Conclua a conexão neste navegador, logado no CRClin com o mesmo usuário que clicou em Conectar.",
  permissao: "Seu usuário não tem permissão para conectar esta conta.",
  troca: "O Instagram recusou a autorização.",
  perfil: "Não foi possível ler a conta profissional do Instagram.",
  outro_tenant: "Esta conta já está conectada em outra clínica.",
  banco: "Não foi possível salvar a conta.",
  erro: "Não foi possível concluir a conexão.",
  webhooks: "Conectado, mas o recebimento de mensagens não foi confirmado.",
  // instagram-oauth-callback (Login do Facebook) desativado no v2.
  desativado: "Esta forma de conexão foi desativada. Use Conectar Instagram em Integrações.",
};

// Login do Instagram: o callback devolve code/state no fragmento (status=pending)
// e a conexão só é concluída aqui, com o JWT de quem está logado no CRClin
// (instagram-login-callback confere que o state é deste usuário). Assim um link
// de autorização repassado para outra pessoa não liga a conta dela na clínica.
//
// Lê code/state do fragmento uma vez só e tira da barra de endereço/histórico.
// Guardado no módulo: o StrictMode chama o inicializador do useState duas vezes.
let fragmentoLido: { code: string; state: string } | null = null;
function lerFragmento(): { code: string; state: string } {
  if (fragmentoLido) return fragmentoLido;
  const frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const r = { code: frag.get("code") || "", state: frag.get("state") || "" };
  fragmentoLido = r;
  if (window.location.hash) {
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch { /* sem history: segue */ }
  }
  return r;
}

// Uma conclusão por state: o StrictMode roda o efeito duas vezes e o segundo
// POST acharia o state já consumido.
const conclusoes = new Map<string, Promise<{ status: "connected" | "error"; count: number; reason: string }>>();

function concluirInstagram(code: string, state: string) {
  if (!code || !state) return Promise.resolve({ status: "error" as const, count: 0, reason: "state" });
  let p = conclusoes.get(state);
  if (!p) {
    p = chamarConclusao(code, state);
    conclusoes.set(state, p);
  }
  return p;
}

async function chamarConclusao(code: string, state: string): Promise<{ status: "connected" | "error"; count: number; reason: string }> {
  const { data: sessao } = await supabase.auth.getSession();
  if (!sessao.session) return { status: "error", count: 0, reason: "sessao" };

  const { data, error } = await supabase.functions.invoke("instagram-login-callback", {
    body: { code, state },
  });
  if (error) {
    let reason = "erro";
    try {
      const b = await (error as any).context?.json?.();
      if (b?.reason) reason = String(b.reason);
    } catch { /* corpo não-JSON */ }
    return { status: "error", count: 0, reason };
  }
  const d = (data ?? {}) as { status?: string; count?: number; reason?: string | null };
  return {
    status: d.status === "connected" ? "connected" : "error",
    count: Number(d.count) || 0,
    reason: String(d.reason ?? ""),
  };
}

const OAuthClose = () => {
  const params = new URLSearchParams(window.location.search);
  const channel = (params.get("channel") || "") as "instagram" | "whatsapp" | "";
  const statusInicial = (params.get("status") || "") as Status;
  const pendente = statusInicial === "pending" && channel === "instagram";
  const [fragmento] = useState(() => (pendente ? lerFragmento() : { code: "", state: "" }));

  const [status, setStatus] = useState<Status>(pendente ? "pending" : statusInicial);
  const [count, setCount] = useState(Number(params.get("count")) || 0);
  // Motivo curto do callback (ex.: "outro_tenant", "config", "webhooks"); opcional.
  const [reason, setReason] = useState((params.get("reason") || "").slice(0, 40));
  const ok = status === "connected";

  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!pendente) return;
    let vivo = true;
    concluirInstagram(fragmento.code, fragmento.state)
      .catch(() => ({ status: "error" as const, count: 0, reason: "erro" }))
      .then((r) => {
        if (!vivo) return;
        setStatus(r.status);
        setCount(r.count);
        setReason(r.reason.slice(0, 40));
      });
    return () => { vivo = false; };
  }, [pendente, fragmento]);

  useEffect(() => {
    if (status === "pending") return;
    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: "oauth_result", channel, status, count, reason },
          "*",
        );
      }
    } catch {}
    // Erro de sessão fica aberto para a pessoa ler o que fazer.
    if (reason === "sessao") return;
    const t = window.setTimeout(() => {
      setClosing(true);
      try { window.close(); } catch {}
    }, 800);
    return () => window.clearTimeout(t);
  }, [channel, status, count, reason]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0b0b0b",
        color: "#fff",
        fontFamily:
          '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>{status === "pending" ? "⏳" : ok ? "✅" : "❌"}</div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px", fontWeight: 600 }}>
          {status === "pending"
            ? "Concluindo a conexão…"
            : ok
              ? "Conectado com sucesso!"
              : "Não foi possível conectar"}
        </h1>
        {status !== "pending" && (
          <p style={{ margin: 0, color: "#bbb", fontSize: 14, lineHeight: 1.5 }}>
            {ok
              ? closing
                ? "Fechando esta janela…"
                : "Fechando esta janela…"
              : "Feche esta janela e tente novamente."}
          </p>
        )}
        {status !== "pending" && avisoMotivo[reason] && (
          <p style={{ margin: "8px 0 0", color: "#bbb", fontSize: 14, lineHeight: 1.5 }}>
            {avisoMotivo[reason]}
          </p>
        )}
      </div>
    </div>
  );
};

export default OAuthClose;

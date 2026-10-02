import { useEffect, useState } from "react";

const OAuthClose = () => {
  const params = new URLSearchParams(window.location.search);
  const channel = (params.get("channel") || "") as "instagram" | "whatsapp" | "";
  const status = (params.get("status") || "") as "connected" | "error" | "";
  const count = Number(params.get("count")) || 0;
  const ok = status === "connected";

  const [closing, setClosing] = useState(false);

  useEffect(() => {
    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: "oauth_result", channel, status, count },
          "*",
        );
      }
    } catch {}
    const t = window.setTimeout(() => {
      setClosing(true);
      try { window.close(); } catch {}
    }, 800);
    return () => window.clearTimeout(t);
  }, [channel, status, count]);

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
        <div style={{ fontSize: 64, marginBottom: 16 }}>{ok ? "✅" : "❌"}</div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px", fontWeight: 600 }}>
          {ok ? "Conectado com sucesso!" : "Não foi possível conectar"}
        </h1>
        <p style={{ margin: 0, color: "#bbb", fontSize: 14, lineHeight: 1.5 }}>
          {ok
            ? closing
              ? "Fechando esta janela…"
              : "Fechando esta janela…"
            : "Feche esta janela e tente novamente."}
        </p>
      </div>
    </div>
  );
};

export default OAuthClose;

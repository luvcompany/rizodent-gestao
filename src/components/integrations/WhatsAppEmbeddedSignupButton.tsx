import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageCircle, Loader2 } from "lucide-react";

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const FB_SDK_ID = "facebook-jssdk";

type WaConfig = { app_id: string; config_id: string; api_version: string };

function loadFbSdk(appId: string, apiVersion: string): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) {
      try { window.FB.init({ appId, version: apiVersion, cookie: true, xfbml: false }); } catch {}
      resolve();
      return;
    }
    if (document.getElementById(FB_SDK_ID)) {
      const check = setInterval(() => {
        if (window.FB) { clearInterval(check); resolve(); }
      }, 100);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB.init({ appId, version: apiVersion, cookie: true, xfbml: false });
      resolve();
    };
    const s = document.createElement("script");
    s.id = FB_SDK_ID;
    s.src = FB_SDK_SRC;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    document.body.appendChild(s);
  });
}

export default function WhatsAppEmbeddedSignupButton({ onConnected }: { onConnected?: () => void }) {
  const [cfg, setCfg] = useState<WaConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const capturedRef = useRef<{ phone_number_id?: string; waba_id?: string }>({});

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("get-whatsapp-config");
      if (error || !data) return;
      setCfg(data as WaConfig);
      if ((data as WaConfig).app_id && (data as WaConfig).config_id) {
        loadFbSdk((data as WaConfig).app_id, (data as WaConfig).api_version || "v21.0");
      }
    })();

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data?.event === "FINISH" && data?.data) {
          capturedRef.current = {
            phone_number_id: data.data.phone_number_id,
            waba_id: data.data.waba_id,
          };
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const notConfigured = !cfg?.app_id || !cfg?.config_id;

  const handleClick = () => {
    if (!cfg || notConfigured) {
      toast.warning("Configuração pendente do WhatsApp Embedded Signup");
      return;
    }
    if (!window.FB) {
      toast.error("Facebook SDK ainda carregando, tente novamente");
      return;
    }
    capturedRef.current = {};
    setLoading(true);
    window.FB.login(
      async (response: any) => {
        try {
          const code = response?.authResponse?.code;
          if (!code) {
            toast.error("Login cancelado ou sem code");
            return;
          }
          // Aguardar até 3s pelo postMessage se ainda não veio
          for (let i = 0; i < 15 && !capturedRef.current.phone_number_id; i++) {
            await new Promise((r) => setTimeout(r, 200));
          }
          const { phone_number_id, waba_id } = capturedRef.current;
          if (!phone_number_id || !waba_id) {
            toast.error("Não recebemos phone_number_id/waba_id do Meta");
            return;
          }
          const { data, error } = await supabase.functions.invoke("whatsapp-embedded-signup", {
            body: { code, phone_number_id, waba_id },
          });
          if (error || !(data as any)?.success) {
            toast.error(`Falha ao conectar: ${error?.message || (data as any)?.error || "erro desconhecido"}`);
            return;
          }
          toast.success("WhatsApp conectado com sucesso");
          onConnected?.();
        } finally {
          setLoading(false);
        }
      },
      {
        config_id: cfg.config_id,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  };

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={loading} title={notConfigured ? "Configuração pendente" : ""}>
      {loading ? <Loader2 size={14} className="mr-1 animate-spin" /> : <MessageCircle size={14} className="mr-1" />}
      Conectar WhatsApp automaticamente
    </Button>
  );
}

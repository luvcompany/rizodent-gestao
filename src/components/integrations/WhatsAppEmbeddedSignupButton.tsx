import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageCircle, Loader2 } from "lucide-react";

type WaConfig = { app_id: string; config_id: string; redirect_uri: string; api_version: string };

export default function WhatsAppEmbeddedSignupButton({ onConnected }: { onConnected?: () => void }) {
  const [cfg, setCfg] = useState<WaConfig | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("get-whatsapp-config");
      if (error || !data) return;
      setCfg(data as WaConfig);
    })();
  }, []);

  const notConfigured = !cfg?.app_id || !cfg?.config_id || !cfg?.redirect_uri;

  const handleClick = async () => {
    if (!cfg || notConfigured) {
      toast.warning("Configuração pendente do WhatsApp Embedded Signup");
      return;
    }
    setConnecting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("Usuário não autenticado.");
        setConnecting(false);
        return;
      }

      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", userId)
        .maybeSingle();
      const tenantId = (profileData as any)?.tenant_id;
      if (profileErr || !tenantId) {
        toast.error("Tenant não encontrado para o usuário.");
        setConnecting(false);
        return;
      }

      const { data: stateRow, error: stateErr } = await supabase
        .from("whatsapp_oauth_states" as any)
        .insert({ user_id: userId, tenant_id: tenantId })
        .select("state")
        .single();
      if (stateErr || !(stateRow as any)?.state) {
        toast.error("Falha ao iniciar fluxo OAuth. Tente novamente.");
        setConnecting(false);
        return;
      }
      const state = (stateRow as any).state as string;

      const oauthUrl = new URL(`https://www.facebook.com/${cfg.api_version || "v21.0"}/dialog/oauth`);
      oauthUrl.searchParams.set("client_id", cfg.app_id);
      oauthUrl.searchParams.set("config_id", cfg.config_id);
      oauthUrl.searchParams.set("redirect_uri", cfg.redirect_uri);
      oauthUrl.searchParams.set("response_type", "code");
      oauthUrl.searchParams.set("override_default_response_type", "true");
      oauthUrl.searchParams.set("state", state);

      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        oauthUrl.toString(),
        "whatsapp-oauth",
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`,
      );

      if (!popup) {
        toast.error("Popup bloqueado pelo navegador. Permita popups e tente novamente.");
        setConnecting(false);
        return;
      }

      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          setConnecting(false);
          onConnected?.();
        }
      }, 500);
    } catch (e: any) {
      console.error("[WhatsAppEmbeddedSignupButton] connect error:", e);
      toast.error(e?.message ?? "Erro ao iniciar conexão");
      setConnecting(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={connecting} title={notConfigured ? "Configuração pendente" : ""}>
      {connecting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <MessageCircle size={14} className="mr-1" />}
      Conectar WhatsApp automaticamente
    </Button>
  );
}

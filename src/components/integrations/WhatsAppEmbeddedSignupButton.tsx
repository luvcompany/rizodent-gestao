import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageCircle, Loader2 } from "lucide-react";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { urlInicioOAuthWhatsApp } from "@/lib/whatsappOauthInicio";

/**
 * Botão do Embedded Signup (conectar número pelo Facebook).
 *
 * Quem monta a URL do Facebook e cria o `state` do OAuth é o SERVIDOR
 * (get-whatsapp-config): ele escolhe o app Meta certo do cliente (geral ou
 * próprio), confere o papel do usuário e grava o state com o app, a origem e o
 * modo. O navegador só abre a URL recebida — não lê perfil, não insere em
 * whatsapp_oauth_states e não conhece app_id/config_id.
 *
 * coexistencia=true conecta um número que CONTINUA ativo no app WhatsApp
 * Business do celular (a Meta chama de Coexistence): o fluxo pede um QR code
 * para escanear no app, e as mensagens enviadas pelo celular chegam ao CRM pelo
 * webhook (smb_message_echoes). Sem a flag é o onboarding clássico (o número
 * sai do app do celular).
 */

// { disponivel:false, motivo } | { disponivel:true, url, ... }
type RespostaConfig = { disponivel?: boolean; motivo?: string; url?: string };

const LARGURA = 600;
const ALTURA = 700;

// A URL vem do servidor e só é aberta se for o passo "iniciar" do
// whatsapp-oauth-callback deste projeto (ele amarra o state a este navegador
// e redireciona para o diálogo da Meta).
export default function WhatsAppEmbeddedSignupButton({
  coexistencia = false,
  onConnected,
  disabled = false,
  rotulo,
  className,
}: {
  coexistencia?: boolean;
  onConnected?: () => void;
  disabled?: boolean;
  /** Texto do botão; o padrão depende de `coexistencia`. */
  rotulo?: string;
  className?: string;
}) {
  const [conectando, setConectando] = useState(false);
  const vigia = useRef<number | null>(null);

  // Para de vigiar o popup se a tela for desmontada no meio da conexão.
  useEffect(() => () => {
    if (vigia.current !== null) window.clearInterval(vigia.current);
  }, []);

  const abrir = async () => {
    if (conectando || disabled) return;

    // O popup é aberto JÁ no clique (em branco) e só depois recebe a URL: aberto
    // depois de um await, o navegador pode tratá-lo como popup não solicitado.
    const left = window.screenX + (window.outerWidth - LARGURA) / 2;
    const top = window.screenY + (window.outerHeight - ALTURA) / 2;
    const popup = window.open(
      "about:blank",
      "whatsapp-oauth",
      `width=${LARGURA},height=${ALTURA},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`,
    );
    if (!popup) {
      toast.error("O navegador bloqueou a janela de conexão. Permita pop-ups para este site e tente de novo.");
      return;
    }

    setConectando(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-whatsapp-config", {
        body: { coexistencia },
      });
      if (error) {
        popup.close();
        toast.error(await motivoDoServidor(data, error, "Não foi possível iniciar a conexão. Tente de novo."));
        setConectando(false);
        return;
      }

      const resposta = (data ?? {}) as RespostaConfig;
      if (!resposta.disponivel) {
        popup.close();
        toast.warning(resposta.motivo || "A conexão pelo Facebook não está disponível para este cliente.");
        setConectando(false);
        return;
      }

      const url = urlInicioOAuthWhatsApp(resposta.url);
      if (!url) {
        popup.close();
        toast.error("O servidor não devolveu um endereço de conexão válido.");
        setConectando(false);
        return;
      }

      popup.location.href = url;

      if (vigia.current !== null) window.clearInterval(vigia.current);
      vigia.current = window.setInterval(() => {
        if (popup.closed) {
          if (vigia.current !== null) window.clearInterval(vigia.current);
          vigia.current = null;
          setConectando(false);
          onConnected?.();
        }
      }, 500);
    } catch (e: unknown) {
      try { popup.close(); } catch { /* janela já fechada */ }
      console.error("[WhatsAppEmbeddedSignupButton] falha ao iniciar a conexão");
      toast.error(e instanceof Error && e.message ? e.message : "Não foi possível iniciar a conexão.");
      setConectando(false);
    }
  };

  const texto = rotulo ?? (coexistencia
    ? "Conectar número do WhatsApp Business (coexistência)"
    : "Conectar número");

  return (
    <Button
      size="sm"
      variant={coexistencia ? "outline" : "default"}
      onClick={() => void abrir()}
      disabled={disabled || conectando}
      className={className}
      title={
        coexistencia
          ? "Mantém o número ativo no app WhatsApp Business do celular (escaneie o QR code quando aparecer)"
          : undefined
      }
    >
      {conectando ? <Loader2 size={14} className="mr-1 animate-spin" /> : <MessageCircle size={14} className="mr-1" />}
      {conectando ? "Conectando…" : texto}
    </Button>
  );
}

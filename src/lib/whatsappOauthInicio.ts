/**
 * Confere a URL que o get-whatsapp-config devolve para o popup do WhatsApp.
 *
 * Desde o vínculo anti-CSRF, a URL não é mais a do diálogo da Meta: é o passo
 * "iniciar" do whatsapp-oauth-callback deste projeto (grava um cookie de
 * vínculo no popup e redireciona para a Meta). Só aceita esse endereço exato,
 * em https, na origem do backend configurado.
 */
export function urlInicioOAuthWhatsApp(bruta: unknown): string | null {
  if (typeof bruta !== "string" || !bruta) return null;
  try {
    const u = new URL(bruta);
    const base = new URL(String(import.meta.env.VITE_SUPABASE_URL ?? ""));
    const caminhoOk = u.pathname.replace(/\/+$/, "") ===
      `${base.pathname.replace(/\/+$/, "")}/functions/v1/whatsapp-oauth-callback`;
    const ok = u.protocol === "https:" && u.origin === base.origin && caminhoOk && u.searchParams.has("iniciar");
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

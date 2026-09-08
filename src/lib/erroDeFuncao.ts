/**
 * Mensagem de erro de uma edge function como o SERVIDOR mandou.
 *
 * Quem decide se a ação pode acontecer é a function, não a tela: um 403 sai
 * dela com `{ error: "..." }` no corpo, e o supabase-js entrega isso em
 * `error.context` (uma Response), não em `data`. Sem ler o contexto, todo motivo
 * vira o mesmo "Edge Function returned a non-2xx status code" e o usuário não
 * fica sabendo o que houve — o que passou a importar quando papéis como a SDR
 * ganharam recusas próprias ("Ligações não fazem parte do perfil SDR", "SDR não
 * transfere lead", …).
 *
 * Fonte única: usado por SendToPosvendaButton, WhatsappCallContext e
 * whatsapp-call-session. `CrmEquipe.tsx` tem uma cópia local equivalente
 * (`erroDaFuncao`) por ser uma tela isolada da aba Equipe.
 */
export async function motivoDoServidor(
  data: unknown,
  error: unknown,
  padrao: string,
): Promise<string> {
  const corpo = (data ?? {}) as { error?: unknown };
  if (corpo.error) return String(corpo.error);
  const err = (error && typeof error === "object" ? error : {}) as {
    message?: string;
    context?: { json?: unknown; clone?: () => Response };
  };
  const ctx = err.context;
  if (ctx?.json && typeof ctx.clone === "function") {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown };
      if (body?.error) return String(body.error);
    } catch {
      /* corpo não-JSON → cai na mensagem abaixo */
    }
  }
  return err.message || padrao;
}

/**
 * Versão para quem já tem só um `unknown` lançado (catch): devolve a mensagem
 * carregada por `Error.cause` quando a origem foi uma edge function, senão a
 * própria `message`.
 */
export function motivoDeErroLancado(e: unknown, padrao: string): string {
  const err = (e && typeof e === "object" ? e : {}) as { message?: string; cause?: unknown };
  const causa = (err.cause && typeof err.cause === "object" ? err.cause : {}) as { message?: string };
  return causa.message || err.message || padrao;
}

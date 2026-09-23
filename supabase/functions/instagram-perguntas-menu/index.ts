/**
 * Perguntas prontas (ice breakers) e menu fixo do Direct do Instagram.
 *
 * As duas coisas vivem no mesmo lugar na Meta: POST /{ig_id}/messenger_profile.
 * Quem tem token do Instagram Login (começa com IGAA) fala com
 * graph.instagram.com; token de Página fala com graph.facebook.com.
 *
 * As perguntas aparecem ANTES da primeira mensagem, no celular (no Direct do
 * computador não aparecem). O menu fica disponível a conversa inteira.
 * A escolha do paciente volta no webhook como `postback`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { resolveCaller, callerHasRole } from "../_shared/authz.ts";
import { BASE_GRAPH_INSTAGRAM, BASE_GRAPH_META } from "../_shared/metaVersao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Limites da Meta: 4 perguntas; título de item de menu com 30 caracteres. */
const MAX_PERGUNTAS = 4;
const MAX_MENU = 5;
const MAX_TITULO = 30;
const MAX_PERGUNTA = 80;

/** Código estável para a escolha voltar no webhook (sem acento, sem espaço). */
function codigoDoTexto(texto: string, prefixo: string): string {
  const base = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${prefixo}:${base || "OPCAO"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const caller = await resolveCaller(req, admin);
    if (!caller.ok) return json({ error: caller.error }, caller.status);

    const podeConfigurar =
      caller.isServiceRole ||
      caller.isSuperadmin ||
      callerHasRole(caller, "crc") ||
      callerHasRole(caller, "gerente");
    if (!podeConfigurar) return json({ error: "Só a gestão configura o Direct." }, 403);

    const body = await req.json().catch(() => ({}));
    const contaId = String(body?.ig_account_id || "").trim();
    const acao = String(body?.acao || "ler").trim();
    if (!contaId) return json({ error: "ig_account_id é obrigatório" }, 400);

    const { data: conta } = await admin
      .from("ig_accounts")
      .select("id, ig_user_id, username, access_token, tenant_id, active")
      .eq("id", contaId)
      .maybeSingle();
    if (!conta) return json({ error: "Conta de Instagram não encontrada" }, 404);
    if (!caller.isServiceRole && !caller.isSuperadmin && caller.tenantId !== (conta as any).tenant_id) {
      return json({ error: "Conta de outro cliente" }, 403);
    }

    const token = String((conta as any).access_token || "");
    const igId = String((conta as any).ig_user_id || "");
    if (!token || !igId) return json({ error: "Conta sem token ou sem ID do Instagram" }, 400);

    const base = token.startsWith("IGAA") ? BASE_GRAPH_INSTAGRAM : BASE_GRAPH_META;
    const url = `${base}/${encodeURIComponent(igId)}/messenger_profile`;

    // ---------- LER ----------
    if (acao === "ler") {
      const res = await fetch(
        `${url}?fields=ice_breakers,persistent_menu&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15000) },
      );
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        return json({ ok: false, motivo: dados?.error?.message || `HTTP ${res.status}` });
      }
      // A Meta devolve { data: [ { ice_breakers: [...], persistent_menu: [...] } ] }
      const bloco = Array.isArray(dados?.data) ? (dados.data[0] ?? {}) : dados;
      const perguntas =
        (bloco?.ice_breakers ?? []).find((b: any) => (b?.locale ?? "default") === "default")?.call_to_actions ?? [];
      const menu =
        (bloco?.persistent_menu ?? []).find((b: any) => (b?.locale ?? "default") === "default")?.call_to_actions ?? [];
      return json({
        ok: true,
        perguntas: perguntas.map((p: any) => ({ pergunta: p?.question ?? "", payload: p?.payload ?? "" })),
        menu: menu.map((m: any) => ({
          titulo: m?.title ?? "",
          payload: m?.payload ?? null,
          url: m?.url ?? null,
        })),
      });
    }

    if (acao !== "salvar") return json({ error: "acao deve ser 'ler' ou 'salvar'" }, 400);

    // ---------- SALVAR ----------
    const perguntasEntrada: Array<{ pergunta?: string }> = Array.isArray(body?.perguntas) ? body.perguntas : [];
    const menuEntrada: Array<{ titulo?: string; url?: string }> = Array.isArray(body?.menu) ? body.menu : [];

    const perguntas = perguntasEntrada
      .map((p) => String(p?.pergunta || "").trim())
      .filter(Boolean)
      .slice(0, MAX_PERGUNTAS)
      .map((texto) => ({
        question: texto.slice(0, MAX_PERGUNTA),
        payload: codigoDoTexto(texto, "PERGUNTA"),
      }));

    const menu = menuEntrada
      .map((m) => ({ titulo: String(m?.titulo || "").trim(), url: String(m?.url || "").trim() }))
      .filter((m) => m.titulo)
      .slice(0, MAX_MENU)
      .map((m) =>
        m.url
          ? { type: "web_url", title: m.titulo.slice(0, MAX_TITULO), url: m.url }
          : { type: "postback", title: m.titulo.slice(0, MAX_TITULO), payload: codigoDoTexto(m.titulo, "MENU") },
      );

    const resultados: Record<string, string> = {};

    // A Meta substitui a configuração inteira a cada POST; lista vazia = apagar.
    const aplicar = async (campo: "ice_breakers" | "persistent_menu", conteudo: unknown[] | null) => {
      const temConteudo = Array.isArray(conteudo) && conteudo.length > 0;
      const res = await fetch(`${url}?access_token=${encodeURIComponent(token)}`, {
        method: temConteudo ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          temConteudo
            ? campo === "ice_breakers"
              ? { platform: "instagram", ice_breakers: [{ call_to_actions: conteudo, locale: "default" }] }
              : { persistent_menu: [{ locale: "default", call_to_actions: conteudo }] }
            : { fields: [campo] },
        ),
        signal: AbortSignal.timeout(15000),
      });
      const corpo = await res.json().catch(() => ({}));
      resultados[campo] = res.ok ? "ok" : String(corpo?.error?.message || `HTTP ${res.status}`);
      return res.ok;
    };

    const okPerguntas = await aplicar("ice_breakers", perguntas);
    const okMenu = await aplicar("persistent_menu", menu);

    console.log(
      `[instagram-perguntas-menu] conta=${(conta as any).username ?? igId} perguntas=${perguntas.length} menu=${menu.length} ` +
        `resultado=${JSON.stringify(resultados)}`,
    );

    return json({
      ok: okPerguntas && okMenu,
      resultados,
      perguntas: perguntas.map((p) => ({ pergunta: p.question, payload: p.payload })),
      menu: menu.map((m: any) => ({ titulo: m.title, payload: m.payload ?? null, url: m.url ?? null })),
    });
  } catch (e) {
    console.error("[instagram-perguntas-menu] erro inesperado:", e);
    return json({ ok: false, motivo: "Erro inesperado ao falar com a Meta." });
  }
});

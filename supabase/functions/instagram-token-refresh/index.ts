import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * instagram-token-refresh
 * Renova automaticamente os tokens das contas Instagram (tabela ig_accounts)
 * que vencem nos próximos 7 dias. Agendado para rodar 1x por semana.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: accounts, error } = await supabase
    .from("ig_accounts")
    .select("id, username, access_token, token_expires_at")
    .eq("active", true)
    .lt("token_expires_at", horizon);

  if (error) {
    console.error("Erro ao buscar contas:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!accounts || accounts.length === 0) {
    console.log("✅ Nenhum token para renovar.");
    return new Response(
      JSON.stringify({ message: "Nenhum token para renovar.", results: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const results: Array<Record<string, unknown>> = [];

  for (const account of accounts) {
    try {
      const response = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(
          account.access_token
        )}`
      );
      const data = await response.json();

      if (!response.ok || data.error) {
        console.error(`❌ Erro ao renovar token de @${account.username}:`, data.error);
        results.push({ username: account.username, status: "erro", detail: data.error });
        continue;
      }

      const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

      const { error: updateError } = await supabase
        .from("ig_accounts")
        .update({
          access_token: data.access_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      if (updateError) {
        console.error(`❌ Erro ao salvar token de @${account.username}:`, updateError);
        results.push({
          username: account.username,
          status: "erro_banco",
          detail: updateError.message,
        });
        continue;
      }

      console.log(`✅ Token renovado: @${account.username} | expira em: ${expiresAt}`);
      results.push({ username: account.username, status: "renovado", expires_at: expiresAt });
    } catch (err) {
      console.error(`❌ Exceção para @${account.username}:`, err);
      results.push({ username: account.username, status: "excecao", detail: String(err) });
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

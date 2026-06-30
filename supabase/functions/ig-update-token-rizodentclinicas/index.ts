import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const token = Deno.env.get("IG_TOKEN_RIZODENTCLINICAS");
  if (!token) return new Response(JSON.stringify({ error: "missing secret" }), { status: 400 });

  // Validate
  const me = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${token}`);
  const meJson = await me.json();
  if (!me.ok) return new Response(JSON.stringify({ step: "validate", error: meJson }), { status: 400 });

  // Try to exchange for long-lived if short-lived
  let finalToken = token;
  let expiresAt: string | null = null;
  const ll = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${Deno.env.get("INSTAGRAM_APP_SECRET") ?? ""}&access_token=${token}`);
  if (ll.ok) {
    const llJson = await ll.json();
    if (llJson.access_token) {
      finalToken = llJson.access_token;
      expiresAt = new Date(Date.now() + (llJson.expires_in ?? 5184000) * 1000).toISOString();
    }
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase
    .from("ig_accounts")
    .update({ access_token: finalToken, token_expires_at: expiresAt, updated_at: new Date().toISOString(), active: true })
    .eq("username", "rizodentclinicas");

  if (error) return new Response(JSON.stringify({ step: "update", error }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, user: meJson, exchanged: !!expiresAt, expires_at: expiresAt }), { headers: { "Content-Type": "application/json" } });
});

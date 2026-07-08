const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const app_id = Deno.env.get("META_APP_ID") ?? "";
  const config_id = Deno.env.get("WHATSAPP_EMBEDDED_CONFIG_ID") ?? "";
  return new Response(
    JSON.stringify({ app_id, config_id, api_version: "v21.0" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

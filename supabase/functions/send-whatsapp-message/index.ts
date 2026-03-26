import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const whatsappToken = Deno.env.get("WHATSAPP_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    if (!whatsappToken || !phoneNumberId) {
      return new Response(JSON.stringify({ error: "WhatsApp secrets not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { lead_id, to, message } = await req.json();

    if (!lead_id || !to || !message) {
      return new Response(JSON.stringify({ error: "Missing lead_id, to, or message" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via WhatsApp API
    const waResponse = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message },
        }),
      }
    );

    const waData = await waResponse.json();

    if (!waResponse.ok) {
      return new Response(JSON.stringify({ error: "WhatsApp API error", details: waData }), {
        status: waResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save message to DB
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: msg, error: insertError } = await supabase.from("messages").insert({
      lead_id,
      direction: "outbound",
      type: "text",
      content: message,
      status: "sent",
    }).select().single();

    if (insertError) {
      return new Response(JSON.stringify({ error: "DB insert error", details: insertError }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update lead
    await supabase.from("crm_leads").update({
      last_message: message,
      last_message_at: new Date().toISOString(),
    }).eq("id", lead_id);

    return new Response(JSON.stringify({ success: true, message: msg, whatsapp: waData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Usuário inválido" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messageId } = await req.json();
    if (!messageId || typeof messageId !== "string") {
      return new Response(JSON.stringify({ error: "messageId é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate message exists, is outbound, and not already deleted
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .select("id, whatsapp_message_id, direction, deleted_at, created_at")
      .eq("id", messageId)
      .maybeSingle();

    if (msgErr || !msg) {
      return new Response(JSON.stringify({ error: "Mensagem não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (msg.direction !== "outbound") {
      return new Response(JSON.stringify({ error: "Só é possível apagar mensagens enviadas pelo sistema" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (msg.deleted_at) {
      return new Response(JSON.stringify({ error: "Mensagem já foi apagada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const waMsgId = msg.whatsapp_message_id;
    const token = Deno.env.get("WHATSAPP_TOKEN");

    let metaResult: any = { skipped: true };

    if (waMsgId && token) {
      const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
      // Meta Graph API: DELETE /{phone_number_id}/messages with body
      const url = `https://graph.facebook.com/v25.0/${phoneId}/messages`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "deleted",
          message_id: waMsgId,
        }),
      });

      const txt = await resp.text();
      let body: any;
      try { body = JSON.parse(txt); } catch { body = txt; }

      if (!resp.ok) {
        const errMsg = body?.error?.message || "Falha ao apagar no WhatsApp";
        const errCode = body?.error?.code;
        // Common: out of window (>15min/48h depending on type)
        const friendly = /time|window|expired|deleted/i.test(String(errMsg))
          ? "Não foi possível apagar: a mensagem está fora do prazo permitido pelo WhatsApp."
          : errMsg;
        console.error("[delete-whatsapp-message] Meta API error", { errCode, errMsg, body });
        return new Response(JSON.stringify({ error: friendly, details: body }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      metaResult = body;
    }

    // Soft delete in DB
    const { error: updErr } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);

    if (updErr) {
      console.error("[delete-whatsapp-message] DB update error", updErr);
      return new Response(JSON.stringify({ error: "Falha ao atualizar registro local" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[delete-whatsapp-message] Deleted ${messageId} by user ${userData.user.id}`);

    return new Response(JSON.stringify({ success: true, meta: metaResult }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[delete-whatsapp-message] Exception", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

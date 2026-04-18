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

    // NOTE: WhatsApp Cloud API does NOT support deleting messages remotely.
    // The /messages endpoint only accepts status="read". We perform a local
    // soft-delete so the message is hidden in the CRM UI.
    const metaResult: any = { skipped: true, reason: "WhatsApp Cloud API não suporta exclusão remota; aplicado soft-delete local." };

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

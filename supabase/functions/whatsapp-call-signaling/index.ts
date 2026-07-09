// WhatsApp Calling API — Signaling proxy
// Chamado pelo frontend para aceitar/pré-aceitar/rejeitar/encerrar uma chamada
// via Graph API. O SDP answer é gerado pelo navegador (RTCPeerConnection) e
// enviado aqui para forward.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_VERSION = "v25.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  call_id?: string; // whatsapp_calls.id (uuid) — obrigatório exceto para "connect"
  action: "pre_accept" | "accept" | "reject" | "terminate" | "connect";
  sdp?: string; // required for pre_accept / accept / connect
  // connect (outbound):
  to_phone?: string; // E.164 sem '+'
  phone_number_id?: string; // origem
  lead_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // Autenticação do usuário chamador
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as Body;
    const { call_id, action, sdp } = body || ({} as Body);
    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((action === "pre_accept" || action === "accept" || action === "connect") && !sdp) {
      return new Response(JSON.stringify({ error: "sdp is required for accept/pre_accept/connect" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action !== "connect" && !call_id) {
      return new Response(JSON.stringify({ error: "call_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve tenant/phone_number_id/wa_call_id conforme o modo
    let tenantId: string | null = null;
    let phoneNumberId: string | null = null;
    let waCallId: string | null = null;
    let dbCallId: string | null = null;

    // Perfil do usuário
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    tenantId = profile.tenant_id;

    if (action === "connect") {
      const toPhone = (body.to_phone || "").replace(/\D/g, "");
      if (!toPhone) {
        return new Response(JSON.stringify({ error: "to_phone required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // phone_number_id: usa o informado ou o default do tenant
      phoneNumberId = body.phone_number_id || null;
      if (!phoneNumberId) {
        const { data: def } = await supabase
          .from("whatsapp_numbers")
          .select("phone_number_id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle();
        phoneNumberId = def?.phone_number_id || null;
      }
      if (!phoneNumberId) {
        return new Response(JSON.stringify({ error: "no phone_number_id available" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Carrega a chamada existente
      const { data: call, error: callErr } = await supabase
        .from("whatsapp_calls")
        .select("id, tenant_id, phone_number_id, wa_call_id, status, direction")
        .eq("id", call_id!)
        .maybeSingle();
      if (callErr || !call) {
        return new Response(JSON.stringify({ error: "call not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (call.tenant_id !== tenantId) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      phoneNumberId = call.phone_number_id;
      waCallId = call.wa_call_id;
      dbCallId = call.id;
    }

      return new Response(JSON.stringify({ error: "call not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica que o usuário pertence ao tenant da chamada
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile || profile.tenant_id !== call.tenant_id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve token WhatsApp do tenant pelo phone_number_id
    const { data: integrations } = await supabase
      .from("integrations")
      .select("config, status")
      .eq("tenant_id", call.tenant_id)
      .like("key", "whatsapp_%")
      .neq("status", "disabled");
    const intg = (integrations || []).find((i: any) => {
      const c = (i.config as any) || {};
      return c.phone_number_id === call.phone_number_id && (c.access_token || c.token);
    });
    const cfg = (intg?.config as any) || {};
    const waToken: string = cfg.access_token || cfg.token || "";
    if (!waToken) {
      return new Response(JSON.stringify({ error: "no WhatsApp token for this phone_number_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Monta body para Graph API
    const graphBody: Record<string, any> = {
      messaging_product: "whatsapp",
      call_id: call.wa_call_id,
      action,
    };
    if (action === "pre_accept" || action === "accept") {
      graphBody.session = { sdp_type: "answer", sdp };
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(call.phone_number_id)}/calls`;
    const graphRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${waToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(graphBody),
    });
    const graphText = await graphRes.text();
    let graphJson: any = null;
    try { graphJson = JSON.parse(graphText); } catch { /* ignore */ }

    if (!graphRes.ok) {
      console.error(`[wa-call-signaling] Graph API error ${graphRes.status}: ${graphText}`);
      // atualizar status
      await supabase.from("whatsapp_calls").update({
        status: "failed",
        error_message: `Graph ${graphRes.status}: ${graphText}`,
      }).eq("id", call.id);
      return new Response(JSON.stringify({ error: "graph api error", status: graphRes.status, details: graphJson ?? graphText }), {
        status: graphRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atualiza status local otimista
    const patch: Record<string, any> = {};
    if (action === "accept") {
      patch.status = "accepted";
      patch.answered_by = userId;
      patch.sdp_answer = sdp;
      patch.connected_at = new Date().toISOString();
    } else if (action === "pre_accept") {
      patch.status = "pre_accepted";
      patch.sdp_answer = sdp;
    } else if (action === "reject") {
      patch.status = "rejected";
      patch.ended_at = new Date().toISOString();
    } else if (action === "terminate") {
      patch.status = "completed";
      patch.ended_at = new Date().toISOString();
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("whatsapp_calls").update(patch).eq("id", call.id);
    }

    console.log(`[wa-call-signaling] ${action} OK wa_call_id=${call.wa_call_id} by user=${userId}`);
    return new Response(JSON.stringify({ ok: true, graph: graphJson }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[wa-call-signaling] error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

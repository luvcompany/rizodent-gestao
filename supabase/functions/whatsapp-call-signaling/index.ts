// WhatsApp Calling API — Signaling proxy
// Chamado pelo frontend para aceitar/pré-aceitar/rejeitar/encerrar uma chamada
// via Graph API. O SDP answer é gerado pelo navegador (RTCPeerConnection) e
// enviado aqui para forward.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { integracaoDoPnid, numeroDeSaida, numerosAtivosDaEquipe } from "../_shared/numeroDeSaida.ts";
import { mundoDoUsuario } from "../_shared/mundoNumero.ts";

const API_VERSION = "v25.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  call_id?: string; // whatsapp_calls.id (uuid) — obrigatório exceto para "connect"/"request_permission"
  action: "pre_accept" | "accept" | "reject" | "terminate" | "connect" | "request_permission";
  sdp?: string; // required for pre_accept / accept / connect
  // connect (outbound) / request_permission:
  to_phone?: string; // E.164 sem '+'
  phone_number_id?: string; // origem
  lead_id?: string | null;
  permission_text?: string; // texto opcional do pedido de permissão
}

type ResolutionRule = "body" | "lead" | "equipe";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Token de um número já escolhido (chamada existente: aceitar, recusar,
 * encerrar). A integração é achada pelo phone_number_id — o número oficial
 * vive na chave herdada `whatsapp_config`, não em `whatsapp_<id>`.
 */
async function tokenDoPnid(supabase: any, tenantId: string, phoneNumberId: string): Promise<string> {
  const [{ data: num }, { data: ints }] = await Promise.all([
    supabase.from("whatsapp_numbers").select("token").eq("tenant_id", tenantId).eq("phone_number_id", phoneNumberId).maybeSingle(),
    supabase.from("integrations").select("key, status, owner_role, config").eq("tenant_id", tenantId).like("key", "whatsapp%"),
  ]);
  const intg = integracaoDoPnid((ints || []) as any[], phoneNumberId);
  const cfg = (intg && intg.status !== "disabled" ? intg.config : null) ?? {};
  return String(cfg.access_token || cfg.token || (num as any)?.token || "");
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
    const { data: claims, error: userErr } = await userClient.auth.getClaims(jwt);
    if (userErr || !claims?.claims?.sub) {
      console.error("[wa-call-signaling] getClaims failed:", userErr);
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as Body;
    const { call_id, action, sdp } = body || ({} as Body);
    console.log(`[wa-call-signaling] request action=${action} user=${userId} to=${body?.to_phone ?? "-"} pnid=${body?.phone_number_id ?? "-"} lead=${body?.lead_id ?? "-"} sdp_len=${sdp?.length ?? 0}`);
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
    if (action !== "connect" && action !== "request_permission" && !call_id) {
      return new Response(JSON.stringify({ error: "call_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "request_permission" && !body?.to_phone) {
      return new Response(JSON.stringify({ error: "to_phone required for request_permission" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve tenant/phone_number_id/wa_call_id conforme o modo
    let phoneNumberId: string | null = null;
    let waCallId: string | null = null;
    let dbCallId: string | null = null;
    // Token do número escolhido para ligar (connect/request_permission).
    let waTokenEscolhido = "";

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
    const tenantId: string = String(profile.tenant_id);

    // Rodízio de SDRs — decisão do dono (09/09/2026): a SDR faz e atende
    // chamada de WhatsApp, mas só de lead que é dela. Esta function roda com
    // service role, então a posse é conferida aqui (mesma régua da RLS).
    let chamadorSdr = false;
    const { data: callerRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles: string[] = (callerRoles || []).map((r: any) => String(r.role));
    {
      chamadorSdr = roles.includes("sdr") && !roles.includes("superadmin");
      if (chamadorSdr && (action === "connect" || action === "request_permission")) {
        if (!body.lead_id) {
          return new Response(JSON.stringify({ error: "Informe o lead para ligar." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: dona } = await supabase
          .from("crm_leads").select("assigned_to").eq("id", body.lead_id).maybeSingle();
        if (!dona || (dona as any).assigned_to !== userId) {
          return new Response(JSON.stringify({ error: "Você só pode ligar para leads que são seus." }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // lead_id vinha do corpo sem validação: confirma que o lead é do mesmo cliente.
    let bodyLead: { tenant_id?: string | null; whatsapp_number_id?: string | null; pipeline_id?: string | null } | null = null;
    if ((action === "connect" || action === "request_permission") && body.lead_id) {
      const { data: leadRow } = await supabase
        .from("crm_leads").select("tenant_id, whatsapp_number_id, pipeline_id").eq("id", body.lead_id).maybeSingle();
      if (!leadRow || leadRow.tenant_id !== tenantId) {
        return new Response(JSON.stringify({ error: "lead de outro cliente" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bodyLead = leadRow as any;
    }



    if (action === "connect" || action === "request_permission") {
      const toPhone = (body.to_phone || "").replace(/\D/g, "");
      if (!toPhone) {
        return new Response(JSON.stringify({ error: "to_phone required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let resolutionRule: ResolutionRule | null = null;
      const pedido = body.phone_number_id ? String(body.phone_number_id) : null;

      // Por qual número ligar — sempre um número ATIVO da equipe certa, nunca
      // o whatsapp_config fixo (antes: lead sem carimbo ligava pelo número
      // legado e closer/recepção pelo número achado nos overrides, que a
      // conexão de número não grava mais).
      //  • com lead: a regra única de saída (_shared/numeroDeSaida.ts) — o
      //    número em que o paciente escreveu nas últimas 24h, o do lead, o
      //    padrão da equipe… sempre na EQUIPE do lead. O número pedido pela
      //    tela só vale se for ativo e da equipe do lead.
      //  • sem lead: os números ativos da equipe de quem liga (closer/recepção:
      //    os números de que a pessoa é dona; demais: os da central).
      if (bodyLead) {
        const leadNumberId = bodyLead.whatsapp_number_id ?? null;
        if (pedido) {
          const daEquipeDoLead = await numerosAtivosDaEquipe(supabase, { tenantId, leadNumberId });
          const doPedido = daEquipeDoLead.find((c) => c.phoneNumberId === pedido);
          if (doPedido) {
            phoneNumberId = doPedido.phoneNumberId;
            waTokenEscolhido = doPedido.token;
            resolutionRule = "body";
          } else {
            console.warn(`[wa-call-signaling] número pedido ${pedido} não é ativo da equipe do lead ${body.lead_id}; usando a regra de saída`);
          }
        }
        if (!phoneNumberId) {
          const saida = await numeroDeSaida(supabase, {
            leadId: String(body.lead_id),
            tenantId,
            leadNumberId,
            pipelineId: bodyLead.pipeline_id ?? null,
          });
          if (!saida.ok) return json({ error: saida.error }, saida.status);
          phoneNumberId = saida.phoneNumberId;
          waTokenEscolhido = saida.token;
          resolutionRule = "lead";
          console.log(`[wa-call-signaling] número do lead: ${saida.motivo}`);
        }
      } else {
        const meuMundo = mundoDoUsuario(roles);
        const minhaEquipe = { mundo: meuMundo, dono: meuMundo === "crc" ? null : userId };
        let candidatos = await numerosAtivosDaEquipe(supabase, { tenantId, equipe: minhaEquipe });
        if (pedido && !candidatos.some((c) => c.phoneNumberId === pedido)) {
          // Número de outra equipe pedido pela tela (gerência vê todos; exceção
          // do superadmin): credencial pela equipe DO NÚMERO; o acesso é
          // conferido logo abaixo pela can_access_whatsapp_number.
          const { data: numPedido } = await supabase
            .from("whatsapp_numbers").select("mundo, dono_user_id")
            .eq("tenant_id", tenantId).eq("phone_number_id", pedido).eq("is_active", true).maybeSingle();
          candidatos = numPedido
            ? await numerosAtivosDaEquipe(supabase, {
              tenantId,
              equipe: { mundo: (numPedido as any).mundo || "crc", dono: (numPedido as any).dono_user_id ?? null },
            })
            : [];
        }
        const escolhido = pedido ? candidatos.find((c) => c.phoneNumberId === pedido) : candidatos[0];
        if (escolhido) {
          phoneNumberId = escolhido.phoneNumberId;
          waTokenEscolhido = escolhido.token;
          resolutionRule = pedido ? "body" : "equipe";
        }
      }

      if (!phoneNumberId) {
        console.error(`[wa-call-signaling] no phone_number_id for tenant=${tenantId} user=${userId}`);
        return json({ error: pedido ? "Este número não está ativo nesta clínica." : "Nenhum número de WhatsApp ativo da sua equipe." }, 400);
      }
      console.log(`[wa-call-signaling] ${action} resolved phone_number_id=${phoneNumberId} tenant=${tenantId} rule=${resolutionRule ?? "none"}`);

      // Visibilidade por número (papel recepcao): barra uso de número não
      // concedido ao usuário. Número sem cadastro em whatsapp_numbers (legado
      // via integrations) não tem o que checar — segue o comportamento atual.
      const { data: waRowGuard } = await supabase
        .from("whatsapp_numbers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (waRowGuard?.id) {
        const { data: allowedNum } = await userClient.rpc("can_access_whatsapp_number", { _number_id: waRowGuard.id });
        if (allowedNum !== true) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
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

    // Token: o do número escolhido acima ou, numa chamada existente, o do
    // número que a recebeu/fez (achado pelo phone_number_id).
    const waToken: string = waTokenEscolhido || (phoneNumberId ? await tokenDoPnid(supabase, tenantId, phoneNumberId) : "");
    if (!waToken) {
      console.error(`[wa-call-signaling] no token for tenant=${tenantId} phone_number_id=${phoneNumberId}`);
      return new Response(JSON.stringify({ error: "no WhatsApp token for this phone_number_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[wa-call-signaling] token resolved (len=${waToken.length})`);

    // === Pedido de permissão de ligação (mensagem interativa nativa) ===
    // O cliente recebe no WhatsApp uma mensagem com botão "Permitir" — 1 toque
    // autoriza (temporário 7 dias ou permanente). Meta: /messages, não /calls.
    if (action === "request_permission") {
      const toPhone = (body.to_phone || "").replace(/\D/g, "");
      const permText = (body.permission_text || "Podemos te ligar pelo WhatsApp para agilizar seu atendimento?").slice(0, 1024);
      const msgUrl = `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(phoneNumberId!)}/messages`;
      const permRes = await fetch(msgUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: toPhone,
          type: "interactive",
          interactive: {
            type: "call_permission_request",
            action: { name: "call_permission_request" },
            body: { text: permText },
          },
        }),
      });
      const permText2 = await permRes.text();
      let permJson: any = null;
      try { permJson = JSON.parse(permText2); } catch { /* ignore */ }
      if (!permRes.ok) {
        console.error(`[wa-call-signaling] permission request error ${permRes.status}: ${permText2}`);
        const errObj = permJson?.error;
        // 138002 / limite de solicitações → mensagem amigável
        const friendly = /call permission|138\d{3}|already|limit/i.test(permText2)
          ? "Não foi possível enviar agora (limite: 1 pedido por 24h / conversa precisa estar ativa)."
          : (errObj?.message || "Falha ao enviar o pedido de permissão.");
        return new Response(JSON.stringify({ ok: false, code: "permission_request_failed", user_message: friendly, details: permJson ?? permText2 }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // whatsapp_number_id (uuid) do phone_number_id, para vincular
      const { data: waRowP } = await supabase
        .from("whatsapp_numbers").select("id").eq("tenant_id", tenantId).eq("phone_number_id", phoneNumberId).maybeSingle();

      // Registra/atualiza a solicitação (status 'pending' — valor aceito pelo CHECK
      // da coluna; 'requested' era inválido e a gravação falhava silenciosamente). A
      // resposta do cliente atualiza para 'approved'/'denied' via trigger em messages.
      await supabase.from("whatsapp_call_permissions").upsert({
        tenant_id: tenantId,
        whatsapp_number_id: waRowP?.id || null,
        phone_number_id: phoneNumberId,
        consumer_phone: toPhone,
        lead_id: body.lead_id ?? null,
        status: "pending",
        requested_at: new Date().toISOString(),
        raw_payload: permJson ?? null,
      } as any, { onConflict: "tenant_id,consumer_phone" });

      // Registra na conversa (se houver lead)
      if (body.lead_id) {
        const waMsgId = permJson?.messages?.[0]?.id || null;
        await supabase.from("messages").insert({
          lead_id: body.lead_id,
          tenant_id: tenantId,
          whatsapp_number_id: waRowP?.id || null,
          channel: "whatsapp",
          direction: "outbound",
          type: "text",
          content: "📞 Solicitação de permissão de ligação enviada",
          status: "sent",
          whatsapp_message_id: waMsgId,
          sender_id: userId,
        });
        await supabase.from("crm_leads").update({
          last_message: "📞 Solicitação de permissão de ligação",
          last_message_at: new Date().toISOString(),
          last_outbound_at: new Date().toISOString(),
        }).eq("id", body.lead_id).eq("tenant_id", tenantId);
      }

      console.log(`[wa-call-signaling] permission request sent to ${toPhone} by user=${userId}`);
      return new Response(JSON.stringify({ ok: true, message: "permission_requested" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Monta body para Graph API
    const graphBody: Record<string, any> = {
      messaging_product: "whatsapp",
      action,
    };
    if (action === "connect") {
      graphBody.to = body.to_phone!.replace(/\D/g, "");
      graphBody.session = { sdp_type: "offer", sdp };
    } else {
      graphBody.call_id = waCallId;
      if (action === "pre_accept" || action === "accept") {
        graphBody.session = { sdp_type: "answer", sdp };
      }
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(phoneNumberId!)}/calls`;
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
      if (dbCallId) {
        await supabase.from("whatsapp_calls").update({
          status: "failed",
          error_message: `Graph ${graphRes.status}: ${graphText}`,
        }).eq("id", dbCallId);
      }

      // Mapeia erros conhecidos da Graph API para códigos de negócio
      const graphCode = graphJson?.error?.code;
      const knownBusinessErrors: Record<number, { code: string; user_message: string }> = {
        138006: {
          code: "no_call_permission",
          user_message: "Este contato ainda não autorizou receber ligações pelo WhatsApp Business.",
        },
      };
      const mapped = typeof graphCode === "number" ? knownBusinessErrors[graphCode] : undefined;
      if (mapped) {
        return new Response(
          JSON.stringify({ ok: false, code: mapped.code, user_message: mapped.user_message, graph_code: graphCode }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: "graph api error", status: graphRes.status, details: graphJson ?? graphText }), {
        status: graphRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Para "connect", cria/upserta linha em whatsapp_calls com o wa_call_id retornado
    if (action === "connect") {
      const returnedWaCallId: string | null =
        graphJson?.messaging?.calls?.[0]?.id ||
        graphJson?.calls?.[0]?.id ||
        graphJson?.id ||
        null;
      if (!returnedWaCallId) {
        console.error("[wa-call-signaling] connect ok but no wa_call_id in response:", graphText);
      }

      // Descobre whatsapp_number_id
      const { data: waRow } = await supabase
        .from("whatsapp_numbers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();

      const { data: inserted, error: insErr } = await supabase
        .from("whatsapp_calls")
        .insert({
          tenant_id: tenantId,
          whatsapp_number_id: waRow?.id || null,
          phone_number_id: phoneNumberId,
          wa_call_id: returnedWaCallId,
          lead_id: body.lead_id || null,
          from_phone: null,
          to_phone: graphBody.to,
          direction: "outbound",
          status: "ringing",
          event: "connect",
          sdp_offer: sdp,
          initiated_by: userId,
          started_at: new Date().toISOString(),
          raw_payload: graphJson,
        })
        .select("id")
        .maybeSingle();
      if (insErr) console.error("[wa-call-signaling] insert whatsapp_calls error:", insErr);

      // Registra a chamada como mensagem na conversa
      if (body.lead_id && returnedWaCallId) {
        const { error: msgErr } = await supabase.from("messages").insert({
          lead_id: body.lead_id,
          tenant_id: tenantId,
          whatsapp_number_id: waRow?.id || null,
          channel: "whatsapp",
          direction: "outbound",
          type: "call",
          content: "📞 Chamada de voz",
          status: "sent",
          whatsapp_message_id: `call:${returnedWaCallId}`,
          sender_id: userId,
        });
        if (msgErr) console.error("[wa-call-signaling] insert call message error:", msgErr);
        await supabase.from("crm_leads").update({
          last_message: "📞 Chamada de voz",
          last_message_at: new Date().toISOString(),
          last_outbound_at: new Date().toISOString(),
        }).eq("id", body.lead_id).eq("tenant_id", tenantId);
      }

      console.log(`[wa-call-signaling] connect OK wa_call_id=${returnedWaCallId} by user=${userId}`);
      return new Response(JSON.stringify({ ok: true, call_id: inserted?.id, wa_call_id: returnedWaCallId, graph: graphJson }), {
        status: 200,
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
    if (Object.keys(patch).length > 0 && dbCallId) {
      await supabase.from("whatsapp_calls").update(patch).eq("id", dbCallId);
    }

    console.log(`[wa-call-signaling] ${action} OK wa_call_id=${waCallId} by user=${userId}`);
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

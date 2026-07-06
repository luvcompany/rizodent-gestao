import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// America/Bahia is UTC-3 fixed (no DST).
function bahiaTimeOfDay(): { hh: number; mm: number; minutes: number } {
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const localMin = (utcMin - 180 + 24 * 60) % (24 * 60);
  return { hh: Math.floor(localMin / 60), mm: localMin % 60, minutes: localMin };
}
function parseHMM(s: string): number {
  const [h, m] = String(s || "00:00").split(":").map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const auth = await authorizeInternal(req, supabase, { cronSecretName: "ai_autosend_cron_token" });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);

  try {
    // Per-tenant config cache: never fall back to another tenant's config
    const configCache = new Map<string, any | null>();
    async function getTenantConfig(tenantId: string): Promise<any | null> {
      if (configCache.has(tenantId)) return configCache.get(tenantId) ?? null;
      const { data } = await supabase
        .from("ai_assistant_config")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      configCache.set(tenantId, data || null);
      return data || null;
    }

    const now = new Date();
    const localMin = bahiaTimeOfDay().minutes;

    // Fetch pending reply suggestions (limit batch)
    const { data: pending } = await supabase
      .from("ai_reply_suggestions")
      .select("id, lead_id, suggested_text, action, created_at")
      .eq("status", "pending")
      .eq("action", "reply")
      .order("created_at", { ascending: true })
      .limit(50);

    const processed: any[] = [];
    for (const s of pending || []) {
      try {
        const { data: lead } = await supabase
          .from("crm_leads")
          .select("id, tenant_id, phone, last_inbound_at, instagram_user_id")
          .eq("id", s.lead_id)
          .maybeSingle();
        if (!lead || !lead.phone || lead.instagram_user_id) {
          processed.push({ id: s.id, skipped: "no_phone_or_instagram" });
          continue;
        }

        if (!lead.tenant_id) { processed.push({ id: s.id, skipped: "no_config" }); continue; }
        const config = await getTenantConfig(lead.tenant_id);
        if (!config) { processed.push({ id: s.id, skipped: "no_config" }); continue; }
        if (config.auto_send_enabled !== true) { processed.push({ id: s.id, skipped: "auto_send_disabled" }); continue; }

        const waitMinutes = Math.max(0, Number(config.wait_minutes) || 10);
        const recoilHours = Math.max(0, Number(config.recoil_hours) || 2);
        const shiftStart = parseHMM(config.shift_start || "07:29");
        const shiftEnd = parseHMM(config.shift_end || "14:00");
        const inShift = localMin >= shiftStart && localMin <= shiftEnd;

        const lastInbound = lead.last_inbound_at ? new Date(lead.last_inbound_at) : null;
        if (!lastInbound) { processed.push({ id: s.id, skipped: "no_last_inbound" }); continue; }

        // 24h Meta window
        if ((now.getTime() - lastInbound.getTime()) > 24 * 3600 * 1000) {
          await supabase.from("ai_reply_suggestions").update({ status: "discarded", decided_at: now.toISOString() }).eq("id", s.id);
          processed.push({ id: s.id, skipped: "outside_24h" });
          continue;
        }

        // wait_minutes since last inbound
        if ((now.getTime() - lastInbound.getTime()) < waitMinutes * 60 * 1000) {
          processed.push({ id: s.id, skipped: "wait_minutes_not_elapsed" });
          continue;
        }

        // Check messages after suggestion: if client OR sdr responded after the suggestion, supersede
        const { data: msgsAfter } = await supabase
          .from("messages")
          .select("id, direction, type, created_at, status")
          .eq("lead_id", lead.id)
          .gt("created_at", s.created_at)
          .is("deleted_at", null)
          .order("created_at", { ascending: true });

        const newInbound = (msgsAfter || []).find((m: any) => m.direction === "inbound");
        if (newInbound) {
          await supabase.from("ai_reply_suggestions").update({ status: "superseded", decided_at: now.toISOString() }).eq("id", s.id);
          processed.push({ id: s.id, skipped: "superseded_by_inbound" });
          continue;
        }
        const newOutboundHuman = (msgsAfter || []).find((m: any) => m.direction === "outbound" && m.type === "text" && m.status !== "template" && m.status !== "bot");
        if (newOutboundHuman) {
          await supabase.from("ai_reply_suggestions").update({ status: "discarded", decided_at: now.toISOString() }).eq("id", s.id);
          processed.push({ id: s.id, skipped: "discarded_human_replied" });
          continue;
        }

        // Within SDR shift: skip if a human SDR replied (outbound text, not template/bot) within recoil_hours
        if (inShift && recoilHours > 0) {
          const cutoff = new Date(now.getTime() - recoilHours * 3600 * 1000).toISOString();
          const { data: recentHuman } = await supabase
            .from("messages")
            .select("id, status, type")
            .eq("lead_id", lead.id)
            .eq("direction", "outbound")
            .eq("type", "text")
            .gte("created_at", cutoff)
            .limit(20);
          const hasHuman = (recentHuman || []).some((m: any) => m.status !== "template" && m.status !== "bot");
          if (hasHuman) {
            processed.push({ id: s.id, skipped: "sdr_in_shift_recoil" });
            continue;
          }
        }

        // Send via send-whatsapp-message
        const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY,
          },
          body: JSON.stringify({ lead_id: lead.id, to: lead.phone, message: s.suggested_text, type: "text" }),
        });
        const sendText = await sendResp.text();
        if (!sendResp.ok) {
          processed.push({ id: s.id, send_error: `${sendResp.status}: ${sendText.slice(0, 200)}` });
          continue;
        }

        await supabase
          .from("ai_reply_suggestions")
          .update({ status: "auto_sent", decided_at: now.toISOString() })
          .eq("id", s.id);
        processed.push({ id: s.id, sent: true });
      } catch (e: any) {
        processed.push({ id: s.id, error: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, count: processed.length, processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("auto-send-suggestions error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// Instagram Lite Webhook — independente da integração Meta API antiga.
// Lê contas da tabela `ig_accounts` (manuais) e processa DMs/comments
// usando o access_token salvo por conta.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("INSTAGRAM_LITE_VERIFY_TOKEN") ?? "";

// Pipeline padrão para leads vindos do Instagram Lite (mesmo do IG legado)
const INSTAGRAM_PIPELINE_ID = "c2d3e4f5-0001-4000-8000-000000000002";

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface IgAccountRow {
  id: string;
  ig_user_id: string;
  username: string | null;
  access_token: string;
  active: boolean;
  token_expires_at: string | null;
}

const profileCache = new Map<
  string,
  { name: string | null; username: string | null; profile_pic: string | null }
>();

async function fetchIgProfile(igUserId: string, accessToken: string) {
  if (profileCache.has(igUserId)) return profileCache.get(igUserId)!;
  let out = { name: null as string | null, username: null as string | null, profile_pic: null as string | null };
  try {
    const url = `https://graph.facebook.com/v25.0/${igUserId}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      out = {
        name: j?.name ?? null,
        username: j?.username ?? null,
        profile_pic: j?.profile_pic ?? null,
      };
    }
  } catch (e) {
    console.warn("[ig-lite] fetchIgProfile error", igUserId, e);
  }
  profileCache.set(igUserId, out);
  return out;
}

async function findOrCreateLead(
  igUserId: string,
  profile: { name: string | null; username: string | null; profile_pic: string | null },
  accountUsername: string | null
): Promise<string | null> {
  if (!igUserId) return null;

  const { data: existing } = await supabase
    .from("crm_leads")
    .select("id, instagram_username, instagram_profile_pic_url, name, is_blocked")
    .eq("instagram_user_id", igUserId)
    .maybeSingle();

  if (existing && (existing as any).is_blocked) {
    console.log(`[ig-lite] Lead ${existing.id} bloqueado — descartado.`);
    return null;
  }
  if (existing) {
    const updates: Record<string, unknown> = {};
    if (profile.username && existing.instagram_username !== profile.username) {
      updates.instagram_username = profile.username;
    }
    if (profile.profile_pic && existing.instagram_profile_pic_url !== profile.profile_pic) {
      updates.instagram_profile_pic_url = profile.profile_pic;
    }
    if (existing.name?.startsWith("IG ")) {
      const better = profile.name || profile.username;
      if (better) updates.name = better;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from("crm_leads").update(updates).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: firstStage } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", INSTAGRAM_PIPELINE_ID)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStage) {
    console.error("[ig-lite] No stages in Instagram pipeline");
    return null;
  }

  const displayName = profile.name || profile.username || `IG ${igUserId.slice(0, 8)}`;
  const sourceLabel = accountUsername ? `Instagram Lite (@${accountUsername})` : "Instagram Lite";

  const { data: created, error: createErr } = await supabase
    .from("crm_leads")
    .insert({
      name: displayName,
      pipeline_id: INSTAGRAM_PIPELINE_ID,
      stage_id: firstStage.id,
      source: sourceLabel,
      instagram_user_id: igUserId,
      instagram_username: profile.username,
      instagram_profile_pic_url: profile.profile_pic,
    })
    .select("id")
    .single();

  if (createErr) {
    console.error("[ig-lite] Failed to create lead:", createErr);
    return null;
  }
  return created.id;
}

async function persistDm(opts: {
  account: IgAccountRow;
  senderId: string;
  text: string | null;
  igMessageId: string | null;
}) {
  const profile = await fetchIgProfile(opts.senderId, opts.account.access_token);

  const { data: blockedCheck } = await supabase
    .from("crm_leads")
    .select("id, is_blocked")
    .eq("instagram_user_id", opts.senderId)
    .maybeSingle();
  if (blockedCheck && (blockedCheck as any).is_blocked) return;

  const leadId = await findOrCreateLead(opts.senderId, profile, opts.account.username);
  if (!leadId) return;

  await supabase.from("messages").insert({
    lead_id: leadId,
    direction: "inbound",
    type: "text",
    content: opts.text,
    channel: "instagram",
    instagram_message_id: opts.igMessageId,
    instagram_sender_id: opts.senderId,
    status: "received",
  });

  await supabase
    .from("crm_leads")
    .update({
      last_message: opts.text,
      last_message_at: new Date().toISOString(),
      last_inbound_at: new Date().toISOString(),
    })
    .eq("id", leadId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // GET — Meta verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (req.method === "POST") {
    const rawBody = await req.text();
    try {
      const payload = JSON.parse(rawBody);
      console.log("[ig-lite] payload:", JSON.stringify(payload));

      const entries = Array.isArray(payload?.entry) ? payload.entry : [];

      for (const entry of entries) {
        const accountId: string = String(entry?.id ?? "");
        if (!accountId) continue;

        // Buscar conta na tabela ig_accounts
        const { data: account } = await supabase
          .from("ig_accounts")
          .select("id, ig_user_id, username, access_token, active, token_expires_at")
          .eq("ig_user_id", accountId)
          .maybeSingle();

        if (!account) {
          console.log(`[ig-lite] Conta ${accountId} não cadastrada — ignorada.`);
          continue;
        }
        if (!account.active) {
          console.log(`[ig-lite] Conta ${accountId} inativa — ignorada.`);
          continue;
        }
        if (
          account.token_expires_at &&
          new Date(account.token_expires_at).getTime() < Date.now()
        ) {
          console.log(`[ig-lite] Token expirado para ${accountId} — ignorado.`);
          continue;
        }

        const acc = account as IgAccountRow;

        // DMs
        const messagingArr = Array.isArray(entry?.messaging) ? entry.messaging : [];
        for (const m of messagingArr) {
          if (!m?.message || m?.message?.is_echo) continue;
          const senderId = String(m?.sender?.id ?? "");
          if (!senderId || senderId === accountId) continue;
          await persistDm({
            account: acc,
            senderId,
            text: m?.message?.text ?? null,
            igMessageId: m?.message?.mid ?? null,
          });
        }

        // changes (formato alternativo)
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          if (change?.field !== "messages") continue;
          const value = change?.value ?? {};
          const senderId = String(value?.sender?.id ?? value?.from?.id ?? "");
          if (!senderId || senderId === accountId) continue;
          await persistDm({
            account: acc,
            senderId,
            text: value?.message?.text ?? value?.text ?? null,
            igMessageId: value?.message?.mid ?? value?.mid ?? null,
          });
        }
      }
    } catch (err) {
      console.error("[ig-lite] error:", err);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
});

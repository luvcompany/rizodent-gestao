// One-shot backfill: fills instagram_post_thumbnail / instagram_post_permalink
// and instagram_account_id on messages of type='comment' that are missing them.
//
// Auth: requires service role bearer or any authenticated user (admin-like).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fetchPostInfo(postId: string, accessToken: string) {
  const isIgLite = accessToken.startsWith("IGAA");
  const base = isIgLite ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v25.0";
  const url = `${base}/${postId}?fields=media_type,media_url,thumbnail_url,permalink&access_token=${encodeURIComponent(accessToken)}`;
  try {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { thumbnail: null as string | null, permalink: null as string | null, error: j };
    return { thumbnail: j?.thumbnail_url || j?.media_url || null, permalink: j?.permalink || null, error: null };
  } catch (e) {
    return { thumbnail: null, permalink: null, error: String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Load all ig_accounts once: ig_user_id -> token
  const { data: igAccs } = await supabase
    .from("ig_accounts")
    .select("ig_user_id, access_token, active");
  const tokenByIg = new Map<string, string>();
  for (const a of igAccs ?? []) {
    if (a.active && a.access_token) tokenByIg.set(a.ig_user_id, a.access_token);
  }

  // Pull all comment messages missing thumbnail OR account id
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id, instagram_comment_id, instagram_post_id, instagram_post_thumbnail, instagram_account_id, lead_id")
    .eq("type", "comment")
    .limit(2000);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const errors: any[] = [];

  for (const m of msgs ?? []) {
    processed++;
    // Resolve account from instagram_messages by comment_id or lead_id
    let accountId: string | null = m.instagram_account_id ?? null;
    if (!accountId) {
      const filter = m.instagram_comment_id
        ? supabase.from("instagram_messages").select("instagram_account_id").eq("comment_id", m.instagram_comment_id).limit(1).maybeSingle()
        : supabase.from("instagram_messages").select("instagram_account_id").eq("lead_id", m.lead_id).not("instagram_account_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: imRow } = await filter;
      accountId = (imRow as any)?.instagram_account_id ?? null;
    }

    const update: Record<string, unknown> = {};
    if (accountId && !m.instagram_account_id) update.instagram_account_id = accountId;

    if (!m.instagram_post_thumbnail && m.instagram_post_id && accountId) {
      const token = tokenByIg.get(accountId);
      if (token) {
        const info = await fetchPostInfo(m.instagram_post_id, token);
        if (info.thumbnail) update.instagram_post_thumbnail = info.thumbnail;
        if (info.permalink) update.instagram_post_permalink = info.permalink;
        if (!info.thumbnail && !info.permalink && info.error) errors.push({ id: m.id, postId: m.instagram_post_id, error: info.error });
      } else {
        skipped++;
      }
    }

    if (Object.keys(update).length > 0) {
      const { error: uErr } = await supabase.from("messages").update(update).eq("id", m.id);
      if (uErr) errors.push({ id: m.id, error: uErr.message });
      else updated++;
    }
  }

  return new Response(JSON.stringify({ processed, updated, skipped, errors_sample: errors.slice(0, 5) }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

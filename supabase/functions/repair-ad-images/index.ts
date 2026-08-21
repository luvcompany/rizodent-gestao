import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeInternal } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Job de batch: cron ou chamada interna com service role (comparação em tempo
  // constante dentro de authorizeInternal — substitui o `auth !== expected`).
  const gate = await authorizeInternal(req, supabase, { cronSecretName: "automation_cron_token" });
  if (!gate.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {

    // Find leads with ad_id but missing imagem_origem
    const { data: leads, error } = await supabase
      .from("crm_leads")
      .select("id, ad_id, link_anuncio, pipeline_id, tenant_id")
      .not("ad_id", "is", null)
      .is("imagem_origem", null)
      .limit(50);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No leads to repair", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get integrations for tokens (com tenant — o fallback NUNCA cruza tenants)
    const { data: integrations } = await supabase
      .from("integrations")
      .select("key, config, status, tenant_id");
    const whatsappIntegrations = (integrations || []).filter(
      (i: any) => i.key.startsWith("whatsapp") && i.status === "connected"
    );

    // Token só do MESMO tenant do lead. Sem integração própria => pula o lead
    // (antes o fallback usava o token de qualquer tenant conectado).
    const getToken = (pipelineId: string, tenantId: string | null): string => {
      if (!tenantId) return "";
      const ofTenant = whatsappIntegrations.filter((i: any) => i.tenant_id === tenantId);
      for (const integ of ofTenant) {
        const cfg = integ.config as any;
        if (cfg?.pipeline_id === pipelineId && cfg?.access_token) return cfg.access_token;
      }
      for (const integ of ofTenant) {
        const cfg = integ.config as any;
        if (cfg?.access_token) return cfg.access_token;
      }
      return "";
    };

    let repaired = 0;

    for (const lead of leads) {
      const adSourceId = lead.ad_id;
      const token = getToken(lead.pipeline_id, (lead as any).tenant_id ?? null);
      if (!token || !adSourceId) continue;

      let imageUrl: string | null = null;

      // Method 1: Ad creative endpoint
      try {
        const adRes = await fetch(
          `https://graph.facebook.com/v25.0/${encodeURIComponent(adSourceId)}?fields=creative{thumbnail_url,image_url,object_story_spec}&access_token=${token}`
        );
        if (adRes.ok) {
          const adData = await adRes.json();
          const creative = adData.creative;
          if (creative) {
            imageUrl = creative.image_url
              || creative.thumbnail_url
              || creative.object_story_spec?.link_data?.picture
              || creative.object_story_spec?.link_data?.image_url
              || creative.object_story_spec?.video_data?.image_url
              || null;
          }
        }
      } catch (_) { /* skip */ }

      // Method 2: adcreatives endpoint
      if (!imageUrl) {
        try {
          const crRes = await fetch(
            `https://graph.facebook.com/v25.0/${encodeURIComponent(adSourceId)}/adcreatives?fields=thumbnail_url,image_url,effective_object_story_id&access_token=${token}`
          );
          if (crRes.ok) {
            const crData = await crRes.json();
            const cr = crData.data?.[0];
            if (cr) {
              imageUrl = cr.image_url || cr.thumbnail_url || null;
              const storyId = cr.effective_object_story_id;
              if (!imageUrl && storyId) {
                try {
                  const postRes = await fetch(
                    `https://graph.facebook.com/v25.0/${encodeURIComponent(storyId)}?fields=full_picture,picture&access_token=${token}`
                  );
                  if (postRes.ok) {
                    const postData = await postRes.json();
                    imageUrl = postData.full_picture || postData.picture || null;
                  }
                } catch (_) { /* skip */ }
              }
            }
          }
        } catch (_) { /* skip */ }
      }

      // Method 3: oEmbed for Instagram posts
      if (!imageUrl && lead.link_anuncio) {
        try {
          const igMatch = lead.link_anuncio.match(/instagram\.com\/p\/([^/?]+)/);
          if (igMatch) {
            const oembedRes = await fetch(
              `https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(lead.link_anuncio)}&access_token=${token}`
            );
            if (oembedRes.ok) {
              const oembedData = await oembedRes.json();
              imageUrl = oembedData.thumbnail_url || null;
            }
          }
        } catch (_) { /* skip */ }
      }

      if (imageUrl) {
        await supabase.from("crm_leads").update({ imagem_origem: imageUrl }).eq("id", lead.id);

        // Also update the first inbound message with ad info
        await supabase
          .from("messages")
          .update({ ad_image_url: imageUrl })
          .eq("lead_id", lead.id)
          .not("ad_source_id", "is", null)
          .is("ad_image_url", null);

        repaired++;
        console.log(`[REPAIR] Lead ${lead.id}: image set to ${imageUrl}`);
      } else {
        console.log(`[REPAIR] Lead ${lead.id}: no image found for ad ${adSourceId}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, total: leads.length, repaired }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[REPAIR] Error:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

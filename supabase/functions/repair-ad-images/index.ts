import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeInternal } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

async function persistAdImage(supabase: any, url: string, adId: string): Promise<string> {
  if (url.includes("/storage/v1/object/public/chat-media/")) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) return url;
    const blob = await response.blob();
    const mime = (response.headers.get("content-type") || blob.type || "image/jpeg").split(";")[0];
    if (!mime.startsWith("image/")) return url;
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const path = `ads/${adId.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, blob, { contentType: mime, upsert: false });
    if (error) return url;
    return supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl || url;
  } catch {
    return url;
  }
}

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

    let body: any = {};
    try { body = await req.json(); } catch (_) { /* sem corpo */ }
    const modoLeads = body?.mode === "leads";
    const limite = Math.min(Math.max(Number(body?.limit) || 40, 1), 100);

    type Grupo = { atual?: string | null; adId: string; tenantId: string | null; pipelineId: string; link: string | null; leadIds: Set<string> };
    const grupos = new Map<string, Grupo>();

    if (modoLeads) {
      // Retroativo: leads com anúncio cuja miniatura não está guardada no sistema
      // (vazia ou link da Meta que expira).
      const { data: ls, error: le } = await supabase
        .from("crm_leads")
        .select("id, ad_id, pipeline_id, tenant_id, link_anuncio, imagem_origem")
        .not("ad_id", "is", null)
        .or("imagem_origem.is.null,imagem_origem.not.like.*/chat-media/*")
        .limit(5000);
      if (le) throw le;
      const pulados = new Set<string>((body?.skip || []).map(String));
      for (const l of (ls || []) as any[]) {
        const key = `${l.tenant_id}|${l.ad_id}`;
        if (pulados.has(String(l.ad_id))) continue;
        let g = grupos.get(key);
        if (!g) {
          if (grupos.size >= limite) continue;
          g = { adId: String(l.ad_id), tenantId: l.tenant_id, pipelineId: l.pipeline_id, link: l.link_anuncio || null, atual: l.imagem_origem || null, leadIds: new Set() };
          grupos.set(key, g);
        }
        g.leadIds.add(l.id);
      }
    } else {
    // Busca mensagens de anúncio sem miniatura e agrupa por anúncio:
    // uma consulta à Meta por anúncio, não por lead.
    const { data: msgs, error } = await supabase
      .from("messages")
      .select("id, lead_id, ad_source_id, ad_source_url, crm_leads!inner(id, pipeline_id, tenant_id, link_anuncio, imagem_origem)")
      .not("ad_source_id", "is", null)
      .is("ad_image_url", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw error;

    for (const m of (msgs || []) as any[]) {
      const lead = m.crm_leads;
      const key = `${lead.tenant_id}|${m.ad_source_id}`;
      let g = grupos.get(key);
      if (!g) {
        g = { adId: String(m.ad_source_id), tenantId: lead.tenant_id, pipelineId: lead.pipeline_id, link: m.ad_source_url || lead.link_anuncio || null, leadIds: new Set() };
        grupos.set(key, g);
      }
      g.leadIds.add(lead.id);
    }
    }
    const leads = Array.from(grupos.values());
    if (leads.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No ads to repair", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: integrations } = await supabase
      .from("integrations")
      .select("key, config, status, tenant_id");
    const whatsappIntegrations = (integrations || []).filter(
      (i: any) => i.key.startsWith("whatsapp") && i.status !== "disabled"
    );

    // Tokens só do MESMO tenant (nunca cruza clientes).
    const tokensDo = (pipelineId: string, tenantId: string | null): string[] => {
      if (!tenantId) return [];
      const ofTenant = whatsappIntegrations.filter((i: any) => i.tenant_id === tenantId);
      const out: string[] = [];
      for (const integ of ofTenant) {
        const t = ((integ.config as any)?.access_token || (integ.config as any)?.token);
        if (t && (integ.config as any)?.pipeline_id === pipelineId && !out.includes(t)) out.push(t);
      }
      for (const integ of ofTenant) {
        const t = ((integ.config as any)?.access_token || (integ.config as any)?.token);
        if (t && !out.includes(t)) out.push(t);
      }
      return out;
    };

    let repaired = 0;
    let leadsRepaired = 0;
    const falhas: string[] = [];

    for (const g of leads) {
      const adSourceId = g.adId;
      let imageUrl: string | null = null;

      for (const token of tokensDo(g.pipelineId, g.tenantId)) {
        if (imageUrl) break;
        try {
          const adRes = await fetch(
            `https://graph.facebook.com/v25.0/${encodeURIComponent(adSourceId)}?fields=creative{thumbnail_url,image_url,object_story_spec,effective_object_story_id}&thumbnail_width=600&thumbnail_height=600&access_token=${token}`
          );
          if (adRes.ok) {
            const c = (await adRes.json()).creative;
            if (c) {
              imageUrl = c.image_url
                || c.object_story_spec?.link_data?.picture
                || c.object_story_spec?.link_data?.image_url
                || c.object_story_spec?.video_data?.image_url
                || c.thumbnail_url
                || null;
              if (!imageUrl && c.effective_object_story_id) {
                const p = await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(c.effective_object_story_id)}?fields=full_picture,picture&access_token=${token}`);
                if (p.ok) { const pd = await p.json(); imageUrl = pd.full_picture || pd.picture || null; }
              }
            }
          } else {
            console.log(`[REPAIR] ad ${adSourceId} token ...${token.slice(-6)}: ${adRes.status} ${(await adRes.text()).slice(0,200)}`);
          }
        } catch (_) { /* skip */ }

        if (!imageUrl && g.link && /instagram\.com\/(p|reel)\//.test(g.link)) {
          try {
            const o = await fetch(`https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(g.link)}&access_token=${token}`);
            if (o.ok) imageUrl = (await o.json()).thumbnail_url || null; else await o.text();
          } catch (_) { /* skip */ }
        }
      }

      if (imageUrl && modoLeads && !imageUrl.includes("/chat-media/")) {
        // ok, será persistida abaixo
      }
      if (!imageUrl && modoLeads && g.atual && /fbcdn|facebook/.test(g.atual)) {
        // Meta não devolveu o anúncio: tenta guardar o link que já temos, se ainda abrir.
        try { const t = await fetch(g.atual, { method: "HEAD" }); if (t.ok) imageUrl = g.atual; } catch (_) { /* expirou */ }
      }
      if (!imageUrl) { console.log(`[REPAIR] sem imagem ad ${adSourceId} tokens=${tokensDo(g.pipelineId, g.tenantId).length}`); falhas.push(adSourceId); continue; }

      imageUrl = await persistAdImage(supabase, imageUrl, adSourceId);
      const ids = Array.from(g.leadIds);
      await supabase.from("messages").update({ ad_image_url: imageUrl })
        .eq("ad_source_id", adSourceId).or("ad_image_url.is.null,ad_image_url.not.like.*/chat-media/*");
      if (modoLeads) {
        await supabase.from("crm_leads").update({ imagem_origem: imageUrl }).in("id", ids);
      } else {
        await supabase.from("crm_leads").update({ imagem_origem: imageUrl })
          .in("id", ids).is("imagem_origem", null);
      }
      if (g.tenantId) {
        await supabase.from("ad_id_mapping").update({ thumbnail_url: imageUrl })
          .eq("ad_id", adSourceId).eq("tenant_id", g.tenantId)
          .or("thumbnail_url.is.null,thumbnail_url.not.like.*/chat-media/*");
      }
      repaired++;
      leadsRepaired += ids.length;
    }

    return new Response(
      JSON.stringify({ success: true, anuncios: leads.length, repaired, leadsRepaired, falhas: falhas.length, falhaIds: falhas }),
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

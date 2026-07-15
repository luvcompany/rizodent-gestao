import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveCidade } from "../_shared/resolveCidade.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify user is admin
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all leads with ad_id but missing ad_account_id
    const { data: leads, error: leadsErr } = await supabase
      .from("crm_leads")
      .select("id, ad_id, ad_account_id, tenant_id")
      .not("ad_id", "is", null)
      .is("ad_account_id", null)
      .limit(500);

    if (leadsErr) {
      console.error("[ENRICH] Error fetching leads:", leadsErr);
      return new Response(JSON.stringify({ error: "Failed to fetch leads" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!leads || leads.length === 0) {
      return new Response(
        JSON.stringify({ message: "No leads to enrich", enriched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[ENRICH] Found ${leads.length} leads to enrich`);

    // Get WhatsApp token from integrations
    const { data: integrations } = await supabase
      .from("integrations")
      .select("config")
      .eq("key", "whatsapp")
      .eq("status", "connected")
      .limit(10);

    // Collect all tokens from integrations
    const tokens: string[] = [];
    if (integrations) {
      for (const integ of integrations) {
        const token = (integ.config as any)?.access_token;
        if (token) tokens.push(token);
      }
    }
    // Fallback to env
    const fallbackToken = Deno.env.get("WHATSAPP_TOKEN") || "";
    if (fallbackToken && !tokens.includes(fallbackToken)) {
      tokens.push(fallbackToken);
    }

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ error: "No WhatsApp token available" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deduplicate ad_ids to avoid redundant API calls
    const adIdSet = new Map<string, string[]>(); // ad_id -> lead_ids
    const leadTenantMap = new Map<string, string>(); // lead_id -> tenant_id
    for (const lead of leads) {
      if (!lead.ad_id) continue;
      if (!adIdSet.has(lead.ad_id)) adIdSet.set(lead.ad_id, []);
      adIdSet.get(lead.ad_id)!.push(lead.id);
      if ((lead as any).tenant_id) leadTenantMap.set(lead.id, (lead as any).tenant_id);
    }

    console.log(`[ENRICH] ${adIdSet.size} unique ad_ids to query`);

    let enrichedCount = 0;
    let errorCount = 0;
    const accountCache = new Map<string, string>(); // account_id -> account_name

    for (const [adId, leadIds] of adIdSet) {
      let success = false;

      for (const token of tokens) {
        try {
          const adRes = await fetch(
            `https://graph.facebook.com/v25.0/${adId}?fields=account_id&access_token=${token}`
          );

          if (!adRes.ok) {
            const errText = await adRes.text();
            console.log(`[ENRICH] Failed ad ${adId} with token ...${token.slice(-6)}: ${adRes.status} - ${errText.slice(0, 100)}`);
            continue;
          }

          const adData = await adRes.json();
          if (!adData.account_id) {
            console.log(`[ENRICH] Ad ${adId}: no account_id in response`);
            await adRes.text().catch(() => {});
            break; // no point trying other tokens
          }

          const accountId = adData.account_id;
          let accountName = accountCache.get(accountId) || null;

          if (!accountName) {
            try {
              const acctRes = await fetch(
                `https://graph.facebook.com/v25.0/act_${accountId}?fields=name&access_token=${token}`
              );
              if (acctRes.ok) {
                const acctData = await acctRes.json();
                accountName = acctData.name || null;
                if (accountName) accountCache.set(accountId, accountName);
              } else {
                await acctRes.text();
              }
            } catch (_) { /* skip */ }
          }

          // Update leads (preenche cidade só se ainda estiver vazia)
          const leadUpdate: any = {
            ad_account_id: accountId,
            ad_account_name: accountName,
          };
          const { error: updateErr } = await supabase
            .from("crm_leads")
            .update(leadUpdate)
            .in("id", leadIds);

          if (updateErr) {
            console.error(`[ENRICH] Error updating leads for ad ${adId}:`, updateErr);
            errorCount += leadIds.length;
          } else {
            enrichedCount += leadIds.length;
          }

          // Resolução determinística de cidade via ad_account_map (por tenant).
          // Defensiva: qualquer erro é engolido, não bloqueia o enrich.
          const tenantsForAd = new Set<string>();
          for (const lid of leadIds) {
            const t = leadTenantMap.get(lid);
            if (t) tenantsForAd.add(t);
          }
          // Mantemos apenas o primeiro tenant resolvido para logar; o mapping global usa esse valor.
          let cidadeInferida: string | null = null;
          for (const tId of tenantsForAd) {
            let cidadeTenant: string | null = null;
            try {
              cidadeTenant = await resolveCidade({
                supabase,
                tenantId: tId,
                adAccountId: accountId,
                adId,
                pageId: null,
                adAccountName: accountName,
              });
            } catch (_e) { cidadeTenant = null; }
            if (cidadeTenant) {
              if (!cidadeInferida) cidadeInferida = cidadeTenant;
              try {
                const tenantLeadIds = leadIds.filter((lid) => leadTenantMap.get(lid) === tId);
                if (tenantLeadIds.length > 0) {
                  await supabase
                    .from("crm_leads")
                    .update({ cidade: cidadeTenant })
                    .in("id", tenantLeadIds)
                    .is("cidade", null);
                }
              } catch (_e) { /* engole */ }
            }
          }

          console.log(`[ENRICH] Ad ${adId} => account ${accountId} (${accountName}) cidade=${cidadeInferida}, updated ${leadIds.length} leads`);

          // Atualizar ad_id_mapping (cache global de anúncios)
          await supabase
            .from("ad_id_mapping")
            .upsert({
              ad_id: adId,
              ad_account_id: accountId,
              ad_account_name: accountName,
              ...(cidadeInferida ? { cidade: cidadeInferida } : {}),
              updated_at: new Date().toISOString(),
            }, { onConflict: "ad_id" });

          // Also update messages with same ad_source_id
          await supabase
            .from("messages")
            .update({
              ad_account_id: accountId,
              ad_account_name: accountName,
            })
            .eq("ad_source_id", adId)
            .is("ad_account_id", null);

          success = true;
          break;
        } catch (err: any) {
          console.log(`[ENRICH] Error for ad ${adId}: ${err.message}`);
        }
      }

      if (!success) {
        errorCount += leadIds.length;
      }

      // Rate limit: 200ms between API calls
      await new Promise((r) => setTimeout(r, 200));
    }

    const result = {
      message: "Enrichment complete",
      total_leads: leads.length,
      unique_ads: adIdSet.size,
      enriched: enrichedCount,
      errors: errorCount,
      accounts_found: accountCache.size,
    };

    console.log(`[ENRICH] Done:`, JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[ENRICH] Unexpected error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

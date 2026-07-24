// @ts-nocheck
// Deduplicação de pagamentos duplicados entre lançamento manual da recepção
// (dontus_key NULL) e importação do sync Dontus (dontus_key NOT NULL).
//
// Restrito ao tenant Rizodent. Chamado por admin-api (Bearer SR) ou por
// pg_cron (x-cron-secret + AUTOMATION_CRON_TOKEN). NÃO agenda cron aqui.
//
// Dry-run por padrão: só reporta os pares candidatos, sem apagar/editar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RIZODENT_TENANT_ID = "00000000-0000-0000-0000-000000000010";

const NAME_STOPWORDS = new Set([
  "DE","DA","DO","DAS","DOS","E","DI","DU","LA","LE","EL",
  "JR","JUNIOR","NETO","FILHO","FILHA","SOBRINHO",
  "SANTOS","SILVA","SOUZA","SOUSA","OLIVEIRA","LIMA","COSTA","PEREIRA","FERREIRA",
  "RODRIGUES","ALVES","GOMES","MARTINS","ARAUJO","BARBOSA","RIBEIRO","CARVALHO","MELO","MOURA",
]);

function normalizeName(raw: string | null | undefined): string {
  return String(raw || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    // remove sufixos numéricos tipo "MARIA 1" / "JOAO 2"
    .replace(/\s+\d+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(name: string): string[] {
  return name.split(/\s+/).filter((t) => t.length > 2 && !NAME_STOPWORDS.has(t));
}

function namesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(/\s+/).filter(Boolean);
  const tb = nb.split(/\s+/).filter(Boolean);
  if (!ta.length || !tb.length) return false;
  if (ta[0] === tb[0] && !NAME_STOPWORDS.has(ta[0]) && ta[0].length > 2) return true;
  const sigA = significantTokens(na);
  const setB = new Set(significantTokens(nb));
  let common = 0;
  for (const t of sigA) {
    if (setB.has(t)) common++;
    if (common >= 2) return true;
  }
  return false;
}

function tailPhone(raw: string | null | undefined): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(-8);
}

// "Mesma pessoa" — retorna 'strong' (funde), 'weak' (notifica), 'none'.
function personMatch(
  pacSync: { id: string; nome: string; telefone: string | null },
  pacRec: { id: string; nome: string; telefone: string | null },
): "strong" | "weak" | "none" {
  if (pacSync.id === pacRec.id) return "strong";
  const nSync = normalizeName(pacSync.nome);
  const nRec = normalizeName(pacRec.nome);
  if (nSync && nRec && nSync === nRec) return "strong";
  const tSync = tailPhone(pacSync.telefone);
  const tRec = tailPhone(pacRec.telefone);
  if (tSync && tRec && tSync === tRec) {
    if (namesCompatible(pacSync.nome, pacRec.nome)) return "strong";
    return "weak";
  }
  if (namesCompatible(pacSync.nome, pacRec.nome)) return "weak";
  return "none";
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const auth = await authorizeInternal(req, supabase, {
    cronSecretName: "AUTOMATION_CRON_TOKEN",
  });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const date_ate: string = body?.date_ate || todayISO();
  const date_de: string = body?.date_de || daysAgoISO(4);
  const dryRun: boolean = body?.dry_run !== false; // default true

  const summary = {
    tenant_id: RIZODENT_TENANT_ID,
    date_de, date_ate, dry_run: dryRun,
    pares_encontrados: 0,
    fundidos: 0,
    ambiguos: 0,
    erros: 0,
    detalhes: [] as any[],
    erros_det: [] as any[],
  };

  try {
    // 1) Carrega todos os pagamentos do período do tenant Rizodent.
    const { data: pagsRaw, error: pagsErr } = await supabase
      .from("pagamentos")
      .select("id, paciente_id, clinica_id, data_pagamento, valor, dontus_key, recorrencia_orto, tipo, especialidade")
      .gte("data_pagamento", date_de)
      .lte("data_pagamento", date_ate);
    if (pagsErr) throw pagsErr;

    const pagsAll = (pagsRaw || []).filter((p: any) => p.clinica_id && p.paciente_id);
    if (!pagsAll.length) {
      // Nada a fazer.
      const { data: runRow } = await supabase.from("dontus_dedup_runs").insert({
        tenant_id: RIZODENT_TENANT_ID, date_de, date_ate, dry_run: dryRun,
        pares_encontrados: 0, fundidos: 0, ambiguos: 0, erros: 0, detalhes: [],
      }).select("id").maybeSingle();
      return new Response(JSON.stringify({ ok: true, run_id: runRow?.id, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Carrega pacientes envolvidos.
    const pacIds = Array.from(new Set(pagsAll.map((p: any) => p.paciente_id)));
    const pacMap = new Map<string, { id: string; nome: string; telefone: string | null }>();
    for (let i = 0; i < pacIds.length; i += 500) {
      const chunk = pacIds.slice(i, i + 500);
      const { data } = await supabase.from("pacientes").select("id, nome, telefone").in("id", chunk);
      for (const p of data || []) pacMap.set(p.id, p as any);
    }

    // 3) Agrupa por (clinica, data, valor).
    type Bucket = { sync: any[]; rec: any[] };
    const buckets = new Map<string, Bucket>();
    for (const p of pagsAll) {
      const valor = Number(p.valor);
      if (!Number.isFinite(valor)) continue;
      const key = `${p.clinica_id}|${p.data_pagamento}|${valor.toFixed(2)}`;
      if (!buckets.has(key)) buckets.set(key, { sync: [], rec: [] });
      const b = buckets.get(key)!;
      if (p.dontus_key) b.sync.push(p);
      else b.rec.push(p);
    }

    // 4) Para cada bucket com sync>=1 && rec>=1, casar 1:1.
    const usedSync = new Set<string>();
    const usedRec = new Set<string>();
    const strongPairs: Array<{ sync: any; rec: any; reason: string }> = [];
    const weakPairs: Array<{ sync: any; rec: any; reason: string }> = [];

    for (const [, b] of buckets) {
      if (!b.sync.length || !b.rec.length) continue;

      // Para cada sync, avaliar candidatos rec.
      for (const s of b.sync) {
        if (usedSync.has(s.id)) continue;
        const pacSync = pacMap.get(s.paciente_id);
        if (!pacSync) continue;

        const strong: any[] = [];
        const weak: any[] = [];
        for (const r of b.rec) {
          if (usedRec.has(r.id)) continue;
          const pacRec = pacMap.get(r.paciente_id);
          if (!pacRec) continue;
          const m = personMatch(pacSync, pacRec);
          if (m === "strong") strong.push(r);
          else if (m === "weak") weak.push(r);
        }

        if (strong.length === 1 && weak.length === 0) {
          const r = strong[0];
          usedSync.add(s.id); usedRec.add(r.id);
          strongPairs.push({ sync: s, rec: r, reason: "strong" });
        } else if (strong.length >= 1 || weak.length >= 1) {
          // Ambíguo: mais de um candidato forte, OU só candidatos fracos.
          // Marca sync como visto (uma notificação) e registra os ids possíveis.
          usedSync.add(s.id);
          const cand = strong.length ? strong : weak;
          for (const r of cand) weakPairs.push({ sync: s, rec: r, reason: strong.length > 1 ? "ambiguous_strong" : "weak_only" });
        }
      }
    }

    summary.pares_encontrados = strongPairs.length;
    summary.ambiguos = weakPairs.length;

    // 5) DRY-RUN: só monta detalhes.
    const buildDetail = (pair: { sync: any; rec: any; reason: string }, kind: "merge" | "ambiguous") => ({
      kind,
      reason: pair.reason,
      clinica_id: pair.sync.clinica_id,
      data: pair.sync.data_pagamento,
      valor: Number(pair.sync.valor),
      sync: {
        pagamento_id: pair.sync.id,
        paciente_id: pair.sync.paciente_id,
        paciente_nome: pacMap.get(pair.sync.paciente_id)?.nome || null,
        dontus_key: pair.sync.dontus_key,
        recorrencia_orto: pair.sync.recorrencia_orto,
        tipo: pair.sync.tipo,
      },
      recepcao: {
        pagamento_id: pair.rec.id,
        paciente_id: pair.rec.paciente_id,
        paciente_nome: pacMap.get(pair.rec.paciente_id)?.nome || null,
        recorrencia_orto: pair.rec.recorrencia_orto,
        tipo: pair.rec.tipo,
      },
    });

    for (const p of strongPairs) summary.detalhes.push(buildDetail(p, "merge"));
    for (const p of weakPairs) summary.detalhes.push(buildDetail(p, "ambiguous"));

    // 6) MERGE (apenas quando dry_run=false).
    if (!dryRun) {
      // 6a) Fundir pares fortes.
      for (const pair of strongPairs) {
        try {
          const { sync: s, rec: r } = pair;

          // Reaponta crm_lead_pacientes: qualquer vínculo que aponte para o paciente do sync
          // (e não seja o paciente da recepção) vira o paciente da recepção.
          if (s.paciente_id !== r.paciente_id) {
            const { data: vincs } = await supabase.from("crm_lead_pacientes")
              .select("lead_id, paciente_id")
              .eq("paciente_id", s.paciente_id);
            for (const v of vincs || []) {
              // Se já existe vínculo com o paciente da recepção para esse lead, apenas remove o antigo.
              const { data: exists } = await supabase.from("crm_lead_pacientes")
                .select("lead_id").eq("lead_id", v.lead_id).eq("paciente_id", r.paciente_id).maybeSingle();
              if (exists) {
                await supabase.from("crm_lead_pacientes")
                  .delete().eq("lead_id", v.lead_id).eq("paciente_id", s.paciente_id);
              } else {
                await supabase.from("crm_lead_pacientes")
                  .update({ paciente_id: r.paciente_id })
                  .eq("lead_id", v.lead_id).eq("paciente_id", s.paciente_id);
              }
            }
          }

          // Atualiza a linha da recepção: grava dontus_key + copia campos vazios/genéricos.
          const updates: any = { dontus_key: s.dontus_key };
          if (s.recorrencia_orto === true && r.recorrencia_orto !== true) {
            updates.recorrencia_orto = true;
          }
          const tipoRec = String(r.tipo || "").trim().toLowerCase();
          const tipoSync = String(s.tipo || "").trim().toLowerCase();
          if ((tipoRec === "" || tipoRec === "primeiro") && tipoSync && tipoSync !== tipoRec) {
            // só sobrescreve se o sync tem info melhor (recorrente) ou se rec está vazio.
            if (tipoRec === "" || tipoSync === "recorrente") updates.tipo = s.tipo;
          }
          const { error: updErr } = await supabase.from("pagamentos")
            .update(updates).eq("id", r.id).is("dontus_key", null);
          if (updErr) throw new Error(`update recepção falhou: ${updErr.message}`);

          // Apaga a linha do sync.
          const { error: delErr } = await supabase.from("pagamentos")
            .delete().eq("id", s.id).not("dontus_key", "is", null);
          if (delErr) throw new Error(`delete sync falhou: ${delErr.message}`);

          summary.fundidos++;

          // Se sobrou paciente órfão do sync (nenhum outro pagamento, nenhum vínculo),
          // apenas notifica — não apaga automaticamente.
          if (s.paciente_id !== r.paciente_id) {
            const [{ count: pagCount }, { count: vincCount }] = await Promise.all([
              supabase.from("pagamentos").select("id", { count: "exact", head: true }).eq("paciente_id", s.paciente_id),
              supabase.from("crm_lead_pacientes").select("lead_id", { count: "exact", head: true }).eq("paciente_id", s.paciente_id),
            ]);
            if ((pagCount || 0) === 0 && (vincCount || 0) === 0) {
              await supabase.from("crm_notifications").insert({
                title: "Paciente órfão pós-dedup",
                body: `Paciente ${pacMap.get(s.paciente_id)?.nome || s.paciente_id} ficou sem pagamentos/vínculos após dedup do pagamento ${r.id}.`,
                type: "dontus_dedup",
                dedupe_key: `dedup:orphan:${s.paciente_id}`,
              }).then(({ error }) => {
                if (error && !/duplicate|unique/i.test(error.message || "")) {
                  summary.erros_det.push({ orphan: s.paciente_id, error: error.message });
                }
              });
            }
          }
        } catch (e: any) {
          summary.erros++;
          summary.erros_det.push({ pair: { sync: pair.sync.id, rec: pair.rec.id }, error: e?.message || String(e) });
        }
      }

      // 6b) Notificações para ambíguos.
      for (const pair of weakPairs) {
        try {
          const dk = `dedup:ambig:${pair.sync.id}:${pair.rec.id}`;
          const { error } = await supabase.from("crm_notifications").insert({
            title: "Possível pagamento duplicado — conferir manualmente",
            body: `Clínica ${pair.sync.clinica_id} · ${pair.sync.data_pagamento} · R$${Number(pair.sync.valor).toFixed(2)}. ` +
                  `Sync: ${pacMap.get(pair.sync.paciente_id)?.nome} (pag ${pair.sync.id}). ` +
                  `Recepção: ${pacMap.get(pair.rec.paciente_id)?.nome} (pag ${pair.rec.id}).`,
            type: "dontus_dedup",
            dedupe_key: dk,
          });
          if (error && !/duplicate|unique/i.test(error.message || "")) throw error;
        } catch (e: any) {
          summary.erros++;
          summary.erros_det.push({ ambiguous: { sync: pair.sync.id, rec: pair.rec.id }, error: e?.message || String(e) });
        }
      }
    }

    // 7) Persistir run.
    const { data: runRow, error: runErr } = await supabase.from("dontus_dedup_runs").insert({
      tenant_id: RIZODENT_TENANT_ID,
      date_de, date_ate, dry_run: dryRun,
      pares_encontrados: summary.pares_encontrados,
      fundidos: summary.fundidos,
      ambiguos: summary.ambiguos,
      erros: summary.erros,
      detalhes: summary.detalhes,
    }).select("id").maybeSingle();
    if (runErr) console.error("dontus_dedup_runs insert:", runErr);

    return new Response(JSON.stringify({ ok: true, run_id: runRow?.id, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("dontus-dedup fatal:", e);
    summary.erros++;
    summary.erros_det.push({ fatal: e?.message || String(e) });
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e), summary }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Ponte Dontus → WhatsApp oficial: lembretes de consulta e aniversário do tenant
// Recepção. Hoje esses disparos saem do Dontus por conexão QR (que derruba o
// WhatsApp da recepção); aqui saem pela Cloud API, com rastro no inbox.
//
// Desenho: cron → busca a agenda no Dontus na hora do disparo → resolve/cria o
// lead carimbado com o número da unidade → CLAIM atômico (unique) → envia via
// send-whatsapp-message (que grava em `messages` e resolve credenciais do tenant).
//
// Por que NÃO usamos crm_appointments + automação before_scheduled: o motor de
// automações varre TODOS os agendamentos a cada minuto sem filtro de tenant —
// injetar ~120/dia degradaria o CRM de quem já está em produção — e o guard de
// antecedência mínima faria o lembrete de véspera nunca disparar para quem marcou
// em cima da hora (justamente quem mais falta).
//
// POST { kind: 'vespera'|'duas_horas'|'aniversario'|'espelho',
//        dry_run?: boolean (default TRUE), date?: 'YYYY-MM-DD', unidades?: number[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeInternal } from "../_shared/internalAuth.ts";
import { mcpToolCall, resolveTeamToken } from "../_shared/dontusClient.ts";
import { normalizeBrPhone, primeiroNome } from "../_shared/phoneBR.ts";
import { localParts } from "../_shared/tz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Whitelist FAIL-CLOSED por idStatus do Dontus. Nunca por descricaoStatus (texto
// muda/acentua). Id desconhecido NÃO recebe lembrete e é logado.
const STATUS_ENVIA = new Set([1, 4]); // 1=Agendado, 4=Confirmado
const STATUS_NOMES: Record<number, string> = {
  1: "Agendado", 3: "Cancelado", 4: "Confirmado", 5: "Faltou", 6: "Atendido", 7: "Remarcado",
};

const THROTTLE_MS = 150;          // mesmo passo do broadcast-engine
const MAX_WINDOWS_PER_RUN = 4;    // espelho: janelas de 30 dias por execução
const ESPELHO_LOOKBACK_MONTHS = 24;
// Lembrete "2h antes" só vale se sobrar antecedência útil depois da abertura da
// clínica. Consulta às 08:00 com abertura 08:00 não recebe (não haveria tempo);
// quem cobre esses é a véspera. O caso é CONTABILIZADO, nunca silencioso.
const MIN_ANTECEDENCIA_UTIL_MIN = 30;
const MAX_RETRY_ATTEMPTS = 3;

interface Unidade {
  id: string; tenant_id: string; id_dontus: number; id_clinica: number;
  nome: string; cidade: string | null; ddd_padrao: string; timezone: string;
  whatsapp_number_id: string | null; integration_key: string | null;
  pipeline_id: string | null; stage_id: string | null;
  template_vespera: string | null; template_2h: string | null; template_aniversario: string | null;
  antecedencia_min: number; janela_inicio: string; janela_fim: string;
  vespera_dom: boolean; enviar_vespera: boolean; enviar_2h: boolean; enviar_aniversario: boolean;
}

/** Dia-calendário na TZ da unidade (toISOString mente entre 21h e meia-noite). */
function hojeLocal(tz: string): string {
  const p = localParts(new Date(), tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/**
 * Epoch ms de uma data+hora LOCAL na timezone da unidade. Não assume -03:00:
 * o campo timezone é editável e uma unidade em Manaus (-04:00) teria a janela
 * de disparo deslocada em 1h — inclusive fechando antes da consulta começar.
 */
function localMs(date: string, time: string | null, tz: string): number {
  const hhmm = String(time || "00:00").slice(0, 5);
  const naive = Date.parse(`${date}T${hhmm}:00.000Z`);   // trata como se fosse UTC
  // Descobre o offset real da TZ naquele instante e corrige.
  const p = localParts(new Date(naive), tz);
  const comoLocal = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offsetMs = comoLocal - naive;
  return naive - offsetMs;
}
function minutosDoDia(hhmm: string): number {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fmtDataHora(dataIso: string, horario: string): string {
  const [, mes, dia] = dataIso.split("-");
  return `${dia}/${mes} às ${String(horario).slice(0, 5)}`;
}

/**
 * Resolve (ou cria) o lead da pessoa NO TENANT DA RECEPÇÃO, sempre carimbado com
 * o número da unidade — sem o carimbo a policy RESTRICTIVE esconde a conversa da
 * própria recepcionista, e sem tenant_id explícito o trigger de default jogaria
 * o lead no tenant da Rizodent.
 */
async function ensureLead(
  admin: any, u: Unidade, nome: string, phone: string, idPaciente: number | null,
): Promise<{ id: string; is_blocked: boolean } | null> {
  if (idPaciente != null) {
    const { data: esp } = await admin.from("dontus_pacientes")
      .select("lead_id")
      .eq("id_dontus", u.id_dontus).eq("id_clinica", u.id_clinica).eq("id_paciente", idPaciente)
      .maybeSingle();
    if (esp?.lead_id) {
      // Confere o tenant do lead: um lead_id herdado/errado mandaria a mensagem
      // desta consulta para a conversa de outra pessoa (ou de outro cliente).
      const { data: l } = await admin.from("crm_leads")
        .select("id, is_blocked, tenant_id").eq("id", esp.lead_id).maybeSingle();
      if (l && l.tenant_id === u.tenant_id) return l;
    }
  }

  const { data: cands } = await admin.from("crm_leads")
    .select("id, is_blocked, whatsapp_number_id")
    .eq("tenant_id", u.tenant_id).eq("phone", phone)
    .order("created_at", { ascending: true }).limit(5);

  // Cada número é um mundo: NUNCA re-carimbar lead legado (whatsapp_number_id
  // NULL = conversa do número principal). Antes o UPDATE roubava essa conversa
  // do mundo principal; agora, sem lead do número da unidade, cria um novo.
  let lead = (cands || []).find((c: any) => c.whatsapp_number_id === u.whatsapp_number_id) || null;

  if (!lead) {
    const { data: novo, error } = await admin.from("crm_leads").insert({
      tenant_id: u.tenant_id,                 // explícito: o default cai na Rizodent
      name: nome || `Paciente ${phone.slice(-4)}`,
      phone,
      pipeline_id: u.pipeline_id,
      stage_id: u.stage_id,
      whatsapp_number_id: u.whatsapp_number_id,  // obrigatório p/ a recepção enxergar
      source: "dontus_agenda",
      cidade: u.cidade,
    }).select("id, is_blocked").single();
    if (error) {
      console.error(`[recepcao-lembretes] falha ao criar lead (${phone}): ${error.message}`);
      return null;
    }
    lead = novo;
  }

  if (idPaciente != null && lead?.id) {
    await admin.from("dontus_pacientes")
      .update({ lead_id: lead.id, updated_at: new Date().toISOString() })
      .eq("id_dontus", u.id_dontus).eq("id_clinica", u.id_clinica).eq("id_paciente", idPaciente);
  }
  return lead;
}

/** Envia template pela function oficial (grava em messages e resolve credenciais). */
async function enviarTemplate(
  leadId: string, phone: string, templateName: string, params: string[], logContent: string,
): Promise<{ ok: boolean; wamid?: string; messageId?: string; error?: string; retryable?: boolean }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id: leadId,
        to: phone,
        type: "template",
        template_name: templateName,
        template_language: "pt_BR",
        // Componentes montados aqui de propósito: o preenchimento automático do
        // send-whatsapp-message busca o agendamento mais ANTIGO do lead e poria
        // data errada quando a pessoa tem mais de um.
        template_components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }],
        log_content: logContent,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(body?.error ?? res.status);
      const retryable = res.status === 429 || res.status >= 500 || /rate limit/i.test(msg);
      return { ok: false, error: msg, retryable };
    }
    return { ok: true, wamid: body?.wamid ?? body?.whatsapp_message_id, messageId: body?.message_id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), retryable: true };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // minúsculo de propósito: o nome do secret é 'automation_cron_token'
  const auth = await authorizeInternal(req, admin, { cronSecretName: "automation_cron_token", allowUserJwt: true });
  if (!auth.ok) return json({ error: auth.reason || "Unauthorized" }, 401);
  if (auth.via === "user_jwt") {
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", auth.userId);
    if (!(roles || []).some((r: any) => r.role === "superadmin")) return json({ error: "superadmin only" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || "");
  const dryRun = body?.dry_run !== false;   // seguro por padrão
  const unidadesFiltro: number[] | null = Array.isArray(body?.unidades) ? body.unidades : null;
  if (!["vespera", "duas_horas", "aniversario", "espelho"].includes(kind)) {
    return json({ error: "kind inválido (vespera|duas_horas|aniversario|espelho)" }, 400);
  }

  // MULTI-CLIENTE: credencial do Dontus resolvida por TENANT da unidade
  // (dontus_credenciais), com fallback para o secret global (Rizodent).
  const tokenPorTenant = new Map<string, string>();
  async function teamTokenDoTenant(tenantId: string): Promise<string> {
    const cache = tokenPorTenant.get(tenantId);
    if (cache !== undefined) return cache;
    const t = await resolveTeamToken(admin, tenantId);
    tokenPorTenant.set(tenantId, t);
    return t;
  }

  const tenantFiltro = body?.tenant_id ? String(body.tenant_id) : null;
  let q = admin.from("dontus_unidades").select("*").eq("ativo", true);
  if (tenantFiltro) q = q.eq("tenant_id", tenantFiltro);
  if (unidadesFiltro?.length) q = q.in("id_clinica", unidadesFiltro);
  const { data: unidades, error: uErr } = await q;
  if (uErr) return json({ error: uErr.message }, 500);
  if (!unidades?.length) return json({ error: "nenhuma unidade ativa em dontus_unidades" }, 400);

  const resultados: any[] = [];

  for (const u of unidades as Unidade[]) {
    const t0 = Date.now();
    const run: any = {
      tenant_id: u.tenant_id, kind, id_clinica: u.id_clinica, dry_run: dryRun,
      lidos: 0, elegiveis: 0, enviados: 0, ja_enviados: 0, sem_telefone: 0,
      tel_invalido: 0, cancelados: 0, remarcados: 0, falhas: 0,
      detalhes: { unidade: u.nome, sem_telefone_nomes: [], status_desconhecido: [], erros: [] },
    };

    try {
      const teamToken = await teamTokenDoTenant(u.tenant_id);
      if (!teamToken) {
        run.error_message = "clínica sem credencial do Dontus (team token ausente)";
        resultados.push({ unidade: u.nome, pulado: run.error_message });
        if (!dryRun) await admin.from("dontus_lembrete_runs").insert(run).catch?.(() => {});
        continue;
      }
      const hoje = hojeLocal(u.timezone);
      const agora = Date.now();

      // FAIL-CLOSED: unidade sem número configurado não envia. Sem o carimbo, o
      // lead nasce invisível para a própria recepção (policy RESTRICTIVE) e o
      // envio cairia no fallback "qualquer integração do tenant" — ou seja, sairia
      // pelo número de OUTRA unidade.
      if (kind !== "espelho" && !u.whatsapp_number_id) {
        run.error_message = "unidade sem whatsapp_number_id — envio bloqueado";
        run.duracao_ms = Date.now() - t0;
        await admin.from("dontus_lembretes_runs").insert(run);
        resultados.push({ unidade: u.nome, erro: run.error_message });
        continue;
      }

      // Guarda de horário civilizado: protege contra reexecução manual de madrugada.
      if (kind !== "espelho") {
        const p = localParts(new Date(), u.timezone);
        const agoraMin = p.hour * 60 + p.minute;
        if (agoraMin < minutosDoDia(u.janela_inicio) || agoraMin > minutosDoDia(u.janela_fim)) {
          run.error_message = `fora da janela de envio (${u.janela_inicio}-${u.janela_fim})`;
          run.duracao_ms = Date.now() - t0;
          await admin.from("dontus_lembretes_runs").insert(run);
          resultados.push({ unidade: u.nome, pulado: run.error_message });
          continue;
        }
      }

      // ------------------------------------------------------------------
      // ESPELHO de pacientes (base do aniversário)
      // ------------------------------------------------------------------
      if (kind === "espelho") {
        const { data: cov } = await admin.from("dontus_pacientes_coverage")
          .select("coberto_de, coberto_ate")
          .eq("id_dontus", u.id_dontus).eq("id_clinica", u.id_clinica).maybeSingle();
        const limiteAntigo = addDays(hoje, -30 * ESPELHO_LOOKBACK_MONTHS);

        // JANELA RECENTE primeiro: sem isso o espelho só andava para trás e,
        // terminado o backfill, congelava — paciente cadastrado depois nunca
        // entraria na base e jamais receberia aniversário (e telefone trocado
        // no Dontus nunca seria atualizado).
        const janelas: Array<{ ini: string; fim: string }> = [];
        if (cov?.coberto_ate && cov.coberto_ate < hoje) {
          janelas.push({ ini: cov.coberto_ate, fim: hoje });
        } else if (!cov) {
          janelas.push({ ini: addDays(hoje, -29), fim: hoje });
        }

        let fim = cov?.coberto_de ? addDays(cov.coberto_de, -1) : addDays(hoje, -30);
        let de = cov?.coberto_de ?? addDays(hoje, -29);
        const ate = hoje;   // sempre avança a cobertura recente

        for (const j of janelas) {
          const rows: any[] = await mcpToolCall(admin, teamToken, "consultar_relatorio_pacientes", {
            input: { contexto: { idDontus: u.id_dontus, idClinica: u.id_clinica }, dataInicio: j.ini, dataFim: j.fim },
          });
          run.lidos += rows.length;
          for (const p of rows) {
            const { phone, motivo } = normalizeBrPhone(p?.celular ?? p?.telefone, u.ddd_padrao);
            if (!dryRun && p?.idPaciente != null) {
              await admin.from("dontus_pacientes").upsert({
                tenant_id: u.tenant_id, id_dontus: u.id_dontus, id_clinica: u.id_clinica,
                id_paciente: p.idPaciente, nome: p?.nome ?? null, celular_raw: p?.celular ?? null,
                phone, phone_motivo: motivo, data_nascimento: p?.dataNascimento ?? null,
                cidade: p?.cidade ?? null, visto_em: j.fim, updated_at: new Date().toISOString(),
              }, { onConflict: "id_dontus,id_clinica,id_paciente" });
            }
            if (motivo === "ok") run.elegiveis += 1;
            else if (motivo === "sem_celular") run.sem_telefone += 1;
            else run.tel_invalido += 1;
          }
        }

        for (let w = 0; w < MAX_WINDOWS_PER_RUN; w++) {
          if (fim < limiteAntigo) break;
          const ini = addDays(fim, -29) < limiteAntigo ? limiteAntigo : addDays(fim, -29);
          const rows: any[] = await mcpToolCall(admin, teamToken, "consultar_relatorio_pacientes", {
            input: { contexto: { idDontus: u.id_dontus, idClinica: u.id_clinica }, dataInicio: ini, dataFim: fim },
          });
          run.lidos += rows.length;
          for (const p of rows) {
            const { phone, motivo } = normalizeBrPhone(p?.celular ?? p?.telefone, u.ddd_padrao);
            const payload: any = {
              tenant_id: u.tenant_id, id_dontus: u.id_dontus, id_clinica: u.id_clinica,
              id_paciente: p?.idPaciente,
              nome: p?.nome ?? null, celular_raw: p?.celular ?? null,
              phone, phone_motivo: motivo,
              data_nascimento: p?.dataNascimento ?? null, cidade: p?.cidade ?? null,
              visto_em: fim, updated_at: new Date().toISOString(),
            };
            if (!dryRun && payload.id_paciente != null) {
              await admin.from("dontus_pacientes").upsert(payload, { onConflict: "id_dontus,id_clinica,id_paciente" });
            }
            if (motivo === "ok") run.elegiveis += 1;
            else if (motivo === "sem_celular") run.sem_telefone += 1;
            else run.tel_invalido += 1;
          }
          de = ini;
          fim = addDays(ini, -1);
        }
        if (!dryRun && de) {
          await admin.from("dontus_pacientes_coverage").upsert({
            id_dontus: u.id_dontus, id_clinica: u.id_clinica,
            coberto_de: de, coberto_ate: ate, updated_at: new Date().toISOString(),
          }, { onConflict: "id_dontus,id_clinica" });
        }
        run.duracao_ms = Date.now() - t0;
        await admin.from("dontus_lembretes_runs").insert(run);
        resultados.push({ unidade: u.nome, kind, lidos: run.lidos, com_telefone: run.elegiveis, coberto_de: de });
        continue;
      }

      // ------------------------------------------------------------------
      // ANIVERSÁRIO — lê do espelho local
      // ------------------------------------------------------------------
      if (kind === "aniversario") {
        if (!u.enviar_aniversario) { resultados.push({ unidade: u.nome, pulado: "enviar_aniversario=false" }); continue; }
        if (!u.template_aniversario) { resultados.push({ unidade: u.nome, pulado: "sem template de aniversário" }); continue; }
        const alvo = String(body?.date || hoje);
        const [, mm, dd] = alvo.split("-");
        const mmdd = Number(mm) * 100 + Number(dd);
        // 29/02 em ano não bissexto: parabeniza em 28/02
        const alvos = [mmdd];
        const ehFimFev = mm === "02" && dd === "28";
        const bissexto = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        if (ehFimFev && !bissexto(Number(alvo.slice(0, 4)))) alvos.push(229);

        const { data: nivers } = await admin.from("dontus_pacientes")
          .select("id_paciente, nome, phone")
          .eq("tenant_id", u.tenant_id).eq("id_dontus", u.id_dontus).eq("id_clinica", u.id_clinica)
          .in("aniv_mmdd", alvos)
          .not("phone", "is", null).eq("opt_out", false).eq("wa_invalido", false);
        run.lidos = (nivers || []).length;

        for (const pac of nivers || []) {
          run.elegiveis += 1;
          if (dryRun) continue;
          const claim = {
            tenant_id: u.tenant_id, id_dontus: u.id_dontus, id_clinica: u.id_clinica, kind: "aniversario",
            occurrence_date: alvo, id_paciente: pac.id_paciente, phone: pac.phone,
            template_name: u.template_aniversario, status: "claimed",
          };
          const { data: claimed, error: cErr } = await admin.from("dontus_lembretes").insert(claim).select("id").single();
          if (cErr) { if ((cErr as any).code === "23505") run.ja_enviados += 1; else run.falhas += 1; continue; }

          const lead = await ensureLead(admin, u, pac.nome ?? "", pac.phone!, pac.id_paciente);
          if (!lead || lead.is_blocked) {
            await admin.from("dontus_lembretes").update({
              status: "skipped", skip_reason: lead ? "lead_bloqueado" : "sem_lead",
              updated_at: new Date().toISOString(),
            }).eq("id", claimed.id);
            continue;
          }
          const nome = primeiroNome(pac.nome);
          const env = await enviarTemplate(lead.id, pac.phone!, u.template_aniversario!, [nome],
            `🎂 Parabéns automático (aniversário) — ${nome}`);
          await admin.from("dontus_lembretes").update({
            lead_id: lead.id,
            status: env.ok ? "sent" : (env.retryable ? "retry" : "failed"),
            wamid: env.wamid ?? null, message_id: env.messageId ?? null,
            error: env.error ?? null, attempts: 1, updated_at: new Date().toISOString(),
          }).eq("id", claimed.id);
          if (env.ok) run.enviados += 1; else { run.falhas += 1; run.detalhes.erros.push(env.error); }
          await new Promise((r) => setTimeout(r, THROTTLE_MS));
        }
        run.duracao_ms = Date.now() - t0;
        run.data_alvo = alvo;
        await admin.from("dontus_lembretes_runs").insert(run);
        resultados.push({ unidade: u.nome, kind, ...run });
        continue;
      }

      // ------------------------------------------------------------------
      // LEMBRETES DE AGENDA (véspera e 2h antes)
      // ------------------------------------------------------------------
      if (kind === "vespera" && !u.enviar_vespera) { resultados.push({ unidade: u.nome, pulado: "enviar_vespera=false" }); continue; }
      // Véspera de segunda cai domingo à noite: a unidade pode desligar isso.
      if (kind === "vespera" && !u.vespera_dom && localParts(new Date(), u.timezone).weekday === 0) {
        resultados.push({ unidade: u.nome, pulado: "vespera_dom=false (hoje é domingo)" });
        continue;
      }
      if (kind === "duas_horas" && !u.enviar_2h) { resultados.push({ unidade: u.nome, pulado: "enviar_2h=false" }); continue; }
      const template = kind === "vespera" ? u.template_vespera : u.template_2h;
      if (!template) { resultados.push({ unidade: u.nome, pulado: `sem template de ${kind}` }); continue; }

      const alvo = String(body?.date || (kind === "vespera" ? addDays(hoje, 1) : hoje));
      // Nunca enviar para data passada (protege reexecução manual com date antigo).
      if (alvo < hoje) { resultados.push({ unidade: u.nome, pulado: `data alvo ${alvo} no passado` }); continue; }
      run.data_alvo = alvo;

      const rows: any[] = await mcpToolCall(admin, teamToken, "consultar_agendamentos", {
        input: { contexto: { idDontus: u.id_dontus, idClinica: u.id_clinica }, dataInicio: alvo, dataFim: alvo },
      });
      run.lidos = rows.length;

      // Filtra por status (fail-closed) e normaliza telefone
      type Item = { ag: any; phone: string; horario: string; nome: string; idPaciente: number | null };
      const itens: Item[] = [];
      for (const ag of rows) {
        const st = Number(ag?.idStatus);
        if (!STATUS_ENVIA.has(st)) {
          if (st === 3) run.cancelados += 1;
          else if (st === 7) run.remarcados += 1;
          else if (!STATUS_NOMES[st]) run.detalhes.status_desconhecido.push(st);
          continue;
        }
        const bruto = [ag?.celular, ag?.telefone1, ag?.telefone2].find((t: any) => String(t || "").trim());
        const { phone, motivo } = normalizeBrPhone(bruto, u.ddd_padrao);
        if (!phone) {
          if (motivo === "sem_celular") run.sem_telefone += 1; else run.tel_invalido += 1;
          run.detalhes.sem_telefone_nomes.push({ nome: ag?.paciente, motivo, horario: ag?.horario });
          continue;
        }
        itens.push({
          ag, phone, horario: String(ag?.horario || "").slice(0, 5),
          nome: ag?.paciente ?? "", idPaciente: ag?.idPaciente ?? null,
        });
      }

      // Agrupamento: véspera = 1 msg por pessoa/dia (representante = 1º horário);
      // 2h = 1 por horário distinto (2 horários no dia merecem 2 avisos).
      const grupos = new Map<string, Item[]>();
      for (const it of itens) {
        const chave = kind === "vespera" ? it.phone : `${it.phone}|${it.horario}`;
        const arr = grupos.get(chave) ?? [];
        arr.push(it);
        grupos.set(chave, arr);
      }

      for (const [, grupo] of grupos) {
        grupo.sort((a, b) => a.horario.localeCompare(b.horario));
        const rep = grupo[0];
        const inicioMs = localMs(alvo, rep.horario, u.timezone);

        if (kind === "duas_horas") {
          const fireAt = inicioMs - u.antecedencia_min * 60_000;
          const aberturaMs = localMs(alvo, u.janela_inicio, u.timezone);
          const fireEfetivo = Math.max(fireAt, aberturaMs);
          // Consulta cedo demais (início antes/junto da abertura): não há janela
          // possível. Registra e segue — antes isso sumia sem contador nenhum.
          if (inicioMs - fireEfetivo < MIN_ANTECEDENCIA_UTIL_MIN * 60_000) {
            run.detalhes.cedo_demais = (run.detalhes.cedo_demais ?? 0) + 1;
            run.detalhes.cedo_demais_horarios = run.detalhes.cedo_demais_horarios ?? [];
            if (run.detalhes.cedo_demais_horarios.length < 20) {
              run.detalhes.cedo_demais_horarios.push({ nome: rep.nome, horario: rep.horario });
            }
            continue;
          }
          if (agora < fireEfetivo || agora >= inicioMs) continue;  // fora da janela deste horário
        }
        run.elegiveis += 1;
        if (dryRun) continue;

        // CLAIM: todas as linhas do grupo numa instrução só. 23505 = já tratado.
        const claimRows = grupo.map((it, idx) => ({
          tenant_id: u.tenant_id, id_dontus: u.id_dontus, id_clinica: u.id_clinica, kind,
          occurrence_date: alvo, id_agendamento: it.ag?.idAgendamento,
          id_paciente: it.idPaciente, phone: it.phone, horario: it.horario,
          template_name: template,
          status: idx === 0 ? "claimed" : "dedup",
          agend_hash: `${alvo}|${it.horario}|${it.ag?.profissional ?? ""}|${it.ag?.idStatus}`,
        }));
        const { data: claimed, error: cErr } = await admin.from("dontus_lembretes")
          .insert(claimRows).select("id, status");
        let linhaEnvio: { id: string } | null = null;
        if (cErr) {
          if ((cErr as any).code !== "23505") {
            run.falhas += 1; run.detalhes.erros.push(cErr.message);
            continue;
          }
          // Já existe registro para este agendamento. Se a tentativa anterior
          // FALHOU de forma retentável, reclama a linha e tenta de novo — sem
          // isto um 429 da Meta condenava o paciente a nunca receber, e ainda
          // era contado como "já enviado".
          const { data: existente } = await admin.from("dontus_lembretes")
            .select("id, status, attempts")
            .eq("id_dontus", u.id_dontus).eq("id_clinica", u.id_clinica).eq("kind", kind)
            .eq("id_agendamento", rep.ag?.idAgendamento).eq("occurrence_date", alvo)
            .maybeSingle();
          if (existente?.status === "retry" && (existente.attempts ?? 0) < MAX_RETRY_ATTEMPTS) {
            const { data: reclaimed } = await admin.from("dontus_lembretes")
              .update({ status: "claimed", attempts: (existente.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
              .eq("id", existente.id).eq("status", "retry")   // compare-and-swap
              .select("id").maybeSingle();
            if (!reclaimed) { run.ja_enviados += 1; continue; }
            linhaEnvio = reclaimed;
            run.detalhes.reenvios = (run.detalhes.reenvios ?? 0) + 1;
          } else {
            run.ja_enviados += 1;
            continue;
          }
        } else {
          linhaEnvio = (claimed || []).find((c: any) => c.status === "claimed") ?? null;
        }
        if (!linhaEnvio) continue;

        const lead = await ensureLead(admin, u, rep.nome, rep.phone, rep.idPaciente);
        if (!lead || lead.is_blocked) {
          await admin.from("dontus_lembretes").update({
            status: "skipped", skip_reason: lead ? "lead_bloqueado" : "sem_lead",
            updated_at: new Date().toISOString(),
          }).eq("id", linhaEnvio.id);
          continue;
        }

        const nome = primeiroNome(rep.nome);
        const quando = fmtDataHora(alvo, rep.horario);
        const profissional = String(rep.ag?.profissional ?? "").trim() || u.nome;
        const params = [nome, quando, profissional];
        const env = await enviarTemplate(
          lead.id, rep.phone, template, params,
          `⏰ Lembrete ${kind === "vespera" ? "de véspera" : "de 2h antes"} — ${quando}`,
        );
        await admin.from("dontus_lembretes").update({
          lead_id: lead.id,
          status: env.ok ? "sent" : (env.retryable ? "retry" : "failed"),
          wamid: env.wamid ?? null, message_id: env.messageId ?? null,
          error: env.error ?? null, attempts: 1, updated_at: new Date().toISOString(),
        }).eq("id", linhaEnvio.id);
        if (env.ok) run.enviados += 1; else { run.falhas += 1; run.detalhes.erros.push(env.error); }
        await new Promise((r) => setTimeout(r, THROTTLE_MS));
      }

      run.duracao_ms = Date.now() - t0;
      await admin.from("dontus_lembretes_runs").insert(run);
      resultados.push({ unidade: u.nome, kind, data_alvo: alvo, ...run });
    } catch (e: any) {
      // Falha de uma unidade NUNCA aborta as outras (ex.: LIMITE_PLANO_EXCEDIDO).
      run.error_message = e?.message ?? String(e);
      run.duracao_ms = Date.now() - t0;
      try { await admin.from("dontus_lembretes_runs").insert(run); } catch { /* nunca mascarar o erro original */ }
      console.error(`[recepcao-lembretes] ${u.nome}: ${run.error_message}`);
      resultados.push({ unidade: u.nome, erro: run.error_message });
    }
  }

  return json({ kind, dry_run: dryRun, unidades: resultados });
});

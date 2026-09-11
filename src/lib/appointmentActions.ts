import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { executeStageAutomations } from "@/lib/automationUtils";
import { moveLeadToStageCrossPipeline } from "@/lib/appointmentOutcome";
import { mensagemDeErroRpc } from "@/lib/relatorioSdr";

/**
 * Ações de agendamento compartilhadas entre o chat e o calendário.
 *
 * Regras de negócio já garantidas por gatilho no banco (Etapa 1):
 * - `is_rescheduled` é derivado de `rescheduled_from_id`
 * - autor/hora do desfecho são carimbados sozinhos
 * - reabrir desfecho e mudar data/hora após desfecho são restritos a gerente
 */

/** America/Bahia é UTC-3 fixo (sem horário de verão). */
const BAHIA_OFFSET = "-03:00";

/** Instante (ms epoch) do horário marcado, interpretado no fuso America/Bahia. */
export function bahiaScheduledMs(scheduled_date: string, scheduled_time?: string | null): number {
  const t = (scheduled_time || "00:00:00").slice(0, 5);
  return new Date(`${scheduled_date}T${t}:00${BAHIA_OFFSET}`).getTime();
}

/** Data/hora atual em ms epoch (comparação de instantes é independente de fuso). */
export function nowMs(): number {
  return Date.now();
}

/** Formata "sábado às 09:30" a partir dos campos do agendamento (fuso America/Bahia). */
export function formatBahiaLabel(scheduled_date: string, scheduled_time?: string | null): string {
  const ms = bahiaScheduledMs(scheduled_date, scheduled_time);
  if (Number.isNaN(ms)) return scheduled_date;
  const d = new Date(ms);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
  return `${dia} às ${hora}`;
}

/** Desfecho ainda não aconteceu no relógio? (clique antecipado) */
export function isBeforeScheduled(scheduled_date: string, scheduled_time?: string | null): boolean {
  const ms = bahiaScheduledMs(scheduled_date, scheduled_time);
  return !Number.isNaN(ms) && nowMs() < ms;
}

/**
 * Régua anti-lavagem: remarcar depois do horário marcado + 3h conta como falta.
 */
export function statusForRescheduledOrigin(scheduled_date: string, scheduled_time?: string | null): "no_show" | "rescheduled" {
  const ms = bahiaScheduledMs(scheduled_date, scheduled_time);
  if (Number.isNaN(ms)) return "rescheduled";
  return nowMs() >= ms + 3 * 60 * 60 * 1000 ? "no_show" : "rescheduled";
}

const TRIGGER_HINTS = ["imutável", "imutavel", "reabertura é ação de gerente", "reabertura e acao de gerente", "após o desfecho", "apos o desfecho", "remarcação", "permissão", "permissao"];

/** Mostra a mensagem do gatilho do banco (ou de permissão) quando existir; senão um erro genérico. */
export function toastDbError(error: unknown, fallback = "Erro ao atualizar agendamento") {
  const msg = (error as any)?.message ? String((error as any).message) : "";
  const lower = msg.toLowerCase();
  if (msg && TRIGGER_HINTS.some((h) => lower.includes(h))) {
    toast.error(msg);
  } else {
    console.error(error);
    toast.error(fallback);
  }
}

async function systemMessage(leadId: string, content: string) {
  await supabase.from("messages").insert({
    lead_id: leadId,
    direction: "outbound",
    type: "system",
    content,
    status: "system",
  });
}

const STALE = "Este agendamento já recebeu desfecho — recarregando";

/** Cancela um agendamento com motivo obrigatório. Retorna false se já houve desfecho. */
export async function cancelAppointment(args: {
  leadId: string;
  appointmentId: string;
  reason: string;
}): Promise<boolean> {
  const { leadId, appointmentId, reason } = args;
  const motivo = reason.trim();
  if (motivo.length < 3) {
    toast.error("Informe o motivo do cancelamento (mín. 3 caracteres)");
    return false;
  }
  const { data, error } = await supabase
    .from("crm_appointments")
    .update({ status: "cancelled", cancelled_reason: motivo } as any)
    .eq("id", appointmentId)
    .eq("status", "confirmed")
    .select("id");
  if (error) { toastDbError(error, "Erro ao cancelar agendamento"); return false; }
  if (!data || data.length === 0) { toast.error(STALE); return false; }

  await systemMessage(leadId, `🗓️ Agendamento cancelado — ${motivo}`);
  toast.success("Agendamento cancelado");
  return true;
}

/**
 * Passo 1 do reagendamento em duas etapas: o lead pediu para remarcar mas ainda
 * não deu o novo horário. Move para a etapa de espera "Reagendar" (sem mexer no
 * agendamento, que segue 'confirmed'). Ali ele não recebe lembretes de
 * confirmação; se o dia terminar sem novo horário, a varredura noturna marca
 * falta (no_show) e move para "Não compareceu".
 * Retorna false quando o tenant não tem a etapa "Reagendar" (chamador decide o fallback).
 */
export async function iniciarReagendamento(leadId: string): Promise<boolean> {
  const movedStageId = await moveLeadToStageCrossPipeline(leadId, (n) => n === "reagendar");
  if (!movedStageId) return false;
  await systemMessage(
    leadId,
    "🔁 Aguardando reagendamento — sem novo horário até o fim do expediente, vira falta (Não compareceu)",
  );
  toast.success("Lead movido para Reagendar — registre o novo horário quando ele responder");
  return true;
}

/**
 * Remarca um agendamento:
 * 1. desfecho no antigo (`no_show` após horário+3h, senão `rescheduled`) com trava
 * 2. cria o novo vinculado por `rescheduled_from_id`
 * 3. UM movimento de etapa para "Reagendado"
 * 4. mensagem de sistema
 */
export async function rescheduleAppointment(args: {
  leadId: string;
  old: { id: string; scheduled_date: string; scheduled_time: string | null };
  newDate: string;
  newTime: string;
  notes?: string | null;
}): Promise<boolean> {
  const { leadId, old, newDate, newTime, notes } = args;

  const novoStatusAntigo = statusForRescheduledOrigin(old.scheduled_date, old.scheduled_time);

  const { data: upd, error: updErr } = await supabase
    .from("crm_appointments")
    .update({ status: novoStatusAntigo })
    .eq("id", old.id)
    .eq("status", "confirmed")
    .select("id");
  if (updErr) { toastDbError(updErr, "Erro ao remarcar agendamento"); return false; }
  if (!upd || upd.length === 0) { toast.error(STALE); return false; }

  const { error: insErr } = await supabase.from("crm_appointments").insert({
    lead_id: leadId,
    scheduled_date: newDate,
    scheduled_time: newTime,
    status: "confirmed",
    notes: notes || null,
    rescheduled_from_id: old.id,
  } as any);
  if (insErr) { toastDbError(insErr, "Erro ao criar o novo agendamento"); return false; }

  // "reagendado" exato: não pode cair na etapa de espera "Reagendar".
  // A remarcação em si JÁ aconteceu (desfecho gravado + novo agendamento
  // criado) — se só o movimento de etapa falhar, o fluxo segue e avisa o
  // parcial, em vez de anunciar "Erro ao remarcar" para uma remarcação feita.
  let movedStageId: string | null = null;
  let falhaDeEtapa: string | null = null;
  try {
    movedStageId = await moveLeadToStageCrossPipeline(leadId, (n) => n.startsWith("reagendado"));
  } catch (e: any) {
    falhaDeEtapa = e?.message || String(e);
  }

  const antigo = `${old.scheduled_date.split("-").reverse().join("/")} às ${(old.scheduled_time || "").slice(0, 5)}`;
  const novo = `${newDate.split("-").reverse().join("/")} às ${newTime}`;
  await systemMessage(leadId, `🔁 Consulta remarcada de ${antigo} para ${novo}`);

  // Automações de ENTRADA só quando o lead realmente trocou de etapa. Com o
  // `movedStageId || lead.stage_id` de antes, lead que já estava na etapa (ou
  // tenant sem a etapa destino) rodava de novo as automações de entrada da
  // etapa ATUAL e o paciente recebia a mensagem dela outra vez.
  if (movedStageId) {
    const { data: lead } = await supabase.from("crm_leads").select("phone").eq("id", leadId).single();
    executeStageAutomations({
      leadId,
      stageId: movedStageId,
      leadPhone: lead?.phone ?? "",
      triggerTypes: ["on_enter"],
    }).catch((e) => console.error("[Reschedule] Automation error:", e));
  }

  if (falhaDeEtapa) {
    toast.warning(`Consulta remarcada, mas o lead não foi movido de etapa: ${falhaDeEtapa}`);
  } else if (movedStageId) {
    toast.success("Consulta remarcada — lead movido para Reagendado");
  } else {
    // Sem etapa "Reagendado" no funil (ou o lead já estava nela): a remarcação
    // valeu, mas não anunciamos um movimento que não houve.
    toast.success("Consulta remarcada — o lead segue na etapa atual");
  }
  return true;
}

/**
 * "Compareceu e agendou": desfecho `not_contracted` no atual, novo agendamento
 * vinculado e UM movimento de etapa para "Compareceu e agendou".
 */
export async function compareceuEAgendou(args: {
  leadId: string;
  old: { id: string; scheduled_date: string; scheduled_time: string | null };
  newDate: string;
  newTime: string;
  notes?: string | null;
}): Promise<boolean> {
  const { leadId, old, newDate, newTime, notes } = args;

  const { data: upd, error: updErr } = await supabase
    .from("crm_appointments")
    .update({ status: "not_contracted" })
    .eq("id", old.id)
    .eq("status", "confirmed")
    .select("id");
  if (updErr) { toastDbError(updErr); return false; }
  if (!upd || upd.length === 0) { toast.error(STALE); return false; }

  const { error: insErr } = await supabase.from("crm_appointments").insert({
    lead_id: leadId,
    scheduled_date: newDate,
    scheduled_time: newTime,
    status: "confirmed",
    notes: notes || null,
    rescheduled_from_id: old.id,
  } as any);
  if (insErr) { toastDbError(insErr, "Erro ao criar o novo agendamento"); return false; }

  // Mesmo raciocínio da remarcação: o desfecho e o novo agendamento já estão
  // gravados — falha só no movimento de etapa vira aviso parcial, não erro.
  let movedStageId: string | null = null;
  let falhaDeEtapa: string | null = null;
  try {
    movedStageId = await moveLeadToStageCrossPipeline(
      leadId,
      (n) => n.includes("compareceu") && n.includes("agendou"),
    );
  } catch (e: any) {
    falhaDeEtapa = e?.message || String(e);
  }

  const novo = `${newDate.split("-").reverse().join("/")} às ${newTime}`;
  await systemMessage(leadId, `📅 Compareceu e agendou — novo horário ${novo}`);

  // Mesma regra da remarcação: sem troca de etapa, nada de automação de
  // entrada — senão a mensagem de entrada da etapa atual ia de novo ao paciente.
  if (movedStageId) {
    const { data: lead } = await supabase.from("crm_leads").select("phone").eq("id", leadId).single();
    executeStageAutomations({
      leadId,
      stageId: movedStageId,
      leadPhone: lead?.phone ?? "",
      triggerTypes: ["on_enter"],
    }).catch((e) => console.error("[CompareceuEAgendou] Automation error:", e));
  }

  if (falhaDeEtapa) {
    toast.warning(`Comparecimento registrado, mas o lead não foi movido de etapa: ${falhaDeEtapa}`);
  } else if (movedStageId) {
    toast.success("Comparecimento registrado — lead movido para Compareceu e agendou");
  } else {
    // Sem a etapa "Compareceu e agendou" no funil (ou o lead já estava nela).
    toast.success("Comparecimento registrado com novo agendamento — o lead segue na etapa atual");
  }
  return true;
}

// ============================================================================
// Comparecimento, correção e exclusão do desfecho de um agendamento (10/09/2026)
//
// PEDIDO DO DONO: "depois que o sdr ou crc marca um agendamento como compareceu
// ou nao compareceu ele nao consegue editar para corrigir caso ela marque
// errado" e "tambem nao consegue excluir caso tenha agendado errado ou marcado
// errado".
//
// Por que não dá para resolver aqui no front, com UPDATE:
//   • o gatilho stamp_appointment_update proíbe mudar o status de uma consulta
//     que já tem desfecho para quem não é gerente ("Desfecho já registrado —
//     reabertura é ação de gerente");
//   • a SDR não enxerga as etapas de desfecho (RLS), então nem moveria o lead;
//   • trocar o desfecho tem consequências que a tela não pode esquecer: a
//     entrega ao administrador em crm_entregas_gestor, o livro do rodízio e a
//     mensagem no chat do lead.
// Quem faz tudo isso é o banco, nas RPCs da migration 20260910130000
// (sdr_corrigir_desfecho / sdr_excluir_agendamento). Daqui saem só a chamada,
// a mensagem em português e o retorno para a tela recarregar a si mesma.
//
// O que NÃO fazemos de propósito:
//   • não escrevemos mensagem de sistema no chat (a RPC já escreve, via
//     rodizio_msg_sistema) — seria duas linhas para o mesmo fato;
//   • não rodamos executeStageAutomations: as três RPCs devolvem stage_id NULL
//     justamente para o front não disparar de novo a automação de entrada da
//     etapa (o paciente receberia a mensagem dela outra vez). Quem cuida disso
//     é a fila do banco. A única exceção é o fallback de compatibilidade em
//     marcarComparecimentoSdr, para a janela em que o site já está publicado e a
//     migration de 10/09 ainda não — a RPC antiga esperava o front.
//
// A terceira RPC (sdr_marcar_comparecimento, o "Compareceu" da SDR) entrou nesta
// mesma casa em 10/09 pelo motivo explicado no JSDoc dela: o toast precisa ler o
// jsonb que ela devolve.
// ============================================================================

/** As RPCs de 10/09 ainda não estão no types.ts gerado pelo Lovable. */
const rpc = (nome: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase as any).rpc(nome, args);

/**
 * Aviso da janela entre publicar o site e aplicar a migration (PGRST202). Serve
 * às três RPCs desta seção, por isso não nomeia uma ação só.
 */
const TEXTO_RPC_AUSENTE_DESFECHO =
  "Esta ação de agendamento ainda não está instalada no banco (migration de 10/09 pendente).";

/**
 * Mensagem do servidor como ele mandou: as duas RPCs recusam em português
 * ("Este lead não é seu…", "Esta consulta está marcada como CONTRATADA pelo
 * sistema de pagamentos…") e é isso que o usuário precisa ler. `toastDbError`
 * não serve aqui: ele só repassa a mensagem quando ela casa com um TRIGGER_HINTS
 * e engoliria essas recusas num "Erro ao atualizar agendamento".
 */
const mensagemDe = (e: unknown, fallback: string): string =>
  mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE_DESFECHO);

/** Retorno comum das duas RPCs (jsonb). Campos ausentes = não houve o caso. */
type RespostaDesfecho = {
  ok?: boolean;
  motivo?: string;
  mensagem?: string;
  status?: string;
  status_antes?: string;
  compareceu?: boolean;
  etapa_mudou?: boolean;
  stage_nome?: string | null;
  /** 'removida' | 'entregue' | 'agendada' | 'nenhuma' (sdr_corrigir_desfecho e sdr_marcar_comparecimento) */
  entrega?: string;
  /** só em sdr_excluir_agendamento — este é contado de verdade (linhas apagadas) */
  entrega_removida?: boolean;
  lead_id?: string;
  /** NULL de propósito nas três RPCs de hoje (ver o bloco acima). */
  stage_id?: string | null;
  phone?: string | null;
};

/** " — lead movido para Compareceu" (nome de etapa no banco pode vir com espaço no fim). */
function trechoDeEtapa(r: RespostaDesfecho): string {
  const nome = (r.stage_nome || "").trim();
  return r.etapa_mudou && nome ? ` — lead movido para ${nome}` : "";
}

/**
 * "Compareceu" da SDR — RPC sdr_marcar_comparecimento.
 *
 * POR QUE ESTA FUNÇÃO MORA AQUI (e não em appointmentOutcome.applySdrComparecimento)
 * Aquela devolvia só `{ ok }` e engolia o resto do jsonb, então o toast da tela
 * tinha de adivinhar o que aconteceu — foi assim que ele passou a prometer "a
 * etapa não muda agora" DEPOIS que a RPC voltou a mover o lead para a etapa
 * "Compareceu" (que, desde 10/09, é visível para a SDR): o card saltava de coluna
 * enquanto a tela avisava que nada tinha mudado. Aqui o texto sai do que o
 * servidor devolveu — `etapa_mudou` + `stage_nome` para a etapa e `entrega` para
 * a passagem ao administrador — no mesmo padrão de corrigirDesfecho/excluir.
 *
 * PENDÊNCIA CONHECIDA: src/pages/CrmCalendario.tsx (handleApptComparecimentoSdr)
 * ainda chama applySdrComparecimento e repete o mesmo toast que mente ("a etapa
 * não muda agora"). Quem puder tocar aquele arquivo troca a chamada por esta
 * função e apaga applySdrComparecimento de src/lib/appointmentOutcome.ts — não
 * deve sobrar dois caminhos para o mesmo clique.
 *
 * A etapa que esta RPC pode anunciar é sempre "Compareceu": quando a carência é
 * 0 e o gatilho já entregou o lead ao administrador (com etapa de desfecho de
 * venda), ela devolve etapa_mudou = false e o nome não é escrito — a SDR nunca lê
 * "Contratado"/"Não contratado" por este caminho.
 *
 * Devolve true quando o comparecimento foi registrado agora.
 */
export async function marcarComparecimentoSdr(appointmentId: string): Promise<boolean> {
  const { data, error } = await rpc("sdr_marcar_comparecimento", { p_appointment_id: appointmentId });
  if (error) {
    toast.error(mensagemDe(error, "Não foi possível registrar o comparecimento."));
    return false;
  }

  const r = (data ?? {}) as RespostaDesfecho;
  if (!r.ok) {
    toast.error(
      r.mensagem ||
        (r.motivo === "ja_tem_desfecho"
          ? "Este agendamento já recebeu desfecho — recarregando"
          : "Não foi possível registrar o comparecimento."),
    );
    return false;
  }

  // NÃO rodamos executeStageAutomations aqui, e isso é deliberado.
  //
  // Havia um bloco de "compatibilidade" que disparava as automações de entrada
  // quando a RPC devolvia stage_id, para o paciente não ficar sem a mensagem na
  // janela entre publicar o site e aplicar a migration. Ele era uma bomba: a RPC
  // move o lead no banco, e o UPDATE de crm_leads.stage_id já aciona
  // trg_enqueue_stage_entry_automations, que enfileira as MESMAS automações de
  // entrada; o automation-engine envia. Com o front disparando também, o paciente
  // recebia DUAS vezes — e o front envia direto, sem passar pela fila, então nem
  // a chave de deduplicação da fila segurava.
  //
  // O jeito certo é a ordem de publicação, que neste projeto é sempre migration
  // antes do site: com a migration aplicada, a RPC devolve stage_id NULL e nada
  // aqui teria rodado de todo modo. E se a ordem se invertesse, o pior caso passa
  // a ser o paciente não receber a mensagem de entrada, que é muito melhor que
  // recebê-la duas vezes. Quem move a etapa é o banco; quem manda é a fila.

  // Só o que o banco disse. 'entregue' = a carência era 0 e o lead já saiu das
  // mãos dela; 'agendada' = continua com ela até o fim da carência; 'nenhuma' =
  // não há passagem agendada (não prometemos uma).
  const entrega =
    r.entrega === "entregue"
      ? " O lead já está com o administrador."
      : r.entrega === "agendada"
      ? " Ele continua com você e passa para o administrador ao fim da carência."
      : "";
  toast.success(`Comparecimento registrado no seu crédito${trechoDeEtapa(r)}.${entrega}`);
  return true;
}

/**
 * Corrige a marcação de presença de uma consulta que já tem desfecho.
 *
 * `compareceu = true`  → compareceu (status 'not_contracted', o estado neutro:
 *   presente, contrato em aberto) e o lead vai para a etapa "Compareceu";
 * `compareceu = false` → falta (status 'no_show'), o lead vai para "Não
 *   compareceu" e a passagem pendente ao administrador é cancelada — ele volta
 *   a ser da SDR para reagendar.
 *
 * A RPC recusa (mensagem própria, mostrada como está) quando a consulta está
 * contratada pelo sistema de pagamentos, quando foi remarcada, quando já foi
 * excluída, ou quando o lead não é de quem clicou.
 *
 * Devolve true quando algo mudou de fato — a tela então recarrega os cards.
 */
export async function corrigirDesfecho(args: {
  appointmentId: string;
  compareceu: boolean;
}): Promise<boolean> {
  const { data, error } = await rpc("sdr_corrigir_desfecho", {
    p_appointment_id: args.appointmentId,
    p_compareceu: args.compareceu,
  });
  if (error) {
    toast.error(mensagemDe(error, "Não foi possível corrigir a marcação de presença."));
    return false;
  }

  const r = (data ?? {}) as RespostaDesfecho;
  if (!r.ok) {
    // 'sem_mudanca' não é erro: já estava como ela quer. 'corrida' é alguém
    // mexendo ao mesmo tempo — a tela recarrega logo em seguida.
    const msg = r.mensagem || "Não foi possível corrigir a marcação de presença.";
    if (r.motivo === "sem_mudanca") toast.info(msg);
    else toast.error(msg);
    return false;
  }

  if (args.compareceu) {
    // A carência de 24 h continua valendo: dizemos o que o banco devolveu, não
    // o que costuma acontecer.
    const entrega =
      r.entrega === "entregue"
        ? " O lead já está com o administrador."
        : r.entrega === "agendada"
        ? " Ele continua com você e passa para o administrador ao fim da carência."
        : "";
    toast.success(`Corrigido: o paciente COMPARECEU${trechoDeEtapa(r)}.${entrega}`);
  } else {
    // Aqui NÃO afirmamos "a passagem para o administrador foi cancelada": a RPC
    // devolve entrega = 'removida' sempre que a correção é "não compareceu",
    // mesmo quando não havia entrega nenhuma para cancelar (ela não devolve
    // quantas linhas de crm_entregas_gestor apagou). Anunciar um cancelamento
    // que talvez não tenha existido é o mesmo tipo de texto que mente pelo qual
    // esta rodada foi reprovada. A mensagem de sistema no chat do lead, essa
    // sim, só cita o cancelamento quando houve (v_removidas > 0).
    toast.success(`Corrigido: o paciente NÃO compareceu${trechoDeEtapa(r)}.`);
  }
  return true;
}

/**
 * Exclui um agendamento errado (agendado no lead errado, horário que nunca
 * existiu, desfecho marcado por engano).
 *
 * Não apaga a linha: grava status 'cancelled' com o motivo. Os relatórios já
 * ignoram 'cancelled' — inclusive o da SDR —, então o número dela se corrige
 * sozinho e a trilha (quem excluiu, quando, por quê) fica no banco e no chat do
 * lead. Se o lead estava numa etapa que prometia essa consulta, a RPC o devolve
 * para "Conversando" (só quando ele não tem outra consulta viva) e cancela a
 * passagem pendente ao administrador.
 *
 * O motivo é obrigatório (mín. 3 caracteres) — a checagem é repetida aqui só
 * para não gastar uma ida ao servidor; quem manda é a RPC.
 */
export async function excluirAgendamento(args: {
  appointmentId: string;
  motivo: string;
}): Promise<boolean> {
  const motivo = args.motivo.trim();
  if (motivo.length < 3) {
    toast.error("Escreva o motivo da exclusão (mín. 3 caracteres) — ele fica no histórico do paciente");
    return false;
  }

  const { data, error } = await rpc("sdr_excluir_agendamento", {
    p_appointment_id: args.appointmentId,
    p_motivo: motivo,
  });
  if (error) {
    toast.error(mensagemDe(error, "Não foi possível excluir o agendamento."));
    return false;
  }

  const r = (data ?? {}) as RespostaDesfecho;
  if (!r.ok) {
    const msg = r.mensagem || "Não foi possível excluir o agendamento.";
    if (r.motivo === "ja_excluido") toast.info(msg);
    else toast.error(msg);
    return false;
  }

  const entrega = r.entrega_removida ? " A passagem para o administrador foi cancelada." : "";
  toast.success(
    `Agendamento excluído — sai dos relatórios e fica no histórico do paciente${trechoDeEtapa(r)}.${entrega}`,
  );
  return true;
}

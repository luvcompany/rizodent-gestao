/**
 * O que o CRClin faz sozinho com a resposta do formulário (WhatsApp Flow).
 *
 * Regra de ouro herdada de 17/09/2026: NENHUMA decisão de comparecimento é
 * automática. Por isso:
 *   - "Confirmo"          → confirma a consulta (pending → confirmed). É o que
 *                           a própria pessoa acabou de dizer; não é presença.
 *   - "Preciso remarcar"  → move para a etapa de espera "Reagendar" (a mesma do
 *                           botão da SDR), sem mexer no agendamento. Ali ele
 *                           para de receber os lembretes daquela consulta.
 *   - "Não vou mais"      → NADA de desfecho. Registra e avisa a dona do lead:
 *                           cancelar/marcar não contratado mexe em relatório e
 *                           em dinheiro, então continua sendo decisão de gente.
 *
 * Nunca lança: qualquer falha vira log e a mensagem do paciente segue gravada.
 */

const normalizar = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export type RespostaDoFormulario = {
  presenca: string | null;
  motivo: string | null;
  /** Preferência de remarcação: "AAAA-MM-DD|manha" ou "...|tarde". */
  quando: string | null;
  /** lead_id|appointment_id montado no envio. */
  flowToken: string | null;
};

const DIA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** "2026-09-25|manha" → "Quinta, 25/09 de manhã". */
export function rotuloDoQuando(valor: string | null | undefined): string | null {
  const bruto = String(valor || "").trim();
  if (!bruto) return null;
  const [data, turno] = bruto.split("|");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || "")) return bruto;
  const d = new Date(`${data}T12:00:00Z`);
  const dia = DIA_SEMANA[d.getUTCDay()] ?? "";
  const periodo = turno === "tarde" ? "à tarde" : turno === "manha" ? "de manhã" : "";
  return `${dia}, ${data.slice(8, 10)}/${data.slice(5, 7)}${periodo ? " " + periodo : ""}`;
}

/** Lê o response_json do nfm_reply sem nunca quebrar. */
export function lerRespostaDoFormulario(responseJson: unknown): RespostaDoFormulario & { extras: Record<string, unknown> } {
  let bruto: any = {};
  try {
    bruto = typeof responseJson === "string" ? JSON.parse(responseJson || "{}") : (responseJson ?? {});
  } catch {
    bruto = {};
  }
  const extras: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(bruto || {})) {
    if (["presenca", "motivo", "flow_token", "quando"].includes(chave)) continue;
    if (valor === null || valor === undefined || valor === "") continue;
    extras[chave] = valor;
  }
  return {
    presenca: bruto?.presenca ? String(bruto.presenca) : null,
    motivo: bruto?.motivo ? String(bruto.motivo).trim() : null,
    quando: bruto?.quando ? String(bruto.quando) : null,
    flowToken: bruto?.flow_token ? String(bruto.flow_token) : null,
    extras,
  };
}

/** Consulta apontada pelo flow_token; na falta dele, a próxima do lead. */
async function consultaDaResposta(
  supabase: any,
  leadId: string,
  flowToken: string | null,
): Promise<{ id: string; status: string; scheduled_date: string; scheduled_time: string | null } | null> {
  const idNoToken = (flowToken || "").split("|")[1]?.trim();
  if (idNoToken) {
    const { data } = await supabase
      .from("crm_appointments")
      .select("id, status, scheduled_date, scheduled_time")
      .eq("id", idNoToken)
      .eq("lead_id", leadId)
      .maybeSingle();
    if (data) return data as any;
  }
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());
  const { data: lista } = await supabase
    .from("crm_appointments")
    .select("id, status, scheduled_date, scheduled_time")
    .eq("lead_id", leadId)
    .in("status", ["confirmed", "pending"])
    .order("scheduled_date", { ascending: true })
    .order("scheduled_time", { ascending: true })
    .limit(20);
  const consultas = (lista || []) as any[];
  return consultas.find((c) => c.scheduled_date >= hoje) ?? consultas[consultas.length - 1] ?? null;
}

/** Etapa de espera "Reagendar" do funil do lead (ou do Funil Principal). */
async function etapaReagendar(supabase: any, leadId: string): Promise<string | null> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("pipeline_id, tenant_id, stage_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return null;

  const procurar = async (pipelineId: string | null) => {
    if (!pipelineId) return null;
    const { data: etapas } = await supabase
      .from("crm_stages")
      .select("id, name")
      .eq("pipeline_id", pipelineId);
    return ((etapas || []) as any[]).find((e) => normalizar(e.name) === "reagendar")?.id ?? null;
  };

  let destino = await procurar((lead as any).pipeline_id);
  if (!destino) {
    const { data: funis } = await supabase
      .from("crm_pipelines")
      .select("id, name")
      .eq("tenant_id", (lead as any).tenant_id);
    const principal = ((funis || []) as any[]).find((f) => /funil principal/i.test(f.name));
    destino = await procurar(principal?.id ?? null);
  }
  if (!destino || destino === (lead as any).stage_id) return null;
  return destino;
}

async function nota(supabase: any, leadId: string, texto: string) {
  await supabase.from("messages").insert({
    lead_id: leadId,
    direction: "outbound",
    type: "system",
    content: texto,
    status: "system",
  });
}

/**
 * Aplica a resposta. Devolve o que foi feito (para log); nunca lança.
 */
export async function aplicarRespostaDoFormulario(
  supabase: any,
  args: { leadId: string; resposta: RespostaDoFormulario },
): Promise<string> {
  const { leadId, resposta } = args;
  const escolha = normalizar(resposta.presenca || "");
  if (!escolha) return "sem escolha";

  try {
    const consulta = await consultaDaResposta(supabase, leadId, resposta.flowToken);
    const quando = consulta
      ? `${consulta.scheduled_date.slice(8, 10)}/${consulta.scheduled_date.slice(5, 7)}` +
        (consulta.scheduled_time ? ` às ${String(consulta.scheduled_time).slice(0, 5)}` : "")
      : null;

    if (escolha === "confirmo") {
      if (!consulta) {
        await nota(supabase, leadId, "✅ Confirmou presença pelo formulário — sem consulta marcada no sistema");
        return "confirmou sem consulta";
      }
      if (consulta.status === "pending") {
        const { data } = await supabase
          .from("crm_appointments")
          .update({ status: "confirmed" })
          .eq("id", consulta.id)
          .eq("status", "pending")
          .select("id");
        const mudou = Array.isArray(data) && data.length > 0;
        await nota(
          supabase,
          leadId,
          `✅ Confirmou presença pelo formulário${quando ? ` — consulta de ${quando}` : ""}${mudou ? "" : " (a consulta já havia mudado de estado)"}`,
        );
        return mudou ? "consulta confirmada" : "consulta já não estava pendente";
      }
      await nota(supabase, leadId, `✅ Confirmou presença pelo formulário${quando ? ` — consulta de ${quando}` : ""}`);
      return "já estava confirmada";
    }

    if (escolha === "remarcar") {
      const preferencia = rotuloDoQuando(resposta.quando);
      const detalhes = [preferencia ? `prefere ${preferencia}` : null, resposta.motivo].filter(Boolean).join(" · ");
      const destino = await etapaReagendar(supabase, leadId);
      if (destino) {
        const { data } = await supabase
          .from("crm_leads")
          .update({ stage_id: destino, updated_at: new Date().toISOString() })
          .eq("id", leadId)
          .select("id");
        const moveu = Array.isArray(data) && data.length > 0;
        await nota(
          supabase,
          leadId,
          moveu
            ? `🔁 Pediu para remarcar pelo formulário${detalhes ? ` — ${detalhes}` : ""} · lead em espera na etapa Reagendar`
            : `🔁 Pediu para remarcar pelo formulário${detalhes ? ` — ${detalhes}` : ""}`,
        );
        return moveu ? "movido para Reagendar" : "não consegui mover";
      }
      await nota(
        supabase,
        leadId,
        `🔁 Pediu para remarcar pelo formulário${detalhes ? ` — ${detalhes}` : ""} (funil sem etapa "Reagendar")`,
      );
      return "sem etapa Reagendar";
    }

    if (escolha === "desistir") {
      // Sem desfecho automático: isso conta em relatório e em faturamento.
      await nota(
        supabase,
        leadId,
        `⚠️ Disse no formulário que NÃO vai mais fazer${resposta.motivo ? ` — ${resposta.motivo}` : ""} · decidir o desfecho na mão`,
      );
      const { data: lead } = await supabase
        .from("crm_leads")
        .select("assigned_to, name")
        .eq("id", leadId)
        .maybeSingle();
      if ((lead as any)?.assigned_to) {
        await supabase.from("crm_notifications").insert({
          user_id: (lead as any).assigned_to,
          lead_id: leadId,
          title: "Paciente desistiu pelo formulário",
          body: `${(lead as any).name || "O paciente"} respondeu que não vai mais fazer${resposta.motivo ? `: ${resposta.motivo}` : ""}`,
          type: "automation",
        });
      }
      return "desistência registrada";
    }

    return `escolha desconhecida: ${escolha}`;
  } catch (e) {
    console.error(`[acoesDoFormulario] falhou lead=${leadId}: ${e instanceof Error ? e.message : String(e)}`);
    return "erro";
  }
}

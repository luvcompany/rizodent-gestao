/**
 * Por qual número de WhatsApp sai a mensagem de um lead.
 *
 * Regra (09/10/2026, base Kommo: a resposta sai pelo canal em que o cliente
 * escreveu):
 *  1. resposta/reação a uma mensagem → o número daquela mensagem;
 *  2. o paciente escreveu nas últimas 24h → o número em que ele escreveu (a
 *     janela de 24h da Meta é POR NÚMERO: responder por outro número cai fora
 *     da janela e o texto livre é recusado);
 *  3. o número do lead (carimbo / escolha em "Enviar por");
 *  4. o último número em que o paciente escreveu (mesmo fora da janela);
 *  5. o número padrão da equipe do lead (is_default), depois o canal do funil,
 *     a integração herdada whatsapp_config e qualquer número ativo da equipe.
 * Todo candidato precisa ser da MESMA EQUIPE (mundo) do lead, estar ativo, ter
 * credencial e não estar com a integração desativada — número desligado ou
 * trocado não trava mais a conversa: o próximo candidato assume.
 *
 * Antes: lead sem carimbo saía SEMPRE pelo número padrão. No dia em que o
 * número oficial virou padrão (09/10), toda resposta às conversas do
 * "Comercial 2" passaria a sair pelo oficial, fora da janela. E lead carimbado
 * com número desativado ficava sem envio ("Número do lead sem credenciais").
 */

export type SaidaOk = {
  ok: true;
  /** whatsapp_numbers.id do número usado (null só quando não há cadastro do número). */
  numberId: string | null;
  phoneNumberId: string;
  token: string;
  mmLite: boolean;
  integrationKey: string | null;
  motivo: string;
};
export type SaidaErro = { ok: false; status: number; error: string };

type Numero = {
  id: string;
  phone_number_id: string | null;
  mundo: string | null;
  dono_user_id: string | null;
  is_active: boolean;
  is_default: boolean;
  token: string | null;
  created_at: string | null;
};
type Integracao = { key: string; status: string | null; owner_role: string | null; config: Record<string, any> | null };

const JANELA_MS = 24 * 3600 * 1000;

function mundoDoPapel(papel: string | null | undefined): string {
  const p = String(papel ?? "");
  return ["", "crc", "sdr", "crc_legacy", "superadmin", "gerente"].includes(p) ? "crc" : p;
}

/** Integração de um número pelo phone_number_id (a do oficial é `whatsapp_config`). */
export function integracaoDoPnid(integracoes: Integracao[], pnid: string | null): Integracao | null {
  if (!pnid) return null;
  const doPnid = integracoes.filter((i) => String(i.config?.phone_number_id ?? "") === String(pnid));
  return doPnid.find((i) => i.key === `whatsapp_${pnid}`) ?? doPnid.find((i) => i.key === "whatsapp_config") ?? doPnid[0] ?? null;
}

export async function numeroDeSaida(
  supabase: any,
  p: {
    leadId: string;
    tenantId: string;
    leadNumberId: string | null;
    pipelineId: string | null;
    /** Mensagem respondida ou reagida (o envio tem de sair pelo número dela). */
    mensagemReferenciaId?: string | null;
  },
): Promise<SaidaOk | SaidaErro> {
  const [{ data: nums }, { data: ints }, { data: entradas }] = await Promise.all([
    supabase
      .from("whatsapp_numbers")
      .select("id, phone_number_id, mundo, dono_user_id, is_active, is_default, token, created_at")
      .eq("tenant_id", p.tenantId),
    supabase
      .from("integrations")
      .select("key, status, owner_role, config")
      .eq("tenant_id", p.tenantId)
      .like("key", "whatsapp%"),
    supabase
      .from("messages")
      .select("whatsapp_number_id, created_at")
      .eq("lead_id", p.leadId)
      .eq("direction", "inbound")
      .not("whatsapp_number_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const numeros = (nums || []) as Numero[];
  const integracoes = (ints || []) as Integracao[];
  const legado = integracoes.find((i) => i.key === "whatsapp_config") ?? null;
  const porId = new Map(numeros.map((n) => [n.id, n]));

  // Equipe (mundo) do lead: a do número carimbado; sem carimbo, a do número legado.
  const carimbo = p.leadNumberId ? porId.get(p.leadNumberId) ?? null : null;
  const mundoLead = carimbo ? (carimbo.mundo || "crc") : mundoDoPapel(legado?.owner_role ?? null);
  const donoLead = carimbo?.dono_user_id ?? null;
  const mesmaEquipe = (n: Numero) =>
    (n.mundo || "crc") === mundoLead &&
    (!donoLead || !n.dono_user_id || n.dono_user_id === donoLead);

  let viuDesativada = false;
  const tentarNumero = (id: string | null | undefined, motivo: string): SaidaOk | null => {
    if (!id) return null;
    const n = porId.get(id);
    if (!n || !n.is_active || !n.phone_number_id || !mesmaEquipe(n)) return null;
    const intg = integracaoDoPnid(integracoes, n.phone_number_id);
    if (intg?.status === "disabled") { viuDesativada = true; return null; }
    const cfg = (intg?.config ?? {}) as Record<string, any>;
    const token = cfg.access_token || cfg.token || n.token || "";
    const pnid = String(cfg.phone_number_id || n.phone_number_id || "");
    if (!token || !pnid) return null;
    return { ok: true, numberId: n.id, phoneNumberId: pnid, token, mmLite: cfg.mm_lite === true, integrationKey: intg?.key ?? null, motivo };
  };
  const tentarIntegracao = (intg: Integracao | null, motivo: string): SaidaOk | null => {
    if (!intg) return null;
    if (intg.status === "disabled") { viuDesativada = true; return null; }
    const cfg = (intg.config ?? {}) as Record<string, any>;
    const token = cfg.access_token || cfg.token || "";
    const pnid = String(cfg.phone_number_id || "");
    if (!token || !pnid) return null;
    const n = numeros.find((x) => x.phone_number_id === pnid) ?? null;
    if (n && (!n.is_active || !mesmaEquipe(n))) return null;
    if (!n && mundoDoPapel(intg.owner_role) !== mundoLead) return null;
    return { ok: true, numberId: n?.id ?? null, phoneNumberId: pnid, token, mmLite: cfg.mm_lite === true, integrationKey: intg.key, motivo };
  };

  // 1) Resposta/reação: o número da mensagem de referência.
  if (p.mensagemReferenciaId) {
    const { data: ref } = await supabase
      .from("messages").select("whatsapp_number_id, lead_id").eq("id", p.mensagemReferenciaId).maybeSingle();
    if ((ref as any)?.lead_id === p.leadId) {
      const r = tentarNumero((ref as any)?.whatsapp_number_id, "número da mensagem respondida");
      if (r) return r;
    }
  }

  // 2) Janela aberta: o número em que o paciente escreveu nas últimas 24h.
  const ultima = ((entradas || []) as any[])[0] ?? null;
  const ultimaMs = ultima?.created_at ? new Date(ultima.created_at).getTime() : 0;
  if (ultima && Date.now() - ultimaMs < JANELA_MS) {
    const r = tentarNumero(ultima.whatsapp_number_id, "número em que o paciente escreveu (janela de 24h aberta)");
    if (r) return r;
  }

  // 3) O número do lead.
  const r3 = tentarNumero(p.leadNumberId, "número do lead");
  if (r3) return r3;

  // 4) Último número em que o paciente escreveu.
  const r4 = tentarNumero(ultima?.whatsapp_number_id, "último número em que o paciente escreveu");
  if (r4) return r4;

  // 5) Padrão da equipe → canal do funil → integração herdada → qualquer ativo.
  const daEquipe = numeros
    .filter((n) => n.is_active && mesmaEquipe(n))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || String(a.created_at).localeCompare(String(b.created_at)));
  const padrao = daEquipe.find((n) => n.is_default);
  const r5 = tentarNumero(padrao?.id, "número padrão de envio");
  if (r5) return r5;

  if (p.pipelineId) {
    const { data: canal } = await supabase
      .from("funnel_channels")
      .select("channel_config")
      .eq("channel_type", "whatsapp")
      .eq("pipeline_id", p.pipelineId)
      .eq("tenant_id", p.tenantId)
      .limit(1);
    const chave = ((canal as any[] | null)?.[0]?.channel_config as any)?.integration_key ?? null;
    const r6 = tentarIntegracao(integracoes.find((i) => i.key === chave) ?? null, "canal do funil");
    if (r6) return r6;
  }

  const r7 = tentarIntegracao(legado, "número principal (whatsapp_config)");
  if (r7) return r7;

  for (const n of daEquipe) {
    const r = tentarNumero(n.id, "número ativo da equipe");
    if (r) return r;
  }

  return viuDesativada
    ? { ok: false, status: 403, error: "Integração desativada" }
    : { ok: false, status: 400, error: "Nenhum número de WhatsApp ativo da equipe deste lead" };
}

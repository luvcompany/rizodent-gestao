import { supabase } from "@/integrations/supabase/client";

// Gera o nome do template no padrão exigido pela Meta: minúsculas, sem acento,
// apenas [a-z0-9_], começando por letra. Sufixo curto do id garante unicidade no WABA.
export function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "unidade";
}

export type ClinicaLike = {
  id: string;
  nome: string | null;
  cidade: string | null;
  endereco: string | null;
  location_link?: string | null;
  tenant_id?: string | null;
};

export function appointmentTemplateName(clinica: ClinicaLike): string {
  const base = slugify(clinica.nome || clinica.cidade || "unidade");
  const suffix = String(clinica.id || "").replace(/-/g, "").slice(0, 6) || "0";
  return `agendamento_${base}_${suffix}`;
}

// Corpo padrão do modelo de agendamento (GENÉRICO — nenhum dado da Rizodent hardcoded).
// Convenção de variáveis: {{1}} = DATA, {{2}} = HORA (iguais aos modelos existentes).
// Endereço e nome da unidade são FIXADOS no corpo (não são variáveis de runtime);
// o link de localização vira o botão "Ver localização".
export function buildAppointmentTemplateBody(clinica: ClinicaLike): string {
  const nome = (clinica.nome || "nossa clínica").trim();
  const endereco = (clinica.endereco || "").trim();
  const enderecoLine = endereco ? `\n📍 ${endereco}\n` : "\n";
  return (
    `Olá! Seu agendamento na ${nome} está confirmado 🧡\n` +
    enderecoLine +
    `\n🗓️ Data: {{1}}\n🕐 Horário: {{2}}\n\n` +
    `Qualquer imprevisto, é só nos avisar por aqui. Estaremos te esperando!`
  );
}

export function buildAppointmentTemplateRow(clinica: ClinicaLike) {
  const name = appointmentTemplateName(clinica);
  const link = (clinica.location_link || "").trim();
  const buttons = link ? [{ type: "URL", text: "Ver localização", url: link }] : null;
  return {
    name,
    category: "UTILITY",
    language: "pt_BR",
    status: "DRAFT",
    header_type: null as string | null,
    header_content: null as string | null,
    body_text: buildAppointmentTemplateBody(clinica),
    footer_text: null as string | null,
    buttons,
    tenant_id: clinica.tenant_id ?? null,
    shared_roles: [] as string[],
  };
}

// Cria/atualiza a linha do template e o envia à Meta para aprovação; ao dar certo,
// grava o nome em clinicas.appointment_template_name. Retorna o resultado da submissão.
export async function generateAndSubmitAppointmentTemplate(
  clinica: ClinicaLike,
): Promise<{ ok: boolean; name: string; status?: string; error?: string }> {
  const row = buildAppointmentTemplateRow(clinica);

  // Upsert do template local (por nome) antes de submeter.
  const { data: existing } = await supabase
    .from("crm_whatsapp_templates" as any)
    .select("id")
    .eq("name", row.name)
    .maybeSingle();

  if ((existing as any)?.id) {
    const { error: upErr } = await supabase
      .from("crm_whatsapp_templates" as any)
      .update({
        category: row.category,
        language: row.language,
        body_text: row.body_text,
        buttons: row.buttons,
        header_type: row.header_type,
        header_content: row.header_content,
        footer_text: row.footer_text,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (existing as any).id);
    if (upErr) return { ok: false, name: row.name, error: upErr.message };
  } else {
    const { error: insErr } = await supabase.from("crm_whatsapp_templates" as any).insert(row);
    if (insErr) return { ok: false, name: row.name, error: insErr.message };
  }

  // Submete à Meta (a mesma edge usada pelo editor de modelos).
  const { data, error } = await supabase.functions.invoke("submit-whatsapp-template", {
    body: { template_name: row.name },
  });
  if (error) return { ok: false, name: row.name, error: error.message || String(error) };
  if ((data as any)?.error) return { ok: false, name: row.name, error: (data as any).error };

  // Vincula o modelo à unidade (resolução cidade->modelo da Bia usa esta coluna).
  await supabase
    .from("clinicas")
    .update({ appointment_template_name: row.name } as any)
    .eq("id", clinica.id);

  return { ok: true, name: row.name, status: (data as any)?.status || "PENDING" };
}

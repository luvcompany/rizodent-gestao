/**
 * Rótulos e formatos do painel admin (PT-BR).
 * Fonte única: telas e componentes do admin não escrevem esses textos à mão.
 */

const ROTULOS_STATUS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  deleted: "Na lixeira",
  conectado: "Conectado",
  desativado: "Desativado",
  erro: "Com erro",
  pendente: "Pendente",
  ativa: "Ativa",
  desativada: "Desativada",
};

/** Rótulo de status em PT-BR. Status desconhecido volta como veio. */
export function rotuloStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return ROTULOS_STATUS[status] ?? status;
}

const ROTULOS_SEGMENTO: Record<string, string> = {
  odontologia: "Odontologia",
  oftalmologia: "Oftalmologia",
  estetica: "Estética",
  medica_geral: "Médica geral",
};

export function rotuloSegmento(segmento: string | null | undefined): string {
  if (!segmento) return "—";
  return ROTULOS_SEGMENTO[segmento] ?? segmento;
}

const ROTULOS_ACAO_AUDITORIA: Record<string, string> = {
  tenant_create: "Cliente criado",
  tenant_update: "Cliente alterado",
  tenant_pause: "Cliente pausado",
  tenant_activate: "Cliente ativado",
  tenant_sessions_revoke: "Sessões do cliente encerradas",
  tenant_delete: "Cliente enviado para a lixeira",
  tenant_restore: "Cliente restaurado da lixeira",
  tenant_hard_delete: "Cliente excluído definitivamente",
  tenant_asset_upload: "Imagem do cliente enviada",
  tenant_modules_set: "Módulos do cliente alterados",
  tenant_segment_apply: "Segmento aplicado ao cliente",
  tenant_plan_set: "Plano do cliente alterado",
  webhook_secret_rotate: "Segredo do webhook de leads rotacionado",
  api_key_create: "Chave de API criada",
  api_key_revoke: "Chave de API revogada",
  system_settings_update: "Marca do sistema alterada",
  system_asset_upload: "Imagem do sistema enviada",
  meta_app_save: "App Meta salvo",
  meta_app_delete: "App Meta apagado",
  meta_app_import_env: "App Meta geral importado do ambiente",
  meta_app_test: "App Meta testado",
  tenant_meta_app_set: "App Meta do cliente definido",
  waba_connect: "WABA conectada",
  waba_token_set: "Token da WABA substituído",
  waba_subscribe: "App assinado na WABA",
  waba_sync: "Números da WABA sincronizados",
  waba_remove: "WABA removida",
  wa_number_update: "Número de WhatsApp alterado",
  wa_number_test: "Número de WhatsApp testado",
  wa_number_send_test: "Mensagem de teste enviada",
  wa_number_register: "Número de WhatsApp registrado",
  wa_number_delete: "Número de WhatsApp apagado",
  wa_number_transfer: "Número de WhatsApp transferido de cliente",
  wa_number_coex_sync: "Sincronização da coexistência solicitada",
  meta_unknown_discard: "Evento de número desconhecido descartado",
  meta_unknown_assign: "Número desconhecido atribuído a um cliente",
  module_catalog_update: "Catálogo de módulos alterado",
  segment_preset_update: "Predefinição de segmento alterada",
  tenant_unit_save: "Unidade do cliente salva",
  tenant_unit_deactivate: "Unidade do cliente desativada",
  impersonate_start: "Acesso como cliente gerado",
  impersonate_redeem: "Acesso como cliente usado",
  superadmin_create: "Administrador adicionado",
  superadmin_revoke: "Administrador removido",
  user_block: "Usuário bloqueado",
  user_unblock: "Usuário desbloqueado",
  user_create: "Usuário criado",
  user_reset_password: "Senha de usuário redefinida",
  user_set_role: "Papel de usuário alterado",
  user_set_email: "E-mail de usuário alterado",
  user_delete: "Usuário excluído",
};

/** Rótulo de uma action do admin_audit_log. Chave desconhecida volta como veio. */
export function rotuloAcaoAuditoria(acao: string | null | undefined): string {
  if (!acao) return "—";
  return ROTULOS_ACAO_AUDITORIA[acao] ?? acao;
}

/** Todas as actions conhecidas, na ordem do mapa (para filtros). */
export const ACOES_AUDITORIA_CONHECIDAS: readonly string[] = Object.keys(ROTULOS_ACAO_AUDITORIA);

type DataEntrada = string | number | Date | null | undefined;

function paraData(valor: DataEntrada): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

const FMT_DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const FMT_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** '28/09/2026 14:05'. Vazio ou inválido vira '—'. */
export function dataHora(valor: DataEntrada): string {
  const d = paraData(valor);
  return d ? FMT_DATA_HORA.format(d).replace(",", "") : "—";
}

/**
 * '28/09/2026'. Uma data pura 'AAAA-MM-DD' é lida como dia local (sem o
 * deslocamento de fuso que o `new Date('2026-09-28')` causaria).
 */
export function dataCurta(valor: DataEntrada): string {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split("-");
    return `${d}/${m}/${a}`;
  }
  const d = paraData(valor);
  return d ? FMT_DATA.format(d) : "—";
}

/**
 * Tempo relativo em PT-BR: 'agora', 'há 5 min', 'há 2 h', 'há 3 dias',
 * 'em 4 dias' (futuro). Acima de 30 dias, mostra a data.
 */
export function relativo(valor: DataEntrada, agora: Date = new Date()): string {
  const d = paraData(valor);
  if (!d) return "—";
  const diffMs = agora.getTime() - d.getTime();
  const futuro = diffMs < 0;
  const seg = Math.abs(diffMs) / 1000;
  if (seg < 45) return futuro ? "em instantes" : "agora";
  const min = Math.round(seg / 60);
  const hora = Math.round(seg / 3600);
  const dia = Math.round(seg / 86400);
  let texto: string;
  if (min < 60) texto = `${min} min`;
  else if (hora < 24) texto = `${hora} h`;
  else if (dia <= 30) texto = dia === 1 ? "1 dia" : `${dia} dias`;
  else return dataCurta(d);
  return futuro ? `em ${texto}` : `há ${texto}`;
}

const FMT_NUMERO = new Intl.NumberFormat("pt-BR");
const FMT_MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Número com separador de milhar. Nulo vira '—'. */
export function numero(valor: number | null | undefined): string {
  return typeof valor === "number" && Number.isFinite(valor) ? FMT_NUMERO.format(valor) : "—";
}

/** 'R$ 1.234,56'. Nulo vira '—'. */
export function reais(valor: number | string | null | undefined): string {
  const n = typeof valor === "string" ? Number(valor) : valor;
  return typeof n === "number" && Number.isFinite(n) ? FMT_MOEDA.format(n) : "—";
}

/** '2 MB', '350 KB'. */
export function tamanhoArquivo(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1).replace(".", ",")} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

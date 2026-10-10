/**
 * Regras puras da checagem de saúde dos números de WhatsApp
 * (whatsapp-health-check). Ficam aqui para serem testadas sem rede.
 *
 * Erro de CONTA gravado pelo envio (09/10/2026): quando a Meta recusa um envio
 * por erro de conta, o send-whatsapp-message grava na hora
 * integrations.health_status = 'error' com um destes motivos (ver o bloco
 * "erroDeConta" em send-whatsapp-message/index.ts). Antes, 5 minutos depois o
 * cron lia `status: CONNECTED` na Meta e devolvia "ok" — os envios voltavam e
 * falhavam de novo, em série. O `status` do número não prova nada nesses
 * casos: um número que nunca passou pelo /register (erro 133010) aparece
 * CONNECTED na Meta e mesmo assim não envia. Por isso, nas 6 horas seguintes ao
 * erro do envio, o erro só é apagado com PROVA de que a causa acabou.
 */

/** 133010 / 133000 / "not registered" (e o padrão do bloco "erroDeConta"). */
export const MOTIVO_ENVIO_NAO_REGISTRADO = "Número desconectado da Meta (não registrado)";
/** 131031: conta bloqueada/restrita. */
export const MOTIVO_ENVIO_CONTA_BLOQUEADA = "Conta bloqueada/restrita pela Meta";
/** 131042: pagamento. */
export const MOTIVO_ENVIO_PAGAMENTO = "Problema de pagamento na conta Meta";

/** Por quanto tempo o erro de conta gravado pelo envio vale sem prova em contrário. */
export const JANELA_ERRO_DO_ENVIO_MS = 6 * 3600 * 1000;

export type SaudeGravada = {
  health_status: string | null;
  health_reason: string | null;
  health_checked_at: string | null;
};

export type LeituraDaMeta = {
  /** Resultado da própria checagem (ok / warning / error). */
  health_status: string;
  /** `status` do número na Meta (CONNECTED, PENDING…), em maiúsculas. */
  meta_status: string | null;
  /** `platform_type` do número: CLOUD_API = registrado na API de nuvem. */
  platform_type: string | null;
  /** A conta (WABA) foi consultada e não está banida nem reprovada. null = não consultada. */
  waba_ok: boolean | null;
};

/**
 * O erro de conta gravado pelo envio deve ser MANTIDO (a checagem não pode
 * sobrescrever com "ok"/"warning")?
 *
 *  - só vale para os motivos que o envio grava e por 6 h a partir do erro;
 *  - token (190) não entra aqui: a própria checagem usa o mesmo token, então
 *    se a Meta respondeu, o token voltou a valer;
 *  - "não registrado": prova = número CONNECTED **e** platform_type CLOUD_API
 *    (registrado na API de nuvem; coexistência também aparece como CLOUD_API);
 *  - "conta bloqueada/restrita": a mesma prova **e** a conta (WABA) consultada
 *    sem banimento nem reprovação;
 *  - "pagamento": a Meta não expõe isso nos campos lidos — segura as 6 h.
 * Se a própria checagem achou erro, não há o que manter: ela grava o dela.
 */
export function manterErroDoEnvio(gravado: SaudeGravada, leitura: LeituraDaMeta, agoraMs: number): boolean {
  if (gravado.health_status !== "error") return false;
  const motivo = String(gravado.health_reason ?? "");
  if (![MOTIVO_ENVIO_NAO_REGISTRADO, MOTIVO_ENVIO_CONTA_BLOQUEADA, MOTIVO_ENVIO_PAGAMENTO].includes(motivo)) return false;
  const quando = gravado.health_checked_at ? new Date(gravado.health_checked_at).getTime() : NaN;
  if (!Number.isFinite(quando) || agoraMs - quando >= JANELA_ERRO_DO_ENVIO_MS) return false;
  if (leitura.health_status === "error") return false;

  const registrado = leitura.meta_status === "CONNECTED" && String(leitura.platform_type ?? "").toUpperCase() === "CLOUD_API";
  if (motivo === MOTIVO_ENVIO_NAO_REGISTRADO) return !registrado;
  if (motivo === MOTIVO_ENVIO_CONTA_BLOQUEADA) return !(registrado && leitura.waba_ok === true);
  return true;
}

/**
 * Telefone do número no formato gravado em whatsapp_numbers.phone_e164
 * (+55DDDNÚMERO, só dígitos — o mesmo de minha-conexao-whatsapp). Usa o
 * display_phone_number da Meta COMO ESTÁ: não completa nem tira o 9º dígito
 * (o número exibido é o que a Meta tem; inventar um 9 mostraria um número que
 * não existe). Com "+" na frente o código do país já veio: não acrescenta 55.
 */
export function e164DaMeta(displayPhoneNumber: string | null | undefined): string | null {
  const bruto = String(displayPhoneNumber ?? "").trim();
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length < 10) return null;
  if (bruto.startsWith("+") || digitos.startsWith("55")) return `+${digitos}`;
  return `+55${digitos}`;
}

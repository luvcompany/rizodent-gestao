/**
 * Frase em PT-BR para um erro do banco (PostgREST), do Storage ou do Auth (X-20).
 *
 * Antes cada tela fazia `toast.error(error.message)` e o usuário lia "new row
 * violates row-level security policy for table …" ou "duplicate key value
 * violates unique constraint …". Aqui fica a tradução única:
 *   - mensagem que já é do produto (RAISE das nossas funções, em PT-BR) passa
 *     como veio: é ela que explica o motivo;
 *   - código do Postgres/PostgREST (42501, 23505, 23503, 23502, 23514, 22P02,
 *     57014, 40001, 55P03, PGRST116, PGRST301…) vira frase;
 *   - código/mensagem do Auth (credenciais, senha fraca, limite de envio…) e
 *     do Storage (tamanho, tipo) idem;
 *   - status HTTP (401/403/404/409/423/429/5xx) quando só ele vem;
 *   - falha de rede;
 *   - nada disso → `padrao`.
 *
 * Edge functions: continuar com `motivoDoServidor` (src/lib/erroDeFuncao.ts),
 * que lê o corpo da resposta; esta função é para erros do supabase-js que já
 * trazem `code`/`message`/`status`.
 *
 * Uso: `toast.error("Erro ao salvar: " + mensagemDeErro(error))` ou
 * `toast.error(mensagemDeErro(error, "Não foi possível salvar."))`.
 */

export const FRASE_SEM_PERMISSAO = "Seu perfil não tem permissão para esta ação.";
export const FRASE_DUPLICADO = "Já existe um registro com esses dados.";
export const FRASE_SESSAO_EXPIRADA = "Sua sessão expirou: entre de novo.";
export const FRASE_SEM_CONEXAO = "Sem conexão com o servidor: confira a internet e tente de novo.";
export const FRASE_MUITAS_TENTATIVAS = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
/** Link do Auth (recuperação de senha, convite) vencido ou já usado — às vezes
 *  por um filtro de e-mail que "clica" no link antes da pessoa. */
export const FRASE_LINK_VENCIDO = "O link expirou ou já foi usado. Peça um novo.";
/** REC-07: recepção/closer sem número liberado (gatilhos stamp_crm_lead_whatsapp_number e closer_pacientes). */
export const FRASE_NUMERO_NAO_LIBERADO = "Nenhum número de WhatsApp foi liberado para você — peça ao gerente.";

const PADRAO = "Não foi possível concluir a ação. Tente de novo.";

type ErroLido = { code: string; status: number; message: string; name: string };

function ler(erro: unknown): ErroLido {
  if (typeof erro === "string") return { code: "", status: 0, message: erro, name: "" };
  const e = (erro && typeof erro === "object" ? erro : {}) as Record<string, unknown>;
  const status = Number(e.status ?? e.statusCode ?? 0);
  return {
    code: typeof e.code === "string" ? e.code : typeof e.code === "number" ? String(e.code) : "",
    status: Number.isFinite(status) ? status : 0,
    message: typeof e.message === "string" ? e.message.trim() : typeof e.error === "string" ? String(e.error).trim() : "",
    name: typeof e.name === "string" ? e.name : "",
  };
}

// Frases que o banco manda e que já têm tradução própria (antes de "passar
// como veio").
const MENSAGENS_CONHECIDAS: [RegExp, string][] = [
  [/usu[aá]rio sem n[uú]mero de whatsapp concedido/i, FRASE_NUMERO_NAO_LIBERADO],
  [/nenhum n[uú]mero de whatsapp concedido/i, FRASE_NUMERO_NAO_LIBERADO],
];

// Mensagens em inglês do Auth/Storage/rede com tradução.
const MENSAGENS_EM_INGLES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/invalid login credentials/i, "E-mail ou senha inválidos."],
  [/email not confirmed/i, "E-mail ainda não confirmado."],
  [/new password should be different/i, "A nova senha precisa ser diferente da atual."],
  [/password should be at least (\d+) characters/i, (m) => `A senha precisa ter ao menos ${m[1]} caracteres.`],
  [/current password required|reauthentication/i, "Informe a senha atual."],
  [
    /for security purposes, you can only request this after (\d+) seconds/i,
    (m) => `Por segurança, aguarde ${m[1]} segundos para pedir de novo.`,
  ],
  [/email rate limit exceeded|rate limit/i, FRASE_MUITAS_TENTATIVAS],
  [/email link is invalid or has expired|otp.*expired|token has expired/i, FRASE_LINK_VENCIDO],
  [/unable to validate email address|invalid email/i, "E-mail inválido."],
  [/user (is )?banned/i, "Seu acesso está bloqueado. Fale com o administrador da clínica."],
  [/user not found/i, "Usuário não encontrado."],
  [/jwt expired|invalid jwt|session.*(not found|missing|expired)|refresh token/i, FRASE_SESSAO_EXPIRADA],
  [/payload too large|exceeded the maximum allowed size|entity too large/i, "Arquivo grande demais."],
  [/mime type .* is not supported|invalid mime/i, "Tipo de arquivo não aceito."],
  [/the resource already exists/i, "Já existe um arquivo com esse nome."],
  [/row-level security|permission denied/i, FRASE_SEM_PERMISSAO],
  [/duplicate key/i, FRASE_DUPLICADO],
  [/failed to fetch|failed to send a request|networkerror|network request failed|load failed|fetch failed/i, FRASE_SEM_CONEXAO],
  [/statement timeout|canceling statement/i, "A operação demorou demais. Tente de novo."],
];

const CODIGOS_AUTH: Record<string, string> = {
  invalid_credentials: "E-mail ou senha inválidos.",
  email_not_confirmed: "E-mail ainda não confirmado.",
  same_password: "A nova senha precisa ser diferente da atual.",
  weak_password: "A senha é fraca: use uma senha mais longa, misturando letras, números e símbolos.",
  reauthentication_needed: "Informe a senha atual.",
  over_email_send_rate_limit: FRASE_MUITAS_TENTATIVAS,
  over_request_rate_limit: FRASE_MUITAS_TENTATIVAS,
  over_sms_send_rate_limit: FRASE_MUITAS_TENTATIVAS,
  otp_expired: FRASE_LINK_VENCIDO,
  email_address_invalid: "E-mail inválido.",
  user_banned: "Seu acesso está bloqueado. Fale com o administrador da clínica.",
  user_not_found: "Usuário não encontrado.",
  session_not_found: FRASE_SESSAO_EXPIRADA,
  session_expired: FRASE_SESSAO_EXPIRADA,
  refresh_token_not_found: FRASE_SESSAO_EXPIRADA,
  bad_jwt: FRASE_SESSAO_EXPIRADA,
  no_authorization: FRASE_SESSAO_EXPIRADA,
};

const CODIGOS_BANCO: Record<string, string> = {
  "42501": FRASE_SEM_PERMISSAO,
  "23505": FRASE_DUPLICADO,
  "23502": "Preencha os campos obrigatórios.",
  "23514": "Algum valor está fora do permitido.",
  "22P02": "Algum valor está em formato inválido.",
  "22001": "Algum texto passou do tamanho permitido.",
  "57014": "A operação demorou demais. Tente de novo.",
  "40001": "Outra alteração aconteceu ao mesmo tempo. Tente de novo.",
  "40P01": "Outra alteração aconteceu ao mesmo tempo. Tente de novo.",
  "55P03": "Este registro está sendo alterado por outra pessoa agora. Tente de novo em instantes.",
  PGRST116: "Registro não encontrado (pode ter sido excluído ou você não tem acesso).",
  PGRST301: FRASE_SESSAO_EXPIRADA,
  PGRST302: FRASE_SESSAO_EXPIRADA,
  PGRST303: FRASE_SESSAO_EXPIRADA,
};

// Palavras que só aparecem em frase escrita para o usuário (as nossas RAISE
// são em PT-BR; as do Postgres/PostgREST/Auth, em inglês).
const PORTUGUES =
  /[ãõçáéíóúâêôà]|\b(nao|voce|para|este|esta|essa|esse|deste|desta|neste|nesta|pelo|pela|peça|ainda|sem|foi|numero|clinica|usuario|perfil|etapa|funil|nenhum|nenhuma|arquivo|informe|tente|cliente|conta|senha|dados|registro|mensagem|paciente|tarefa|apenas|somente|quando|porque|depois|antes)\b/i;

/** A frase veio escrita para o usuário (PT-BR)? */
export function ehMensagemDoProduto(mensagem: string | null | undefined): boolean {
  const m = (mensagem ?? "").trim();
  return m.length > 0 && PORTUGUES.test(m);
}

export function mensagemDeErro(erro: unknown, padrao: string = PADRAO): string {
  if (erro === null || erro === undefined) return padrao;
  const e = ler(erro);

  for (const [re, frase] of MENSAGENS_CONHECIDAS) {
    if (re.test(e.message)) return frase;
  }
  // RAISE das nossas funções/gatilhos (P0001, 42501, 22023, 23505…): o motivo
  // já está escrito para o usuário.
  if (ehMensagemDoProduto(e.message)) return e.message;

  if (e.code && CODIGOS_AUTH[e.code]) return CODIGOS_AUTH[e.code];

  if (e.code === "23503") {
    return /still referenced|update or delete/i.test(e.message)
      ? "Não dá para apagar: há outros registros ligados a este."
      : "O item relacionado não existe mais. Recarregue a página.";
  }
  if (e.code && CODIGOS_BANCO[e.code]) return CODIGOS_BANCO[e.code];

  for (const [re, frase] of MENSAGENS_EM_INGLES) {
    const m = e.message.match(re);
    if (m) return typeof frase === "function" ? frase(m) : frase;
  }

  switch (e.status) {
    case 401:
      return FRASE_SESSAO_EXPIRADA;
    case 403:
      return FRASE_SEM_PERMISSAO;
    case 404:
      return "Registro não encontrado (pode ter sido excluído ou você não tem acesso).";
    case 409:
      return "Conflito: o registro já existe ou foi alterado por outra pessoa. Recarregue e tente de novo.";
    case 413:
      return "Arquivo grande demais.";
    case 423:
      return "Registro bloqueado para alteração no momento. Tente de novo em instantes.";
    case 429:
      return FRASE_MUITAS_TENTATIVAS;
  }
  if (e.status >= 500) return "O servidor não respondeu. Tente de novo em instantes.";
  if (e.name === "TypeError" && /fetch/i.test(e.message)) return FRASE_SEM_CONEXAO;

  return padrao;
}

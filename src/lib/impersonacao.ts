/**
 * Marca de "acesso de suporte" (impersonação) desta aba.
 *
 * Fica no sessionStorage (só esta aba, some ao fechá-la) com a chave
 * 'crm:impersonado_por'. Guarda apenas quem está sendo visto e qual admin
 * gerou o acesso — nunca token nem código. Toda leitura/escrita tem try/catch:
 * em janela privada ou com armazenamento bloqueado a marca simplesmente não
 * existe e a tela funciona sem a faixa.
 */

export const CHAVE_IMPERSONACAO = "crm:impersonado_por";
/** Disparado no window quando a marca muda (a faixa escuta para se atualizar). */
export const EVENTO_IMPERSONACAO = "crm:impersonacao-mudou";

export type UsuarioImpersonado = {
  /** id do usuário do cliente (confere com a sessão ativa). */
  id?: string | null;
  nome: string;
  email: string;
  papel?: string | null;
};

export type Impersonacao = {
  adminUserId: string;
  usuario: UsuarioImpersonado;
  /** ISO da hora em que o acesso começou. */
  desde: string;
};

function avisarMudanca() {
  try {
    window.dispatchEvent(new Event(EVENTO_IMPERSONACAO));
  } catch {
    // sem window (teste/SSR): nada a avisar
  }
}

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function marcarImpersonacao(dados: { adminUserId: string; usuario: UsuarioImpersonado }): void {
  const valor: Impersonacao = {
    adminUserId: dados.adminUserId,
    usuario: {
      id: dados.usuario.id ?? null,
      nome: dados.usuario.nome ?? "",
      email: dados.usuario.email ?? "",
      papel: dados.usuario.papel ?? null,
    },
    desde: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(CHAVE_IMPERSONACAO, JSON.stringify(valor));
  } catch {
    // armazenamento indisponível: a faixa não aparece, o acesso segue
  }
  avisarMudanca();
}

export function lerImpersonacao(): Impersonacao | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_IMPERSONACAO);
    if (!bruto) return null;
    const o = JSON.parse(bruto) as Partial<Impersonacao> | null;
    if (!o || typeof o !== "object" || !texto(o.adminUserId) || !o.usuario || typeof o.usuario !== "object") {
      return null;
    }
    const u = o.usuario as Partial<UsuarioImpersonado>;
    if (!texto(u.email) && !texto(u.nome)) return null;
    return {
      adminUserId: texto(o.adminUserId),
      usuario: {
        id: texto(u.id) || null,
        nome: texto(u.nome),
        email: texto(u.email),
        papel: texto(u.papel) || null,
      },
      desde: texto(o.desde),
    };
  } catch {
    return null;
  }
}

export function limparImpersonacao(): void {
  try {
    sessionStorage.removeItem(CHAVE_IMPERSONACAO);
  } catch {
    // nada a limpar
  }
  avisarMudanca();
}

/**
 * Apaga do localStorage os caches do usuário anterior (chaves 'crm:'), como o
 * signOut do AuthContext faz, mas preserva a marca/tema do cliente
 * ('crm:brand_…'), que não é dado de usuário. Usado antes de trocar a sessão
 * do navegador pela do usuário do cliente.
 */
export function limparCachesDoUsuarioAnterior(): void {
  try {
    const remover: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("crm:") && !k.startsWith("crm:brand_")) remover.push(k);
    }
    remover.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage indisponível: nada a limpar
  }
}

/** Tela inicial do usuário do cliente pelo papel (mesma regra do TenantLogin). */
export function destinoPorPapel(papel: string | null | undefined): string {
  switch (papel) {
    case "posvenda":
      return "/crm";
    case "recepcao":
      return "/crm/recepcao";
    case "closer":
      return "/crm/closer";
    case "sdr":
      return "/crm/sdr";
    default:
      return "/dashboard";
  }
}

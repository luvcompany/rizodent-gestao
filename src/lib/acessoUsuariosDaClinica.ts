/**
 * Quem chega a CRM › Equipe › Usuários (P25 — a clínica cria e administra as
 * próprias contas): o menu (CrmLayout) e o guarda de rota (ProtectedRoute).
 *
 * Arquivo à parte e sem dependências de propósito: o guarda roda no app
 * inteiro e não deve carregar a lógica da tela (src/lib/usuariosDaClinica.ts).
 * Aqui é só navegação — quem decide de verdade é o servidor
 * (clinica_usuarios_autoriza / clinica_usuarios_listar, migration
 * 20260929002360), e a página confere de novo se o crc é o(a) gestor(a).
 */

export const ROTA_USUARIOS_DA_CLINICA = "/crm/equipe/usuarios";

// Gerente (dono) e o(a) gestor(a) da equipe, que tem papel gerente ou crc.
// superadmin entra (acesso de suporte).
const PAPEIS_QUE_ENTRAM = new Set(["gerente", "crc", "superadmin"]);

export const ehRotaDeUsuariosDaClinica = (path: string): boolean =>
  path === ROTA_USUARIOS_DA_CLINICA || path.startsWith(`${ROTA_USUARIOS_DA_CLINICA}/`);

/**
 * O guarda manda para a home do papel? Regra AFIRMATIVA (`role &&`): papel
 * ainda nulo — a busca do perfil não voltou — não expulsa ninguém. SDR,
 * recepção e closer já saem antes pelas listas de rotas deles; aqui saem a
 * pós-venda (que navega por todo /crm) e o crc legado.
 */
export function barradoEmUsuariosDaClinica(path: string, role: string | null): boolean {
  return !!role && ehRotaDeUsuariosDaClinica(path) && !PAPEIS_QUE_ENTRAM.has(role);
}

export type ItemDoGrupoEquipe = "sdrs" | "relatorio-sdr" | "ponto" | "pesquisa" | "usuarios";

/**
 * Itens do grupo Equipe no menu dos papéis gerais. As telas das SDRs
 * (cadastro, relatório do rodízio, ponto e pesquisa) só para quem o servidor
 * confirma como gestor(a) (is_gestor_equipe) — papel não basta: o usuário do
 * Meta App Review é crc. "Usuários" é do(a) gestor(a) e do(a) gerente. Lista
 * vazia = o grupo não aparece.
 */
export function itensDoGrupoEquipe(role: string | null, isGestorEquipe: boolean): ItemDoGrupoEquipe[] {
  const itens: ItemDoGrupoEquipe[] = isGestorEquipe ? ["sdrs", "relatorio-sdr", "ponto", "pesquisa"] : [];
  if (isGestorEquipe || role === "gerente") itens.push("usuarios");
  return itens;
}

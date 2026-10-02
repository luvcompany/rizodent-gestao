/**
 * Rótulos PT-BR dos eventos de public.access_logs — FONTE ÚNICA.
 *
 * Havia dois mapas (src/lib/accessLog.ts para CRM › Logs de acesso e
 * src/lib/admin/formatos.ts para Admin › Cliente › Logs e Sistema › Logs), e
 * cada onda acrescentava evento num só deles: sessoes_encerradas e
 * api4com_ramal_usuario apareciam crus no CRM; senha_alterada,
 * senha_redefinida, senha_troca_falha, api4com_ramal_usuario e os do
 * Instagram, no admin (P26). Os dois agora leem daqui. Módulo puro (sem
 * supabase), para as telas e os testes importarem sem efeito colateral.
 *
 * Quem grava (conferido em 30/09/2026 no código e nas funções do banco da
 * réplica, depois das ondas 1 e 2):
 *   - navegador (src/lib/accessLog.ts): login, logout, login_blocked;
 *   - edge functions: tenant-login, admin-manage-user, admin-create-tenant,
 *     admin-impersonate, impersonate-redeem, bootstrap-superadmin,
 *     trocar-senha, api4com-connect, instagram-conta,
 *     instagram-login-callback, whatsapp-oauth-callback;
 *   - funções do banco: equipe_*, rodizio_definir_*, ponto_motivo*,
 *     pesquisa_config_salvar, set_tenant_business_hours, ad_account_map_salvar,
 *     gestao_* / admin_definir_gestor_equipe / tenant_semear_padroes
 *     (gestor_equipe_definido), admin_encerrar_sessoes, cron_chamar_funcao.
 * Evento novo gravado em qualquer um deles entra AQUI (o teste
 * src/lib/eventosDeAcesso.test.ts lista todos).
 */
export const ROTULOS_EVENTO_ACESSO: Record<string, string> = {
  // entrada (tenant-login, navegador, AdminLogin)
  login: "Entrou",
  logout: "Saiu",
  login_failed: "Falha ao entrar",
  login_blocked: "Entrada bloqueada",
  reauth_failed: "Senha de confirmação do suporte incorreta",
  // conta (admin-manage-user; os user_* do suporte, os sdr_* da clínica)
  user_create: "Usuário criado",
  user_block: "Usuário bloqueado",
  user_unblock: "Usuário desbloqueado",
  user_blocked: "Usuário bloqueado", // nome antigo
  user_unblocked: "Usuário desbloqueado", // nome antigo
  user_reset_password: "Senha redefinida pelo suporte",
  user_set_role: "Papel alterado",
  user_set_email: "E-mail alterado pelo suporte",
  user_delete: "Usuário excluído pelo suporte",
  user_delete_email_reuse: "Conta antiga excluída para reaproveitar o e-mail",
  sessoes_encerradas: "Sessões encerradas",
  // equipe (gestão da clínica: admin-manage-user no modo gestor e equipe_*)
  sdr_create: "Usuário criado pela clínica",
  sdr_reset_password: "Senha redefinida pela clínica",
  sdr_set_email: "E-mail alterado pela clínica",
  sdr_set_nome: "Nome alterado pela clínica",
  sdr_delete: "Usuário excluído pela clínica",
  sdr_block: "Usuário bloqueado pela clínica",
  sdr_unblock: "Usuário desbloqueado pela clínica",
  sdr_sessoes_encerradas: "Sessões encerradas pela clínica",
  sdr_redistribuir_leads: "Leads redistribuídos",
  sdr_rodizio_on: "Entrou no rodízio",
  sdr_rodizio_off: "Saiu do rodízio",
  sdr_horario: "Horário de trabalho alterado",
  gestor_equipe_definido: "Gestor(a) da equipe definido(a)",
  // contas pela clínica (P25, admin-manage-user: gerente ou gestor(a) sobre
  // quem não é só SDR; os sdr_* acima quando o alvo é SDR)
  equipe_user_create: "Usuário criado pela clínica",
  equipe_user_block: "Usuário bloqueado pela clínica",
  equipe_user_unblock: "Usuário desbloqueado pela clínica",
  equipe_user_block_desfeito: "Bloqueio desfeito (a clínica ficaria sem gerente)",
  equipe_user_reset_password: "Senha redefinida pela clínica",
  equipe_user_set_email: "E-mail alterado pela clínica",
  equipe_user_set_nome: "Nome alterado pela clínica",
  equipe_user_set_role: "Papel alterado pela clínica",
  equipe_user_delete: "Usuário excluído pela clínica",
  user_rename: "Nome alterado pelo suporte",
  // senha (trocar-senha)
  senha_alterada: "Senha alterada",
  senha_redefinida: "Senha redefinida pelo link de recuperação",
  senha_troca_falha: "Troca de senha: senha atual errada",
  // configurações da clínica (funções do banco)
  horario_comercial: "Horário comercial salvo",
  rodizio_modo: "Modo do rodízio alterado",
  rodizio_funis: "Funis do rodízio alterados",
  rodizio_tempo_realocacao: "Tempo de realocação do rodízio alterado",
  rodizio_tolerancia_corte: "Tolerância do corte do rodízio alterada",
  rodizio_carencia_abertura: "Carência na abertura do rodízio alterada",
  rodizio_carencia_entrega: "Carência de entrega ao gestor alterada",
  rodizio_fechar_agendado: "Fechamento após o agendamento alterado",
  ponto_motivo_criar: "Motivo de pausa criado",
  ponto_motivo_editar: "Motivo de pausa editado",
  ponto_motivo_ativar: "Motivo de pausa ativado ou desativado",
  ponto_motivo_excluir: "Motivo de pausa excluído",
  ponto_motivos_reordenar: "Motivos de pausa reordenados",
  pesquisa_config_salvar: "Pesquisa de satisfação salva",
  ad_account_map_salvar: "Cidade da conta de anúncio salva",
  ad_account_map_excluir: "Cidade da conta de anúncio removida",
  // acesso de suporte e plataforma
  impersonate: "Acesso de suporte gerado",
  impersonate_redeem: "Acesso de suporte usado",
  impersonate_redeem_falha: "Acesso de suporte recusado",
  bootstrap_superadmin: "Primeiro administrador da plataforma criado",
  bootstrap_superadmin_tentativa: "Tentativa de criar o primeiro administrador",
  bootstrap_superadmin_falhou: "Falha ao criar o primeiro administrador",
  // integrações
  whatsapp_embedded_signup: "WhatsApp conectado",
  instagram_login_conectado: "Instagram conectado",
  instagram_manual_conectado: "Instagram conectado (manual)",
  instagram_login_falhou: "Falha ao conectar o Instagram",
  instagram_manual_falhou: "Falha ao conectar o Instagram (manual)",
  instagram_conta_retomada: "Conta do Instagram transferida de outro cliente",
  instagram_desconectado: "Instagram desconectado",
  api4com_ramal_usuario: "Ramal da telefonia do usuário alterado",
  connect: "Conexão", // nome antigo
  // cliente (nomes antigos, ainda em linhas gravadas)
  tenant_delete: "Cliente excluído",
  tenant_soft_delete: "Cliente enviado para a lixeira",
  tenant_restore: "Cliente restaurado",
  tenant_hard_delete: "Cliente apagado definitivamente",
  // sistema
  cron_sem_configuracao: "Rotina agendada sem configuração",
};

/** Rótulo em PT-BR; evento desconhecido vira texto legível (sem sublinhado). */
export function rotuloEventoAcesso(evento: string | null | undefined): string {
  if (!evento) return "—";
  return ROTULOS_EVENTO_ACESSO[evento] ?? evento.replace(/_/g, " ");
}

-- ============================================================================
-- Badge de conversas "não lidas": janela de 60 dias por last_inbound_at
-- ============================================================================
-- Problema: get_crm_unread_leads_count() (badge da sidebar) e
-- get_crm_unread_leads_count_by_channel() (abas WhatsApp/Instagram em
-- Conversas) acumulavam leads não respondidos indefinidamente, sem janela
-- temporal — divergindo de crm_unread_leads_count(), que já usa 60 dias,
-- e da janela de 60 dias adotada pelo resto do CRM.
--
-- Correção: espelha as definições originais (lidas via pg_get_functiondef em
-- 2026-07-08) mudando APENAS a adição do filtro
--   last_inbound_at >= now() - interval '60 days'.
-- As funções continuam SQL STABLE, security invoker (RLS aplica o escopo de
-- tenant do usuário autenticado).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
  FROM public.crm_leads l
  WHERE l.is_blocked = false
    AND l.last_inbound_at IS NOT NULL
    AND l.last_inbound_at >= now() - interval '60 days'
    AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at);
$function$;

COMMENT ON FUNCTION public.get_crm_unread_leads_count() IS
  'Contador do badge "Conversas" (sidebar do CRM): leads não bloqueados aguardando resposta (última mensagem recebida mais recente que a última enviada), considerando apenas last_inbound_at nos últimos 60 dias — mesma janela do restante do CRM.';

CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count_by_channel(_channel text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
  FROM public.crm_leads l
  WHERE l.is_blocked = false
    AND l.last_inbound_at IS NOT NULL
    AND l.last_inbound_at >= now() - interval '60 days'
    AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at)
    AND (
      (_channel = 'instagram' AND l.instagram_user_id IS NOT NULL)
      OR (_channel = 'whatsapp' AND l.instagram_user_id IS NULL)
      OR (_channel IS NULL OR _channel = 'all')
    );
$function$;

COMMENT ON FUNCTION public.get_crm_unread_leads_count_by_channel(text) IS
  'Contador de não lidas por canal (abas WhatsApp/Instagram na tela Conversas), considerando apenas last_inbound_at nos últimos 60 dias — mesma janela do badge da sidebar.';

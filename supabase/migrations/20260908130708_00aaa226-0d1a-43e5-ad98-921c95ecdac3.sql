-- Varredura de leads presos em "Agendado"/"Reagendado" sem agendamento vivo.
-- Pedido do dono (08/09/2026): "leads presos, faça isso" — em cima da
-- recomendação da auditoria: lead parado nessas etapas há mais de 3 dias sem
-- agendamento pendente/confirmado volta para a etapa que o último desfecho
-- indica (falta → Não compareceu; fechou → Contratado; veio e não fechou →
-- Não contratado; sem agendamento nenhum, cancelado ou só remarcação →
-- Relacionamento). Nunca mexe em lead com agendamento vivo. Roda toda noite
-- às 03:00 da Bahia (06:00 UTC) e deixa mensagem de sistema no chat.
--
-- Esta migration só CRIA a função e o cron. A primeira execução real é feita
-- à parte, depois de um dry-run conferido.

CREATE OR REPLACE FUNCTION public.normaliza_nome_etapa(p_nome text)
RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT lower(btrim(translate(coalesce(p_nome, ''),
    'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')));
$function$;

CREATE OR REPLACE FUNCTION public.varre_agendado_sem_agendamento(p_dry_run boolean DEFAULT true)
RETURNS TABLE(lead_id uuid, lead_nome text, pipeline_id uuid, de_etapa text, para_etapa text, ultimo_desfecho text, entrou_em timestamptz, motivo text, movido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r record;
  v_alvo_nome text;
  v_alvo_id uuid;
  v_alvo_label text;
  v_tem_automacao boolean;
BEGIN
  FOR r IN
    SELECT l.id, l.name, l.tenant_id, l.pipeline_id, l.stage_id, s.name AS etapa,
      (SELECT a.status FROM public.crm_appointments a
        WHERE a.lead_id = l.id
        ORDER BY a.scheduled_date DESC, a.scheduled_time DESC NULLS LAST LIMIT 1) AS ultimo_status,
      COALESCE(
        (SELECT h.entered_at FROM public.crm_lead_stage_history h
          WHERE h.lead_id = l.id AND h.stage_id = l.stage_id AND h.exited_at IS NULL
          ORDER BY h.entered_at DESC LIMIT 1),
        l.updated_at) AS entrou_em
    FROM public.crm_leads l
    JOIN public.crm_stages s ON s.id = l.stage_id
    WHERE public.normaliza_nome_etapa(s.name) IN ('agendado', 'reagendado')
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_appointments a
        WHERE a.lead_id = l.id
          AND a.status IN ('pending', 'confirmed')
          AND a.scheduled_date >= ((now() AT TIME ZONE 'America/Bahia')::date - 2))
  LOOP
    -- Só quem está parado há mais de 3 dias.
    CONTINUE WHEN r.entrou_em > now() - interval '3 days';

    v_alvo_nome := CASE r.ultimo_status
      WHEN 'no_show' THEN 'nao compareceu'
      WHEN 'contracted' THEN 'contratado'
      WHEN 'not_contracted' THEN 'nao contratado'
      ELSE 'relacionamento'
    END;

    SELECT s2.id, s2.name INTO v_alvo_id, v_alvo_label
    FROM public.crm_stages s2
    WHERE s2.pipeline_id = r.pipeline_id
      AND public.normaliza_nome_etapa(s2.name) = v_alvo_nome
    ORDER BY s2.position
    LIMIT 1;

    lead_id := r.id; lead_nome := r.name; pipeline_id := r.pipeline_id;
    de_etapa := r.etapa; ultimo_desfecho := r.ultimo_status; entrou_em := r.entrou_em;

    IF v_alvo_id IS NULL THEN
      para_etapa := NULL; movido := false;
      motivo := 'etapa destino "' || v_alvo_nome || '" não existe neste funil';
      RETURN NEXT; CONTINUE;
    END IF;

    -- Etapa destino com automação de entrada dispararia mensagem para o lead
    -- no meio da noite: nesse caso a varredura não move e avisa.
    SELECT EXISTS (
      SELECT 1 FROM public.crm_automations a
      WHERE a.stage_id = v_alvo_id AND a.is_active
        AND a.trigger_type IN ('on_enter', 'on_create_or_enter', 'time_window')
    ) INTO v_tem_automacao;
    IF v_tem_automacao THEN
      para_etapa := v_alvo_label; movido := false;
      motivo := 'etapa destino tem automação de entrada ativa — não movido';
      RETURN NEXT; CONTINUE;
    END IF;

    para_etapa := v_alvo_label;
    motivo := 'sem agendamento ativo há mais de 3 dias';
    movido := NOT p_dry_run;

    IF NOT p_dry_run THEN
      UPDATE public.crm_leads SET stage_id = v_alvo_id, updated_at = now() WHERE id = r.id;
      INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
      VALUES (r.id, r.tenant_id, 'outbound', 'system',
        '📋 Etapa alterada: ' || r.etapa || ' → ' || v_alvo_label || ' (varredura: sem agendamento ativo há mais de 3 dias)',
        'system');
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.varre_agendado_sem_agendamento(boolean) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'varredura-agendado-sem-agendamento';
  IF v_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_id);
  END IF;
  PERFORM cron.schedule(
    'varredura-agendado-sem-agendamento',
    '0 6 * * *',
    $cmd$SELECT public.varre_agendado_sem_agendamento(false);$cmd$
  );
END
$do$;
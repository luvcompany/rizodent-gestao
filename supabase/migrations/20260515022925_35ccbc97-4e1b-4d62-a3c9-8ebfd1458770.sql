-- Item #3: Isolate crm_lead_instagram_identities by lead's tenant
ALTER TABLE public.crm_lead_instagram_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ig_identities_all_authenticated ON public.crm_lead_instagram_identities;

CREATE POLICY ig_identities_tenant_select ON public.crm_lead_instagram_identities
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_instagram_identities.lead_id AND l.tenant_id = current_tenant_id())
);

CREATE POLICY ig_identities_tenant_insert ON public.crm_lead_instagram_identities
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_instagram_identities.lead_id AND l.tenant_id = current_tenant_id())
);

CREATE POLICY ig_identities_tenant_update ON public.crm_lead_instagram_identities
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_instagram_identities.lead_id AND l.tenant_id = current_tenant_id())
)
WITH CHECK (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_instagram_identities.lead_id AND l.tenant_id = current_tenant_id())
);

CREATE POLICY ig_identities_tenant_delete ON public.crm_lead_instagram_identities
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_instagram_identities.lead_id AND l.tenant_id = current_tenant_id())
);

-- bot_stage_triggers: add tenant restriction via parent bot
CREATE POLICY bot_stage_triggers_tenant_isolation ON public.bot_stage_triggers
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR EXISTS (SELECT 1 FROM public.bots b WHERE b.id = bot_stage_triggers.bot_id AND b.tenant_id = current_tenant_id())
)
WITH CHECK (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR EXISTS (SELECT 1 FROM public.bots b WHERE b.id = bot_stage_triggers.bot_id AND b.tenant_id = current_tenant_id())
);

-- Item #14: Don't cancel terminal-status follow-ups when entering same stage logic
-- The existing function only cancels statuses that are not yet terminal, so it's already correct.
-- However, to be safe against future statuses, we explicitly exclude terminal ones.
CREATE OR REPLACE FUNCTION public.enqueue_followup_on_stage_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config record;
  v_first_delay integer := 10;
  v_delay_text text;
begin
  if new.stage_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  -- Only cancel non-terminal queued items from previous stage
  if tg_op = 'UPDATE' and old.stage_id is not null and old.stage_id is distinct from new.stage_id then
    update public.crm_followup_queue
       set status = 'cancelled',
           updated_at = now()
     where lead_id = new.id
       and stage_id = old.stage_id
       and status in ('waiting_disparo1', 'waiting_disparo2', 'waiting', 'paused');
  end if;

  select *
    into v_config
    from public.crm_followup_configs
   where stage_id = new.stage_id
     and is_active = true
   order by updated_at desc
   limit 1;

  if v_config.id is null then
    return new;
  end if;

  if exists (
    select 1
      from public.crm_followup_queue
     where lead_id = new.id
       and stage_id = new.stage_id
       and config_id = v_config.id
       and status in ('waiting_disparo1', 'waiting_disparo2', 'waiting', 'paused')
  ) then
    return new;
  end if;

  if jsonb_typeof(v_config.disparos) = 'array' and jsonb_array_length(v_config.disparos) > 0 then
    v_delay_text := v_config.disparos->0->>'delay_minutes';
    if v_delay_text ~ '^\d+$' then
      v_first_delay := greatest(v_delay_text::integer, 1);
    end if;
  else
    v_first_delay := greatest(coalesce(v_config.disparo1_delay_minutes, 10), 1);
  end if;

  insert into public.crm_followup_queue (
    lead_id, stage_id, config_id, status, current_disparo_index, attempt_count,
    disparo1_scheduled_at, next_scheduled_at, last_lead_message_at
  ) values (
    new.id, new.stage_id, v_config.id, 'waiting_disparo1', 0, 0,
    now() + make_interval(mins => v_first_delay),
    now() + make_interval(mins => v_first_delay),
    new.last_inbound_at
  );

  return new;
end;
$function$;

-- Item #15: Batch lead score recalc to avoid single-transaction over all leads
CREATE OR REPLACE FUNCTION public.recalculate_all_lead_scores(p_batch_size int DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT id FROM crm_leads
     WHERE last_message_at >= now() - interval '90 days'
        OR last_inbound_at >= now() - interval '90 days'
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT p_batch_size
  LOOP
    PERFORM recalculate_lead_score(r.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
create or replace function public.enqueue_followup_on_stage_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  if tg_op = 'UPDATE' and old.stage_id is not null then
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
    lead_id,
    stage_id,
    config_id,
    status,
    current_disparo_index,
    attempt_count,
    disparo1_scheduled_at,
    next_scheduled_at,
    last_lead_message_at
  ) values (
    new.id,
    new.stage_id,
    v_config.id,
    'waiting_disparo1',
    0,
    0,
    now() + make_interval(mins => v_first_delay),
    now() + make_interval(mins => v_first_delay),
    new.last_inbound_at
  );

  return new;
end;
$$;

drop trigger if exists trg_enqueue_followup_on_stage_entry on public.crm_leads;
create trigger trg_enqueue_followup_on_stage_entry
after insert or update of stage_id on public.crm_leads
for each row
execute function public.enqueue_followup_on_stage_entry();
-- Horário real das ligações da Api4Com (pedido do dono, 09/10/2026).
--
-- A Api4Com manda o horário LOCAL (Bahia) com sufixo "Z": "2026-10-09T13:25:15.000Z"
-- é 13:25 em Salvador. O api4com-poll-calls gravava o texto como veio, então
-- started_at/ended_at ficavam 3 h antes do real nas 2.876 ligações de jul–out/26
-- (o cron roda a cada 3 min e 1.716 das 1.752 ligações de set–out entraram entre
-- 3h00 e 3h15 depois do "fim"). A mensagem da ligação no chat
-- (api4com_call_to_message) herdava o mesmo horário.
--
-- O poll e o webhook passam a converter (_shared/horarioApi4com.ts); aqui as
-- linhas antigas são corrigidas a partir do raw_payload. Só muda a linha que
-- ainda está igual ao texto cru, então rodar de novo não desloca nada. A SDR de
-- cada ligação (0027) já tinha sido calculada com o horário real.

-- 1) Mensagens de ligação no chat (antes das ligações, enquanto started_at é o antigo).
UPDATE public.messages m
   SET created_at = regexp_replace(c.raw_payload->>'started_at', 'Z$', '-03:00')::timestamptz
  FROM public.api4com_calls c
 WHERE m.whatsapp_message_id = 'api4com:' || COALESCE(c.call_id, c.id::text)
   AND m.tenant_id = c.tenant_id
   AND c.raw_payload->>'started_at' ~ 'Z$'
   AND c.started_at = (c.raw_payload->>'started_at')::timestamptz
   AND m.created_at = c.started_at;

-- 2) Ligações.
UPDATE public.api4com_calls c
   SET started_at = regexp_replace(c.raw_payload->>'started_at', 'Z$', '-03:00')::timestamptz,
       ended_at = CASE
         WHEN c.raw_payload->>'ended_at' ~ 'Z$'
          AND c.ended_at = (c.raw_payload->>'ended_at')::timestamptz
           THEN regexp_replace(c.raw_payload->>'ended_at', 'Z$', '-03:00')::timestamptz
         ELSE c.ended_at
       END,
       answered_at = CASE
         WHEN c.raw_payload->>'answered_at' ~ 'Z$'
          AND c.answered_at = (c.raw_payload->>'answered_at')::timestamptz
           THEN regexp_replace(c.raw_payload->>'answered_at', 'Z$', '-03:00')::timestamptz
         ELSE c.answered_at
       END
 WHERE c.raw_payload->>'started_at' ~ 'Z$'
   AND c.started_at = (c.raw_payload->>'started_at')::timestamptz;

COMMENT ON COLUMN public.api4com_calls.started_at IS
  'Instante real do início (a Api4Com manda horário local com "Z"; convertido no poll/webhook e corrigido nas antigas pela migration 0032).';


WITH updated AS (
  SELECT
    jsonb_set(
      b.flow_json,
      '{nodes}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN n->>'id' = 'wait_reply-1776526027957'
              THEN jsonb_set(
                jsonb_set(n, '{data,validateAs}', '"full_name"'::jsonb, true),
                '{data,invalidReplyMessage}',
                to_jsonb('Só pra confirmar, me diga seu nome completo (nome e sobrenome), por favor 🙂'::text),
                true
              )
            WHEN n->>'id' = 'text-confirm'
              THEN jsonb_set(
                n,
                '{data,text}',
                to_jsonb(replace(n->'data'->>'text', 'Período: [periodo_preferido]]', 'Período: [periodo_preferido]'))
              )
            ELSE n
          END
        )
        FROM jsonb_array_elements(b.flow_json->'nodes') n
      )
    ) AS new_flow
  FROM public.bots b
  WHERE b.id = '7ba01994-cfe4-47a9-934d-c3097e4d179a'
)
UPDATE public.bots
SET flow_json = (SELECT new_flow FROM updated),
    updated_at = now()
WHERE id = '7ba01994-cfe4-47a9-934d-c3097e4d179a';

WITH latest AS (
  SELECT id, flow_json
  FROM public.bot_versions
  WHERE bot_id = '7ba01994-cfe4-47a9-934d-c3097e4d179a'
  ORDER BY version DESC NULLS LAST
  LIMIT 1
),
updated_v AS (
  SELECT
    latest.id,
    jsonb_set(
      latest.flow_json,
      '{nodes}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN n->>'id' = 'wait_reply-1776526027957'
              THEN jsonb_set(
                jsonb_set(n, '{data,validateAs}', '"full_name"'::jsonb, true),
                '{data,invalidReplyMessage}',
                to_jsonb('Só pra confirmar, me diga seu nome completo (nome e sobrenome), por favor 🙂'::text),
                true
              )
            WHEN n->>'id' = 'text-confirm'
              THEN jsonb_set(
                n,
                '{data,text}',
                to_jsonb(replace(n->'data'->>'text', 'Período: [periodo_preferido]]', 'Período: [periodo_preferido]'))
              )
            ELSE n
          END
        )
        FROM jsonb_array_elements(latest.flow_json->'nodes') n
      )
    ) AS new_flow
  FROM latest
)
UPDATE public.bot_versions v
SET flow_json = u.new_flow
FROM updated_v u
WHERE v.id = u.id;

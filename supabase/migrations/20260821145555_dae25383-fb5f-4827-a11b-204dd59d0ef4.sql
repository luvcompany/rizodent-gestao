-- ETAPA 8 (3c) — para de deixar o verify token GLOBAL gravado em dados por tenant.
-- O valor do ambiente (WHATSAPP_VERIFY_TOKEN) não é legível no SQL, então
-- rotacionamos: (a) as linhas criadas pelo embedded signup / coexistência, que
-- eram populadas com o global, e (b) qualquer token repetido entre tenants
-- distintos (assinatura de valor compartilhado). O whatsapp-webhook segue
-- aceitando o token global do ambiente, então nada quebra.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- (a) integrations criadas pelo embedded signup
UPDATE public.integrations
SET config = jsonb_set(
      COALESCE(config, '{}'::jsonb),
      '{webhook_verify_token}',
      to_jsonb(encode(gen_random_bytes(16), 'hex')),
      true
    ),
    updated_at = now()
WHERE key LIKE 'whatsapp_es_%'
  AND COALESCE(config->>'webhook_verify_token', '') <> '';

-- (b) integrations whatsapp_% cujo token aparece em MAIS DE UM tenant
WITH compartilhados AS (
  SELECT config->>'webhook_verify_token' AS tok
  FROM public.integrations
  WHERE key LIKE 'whatsapp_%'
    AND COALESCE(config->>'webhook_verify_token', '') <> ''
  GROUP BY 1
  HAVING COUNT(DISTINCT tenant_id) > 1
)
UPDATE public.integrations i
SET config = jsonb_set(
      COALESCE(i.config, '{}'::jsonb),
      '{webhook_verify_token}',
      to_jsonb(encode(gen_random_bytes(16), 'hex')),
      true
    ),
    updated_at = now()
FROM compartilhados c
WHERE i.key LIKE 'whatsapp_%'
  AND i.config->>'webhook_verify_token' = c.tok;

-- (c) whatsapp_numbers: coexistência (populada com o global) + tokens repetidos
UPDATE public.whatsapp_numbers n
SET verify_token = encode(gen_random_bytes(16), 'hex'),
    updated_at = now()
WHERE COALESCE(n.verify_token, '') <> ''
  AND (
    n.is_coexistence IS TRUE
    OR n.verify_token IN (
      SELECT verify_token
      FROM public.whatsapp_numbers
      WHERE COALESCE(verify_token, '') <> ''
      GROUP BY verify_token
      HAVING COUNT(DISTINCT tenant_id) > 1
    )
    OR n.verify_token IN (
      SELECT config->>'webhook_verify_token'
      FROM public.integrations
      WHERE key LIKE 'whatsapp_%'
        AND COALESCE(config->>'webhook_verify_token', '') <> ''
    )
  );

-- Garante token por tenant para os próximos onboardings (default já é aleatório).
UPDATE public.tenant_meta_credentials
SET whatsapp_verify_token = encode(gen_random_bytes(16), 'hex')
WHERE COALESCE(whatsapp_verify_token, '') = '';
-- ==========================================================================
-- Dedup de ligações Api4Com. A Api4Com pode reenviar o mesmo channel-hangup
-- (retry/timeout do webhook). Além da pré-checagem no api4com-webhook, este
-- índice único parcial garante, no banco, no máximo uma linha por
-- (tenant_id, call_id) quando call_id está presente. call_id NULL não deduplica
-- (nulos são distintos no Postgres), o que é aceitável (payload sem id).
-- ==========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uniq_api4com_calls_tenant_callid
  ON public.api4com_calls (tenant_id, call_id)
  WHERE call_id IS NOT NULL;

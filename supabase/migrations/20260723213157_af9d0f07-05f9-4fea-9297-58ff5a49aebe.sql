-- 1) Coluna dontus_key em pagamentos (idempotência do import)
ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS dontus_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_dontus_key_uniq
  ON public.pagamentos (dontus_key) WHERE dontus_key IS NOT NULL;

-- 2) Estado da conexão OAuth com o Dontus (client_id + access_token cache)
CREATE TABLE IF NOT EXISTS public.dontus_sync_state (
  id text PRIMARY KEY DEFAULT 'singleton',
  client_id text,
  access_token text,
  token_expires_at timestamptz,
  last_authorize_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.dontus_sync_state TO service_role;
ALTER TABLE public.dontus_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no direct access to dontus_sync_state"
  ON public.dontus_sync_state FOR ALL USING (false) WITH CHECK (false);

-- 3) Runs de sync (auditoria)
CREATE TABLE IF NOT EXISTS public.dontus_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  date_sincronizada date NOT NULL,
  clinica_id uuid,
  id_clinica_dontus int,
  dry_run boolean NOT NULL DEFAULT false,
  itens_lidos int NOT NULL DEFAULT 0,
  importados int NOT NULL DEFAULT 0,
  adotados int NOT NULL DEFAULT 0,
  ignorados int NOT NULL DEFAULT 0,
  vinculados_telefone int NOT NULL DEFAULT 0,
  vinculados_nome int NOT NULL DEFAULT 0,
  movidos_contratado int NOT NULL DEFAULT 0,
  notificacoes int NOT NULL DEFAULT 0,
  erros int NOT NULL DEFAULT 0,
  error_message text,
  detalhes jsonb
);
CREATE INDEX IF NOT EXISTS dontus_sync_runs_started_idx ON public.dontus_sync_runs (started_at DESC);
GRANT ALL ON public.dontus_sync_runs TO service_role;
GRANT SELECT ON public.dontus_sync_runs TO authenticated;
ALTER TABLE public.dontus_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "superadmin reads dontus_sync_runs"
  ON public.dontus_sync_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

-- 4) pg_cron jobs — CRIADOS DESLIGADOS (active=false). Só rodam manualmente
--    via POST /sync-dontus até liberação.
-- Bloco propositalmente comentado; deixamos apenas o registro do que rodaria:
--
-- select cron.schedule('dontus-sync-day-current', '*/10 7-19 * * *', $$ ... $$);
-- select cron.schedule('dontus-sync-day-previous', '0 6 * * *', $$ ... $$);
--
-- Documentado para ativação futura.
-- Ponte Dontus → tenant Recepção: lembretes de consulta e aniversário saindo do
-- CRClin pela Cloud API (hoje saem do Dontus por conexão QR, que cai o tempo todo).
-- Nenhuma destas tabelas é acessada pelo app: só service_role (edge functions) e
-- leitura para superadmin, para auditoria.

-- ---------------------------------------------------------------------------
-- Configuração por unidade (substitui mapa hardcoded: unidade ↔ número ↔ template)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dontus_unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  id_dontus integer NOT NULL DEFAULT 210380,
  id_clinica integer NOT NULL,
  nome text NOT NULL,
  cidade text,
  ddd_padrao text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Bahia',
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  integration_key text,
  pipeline_id uuid REFERENCES public.crm_pipelines(id),
  stage_id uuid REFERENCES public.crm_stages(id),
  template_vespera text,
  template_2h text,
  template_aniversario text,
  vespera_hora time NOT NULL DEFAULT '18:00',
  vespera_dom boolean NOT NULL DEFAULT true,
  antecedencia_min integer NOT NULL DEFAULT 120,
  aniversario_hora time NOT NULL DEFAULT '09:00',
  janela_inicio time NOT NULL DEFAULT '08:00',
  janela_fim time NOT NULL DEFAULT '20:00',
  enviar_vespera boolean NOT NULL DEFAULT false,
  enviar_2h boolean NOT NULL DEFAULT false,
  enviar_aniversario boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dontus_unidades_uniq ON public.dontus_unidades(id_dontus, id_clinica);
CREATE INDEX IF NOT EXISTS dontus_unidades_tenant ON public.dontus_unidades(tenant_id);
COMMENT ON TABLE public.dontus_unidades IS 'Config por unidade da ponte Dontus: qual clínica do Dontus, por qual número sai, com quais templates e em que horários.';

-- ---------------------------------------------------------------------------
-- Espelho de pacientes: fonte do aniversário. O relatório do Dontus filtra por
-- período de cadastro e por intervalo de nascimento COM ano — não dá para
-- perguntar "quem faz aniversário hoje", daí o espelho local.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dontus_pacientes (
  tenant_id uuid NOT NULL,
  -- id_dontus na chave: id_clinica é sequencial POR CONTA do Dontus, então uma
  -- segunda conta repetiria os mesmos ids e um cliente sobrescreveria o outro.
  id_dontus integer NOT NULL DEFAULT 210380,
  id_clinica integer NOT NULL,
  id_paciente bigint NOT NULL,
  nome text,
  celular_raw text,
  phone text,
  phone_motivo text,
  data_nascimento date,
  cidade text,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  wa_invalido boolean NOT NULL DEFAULT false,
  opt_out boolean NOT NULL DEFAULT false,
  visto_em date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  aniv_mmdd smallint GENERATED ALWAYS AS (
    CASE WHEN data_nascimento IS NULL THEN NULL
         ELSE (EXTRACT(month FROM data_nascimento)::int * 100
             + EXTRACT(day FROM data_nascimento)::int)::smallint END
  ) STORED,
  PRIMARY KEY (id_dontus, id_clinica, id_paciente)
);
CREATE INDEX IF NOT EXISTS dontus_pacientes_aniv ON public.dontus_pacientes(tenant_id, aniv_mmdd)
  WHERE aniv_mmdd IS NOT NULL AND phone IS NOT NULL AND opt_out = false;
CREATE INDEX IF NOT EXISTS dontus_pacientes_phone ON public.dontus_pacientes(tenant_id, phone);
-- FK para crm_leads sem índice = seq scan a cada lead apagado (ON DELETE SET NULL).
-- Sem isto, excluir uma etapa do funil (centenas de leads) ficaria lento para
-- TODOS os clientes assim que o espelho tivesse volume.
CREATE INDEX IF NOT EXISTS dontus_pacientes_lead ON public.dontus_pacientes(lead_id) WHERE lead_id IS NOT NULL;
COMMENT ON TABLE public.dontus_pacientes IS 'Espelho local de pacientes do Dontus (nome, telefone canônico, nascimento) — base do disparo de aniversário.';

CREATE TABLE IF NOT EXISTS public.dontus_pacientes_coverage (
  id_dontus integer NOT NULL,
  id_clinica integer NOT NULL,
  coberto_de date,
  coberto_ate date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_dontus, id_clinica)
);
COMMENT ON TABLE public.dontus_pacientes_coverage IS 'Até onde o espelho de pacientes já varreu, por unidade (varredura em janelas).';

-- ---------------------------------------------------------------------------
-- Log + idempotência. É o que garante que ninguém receba o mesmo lembrete duas
-- vezes: o INSERT com unique é o CLAIM, feito ANTES do envio.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dontus_lembretes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  id_dontus integer NOT NULL DEFAULT 210380,
  id_clinica integer NOT NULL,
  kind text NOT NULL,
  occurrence_date date NOT NULL,
  id_agendamento bigint,
  id_paciente bigint,
  phone text,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  template_name text,
  status text NOT NULL DEFAULT 'claimed',
  skip_reason text,
  attempts smallint NOT NULL DEFAULT 0,
  agend_hash text,
  horario time,
  wamid text,
  message_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 1 lembrete por agendamento por tipo
CREATE UNIQUE INDEX IF NOT EXISTS dontus_lembretes_agend_uniq
  ON public.dontus_lembretes (id_dontus, id_clinica, kind, id_agendamento, occurrence_date)
  WHERE id_agendamento IS NOT NULL;
-- aniversário: 1 por pessoa por dia no tenant (mata duplicata entre unidades)
CREATE UNIQUE INDEX IF NOT EXISTS dontus_lembretes_aniv_uniq
  ON public.dontus_lembretes (tenant_id, phone, occurrence_date)
  WHERE kind = 'aniversario';
CREATE INDEX IF NOT EXISTS dontus_lembretes_lookup
  ON public.dontus_lembretes(tenant_id, occurrence_date, kind, status);
CREATE INDEX IF NOT EXISTS dontus_lembretes_lead ON public.dontus_lembretes(lead_id) WHERE lead_id IS NOT NULL;
COMMENT ON TABLE public.dontus_lembretes IS 'Um registro por lembrete (claim antes do envio). O unique é a garantia de não enviar duas vezes.';

CREATE TABLE IF NOT EXISTS public.dontus_lembretes_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  kind text NOT NULL,
  id_clinica integer,
  data_alvo date,
  dry_run boolean NOT NULL DEFAULT true,
  lidos int DEFAULT 0,
  elegiveis int DEFAULT 0,
  enviados int DEFAULT 0,
  ja_enviados int DEFAULT 0,
  sem_telefone int DEFAULT 0,
  tel_invalido int DEFAULT 0,
  cancelados int DEFAULT 0,
  remarcados int DEFAULT 0,
  falhas int DEFAULT 0,
  duracao_ms int,
  error_message text,
  detalhes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dontus_lembretes_runs IS 'Resumo de cada execução da ponte (por unidade e tipo): lidos, elegíveis, enviados, motivos de pulo.';

-- ---------------------------------------------------------------------------
-- RLS: nada de acesso pelo app. Só service_role (que ignora RLS) escreve;
-- superadmin lê para auditoria.
-- ---------------------------------------------------------------------------
ALTER TABLE public.dontus_unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dontus_pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dontus_pacientes_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dontus_lembretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dontus_lembretes_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dontus_unidades','dontus_pacientes','dontus_pacientes_coverage','dontus_lembretes','dontus_lembretes_runs']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_superadmin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (has_role(auth.uid(), ''superadmin''::app_role))',
      t || '_superadmin_select', t);
  END LOOP;
END $$;

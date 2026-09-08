-- Rodízio de SDRs — Fase 0, parte 2: fundações invisíveis.
--
-- NADA aqui muda comportamento para nenhum usuário. É só chão: colunas,
-- tabelas fechadas, índice, chave, livro de atribuições e higiene de dados.
--
-- Critério de aceite (medido antes e depois):
--   leads do tenant 9.360 · leads do admin 7.607 · agosto 364 agend./160 comp.
--   · Previsão Mensal e dias úteis do Dashboard IDÊNTICOS (por isso NÃO há
--   feriados aqui — cadastrar feriado muda esses números; fica para a tela).
--   · updated_at de crm_appointments não é tocado · crm_appointments_audit
--   não ganha linhas.
-- Duas mudanças visíveis, declaradas: (1) os 17 leads que apontavam para um
-- usuário apagado passam a aparecer como "sem responsável"; (2) gravar um
-- responsável inexistente passa a ser recusado (chave estrangeira).
--
-- Rollback: tabelas e colunas novas podem ser dropadas; o backfill de crédito
-- se desfaz com  UPDATE crm_appointments SET responsavel_credito_id=NULL,
-- credito_origem=NULL WHERE credito_origem='backfill_fase0'  (com os mesmos
-- dois gatilhos desligados, como abaixo).
--
-- Decisões do dono (01/09/2026) que esta base já respeita: crédito de
-- agendamento = dona do lead no instante do agendamento, carimbado pelo
-- BANCO e imutável; remarcação herda; comparecimento herda do agendamento.
--
-- Pendências conhecidas para a Fase 1 (quando o papel 'sdr' ganhar usuárias):
-- incluir 'sdr' em set_owner_role_from_user, tenant_set_user_role,
-- concede_numeros_ao_novo_usuario (senão a SDR ganharia TODOS os números),
-- _shared/roles.ts, src/lib/roles.ts, ProtectedRoute, CrmLayout; e dar à SDR
-- leitura dos agendamentos dos leads de que é dona.

SET LOCAL lock_timeout = '5s';

-- ============================================================ 1. livro
-- Toda troca de dono de lead vira linha aqui (rodízio, corte das 9h,
-- realocação por 1h sem resposta, transferência manual, saneamento). É a
-- auditoria que o dono pediu: quem recebeu o quê, quando e por quê — e ela
-- SOBREVIVE à exclusão do lead (lead_id vira nulo; nome e telefone ficam).
CREATE TABLE IF NOT EXISTS public.crm_lead_atribuicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  lead_nome text,
  lead_telefone text,
  de_user_id uuid,
  para_user_id uuid,
  fase text NOT NULL CHECK (fase IN ('reserva','aplicacao','corte_9h','realocacao_1h','manual','saneamento','sombra')),
  motivo text,
  run_id uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_lead_atribuicoes_lead_idx ON public.crm_lead_atribuicoes (lead_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS crm_lead_atribuicoes_tenant_dia_idx ON public.crm_lead_atribuicoes (tenant_id, criado_em DESC);
ALTER TABLE public.crm_lead_atribuicoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_hard_isolation_crm_lead_atribuicoes ON public.crm_lead_atribuicoes;
CREATE POLICY tenant_hard_isolation_crm_lead_atribuicoes ON public.crm_lead_atribuicoes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));
-- Leitura: gestão do tenant; a SDR lê só as linhas em que ela é origem ou destino.
DROP POLICY IF EXISTS atribuicoes_le_gestao ON public.crm_lead_atribuicoes;
CREATE POLICY atribuicoes_le_gestao ON public.crm_lead_atribuicoes
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT public.has_role(auth.uid(), 'crc'::app_role))
      OR (SELECT public.has_role(auth.uid(), 'gerente'::app_role))
      OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role))
      OR de_user_id = auth.uid() OR para_user_id = auth.uid()
    )
  );
-- Escrita: só o servidor (nenhuma policy permissiva de INSERT/UPDATE/DELETE).

-- ============================================================ 2. higiene
-- 17 leads apontavam para um usuário que não existe mais. Ficam sem dono,
-- com registro no livro.
INSERT INTO public.crm_lead_atribuicoes (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo)
SELECT l.tenant_id, l.id, l.name, l.phone, l.assigned_to, NULL, 'saneamento', 'dono apontava para usuário inexistente (fase 0)'
FROM public.crm_leads l
WHERE l.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.assigned_to);

UPDATE public.crm_leads l SET assigned_to = NULL
WHERE l.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.assigned_to);

-- Dono vira chave de verdade (apagar o usuário solta o lead, não o quebra;
-- gravar id inexistente passa a ser recusado) e ganha índice — toda regra
-- "só o que é meu" depende disto. Em produção não existia FK nenhuma.
ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS crm_leads_tenant_assigned_idx
  ON public.crm_leads (tenant_id, assigned_to) WHERE assigned_to IS NOT NULL;

-- ============================================================ 3. lead: estado do atendimento
-- conversa_fechada_em: o botão "Fechar conversa" (decisão do dono) — um lead
-- fechado não conta para a regra "1 hora sem resposta"; a próxima mensagem
-- recebida reabre (o webhook zera, em fase posterior).
-- distribuido_em: quando o rodízio entregou o lead à dona atual.
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS conversa_fechada_em timestamptz,
  ADD COLUMN IF NOT EXISTS conversa_fechada_por uuid,
  ADD COLUMN IF NOT EXISTS distribuido_em timestamptz;

-- ============================================================ 4. crédito do agendamento
-- Coluna carimbada pelo BANCO na criação com a dona do lead naquele instante
-- — nunca recalculada. Remarcação herda do agendamento de origem. O Dontus
-- (servidor) carimba desfecho sem usuário e o crédito não se mexe.
ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS responsavel_credito_id uuid,
  ADD COLUMN IF NOT EXISTS credito_origem text;

CREATE OR REPLACE FUNCTION public.carimba_credito_agendamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_dono uuid;
  v_origem text;
  v_confiavel boolean := (auth.uid() IS NULL)
    OR public.has_role(auth.uid(), 'gerente'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role);
BEGIN
  -- Valor vindo de fora só é honrado do servidor ou da gerência. Qualquer
  -- outro chamador tem o carimbo recalculado — a policy de INSERT deixa
  -- qualquer autenticado inserir, e o crédito não pode ser escolhido.
  IF NEW.responsavel_credito_id IS NOT NULL AND v_confiavel THEN
    NEW.credito_origem := COALESCE(NEW.credito_origem, 'informado_pelo_servidor');
    RETURN NEW;
  END IF;
  NEW.responsavel_credito_id := NULL;
  NEW.credito_origem := NULL;

  IF NEW.rescheduled_from_id IS NOT NULL THEN
    SELECT responsavel_credito_id INTO v_dono FROM public.crm_appointments WHERE id = NEW.rescheduled_from_id;
    IF v_dono IS NOT NULL THEN v_origem := 'herdado_remarcacao'; END IF;
  END IF;
  IF v_dono IS NULL THEN
    SELECT assigned_to INTO v_dono FROM public.crm_leads WHERE id = NEW.lead_id;
    v_origem := CASE WHEN v_dono IS NULL THEN 'sem_dona_na_criacao' ELSE 'dona_do_lead_na_criacao' END;
  END IF;
  NEW.responsavel_credito_id := v_dono;
  NEW.credito_origem := v_origem;
  RETURN NEW;
END $fn$;

-- Prefixo "trg_zz_": gatilhos BEFORE disparam em ordem alfabética; este roda
-- DEPOIS de trg_stamp_appointment_insert (que valida rescheduled_from_id).
DROP TRIGGER IF EXISTS trg_zz_carimba_credito_agendamento ON public.crm_appointments;
CREATE TRIGGER trg_zz_carimba_credito_agendamento
  BEFORE INSERT ON public.crm_appointments
  FOR EACH ROW EXECUTE FUNCTION public.carimba_credito_agendamento();

CREATE OR REPLACE FUNCTION public.protege_credito_agendamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF (NEW.responsavel_credito_id IS DISTINCT FROM OLD.responsavel_credito_id
      OR NEW.credito_origem IS DISTINCT FROM OLD.credito_origem)
     AND auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
  THEN
    RAISE EXCEPTION 'O crédito do agendamento é carimbado na criação — alterar é ação de gerente.';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_protege_credito_agendamento ON public.crm_appointments;
CREATE TRIGGER trg_zz_protege_credito_agendamento
  BEFORE UPDATE ON public.crm_appointments
  FOR EACH ROW EXECUTE FUNCTION public.protege_credito_agendamento();

-- Preenchimento do que já existe com a melhor informação disponível (a dona
-- atual do lead). Os dois gatilhos abaixo ficam desligados SÓ durante este
-- UPDATE: um reescreveria updated_at de 1.566 agendamentos com o mesmo
-- instante (o dontus-sync ordena por updated_at), o outro gravaria 1.566
-- linhas de auditoria sem autor.
ALTER TABLE public.crm_appointments DISABLE TRIGGER update_crm_appointments_updated_at;
ALTER TABLE public.crm_appointments DISABLE TRIGGER trg_audit_crm_appointments;
UPDATE public.crm_appointments a
   SET responsavel_credito_id = l.assigned_to, credito_origem = 'backfill_fase0'
  FROM public.crm_leads l
 WHERE l.id = a.lead_id AND a.responsavel_credito_id IS NULL AND l.assigned_to IS NOT NULL;
ALTER TABLE public.crm_appointments ENABLE TRIGGER update_crm_appointments_updated_at;
ALTER TABLE public.crm_appointments ENABLE TRIGGER trg_audit_crm_appointments;
CREATE INDEX IF NOT EXISTS crm_appointments_credito_idx
  ON public.crm_appointments (tenant_id, responsavel_credito_id, scheduled_date);

-- ============================================================ 5. rodízio: configuração e membros
-- Nasce DESLIGADO. 'sombra' = calcula e registra no livro sem mudar dono;
-- 'ligado' = distribui de verdade. Mudar o modo é uma linha — o interruptor.
CREATE TABLE IF NOT EXISTS public.crm_rodizio_config (
  tenant_id uuid PRIMARY KEY,
  modo text NOT NULL DEFAULT 'desligado' CHECK (modo IN ('desligado','sombra','ligado')),
  preferir_em_expediente boolean NOT NULL DEFAULT true,
  realocar_sem_resposta_min integer NOT NULL DEFAULT 60,
  hora_corte time NOT NULL DEFAULT '09:00',
  corte_ate time NOT NULL DEFAULT '12:00',
  pausa_alerta_min integer NOT NULL DEFAULT 75,
  auto_encerrar time NOT NULL DEFAULT '23:59',
  ponteiro_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_rodizio_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_hard_isolation_crm_rodizio_config ON public.crm_rodizio_config;
CREATE POLICY tenant_hard_isolation_crm_rodizio_config ON public.crm_rodizio_config
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));
DROP POLICY IF EXISTS rodizio_config_le_gestao ON public.crm_rodizio_config;
CREATE POLICY rodizio_config_le_gestao ON public.crm_rodizio_config
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.has_role(auth.uid(),'crc'::app_role)) OR (SELECT public.has_role(auth.uid(),'gerente'::app_role)) OR (SELECT public.has_role(auth.uid(),'superadmin'::app_role))));

CREATE TABLE IF NOT EXISTS public.crm_rodizio_membros (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  peso integer NOT NULL DEFAULT 1 CHECK (peso BETWEEN 1 AND 5),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE public.crm_rodizio_membros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_hard_isolation_crm_rodizio_membros ON public.crm_rodizio_membros;
CREATE POLICY tenant_hard_isolation_crm_rodizio_membros ON public.crm_rodizio_membros
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));
DROP POLICY IF EXISTS rodizio_membros_le ON public.crm_rodizio_membros;
CREATE POLICY rodizio_membros_le ON public.crm_rodizio_membros
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.has_role(auth.uid(),'crc'::app_role)) OR (SELECT public.has_role(auth.uid(),'gerente'::app_role))
              OR (SELECT public.has_role(auth.uid(),'superadmin'::app_role)) OR user_id = auth.uid()));

INSERT INTO public.crm_rodizio_config (tenant_id)
VALUES ('00000000-0000-0000-0000-000000000010')
ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================================ 6. ponto (expediente e pausas)
-- Eventos, não estado: cada clique vira uma linha imutável. O estado atual
-- é o último evento. Relatório de horas sai daqui.
CREATE TABLE IF NOT EXISTS public.crm_ponto_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('abrir','pausar','retomar','encerrar')),
  motivo text CHECK (motivo IS NULL OR motivo IN ('cafe','almoco','outro')),
  origem text NOT NULL DEFAULT 'ui' CHECK (origem IN ('ui','auto','admin')),
  criado_por uuid,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_ponto_eventos_user_idx ON public.crm_ponto_eventos (tenant_id, user_id, em DESC);
ALTER TABLE public.crm_ponto_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_hard_isolation_crm_ponto_eventos ON public.crm_ponto_eventos;
CREATE POLICY tenant_hard_isolation_crm_ponto_eventos ON public.crm_ponto_eventos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));
DROP POLICY IF EXISTS ponto_le ON public.crm_ponto_eventos;
CREATE POLICY ponto_le ON public.crm_ponto_eventos
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.has_role(auth.uid(),'crc'::app_role)) OR (SELECT public.has_role(auth.uid(),'gerente'::app_role))
              OR (SELECT public.has_role(auth.uid(),'superadmin'::app_role)) OR user_id = auth.uid()));
-- Escrita entra na Fase 2 (botões), com policy própria.

-- ============================================================ 7. pesquisa de satisfação
-- Configuração por clínica (mensagem/template e quando enviar) e respostas
-- guardadas por lead, com o crédito da SDR — para o relatório.
CREATE TABLE IF NOT EXISTS public.crm_pesquisa_config (
  tenant_id uuid PRIMARY KEY,
  ativa boolean NOT NULL DEFAULT false,
  template_id uuid,
  texto text,
  atraso_min integer NOT NULL DEFAULT 0,
  escala text NOT NULL DEFAULT '1-5',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_pesquisa_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_hard_isolation_crm_pesquisa_config ON public.crm_pesquisa_config;
CREATE POLICY tenant_hard_isolation_crm_pesquisa_config ON public.crm_pesquisa_config
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));
DROP POLICY IF EXISTS pesquisa_config_le_gestao ON public.crm_pesquisa_config;
CREATE POLICY pesquisa_config_le_gestao ON public.crm_pesquisa_config
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.has_role(auth.uid(),'crc'::app_role)) OR (SELECT public.has_role(auth.uid(),'gerente'::app_role)) OR (SELECT public.has_role(auth.uid(),'superadmin'::app_role))));

CREATE TABLE IF NOT EXISTS public.crm_pesquisa_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  lead_nome text,
  lead_telefone text,
  responsavel_credito_id uuid,
  enviada_em timestamptz NOT NULL DEFAULT now(),
  respondida_em timestamptz,
  nota integer CHECK (nota IS NULL OR nota BETWEEN 0 AND 10),
  comentario text,
  canal text NOT NULL DEFAULT 'whatsapp'
);
CREATE INDEX IF NOT EXISTS crm_pesquisa_respostas_tenant_idx ON public.crm_pesquisa_respostas (tenant_id, enviada_em DESC);
ALTER TABLE public.crm_pesquisa_respostas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_hard_isolation_crm_pesquisa_respostas ON public.crm_pesquisa_respostas;
CREATE POLICY tenant_hard_isolation_crm_pesquisa_respostas ON public.crm_pesquisa_respostas
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));
DROP POLICY IF EXISTS pesquisa_respostas_le ON public.crm_pesquisa_respostas;
CREATE POLICY pesquisa_respostas_le ON public.crm_pesquisa_respostas
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.has_role(auth.uid(),'crc'::app_role)) OR (SELECT public.has_role(auth.uid(),'gerente'::app_role))
              OR (SELECT public.has_role(auth.uid(),'superadmin'::app_role)) OR responsavel_credito_id = auth.uid()));

-- Feriados: NÃO entram aqui de propósito (mudam Previsão Mensal, dias úteis
-- e vencimento de tarefas do bot no instante em que são gravados). O dono
-- cadastra pela tela de feriados, que é a fonte que ele controla.
-- Correções da auditoria de ponta a ponta (07–08/09/2026, leads de teste do
-- dono). Cada bloco cita o defeito que fecha. Nada aqui afrouxa isolamento:
-- as RESTRICTIVE de número (closer/recepção) e de tenant continuam por cima.

-- ============================================================ 1. pós-venda lia conversa de funil negado
-- A função que abre a conversa não conferia o funil: com a URL direta, a
-- pós-venda abria qualquer lead do tenant (56 mensagens do Vitor) apesar do
-- override negado no Funil Principal.
CREATE OR REPLACE FUNCTION public.get_lead_for_conversation(_lead_id uuid)
 RETURNS SETOF public.crm_leads
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT l.*
  FROM public.crm_leads l
  WHERE l.id = _lead_id
    AND l.tenant_id = public.current_tenant_id()
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND public.can_access_pipeline(l.pipeline_id)
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'posvenda'::app_role)
    );
$function$;

-- E as mensagens em si: a pós-venda passa a ter a mesma cerca de escopo que
-- closer e recepção têm por número — aqui, por funil alcançável.
DROP POLICY IF EXISTS posvenda_escopo_funil_messages ON public.messages;
CREATE POLICY posvenda_escopo_funil_messages ON public.messages
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'posvenda'::app_role))
    OR lead_id IS NULL
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = messages.lead_id AND public.can_access_pipeline(l.pipeline_id))
  )
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'posvenda'::app_role))
    OR lead_id IS NULL
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = messages.lead_id AND public.can_access_pipeline(l.pipeline_id))
  );

-- ============================================================ 2. calendário do closer mostrava "Lead"
-- A função de nomes excluía closer/recepção (devolvia lista vazia) e a tela
-- tratava lista vazia como sucesso. Agora cada papel recebe os nomes dos
-- leads que alcança — e nada além.
CREATE OR REPLACE FUNCTION public.get_leads_for_calendar(_lead_ids uuid[])
 RETURNS TABLE(id uuid, name text, cidade text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT l.id, l.name, l.cidade
  FROM public.crm_leads l
  WHERE l.id = ANY(_lead_ids)
    AND l.tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR ((public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'posvenda'::app_role))
          AND public.can_access_pipeline(l.pipeline_id)
          AND public.can_access_whatsapp_number(l.whatsapp_number_id))
      OR (public.has_role(auth.uid(), 'closer'::app_role) AND public.closer_pode_ver_lead(l.id))
      OR (public.has_role(auth.uid(), 'recepcao'::app_role) AND public.recepcao_pode_ver_lead(l.id))
    );
$function$;

-- ============================================================ 3. agendamentos e tarefas seguem o lead
-- A visibilidade era só por owner_role igual: a pós-venda não via nenhum dos
-- 135 agendamentos dos leads do funil dela, e agendamento criado por
-- gerência/automação em lead de closer/recepção sumia do calendário deles.
-- Passa a valer também "quem alcança o lead alcança o agendamento/tarefa" —
-- as RESTRICTIVE de número continuam limitando closer/recepção ao próprio mundo.
DROP POLICY IF EXISTS "Appointments visible by role" ON public.crm_appointments;
CREATE POLICY "Appointments visible by role" ON public.crm_appointments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR ((public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role))
        AND EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_appointments.lead_id AND public.can_access_pipeline(l.pipeline_id)))
    OR public.has_role(auth.uid(), owner_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_appointments.lead_id
        AND public.can_access_pipeline(l.pipeline_id)
        AND public.can_access_whatsapp_number(l.whatsapp_number_id)
        AND public.can_access_instagram_account(l.ig_account_uuid)
    )
  );

DROP POLICY IF EXISTS "Tasks visible by role" ON public.crm_tasks;
CREATE POLICY "Tasks visible by role" ON public.crm_tasks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR ((public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role))
        AND EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_tasks.lead_id AND public.can_access_pipeline(l.pipeline_id)))
    OR public.has_role(auth.uid(), owner_role)
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_tasks.lead_id
        AND public.can_access_pipeline(l.pipeline_id)
        AND public.can_access_whatsapp_number(l.whatsapp_number_id)
        AND public.can_access_instagram_account(l.ig_account_uuid)
    )
  );

-- ============================================================ 4. fila de automações com fantasmas
-- 41 linhas apontavam para agendamentos apagados. Chave estrangeira para não
-- voltar a acontecer: apagar o agendamento solta a referência.
UPDATE public.crm_automation_queue q SET appointment_id = NULL
 WHERE q.appointment_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.id = q.appointment_id);
ALTER TABLE public.crm_automation_queue DROP CONSTRAINT IF EXISTS crm_automation_queue_appointment_id_fkey;
ALTER TABLE public.crm_automation_queue
  ADD CONSTRAINT crm_automation_queue_appointment_id_fkey
  FOREIGN KEY (appointment_id) REFERENCES public.crm_appointments(id) ON DELETE SET NULL;

-- ============================================================ 5. histórico de etapas: um escritor só
-- O front e o gatilho gravavam a mesma passagem (18.685 grupos duplicados em
-- 75.403 linhas), nunca com autor, e a entrada em "Novo Lead" não existia.
-- O gatilho vira o único escritor (o front parou de gravar no mesmo commit),
-- registra o autor e também a entrada do lead.
CREATE OR REPLACE FUNCTION public.sync_lead_stage_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_id IS NOT NULL THEN
      INSERT INTO public.crm_lead_stage_history (lead_id, stage_id, from_stage_id, entered_at, changed_by)
      VALUES (NEW.id, NEW.stage_id, NULL, now(), auth.uid());
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    UPDATE public.crm_lead_stage_history
       SET exited_at = now()
     WHERE lead_id = NEW.id AND exited_at IS NULL;
    INSERT INTO public.crm_lead_stage_history (lead_id, stage_id, from_stage_id, entered_at, changed_by)
    VALUES (NEW.id, NEW.stage_id, OLD.stage_id, now(), auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS crm_leads_stage_history_trg ON public.crm_leads;
CREATE TRIGGER crm_leads_stage_history_trg
  AFTER INSERT OR UPDATE OF stage_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_stage_history();

-- Limpeza do passado: de duas linhas iguais (mesmo lead, mesma etapa, menos
-- de 5 s entre elas) fica a primeira. Depois, cada linha fecha na entrada da
-- seguinte, para nenhum lead ter duas etapas "abertas".
WITH ordenado AS (
  SELECT id, entered_at,
         lag(entered_at) OVER (PARTITION BY lead_id, stage_id ORDER BY entered_at, id) AS anterior
  FROM public.crm_lead_stage_history
)
DELETE FROM public.crm_lead_stage_history h
 USING ordenado o
 WHERE h.id = o.id AND o.anterior IS NOT NULL AND o.entered_at - o.anterior < interval '5 seconds';

WITH seq AS (
  SELECT id, lead(entered_at) OVER (PARTITION BY lead_id ORDER BY entered_at, id) AS prox
  FROM public.crm_lead_stage_history
)
UPDATE public.crm_lead_stage_history h
   SET exited_at = s.prox
  FROM seq s
 WHERE h.id = s.id AND s.prox IS NOT NULL AND (h.exited_at IS NULL OR h.exited_at > s.prox);

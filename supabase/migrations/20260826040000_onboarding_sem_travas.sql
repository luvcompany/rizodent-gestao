-- Cliente novo tem que funcionar no dia 1, para qualquer papel.
--
-- Requisito do dono: "ao conectar um número novo no cliente novo, já deve ser
-- permitido criar os modelos, bots, INDEPENDENTE DO TIPO DE FUNÇÃO DO USUÁRIO".
--
-- A raiz do problema é que as permissões de escrita das tabelas de conteúdo
-- citavam NOME DE PAPEL (crc, gerente). Qualquer papel fora dessa lista — closer,
-- recepção, pós-venda, ou um papel novo — nascia sem conseguir criar nada, e o
-- Postgres barrava sem mensagem, o que fazia a tela dizer só "não funciona".
--
-- Aqui a regra passa a ser de RELAÇÃO: "é do mesmo cliente e alcança o recurso".
-- O isolamento por número entre closer e recepção continua valendo, porque quem
-- decide é can_access_whatsapp_number e o owner_role de cada item.

-- ---------------------------------------------------------------- modelos
-- Registra em arquivo as policies que existiam só no banco de produção e
-- estende a regra para todos os papéis, não só o closer.
DROP POLICY IF EXISTS closer_insere_proprios_templates ON public.crm_whatsapp_templates;
DROP POLICY IF EXISTS closer_edita_proprios_templates  ON public.crm_whatsapp_templates;
DROP POLICY IF EXISTS "Admins and managers can insert crm_whatsapp_templates" ON public.crm_whatsapp_templates;
DROP POLICY IF EXISTS "Admins and managers can update crm_whatsapp_templates" ON public.crm_whatsapp_templates;
DROP POLICY IF EXISTS "Admins and managers can delete crm_whatsapp_templates" ON public.crm_whatsapp_templates;

CREATE POLICY tenant_cria_templates ON public.crm_whatsapp_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.can_access_whatsapp_number(whatsapp_number_id)
  );

CREATE POLICY tenant_edita_templates ON public.crm_whatsapp_templates
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.can_access_whatsapp_number(whatsapp_number_id))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.can_access_whatsapp_number(whatsapp_number_id));

CREATE POLICY tenant_apaga_templates ON public.crm_whatsapp_templates
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.can_access_whatsapp_number(whatsapp_number_id));

-- ---------------------------------------------------------------- bots
-- Mesmo erro dos modelos, ainda vivo: o menu Bots aparecia para closer e
-- recepção, mas o banco recusava a criação.
DROP POLICY IF EXISTS "Admins managers crc can insert bots" ON public.bots;
DROP POLICY IF EXISTS "Admins managers crc can update bots" ON public.bots;
DROP POLICY IF EXISTS "Admins managers crc can delete bots" ON public.bots;
DROP POLICY IF EXISTS "Admins and managers can insert bots" ON public.bots;
DROP POLICY IF EXISTS "Admins and managers can update bots" ON public.bots;
DROP POLICY IF EXISTS "Admins and managers can delete bots" ON public.bots;

CREATE POLICY tenant_cria_bots ON public.bots
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Só mexe no que é do seu perfil (owner_role) — quem não tem papel restrito
-- continua enxergando e editando os itens gerais, como antes.
CREATE POLICY tenant_edita_bots ON public.bots
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (owner_role IS NULL OR public.has_role(auth.uid(), owner_role)
         OR public.user_has_any_role(auth.uid(), shared_roles))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_apaga_bots ON public.bots
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (owner_role IS NULL OR public.has_role(auth.uid(), owner_role)
         OR public.user_has_any_role(auth.uid(), shared_roles))
  );

-- --------------------------------------------- respostas rápidas e transmissão
DROP POLICY IF EXISTS "Admins and managers can insert crm_quick_replies" ON public.crm_quick_replies;
DROP POLICY IF EXISTS "Admins and managers can update crm_quick_replies" ON public.crm_quick_replies;
DROP POLICY IF EXISTS "Admins and managers can delete crm_quick_replies" ON public.crm_quick_replies;

CREATE POLICY tenant_cria_quick_replies ON public.crm_quick_replies
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());

-- --------------------------------------------------------- canal do funil
-- Pós-venda (e qualquer papel novo) não conseguia ligar um número a um funil.
DROP POLICY IF EXISTS "Admins and managers can insert funnel_channels" ON public.funnel_channels;
DROP POLICY IF EXISTS "Admins and managers can update funnel_channels" ON public.funnel_channels;
DROP POLICY IF EXISTS "Admins and managers can delete funnel_channels" ON public.funnel_channels;

CREATE POLICY tenant_cria_funnel_channels ON public.funnel_channels
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.can_access_pipeline(pipeline_id));

CREATE POLICY tenant_edita_funnel_channels ON public.funnel_channels
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.can_access_pipeline(pipeline_id))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.can_access_pipeline(pipeline_id));

CREATE POLICY tenant_apaga_funnel_channels ON public.funnel_channels
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.can_access_pipeline(pipeline_id));

-- -------------------------------------------- acesso ao número, sem passo manual
-- A migração que tirou crc e pós-venda da lista de privilegiados deixou um
-- aviso: "conceder o override ANTES de cadastrar o número principal, senão os
-- leads novos somem da visão deles". Esse aviso nunca virou código — e é
-- exatamente a armadilha que espera qualquer cliente novo.
--
-- MAS a concessão não pode ser cega: um número conectado POR um closer (ou por
-- uma recepcionista) é o mundo DELE, e dar esse número aos demais desfaz o
-- isolamento inteiro. Quem decide é quem conectou:
--   conectado por crc/gerente/superadmin  => número da operação, todos os
--     papéis gerais recebem (é o caso do primeiro número de um cliente novo);
--   conectado por closer/recepção         => número próprio, ninguém mais recebe.
CREATE OR REPLACE FUNCTION public.concede_numero_aos_gerais()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_dono_restrito boolean;
BEGIN
  -- Sem usuário logado (cron/servidor) não há como saber de quem é: não concede.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('closer'::app_role, 'recepcao'::app_role)
  ) INTO v_dono_restrito;

  IF v_dono_restrito THEN RETURN NEW; END IF;

  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT DISTINCT p.id, 'whatsapp_number', NEW.id::text, true, auth.uid()
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.tenant_id = NEW.tenant_id
    AND ur.role NOT IN ('closer'::app_role, 'recepcao'::app_role)
  ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_concede_numero_aos_gerais ON public.whatsapp_numbers;
CREATE TRIGGER trg_concede_numero_aos_gerais
  AFTER INSERT ON public.whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.concede_numero_aos_gerais();

-- Usuário que entra depois recebe só os números SEM dono restrito — os que já
-- pertencem a um closer/recepção continuam sendo só deles.
CREATE OR REPLACE FUNCTION public.concede_numeros_ao_novo_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.role IN ('closer'::app_role, 'recepcao'::app_role) THEN RETURN NEW; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT NEW.user_id, 'whatsapp_number', w.id::text, true, auth.uid()
  FROM public.whatsapp_numbers w
  WHERE w.tenant_id = v_tenant
    AND w.is_active
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_permission_overrides o
      JOIN public.user_roles ur ON ur.user_id = o.user_id
      WHERE o.scope = 'whatsapp_number' AND o.resource_id = w.id::text AND o.granted
        AND ur.role IN ('closer'::app_role, 'recepcao'::app_role)
    )
  ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_concede_numeros_ao_novo_usuario ON public.user_roles;
CREATE TRIGGER trg_concede_numeros_ao_novo_usuario
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.concede_numeros_ao_novo_usuario();

-- SEM backfill cego. Um backfill que desse todos os números a todos os papéis
-- gerais desfaria o isolamento de quem já tem número próprio — foi o que
-- aconteceu ao aplicar a primeira versão desta migração, e teve de ser revertido.
-- Cliente novo não precisa de backfill: os gatilhos acima cobrem o caminho.

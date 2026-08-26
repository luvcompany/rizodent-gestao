-- Modelo sincronizado da Meta somia da tela de quem é dono do número.
--
-- Sintoma relatado: "a sincronização diz que encontrou mas não atualiza —
-- tem 4 modelos no Meta e só aparece 3".
--
-- Causa: o modelo `abordagem2_closer` estava com owner_role NULL. A regra de
-- leitura do closer é RESTRICTIVE e exige owner_role = 'closer' (ou shared),
-- então um item SEM dono é invisível para ele — mesmo sendo do número dele.
-- Ele nasceu órfão na janela em que dois papéis tinham acesso ao número do
-- closer (o gatilho de concessão automática, já revertido): a função que
-- descobre o dono do número só responde quando há UM papel, e naquele momento
-- havia dois. Sincronizar de novo nunca consertava, porque o ramo de UPDATE
-- do sync atualiza texto/status e não toca em owner_role.
--
-- Três camadas de correção, da mais específica à mais geral:
--   1. carimba os órfãos que já existem;
--   2. gatilho que carimba na entrada, valha qual for o caminho que gravou;
--   3. a leitura passa a aceitar "é do número que eu acesso", para que um
--      item sem dono nunca mais desapareça em silêncio.

-- ------------------------------------------------- 1 e 2: quem é o dono
-- Só decide quando há exatamente um papel restrito com acesso ao número.
-- Papéis gerais (crc, gerente, superadmin, pós-venda) não viram dono: no mundo
-- legado o dono NULL é o correto — significa "item geral, todos veem" — e
-- carimbá-lo restringiria itens que hoje são de todos.
CREATE OR REPLACE FUNCTION public.dono_restrito_do_numero(_number_id uuid)
RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT CASE WHEN count(*) = 1 THEN min(papel) END
  FROM (
    SELECT DISTINCT ur.role AS papel
    FROM public.user_permission_overrides o
    JOIN public.user_roles ur ON ur.user_id = o.user_id
    WHERE o.scope = 'whatsapp_number'
      AND o.resource_id = _number_id::text
      AND o.granted
      AND ur.role IN ('closer'::app_role, 'recepcao'::app_role)
  ) papeis;
$fn$;

CREATE OR REPLACE FUNCTION public.carimba_dono_do_modelo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  -- Nunca sobrescreve um dono já definido, e nunca carimba o mundo legado.
  IF NEW.owner_role IS NULL AND NEW.whatsapp_number_id IS NOT NULL THEN
    NEW.owner_role := public.dono_restrito_do_numero(NEW.whatsapp_number_id);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_carimba_dono_do_modelo ON public.crm_whatsapp_templates;
CREATE TRIGGER trg_carimba_dono_do_modelo
  BEFORE INSERT OR UPDATE ON public.crm_whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.carimba_dono_do_modelo();

-- Conserta o que já está gravado (o `abordagem2_closer` e qualquer outro).
UPDATE public.crm_whatsapp_templates t
   SET owner_role = public.dono_restrito_do_numero(t.whatsapp_number_id)
 WHERE t.owner_role IS NULL
   AND t.whatsapp_number_id IS NOT NULL
   AND public.dono_restrito_do_numero(t.whatsapp_number_id) IS NOT NULL;

-- ------------------------------------------------- 3: leitura por número
-- Cinto de segurança: quem tem o número enxerga o que é daquele número, mesmo
-- que o carimbo de dono falhe por algum caminho novo. O `IS NOT NULL` é o que
-- mantém o isolamento — sem ele o mundo legado vazaria, porque
-- can_access_whatsapp_number(NULL) responde TRUE por definição.
DROP POLICY IF EXISTS closer_so_itens_do_perfil_crm_whatsapp_templates ON public.crm_whatsapp_templates;
CREATE POLICY closer_so_itens_do_perfil_crm_whatsapp_templates
  ON public.crm_whatsapp_templates AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
    OR owner_role = 'closer'::app_role
    OR ('closer'::app_role = ANY (COALESCE(shared_roles, '{}'::app_role[])))
    OR (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_so_itens_do_perfil_crm_whatsapp_templates ON public.crm_whatsapp_templates;
CREATE POLICY recepcao_so_itens_do_perfil_crm_whatsapp_templates
  ON public.crm_whatsapp_templates AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR owner_role = 'recepcao'::app_role
    OR ('recepcao'::app_role = ANY (COALESCE(shared_roles, '{}'::app_role[])))
    OR (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

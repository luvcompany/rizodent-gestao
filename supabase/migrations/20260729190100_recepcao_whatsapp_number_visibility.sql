-- O webhook passa a carimbar messages.whatsapp_number_id / crm_leads.whatsapp_number_id
-- quando o número inbound tem cadastro em whatsapp_numbers. Hoje tudo é NULL e a cláusula
-- "_number_id IS NULL" libera geral — inclusive para posvenda. Para o carimbo não tirar
-- visibilidade de posvenda no tenant Rizodent, posvenda entra na lista de papéis com
-- acesso a qualquer número (preserva o comportamento efetivo atual).
-- 'recepcao' fica FORA de propósito: cai no deny-by-default e só vê o número da própria
-- unidade via user_permission_overrides (scope 'whatsapp_number', granted=true).
-- can_access_instagram_account NÃO muda: ig_account_uuid já é carimbado em produção,
-- então incluir posvenda lá alteraria comportamento vigente.
CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'posvenda'::app_role)
    OR COALESCE(public.user_override(auth.uid(), 'whatsapp_number', _number_id::text), false);
$$;

-- As policies permissivas de crm_leads/messages se somam por OR com a tenant_isolation
-- (FOR ALL, tenant inteiro) — logo o escopo por número precisa ser RESTRICTIVE (AND).
-- As policies abaixo só mordem quem tem papel recepcao; para os demais o primeiro
-- predicado curto-circuita em true (zero mudança para crc/gerente/posvenda/superadmin).
-- Exigem carimbo NÃO-nulo: sem isso, com whatsapp_numbers vazia a recepcao veria tudo.

-- Helper p/ escopar messages pelo lead sem recursão de RLS em crm_leads.
CREATE OR REPLACE FUNCTION public.lead_whatsapp_number(_lead_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT whatsapp_number_id FROM public.crm_leads WHERE id = _lead_id;
$$;

DROP POLICY IF EXISTS recepcao_number_scope_leads ON public.crm_leads;
CREATE POLICY recepcao_number_scope_leads ON public.crm_leads
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (whatsapp_number_id IS NOT NULL
        AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_number_scope_lead_update ON public.crm_leads;
CREATE POLICY recepcao_number_scope_lead_update ON public.crm_leads
  AS RESTRICTIVE FOR UPDATE
  USING (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (whatsapp_number_id IS NOT NULL
        AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_no_lead_delete ON public.crm_leads;
CREATE POLICY recepcao_no_lead_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE
  USING (NOT has_role(auth.uid(), 'recepcao'::app_role));

-- messages: escopo pelo LEAD (não por messages.whatsapp_number_id — mensagens de
-- saída podem nascer sem carimbo e sumiriam da conversa da própria recepção).
DROP POLICY IF EXISTS recepcao_number_scope_messages ON public.messages;
CREATE POLICY recepcao_number_scope_messages ON public.messages
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (lead_id IS NOT NULL
        AND public.lead_whatsapp_number(lead_id) IS NOT NULL
        AND public.can_access_whatsapp_number(public.lead_whatsapp_number(lead_id)))
  );

-- whatsapp_numbers guarda token/app_secret/verify_token em texto puro e a policy de
-- SELECT libera a linha para papéis não-admin (posvenda e recepcao com override).
-- Privilégio por coluna esconde os segredos sem tocar RLS nem edge functions
-- (service_role ignora grants).
REVOKE SELECT ON public.whatsapp_numbers FROM anon, authenticated;
GRANT SELECT (id, tenant_id, phone_number_id, display_name, phone_e164, waba_id, app_id, is_active, is_default, created_at, updated_at)
  ON public.whatsapp_numbers TO authenticated;

-- Mensagens de SAÍDA são gravadas por várias functions (send-whatsapp-message,
-- bot-engine, automation-engine, transfer-lead) sem carimbo. Trigger herda o número
-- do lead — no-op quando o lead não tem carimbo (Rizodent hoje: tudo NULL).
CREATE OR REPLACE FUNCTION public.stamp_message_whatsapp_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.whatsapp_number_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT l.whatsapp_number_id INTO NEW.whatsapp_number_id
      FROM public.crm_leads l WHERE l.id = NEW.lead_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_stamp_whatsapp_number ON public.messages;
CREATE TRIGGER messages_stamp_whatsapp_number
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.stamp_message_whatsapp_number();

-- 1. Corrigir RLS de SELECT em crm_whatsapp_templates
DROP POLICY IF EXISTS "Templates visible by role" ON public.crm_whatsapp_templates;

CREATE POLICY "Templates visible by role"
ON public.crm_whatsapp_templates FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);

-- 2. Trigger para preencher owner_role automaticamente em novos modelos
DROP TRIGGER IF EXISTS trg_set_owner_role ON public.crm_whatsapp_templates;
CREATE TRIGGER trg_set_owner_role
BEFORE INSERT ON public.crm_whatsapp_templates
FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_from_user();

-- 3. Backfill: marcar os modelos existentes como admin
UPDATE public.crm_whatsapp_templates
   SET owner_role = 'admin'::app_role
 WHERE owner_role IS NULL;
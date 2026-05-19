
-- 1) Migrar modelos legados para CRC
UPDATE public.crm_whatsapp_templates SET owner_role = 'crc' WHERE owner_role = 'crc_legacy';

-- 2) Ajustar trigger: superadmin cria como compartilhado (NULL)
CREATE OR REPLACE FUNCTION public.set_owner_role_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.app_role;
BEGIN
  IF NEW.owner_role IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role
      WHEN 'crc'        THEN 1
      WHEN 'posvenda'   THEN 2
      WHEN 'gerente'    THEN 3
      WHEN 'superadmin' THEN 99
      WHEN 'crc_legacy' THEN 99
      ELSE 99
    END
    LIMIT 1;
    IF v_role IN ('crc','posvenda','gerente') THEN
      NEW.owner_role := v_role;
    END IF;
    -- superadmin e demais: deixa NULL (compartilhado com todos)
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Corrigir política de SELECT para respeitar owner_role estritamente
DROP POLICY IF EXISTS "Templates visible by role" ON public.crm_whatsapp_templates;
CREATE POLICY "Templates visible by role"
ON public.crm_whatsapp_templates
FOR SELECT
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);

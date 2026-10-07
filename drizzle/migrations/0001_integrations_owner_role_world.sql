ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS owner_role text;

UPDATE public.integrations SET owner_role = 'closer'
 WHERE key = 'whatsapp_1326232703900018' AND owner_role IS NULL;
UPDATE public.integrations SET owner_role = 'crc'
 WHERE key LIKE 'whatsapp_%' AND owner_role IS NULL;

CREATE OR REPLACE FUNCTION public.integration_world(_role text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _role IN ('crc','sdr','crc_legacy') THEN 'crc' ELSE _role END
$$;

CREATE OR REPLACE FUNCTION public.can_access_integration_world(_owner_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _owner_role IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = auth.uid()
          AND (r.role::text IN ('gerente','superadmin')
               OR public.integration_world(r.role::text) = public.integration_world(_owner_role))
      )
$$;
GRANT EXECUTE ON FUNCTION public.integration_world(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_integration_world(text) TO authenticated, service_role;

DROP POLICY IF EXISTS integrations_por_mundo ON public.integrations;
CREATE POLICY integrations_por_mundo ON public.integrations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (key NOT LIKE 'whatsapp\_%' OR public.can_access_integration_world(owner_role))
  WITH CHECK (key NOT LIKE 'whatsapp\_%' OR public.can_access_integration_world(owner_role));
-- Ramal do operador para o click-to-call (POST /dialer). Por enquanto um ramal
-- por clínica (a maioria tem um só). O admin configura na aba Integrações.
ALTER TABLE public.api4com_config ADD COLUMN IF NOT EXISTS ramal text;

-- Flag para o frontend só mostrar o botão de ligar quando a telefonia está pronta
-- (conectada + ramal). api4com_config não tem policy de leitura de cliente, então
-- expomos só este booleano por tenant.
CREATE OR REPLACE FUNCTION public.api4com_dial_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.api4com_config
    WHERE tenant_id = public.current_tenant_id()
      AND connected_at IS NOT NULL AND ramal IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.api4com_dial_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api4com_dial_enabled() TO authenticated;

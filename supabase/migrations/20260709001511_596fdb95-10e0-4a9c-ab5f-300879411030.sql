CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id','')::uuid;

  INSERT INTO public.profiles (id, nome, email, tenant_id, must_change_password)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'nome', ''), NEW.email),
    NEW.email,
    v_tenant,
    COALESCE((NEW.raw_user_meta_data->>'must_change_password')::boolean, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    nome = EXCLUDED.nome,
    email = EXCLUDED.email,
    tenant_id = COALESCE(EXCLUDED.tenant_id, public.profiles.tenant_id),
    must_change_password = EXCLUDED.must_change_password,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
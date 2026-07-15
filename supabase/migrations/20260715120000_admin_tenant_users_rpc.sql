-- ==========================================================================
-- RPC admin_tenant_users: lista perfis + PAPEL (de user_roles) de um tenant.
-- SECURITY DEFINER + superadmin-gated. Usada pela aba Usuários do painel admin
-- para NÃO depender do RLS do cliente ler user_roles (que estava devolvendo
-- vazio e fazendo o papel "voltar" para CRC na tela).
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.admin_tenant_users(_tenant_id uuid)
RETURNS TABLE(
  id uuid, nome text, email text, cargo text,
  is_blocked boolean, last_login_at timestamptz, must_change_password boolean, role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.nome, p.email, p.cargo, p.is_blocked, p.last_login_at, p.must_change_password,
    (SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = p.id ORDER BY ur.role LIMIT 1) AS role
  FROM public.profiles p
  WHERE p.tenant_id = _tenant_id
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tenant_users(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tenant_users(uuid) TO authenticated;

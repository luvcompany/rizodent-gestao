
-- Tabela genérica de overrides de permissões por usuário
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('pipeline','page','action')),
  resource_id text NOT NULL,
  granted boolean NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_upo_user_scope
  ON public.user_permission_overrides (user_id, scope);

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Admin/superadmin podem gerenciar; usuários autenticados podem ler os próprios overrides
DROP POLICY IF EXISTS "Admins manage overrides" ON public.user_permission_overrides;
CREATE POLICY "Admins manage overrides"
ON public.user_permission_overrides
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Users read own overrides" ON public.user_permission_overrides;
CREATE POLICY "Users read own overrides"
ON public.user_permission_overrides
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Helper: retorna NULL quando não há override (segue regra padrão da role)
CREATE OR REPLACE FUNCTION public.user_override(_user_id uuid, _scope text, _resource_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT granted FROM public.user_permission_overrides
   WHERE user_id = _user_id AND scope = _scope AND resource_id = _resource_id
   LIMIT 1;
$$;

-- user_can: combina override + role/policy padrão (usado para page/action)
CREATE OR REPLACE FUNCTION public.user_can(_user_id uuid, _scope text, _resource_id text, _default boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.user_override(_user_id, _scope, _resource_id), _default);
$$;

-- Atualiza can_access_pipeline para considerar overrides primeiro
CREATE OR REPLACE FUNCTION public.can_access_pipeline(_pipeline_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- 1. Override explícito (grant ou deny) tem prioridade absoluta
    COALESCE(
      public.user_override(auth.uid(), 'pipeline', _pipeline_id::text),
      -- 2. Senão, regra padrão: superadmin/admin/gerente sempre veem
      has_role(auth.uid(), 'superadmin'::app_role)
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'gerente'::app_role)
      OR EXISTS (
        SELECT 1
          FROM public.crm_pipelines p
         WHERE p.id = _pipeline_id
           AND (
             p.allowed_roles IS NULL
             OR EXISTS (
               SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = auth.uid()
                  AND ur.role = ANY(p.allowed_roles)
             )
           )
      )
    );
$$;

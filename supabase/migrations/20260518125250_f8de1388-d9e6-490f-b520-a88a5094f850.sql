ALTER TABLE public.user_permission_overrides
  DROP CONSTRAINT IF EXISTS user_permission_overrides_scope_check;

ALTER TABLE public.user_permission_overrides
  ADD CONSTRAINT user_permission_overrides_scope_check
  CHECK (scope IN ('pipeline','page','action','whatsapp_number','instagram_account'));
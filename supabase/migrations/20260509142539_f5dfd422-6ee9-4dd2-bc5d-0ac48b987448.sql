
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM public.tenants WHERE name ILIKE '%luv agency%' OR slug ILIKE '%luvagency%' LOOP
    PERFORM public.hard_delete_tenant(t.id);
  END LOOP;
END $$;

-- Remove the orphaned auth user for the deleted Luv Agency tenants
DELETE FROM auth.users WHERE id = 'b1524772-05d5-4a42-86b6-28db311423a2';

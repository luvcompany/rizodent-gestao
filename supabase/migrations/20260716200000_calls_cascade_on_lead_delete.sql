-- ==========================================================================
-- Apagar as ligações do lead quando o lead é apagado (antes era SET NULL, o que
-- deixava registros órfãos — sem nome/conversa — e atrapalhava o casamento por
-- telefone de novas ligações). Vale para api4com_calls e whatsapp_calls.
-- ==========================================================================

ALTER TABLE public.api4com_calls DROP CONSTRAINT IF EXISTS api4com_calls_lead_id_fkey;
ALTER TABLE public.api4com_calls ADD CONSTRAINT api4com_calls_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;

-- whatsapp_calls: descobre o nome do FK dinamicamente (pode variar) e recria.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'public.whatsapp_calls'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%crm_leads%'
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.whatsapp_calls DROP CONSTRAINT %I', cname);
    EXECUTE 'ALTER TABLE public.whatsapp_calls ADD CONSTRAINT whatsapp_calls_lead_id_fkey '
         || 'FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE';
  END IF;
END $$;

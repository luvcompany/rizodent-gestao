-- ==========================================================================
-- Registra cada ligação Api4Com (com lead casado) como mensagem tipo "call" na
-- conversa do lead — igual às ligações de WhatsApp. Cobre webhook + poll (trigger
-- no INSERT de api4com_calls), sincroniza a transcrição quando ela chega, e faz
-- backfill das ligações já importadas. Dedup por whatsapp_message_id = api4com:<id>.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.api4com_call_label(_status text, _direction text, _dur int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '📞 ' || CASE
    WHEN _status = 'answered' AND _direction = 'inbound' THEN 'Ligação recebida'
    WHEN _status = 'answered' THEN 'Ligação realizada'
    WHEN _direction = 'inbound' THEN 'Ligação perdida'
    ELSE 'Ligação não atendida'
  END || CASE WHEN COALESCE(_dur, 0) > 0
    THEN ' · ' || to_char(make_interval(secs => _dur), 'MI:SS') ELSE '' END;
$$;

-- INSERT: cria a mensagem de ligação na conversa (se houver lead).
CREATE OR REPLACE FUNCTION public.api4com_call_to_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_key text;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  v_key := 'api4com:' || COALESCE(NEW.call_id, NEW.id::text);
  IF EXISTS (SELECT 1 FROM public.messages WHERE whatsapp_message_id = v_key) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.messages (
    lead_id, tenant_id, channel, direction, type, content,
    media_url, transcription, status, whatsapp_message_id, created_at
  ) VALUES (
    NEW.lead_id, NEW.tenant_id, 'whatsapp', COALESCE(NEW.direction, 'outbound'), 'call',
    public.api4com_call_label(NEW.status, NEW.direction, NEW.duration_seconds),
    NEW.recording_url, NEW.transcription, 'sent', v_key, COALESCE(NEW.started_at, now())
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_api4com_call_to_message ON public.api4com_calls;
CREATE TRIGGER trg_api4com_call_to_message
  AFTER INSERT ON public.api4com_calls
  FOR EACH ROW EXECUTE FUNCTION public.api4com_call_to_message();

-- UPDATE da transcrição: sincroniza para a mensagem já criada.
CREATE OR REPLACE FUNCTION public.api4com_sync_transcription_to_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.transcription IS NOT NULL AND NEW.transcription IS DISTINCT FROM OLD.transcription THEN
    UPDATE public.messages SET transcription = NEW.transcription
    WHERE whatsapp_message_id = 'api4com:' || COALESCE(NEW.call_id, NEW.id::text)
      AND transcription IS DISTINCT FROM NEW.transcription;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_api4com_sync_transcription ON public.api4com_calls;
CREATE TRIGGER trg_api4com_sync_transcription
  AFTER UPDATE OF transcription ON public.api4com_calls
  FOR EACH ROW EXECUTE FUNCTION public.api4com_sync_transcription_to_message();

-- Backfill das ligações já importadas (com lead casado, sem mensagem ainda).
INSERT INTO public.messages (lead_id, tenant_id, channel, direction, type, content,
  media_url, transcription, status, whatsapp_message_id, created_at)
SELECT c.lead_id, c.tenant_id, 'whatsapp', COALESCE(c.direction, 'outbound'), 'call',
  public.api4com_call_label(c.status, c.direction, c.duration_seconds),
  c.recording_url, c.transcription, 'sent',
  'api4com:' || COALESCE(c.call_id, c.id::text), COALESCE(c.started_at, c.created_at, now())
FROM public.api4com_calls c
WHERE c.lead_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.whatsapp_message_id = 'api4com:' || COALESCE(c.call_id, c.id::text)
  );


-- Backfill Instagram leads + messages from existing instagram_messages
DO $$
DECLARE
  v_pipeline_id uuid := 'c2d3e4f5-0001-4000-8000-000000000002';
  v_first_stage uuid;
  r RECORD;
  v_lead_id uuid;
  v_display_name text;
  v_account_name text;
BEGIN
  SELECT id INTO v_first_stage FROM crm_stages 
    WHERE pipeline_id = v_pipeline_id ORDER BY position ASC LIMIT 1;

  IF v_first_stage IS NULL THEN
    RAISE NOTICE 'No Instagram stages — aborting backfill';
    RETURN;
  END IF;

  -- For each unique sender, ensure a lead exists
  FOR r IN
    SELECT DISTINCT ON (sender_id)
      sender_id,
      sender_name,
      sender_username,
      sender_profile_pic,
      instagram_account_id
    FROM instagram_messages
    WHERE sender_id IS NOT NULL
    ORDER BY sender_id, created_at DESC
  LOOP
    -- Check if lead already exists
    SELECT id INTO v_lead_id FROM crm_leads WHERE instagram_user_id = r.sender_id LIMIT 1;

    IF v_lead_id IS NULL THEN
      v_display_name := COALESCE(r.sender_name, r.sender_username, 'IG ' || substring(r.sender_id, 1, 8));
      SELECT name INTO v_account_name FROM instagram_accounts WHERE instagram_account_id = r.instagram_account_id LIMIT 1;

      INSERT INTO crm_leads (name, pipeline_id, stage_id, source, instagram_user_id, instagram_username, instagram_profile_pic_url)
      VALUES (
        v_display_name,
        v_pipeline_id,
        v_first_stage,
        CASE WHEN v_account_name IS NOT NULL THEN 'Instagram (' || v_account_name || ')' ELSE 'Instagram' END,
        r.sender_id,
        r.sender_username,
        r.sender_profile_pic
      )
      RETURNING id INTO v_lead_id;
    END IF;

    -- Link existing instagram_messages to this lead
    UPDATE instagram_messages SET lead_id = v_lead_id 
      WHERE sender_id = r.sender_id AND lead_id IS NULL;
  END LOOP;

  -- Mirror instagram_messages into unified messages table where missing
  INSERT INTO messages (lead_id, direction, type, content, channel, instagram_sender_id, status, created_at)
  SELECT 
    im.lead_id,
    CASE WHEN im.is_outbound THEN 'outbound' ELSE 'inbound' END,
    'text',
    im.message_text,
    'instagram',
    im.sender_id,
    CASE WHEN im.is_outbound THEN 'sent' ELSE 'received' END,
    im.created_at
  FROM instagram_messages im
  WHERE im.lead_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM messages m
      WHERE m.lead_id = im.lead_id
        AND m.channel = 'instagram'
        AND m.created_at = im.created_at
        AND COALESCE(m.content,'') = COALESCE(im.message_text,'')
    );

  -- Update last_message + last_inbound_at on backfilled leads
  UPDATE crm_leads l SET
    last_message = sub.last_text,
    last_message_at = sub.last_time,
    last_inbound_at = sub.last_inbound,
    first_inbound_at = sub.first_inbound
  FROM (
    SELECT 
      lead_id,
      (ARRAY_AGG(message_text ORDER BY created_at DESC) FILTER (WHERE message_text IS NOT NULL))[1] AS last_text,
      MAX(created_at) AS last_time,
      MAX(created_at) FILTER (WHERE NOT is_outbound) AS last_inbound,
      MIN(created_at) FILTER (WHERE NOT is_outbound) AS first_inbound
    FROM instagram_messages
    WHERE lead_id IS NOT NULL
    GROUP BY lead_id
  ) sub
  WHERE l.id = sub.lead_id;
END $$;

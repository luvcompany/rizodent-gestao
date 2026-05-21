
CREATE TEMP TABLE _canon ON COMMIT DROP AS
SELECT DISTINCT ON (l.tenant_id, l.phone) l.id AS keep_id, l.tenant_id, l.phone
FROM public.crm_leads l
JOIN (
  SELECT tenant_id, phone FROM public.crm_leads
  WHERE phone IS NOT NULL AND phone <> ''
  GROUP BY tenant_id, phone HAVING COUNT(*) > 1
) d ON d.tenant_id = l.tenant_id AND d.phone = l.phone
ORDER BY l.tenant_id, l.phone, l.created_at ASC, l.id ASC;

CREATE TEMP TABLE _victims ON COMMIT DROP AS
SELECT l.id AS old_id, c.keep_id FROM public.crm_leads l
JOIN _canon c ON c.tenant_id = l.tenant_id AND c.phone = l.phone
WHERE l.id <> c.keep_id;

CREATE TEMP TABLE _group_leads ON COMMIT DROP AS
SELECT keep_id AS lead_id, keep_id FROM _canon
UNION ALL SELECT old_id AS lead_id, keep_id FROM _victims;

UPDATE public.messages m SET lead_id = v.keep_id FROM _victims v WHERE m.lead_id = v.old_id;
UPDATE public.crm_appointments t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_tasks t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_lead_stage_history t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_followup_queue t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_automation_queue t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_automation_executions t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_broadcast_recipients t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_conversation_notes t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_notifications t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.crm_lead_instagram_identities t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.bot_executions t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.ai_conversation_analysis t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;
UPDATE public.instagram_messages t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;

WITH ranked AS (
  SELECT cv.ctid, ROW_NUMBER() OVER (PARTITION BY g.keep_id, cv.field_id ORDER BY (cv.lead_id = g.keep_id) DESC, cv.ctid) rn
  FROM public.crm_lead_custom_values cv JOIN _group_leads g ON g.lead_id = cv.lead_id
)
DELETE FROM public.crm_lead_custom_values cv USING ranked r WHERE cv.ctid = r.ctid AND r.rn > 1;
UPDATE public.crm_lead_custom_values t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;

WITH ranked AS (
  SELECT la.ctid, ROW_NUMBER() OVER (PARTITION BY g.keep_id, la.label_id ORDER BY (la.lead_id = g.keep_id) DESC, la.ctid) rn
  FROM public.crm_lead_label_assignments la JOIN _group_leads g ON g.lead_id = la.lead_id
)
DELETE FROM public.crm_lead_label_assignments la USING ranked r WHERE la.ctid = r.ctid AND r.rn > 1;
UPDATE public.crm_lead_label_assignments t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;

WITH ranked AS (
  SELECT lp.ctid, ROW_NUMBER() OVER (PARTITION BY g.keep_id, lp.paciente_id ORDER BY (lp.lead_id = g.keep_id) DESC, lp.is_primary DESC, lp.ctid) rn
  FROM public.crm_lead_pacientes lp JOIN _group_leads g ON g.lead_id = lp.lead_id
)
DELETE FROM public.crm_lead_pacientes lp USING ranked r WHERE lp.ctid = r.ctid AND r.rn > 1;
UPDATE public.crm_lead_pacientes t SET lead_id = v.keep_id FROM _victims v WHERE t.lead_id = v.old_id;

WITH best_name AS (
  SELECT DISTINCT ON (c.keep_id) c.keep_id, l.name
  FROM _canon c JOIN public.crm_leads l ON l.tenant_id = c.tenant_id AND l.phone = c.phone
  WHERE l.name IS NOT NULL AND l.name <> '' AND l.name <> '.....' AND l.name NOT LIKE 'Lead WhatsApp %'
  ORDER BY c.keep_id, l.updated_at DESC NULLS LAST, l.created_at DESC
),
ts AS (
  SELECT c.keep_id, MIN(l.first_inbound_at) AS first_in,
         MAX(l.last_inbound_at) AS last_in, MAX(l.last_message_at) AS last_msg_at
  FROM _canon c JOIN public.crm_leads l ON l.tenant_id = c.tenant_id AND l.phone = c.phone
  GROUP BY c.keep_id
)
UPDATE public.crm_leads l
SET name = COALESCE(bn.name, l.name),
    first_inbound_at = COALESCE(ts.first_in, l.first_inbound_at),
    last_inbound_at = COALESCE(ts.last_in, l.last_inbound_at),
    last_message_at = COALESCE(ts.last_msg_at, l.last_message_at),
    updated_at = now()
FROM ts LEFT JOIN best_name bn ON bn.keep_id = ts.keep_id
WHERE l.id = ts.keep_id;

UPDATE public.crm_leads l
SET cidade = COALESCE(NULLIF(l.cidade, ''), src.cidade),
    servico_interesse = COALESCE(NULLIF(l.servico_interesse, ''), src.servico_interesse),
    titulo_anuncio = COALESCE(NULLIF(l.titulo_anuncio, ''), src.titulo_anuncio),
    nome_anuncio = COALESCE(NULLIF(l.nome_anuncio, ''), src.nome_anuncio),
    descricao_anuncio = COALESCE(NULLIF(l.descricao_anuncio, ''), src.descricao_anuncio),
    imagem_origem = COALESCE(NULLIF(l.imagem_origem, ''), src.imagem_origem),
    link_anuncio = COALESCE(NULLIF(l.link_anuncio, ''), src.link_anuncio),
    ad_id = COALESCE(NULLIF(l.ad_id, ''), src.ad_id),
    ad_account_id = COALESCE(NULLIF(l.ad_account_id, ''), src.ad_account_id),
    ad_account_name = COALESCE(NULLIF(l.ad_account_name, ''), src.ad_account_name)
FROM (
  SELECT DISTINCT ON (c.keep_id) c.keep_id,
    s.cidade, s.servico_interesse, s.titulo_anuncio, s.nome_anuncio, s.descricao_anuncio,
    s.imagem_origem, s.link_anuncio, s.ad_id, s.ad_account_id, s.ad_account_name
  FROM _canon c JOIN public.crm_leads s ON s.tenant_id = c.tenant_id AND s.phone = c.phone AND s.id <> c.keep_id
  ORDER BY c.keep_id, s.updated_at DESC NULLS LAST, s.created_at DESC
) src
WHERE l.id = src.keep_id;

INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
SELECT c.keep_id, l.tenant_id, 'outbound', 'system',
       '🧹 ' || (SELECT COUNT(*) FROM _victims v WHERE v.keep_id = c.keep_id) ||
       ' lead(s) duplicado(s) com este telefone foram mesclados automaticamente nesta conversa.',
       'system'
FROM _canon c JOIN public.crm_leads l ON l.id = c.keep_id
WHERE EXISTS (SELECT 1 FROM _victims v WHERE v.keep_id = c.keep_id);

DELETE FROM public.crm_leads l USING _victims v WHERE l.id = v.old_id;

CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_tenant_phone_uniq
  ON public.crm_leads (tenant_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

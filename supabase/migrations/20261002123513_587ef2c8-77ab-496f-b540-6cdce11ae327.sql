UPDATE public.crm_leads
SET source = 'instagram_ad', updated_at = now()
WHERE tenant_id = '00000000-0000-0000-0000-000000000010'::uuid
  AND source = 'facebook_ad'
  AND lower(coalesce(link_anuncio, '')) LIKE '%instagram.com%';

UPDATE public.messages AS m
SET ad_headline = coalesce(m.ad_headline, l.titulo_anuncio),
    ad_body = coalesce(m.ad_body, l.descricao_anuncio),
    ad_image_url = coalesce(m.ad_image_url, l.imagem_origem),
    ad_source_url = coalesce(m.ad_source_url, l.link_anuncio),
    ad_account_id = coalesce(m.ad_account_id, l.ad_account_id),
    ad_account_name = coalesce(m.ad_account_name, l.ad_account_name)
FROM public.crm_leads AS l
WHERE m.lead_id = l.id
  AND l.tenant_id = '00000000-0000-0000-0000-000000000010'::uuid
  AND m.direction = 'inbound'
  AND coalesce(m.ad_source_id, l.ad_id) IS NOT NULL
  AND (
    m.ad_headline IS NULL OR m.ad_body IS NULL OR m.ad_image_url IS NULL
    OR m.ad_source_url IS NULL OR m.ad_account_id IS NULL OR m.ad_account_name IS NULL
  );

UPDATE public.messages AS m
SET ad_headline = coalesce(m.ad_headline, a.ad_headline),
    ad_body = coalesce(m.ad_body, a.ad_body),
    ad_image_url = coalesce(m.ad_image_url, a.thumbnail_url),
    ad_account_id = coalesce(m.ad_account_id, a.ad_account_id),
    ad_account_name = coalesce(m.ad_account_name, a.ad_account_name)
FROM public.crm_leads AS l, public.ad_id_mapping AS a
WHERE m.lead_id = l.id
  AND a.tenant_id = l.tenant_id
  AND a.ad_id = coalesce(m.ad_source_id, l.ad_id)
  AND l.tenant_id = '00000000-0000-0000-0000-000000000010'::uuid
  AND m.direction = 'inbound'
  AND (
    m.ad_headline IS NULL OR m.ad_body IS NULL OR m.ad_image_url IS NULL
    OR m.ad_account_id IS NULL OR m.ad_account_name IS NULL
  );
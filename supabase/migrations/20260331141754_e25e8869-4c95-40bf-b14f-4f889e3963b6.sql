
UPDATE messages m
SET
  ad_headline   = l.titulo_anuncio,
  ad_body       = l.descricao_anuncio,
  ad_image_url  = l.imagem_origem,
  ad_source_url = l.link_anuncio,
  ad_source_id  = l.ad_id
FROM crm_leads l
WHERE m.lead_id = l.id
  AND m.direction = 'inbound'
  AND (l.ad_id IS NOT NULL OR l.imagem_origem IS NOT NULL)
  AND m.created_at = (
    SELECT MIN(created_at) FROM messages
    WHERE lead_id = l.id AND direction = 'inbound'
  );

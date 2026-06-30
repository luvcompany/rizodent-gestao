UPDATE crm_leads
SET stage_id='b1b2c3d4-0001-4000-8000-000000000001', updated_at=now()
WHERE id='4a42269a-2be3-427f-b28f-f219f3e84b1e'
  AND stage_id='f9ed5256-ec4e-4aea-b0fb-e3004e4f9211'
  AND lower(coalesce(cidade,''))='teste_vitor';
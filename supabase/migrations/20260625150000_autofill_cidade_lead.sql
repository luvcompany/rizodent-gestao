-- ============================================================
-- Preenchimento automático da CIDADE do lead (corrige ~47% sem cidade)
-- Infere a cidade a partir de TODAS as pistas disponíveis: source
-- (handles do Instagram Lite, ex. @rizodentitabuna), conta de anúncio
-- e textos do anúncio. Vale para qualquer caminho de criação (WhatsApp,
-- Instagram, manual) e corrige os leads já existentes (backfill).
-- ============================================================

-- 1) Função de inferência (mesma regra do webhook/Dashboard)
CREATE OR REPLACE FUNCTION public.rizodent_infer_cidade(p_texto text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_texto ~* 'vca|vitória|vitoria|conquista' THEN 'Vitória da Conquista'
    WHEN p_texto ~* 'guanambi'                       THEN 'Guanambi'
    WHEN p_texto ~* 'itabuna'                        THEN 'Itabuna'
    WHEN p_texto ~* 'ipia[uú]'                       THEN 'Ipiaú'
    ELSE NULL
  END;
$$;

-- 2) Trigger: preenche cidade SÓ quando estiver vazia (preserva edição manual)
CREATE OR REPLACE FUNCTION public.rizodent_fill_cidade_trg()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inferida text;
BEGIN
  IF NEW.cidade IS NULL OR btrim(NEW.cidade) = '' THEN
    inferida := public.rizodent_infer_cidade(
      lower(
        coalesce(NEW.source,'')          || ' ' ||
        coalesce(NEW.ad_account_name,'')  || ' ' ||
        coalesce(NEW.nome_anuncio,'')     || ' ' ||
        coalesce(NEW.titulo_anuncio,'')   || ' ' ||
        coalesce(NEW.descricao_anuncio,'')
      )
    );
    IF inferida IS NOT NULL THEN
      NEW.cidade := inferida;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rizodent_fill_cidade ON public.crm_leads;
CREATE TRIGGER rizodent_fill_cidade
  BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.rizodent_fill_cidade_trg();

-- 3) Backfill: preenche os leads já existentes que estão sem cidade
UPDATE public.crm_leads
SET cidade = public.rizodent_infer_cidade(
  lower(
    coalesce(source,'')          || ' ' ||
    coalesce(ad_account_name,'')  || ' ' ||
    coalesce(nome_anuncio,'')     || ' ' ||
    coalesce(titulo_anuncio,'')   || ' ' ||
    coalesce(descricao_anuncio,'')
  )
)
WHERE (cidade IS NULL OR btrim(cidade) = '')
  AND public.rizodent_infer_cidade(
    lower(
      coalesce(source,'')          || ' ' ||
      coalesce(ad_account_name,'')  || ' ' ||
      coalesce(nome_anuncio,'')     || ' ' ||
      coalesce(titulo_anuncio,'')   || ' ' ||
      coalesce(descricao_anuncio,'')
    )
  ) IS NOT NULL;

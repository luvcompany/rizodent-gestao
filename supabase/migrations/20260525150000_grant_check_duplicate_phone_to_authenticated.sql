-- Bug: a função check_duplicate_phone tinha EXECUTE revogado de "anon, public"
-- na migration 20260509110752, mas nunca foi grantada explicitamente para
-- "authenticated". Como "authenticated" não herda de PUBLIC no Supabase,
-- a função ficava inacessível para usuários logados.
--
-- Sintoma: o frontend ignorava o erro silenciosamente, achava que não havia
-- duplicata e tentava o INSERT direto. O INSERT estourava o UNIQUE constraint
-- crm_leads_tenant_phone_uniq, gerando "Erro 23505".
--
-- Fix: garantir GRANT EXECUTE para authenticated (a função é SECURITY DEFINER,
-- então roda com privilégios elevados, mas precisa do GRANT para ser chamada).

GRANT EXECUTE ON FUNCTION public.check_duplicate_phone(text) TO authenticated;

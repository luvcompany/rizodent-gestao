-- Relatórios › Origem (rpt_origem_conversao): a coorte de leads do período passa a
-- usar a regra única de lead novo da 0023 (public.eh_lead_novo). Antes só tirava
-- quem apenas comentou no Instagram, e contava como lead novo a conciliação do
-- Dontus (kommo), o sintético de pagamento e o recontato de quem já estava na
-- base — números diferentes das outras telas para o mesmo período.
DO $migracao$
DECLARE
  d text := pg_get_functiondef('public.rpt_origem_conversao(date, date, uuid)'::regprocedure);
  antes constant text := 'AND COALESCE(l.comment_only, false) = false';
  depois constant text := 'AND public.eh_lead_novo(l)';
BEGIN
  IF position(depois IN d) > 0 THEN
    RETURN; -- já aplicada
  END IF;
  IF position(antes IN d) = 0 THEN
    RAISE EXCEPTION 'rpt_origem_conversao mudou: filtro de comment_only não encontrado';
  END IF;
  EXECUTE replace(d, antes, depois);
END
$migracao$;

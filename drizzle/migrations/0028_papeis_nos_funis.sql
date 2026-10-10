-- Closer, recepção e pós-venda mexem nas etapas dos próprios funis (09/10/2026).
--
-- 1) crm_stages_empurrar_posicao (usada ao criar etapa no meio do funil e ao
--    reordenar): só CRC, gerente, superadmin e a SDR no funil dela passavam.
--    O closer não conseguia criar etapa no meio do "Padrão Closer", nem a
--    pós-venda no funil Pós-venda — o botão aparecia e o banco recusava.
--    Passam também: closer/recepção nos funis do papel deles
--    (funil_do_papel_do_usuario) e a pós-venda nos funis de pós-venda que ela
--    enxerga.
-- 2) pipeline_inclui_papel_do_criador: funil criado pela pós-venda nascia sem
--    o papel dela em allowed_roles e sumia da tela de quem o criou. Agora o
--    papel posvenda entra, como já acontecia com closer e recepção.

CREATE OR REPLACE FUNCTION public.crm_stages_empurrar_posicao(p_pipeline_id uuid, p_de_posicao integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_pipe_tenant uuid; v_pode boolean; n integer;
BEGIN
  IF p_pipeline_id IS NULL OR p_de_posicao IS NULL THEN
    RAISE EXCEPTION 'Informe o funil e a posição.' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para reordenar as etapas.' USING ERRCODE = '42501';
  END IF;

  -- POR QUE VIROU SECURITY DEFINER. Como INVOKER, o UPDATE e a contagem rodavam
  -- sob a RLS de quem chamou: a SDR só enxerga 12 das 15 etapas do funil (três
  -- são ocultas para ela), então a função empurrava 9, comparava 9 com 9 e
  -- respondia "ok" — deixando Contratado na mesma posição que Reagendado. Para
  -- o gestor, que vê as 15, a ordem das colunas passava a depender do desempate
  -- do ORDER BY. A etapa oculta é oculta para LEITURA, não para ESTRUTURA: o
  -- funil é dela por inteiro ou não é dela.
  -- A autorização, que a RLS fazia antes, agora é explícita aqui.
  SELECT p.tenant_id INTO v_pipe_tenant FROM public.crm_pipelines p WHERE p.id = p_pipeline_id;
  v_tenant := public.current_tenant_id();
  IF v_pipe_tenant IS NULL OR v_tenant IS NULL OR v_pipe_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Este funil é de outra clínica.' USING ERRCODE = '42501';
  END IF;

  v_pode := public.has_role(auth.uid(), 'crc'::app_role)
         OR public.has_role(auth.uid(), 'gerente'::app_role)
         OR public.has_role(auth.uid(), 'superadmin'::app_role)
         -- closer/recepção: os funis do papel deles
         OR public.funil_do_papel_do_usuario(p_pipeline_id)
         -- pós-venda: os funis de pós-venda que ela enxerga
         OR (public.has_role(auth.uid(), 'posvenda'::app_role)
             AND public.is_posvenda_pipeline(p_pipeline_id)
             AND public.can_access_pipeline(p_pipeline_id));

  IF NOT v_pode AND public.has_role(auth.uid(), 'sdr'::app_role) THEN
    v_pode := public.funil_meu(p_pipeline_id);   -- só o funil que ela criou
  END IF;

  IF NOT v_pode THEN
    RAISE EXCEPTION 'Seu perfil não reordena as etapas deste funil.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.crm_stages SET position = position + 1
   WHERE pipeline_id = p_pipeline_id AND position >= p_de_posicao;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.pipeline_inclui_papel_do_criador()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  FOR v_role IN
    SELECT role FROM public.user_roles
     WHERE user_id = auth.uid() AND role IN ('recepcao'::app_role, 'closer'::app_role, 'posvenda'::app_role)
  LOOP
    IF NEW.allowed_roles IS NULL THEN
      NEW.allowed_roles := ARRAY['gerente'::app_role, v_role];
    ELSIF NOT (v_role = ANY(NEW.allowed_roles)) THEN
      NEW.allowed_roles := NEW.allowed_roles || v_role;
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

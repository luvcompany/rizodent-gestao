-- =============================================================================
-- A SDR cria funil, etapa, gatilho e disparo — DENTRO DOS FUNIS DELA.
--
-- PEDIDO DO DONO: "O sdr também deve poder criar etapas, gatilhos, disparos e
-- funis". O verbo é CRIAR.
--
-- POR QUE NÃO NOS FUNIS DA CLÍNICA. A primeira versão liberou escrita em
-- crm_stages, crm_pipelines e crm_automations para qualquer funil que a SDR
-- abre, e a revisão adversarial achou três buracos que policy nenhuma fecha bem:
--
--   1. APAGAR ETAPA LEVA OS LEADS. crm_leads.stage_id é NOT NULL REFERENCES
--      crm_stages(id) ON DELETE CASCADE. O menu "Excluir funil" da tela apaga as
--      etapas antes do funil, e o contador de leads do diálogo de excluir etapa
--      roda sob a RLS DELA — mostra zero quando os leads são das colegas. Ou
--      seja: ela mandava excluir o Funil Principal e ia embora com os 3.582
--      leads da clínica, com mensagens e agendamentos, sem um aviso.
--   2. AUTOMAÇÃO DE ENTRADA ATINGE LEAD DE QUALQUER UMA. O gatilho
--      trg_enqueue_stage_entry_automations enfileira a automação para TODO lead
--      que entra na etapa, sem filtrar por dono. Uma automação criada por ela em
--      "Agendado" manda mensagem para o paciente da colega — o acidente das 46
--      pessoas de 09/09, pela porta automática.
--   3. ETAPA COM NOME PARECIDO SEQUESTRA O CICLO. O front casa etapa por pedaço
--      do nome e pega a primeira por position: 'Contrato fechado' passa a
--      receber o que era da etapa "Contratado", e 'Reagendado — teste' recebe
--      toda remarcação. Além de quebrar o ciclo, isso faz a SDR LER que o lead
--      contratou, que é justamente o que o dono proibiu.
--
-- O dono escolheu, com os três riscos na mão: ela faz o que quiser nos funis que
-- ela criar; nos funis da clínica não escreve nada. Esta migration implementa
-- isso com uma régua só, fácil de conferir: AUTORIA.
--
-- COMO A AUTORIA FUNCIONA. crm_pipelines e crm_stages ganham created_by, hoje
-- inexistente, preenchido no INSERT. Tudo que JÁ existe fica com created_by
-- NULL, e NULL significa "estrutura da clínica" — a SDR não alcança. Assim as 15
-- etapas do ciclo e os 13 funis atuais ficam protegidos sem eu precisar listar
-- nome nenhum, e sem depender de comparação de texto (que foi o que criou o
-- buraco 3).
--
-- Nenhuma policy anterior a hoje é tocada. As policies sdr_* criadas hoje pela
-- 20260910130000 são removidas antes (aquela migration ainda não foi aplicada em
-- produção; o DROP com IF EXISTS existe só para o caso de já ter sido).
-- =============================================================================

-- ============================================================ 1. autoria
ALTER TABLE public.crm_pipelines ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.crm_stages    ADD COLUMN IF NOT EXISTS created_by uuid;

COMMENT ON COLUMN public.crm_pipelines.created_by IS
  'Quem criou o funil. NULL = estrutura da clínica (tudo que existia antes de 10/09/2026): a SDR não escreve nele.';
COMMENT ON COLUMN public.crm_stages.created_by IS
  'Quem criou a etapa. NULL = estrutura da clínica: a SDR não escreve nela.';

-- Preenche no INSERT, sem sobrescrever valor explícito (o service_role às vezes
-- cria em nome de alguém, por exemplo ao clonar as etapas de um funil novo).
CREATE OR REPLACE FUNCTION public.carimba_created_by_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_aa_carimba_created_by ON public.crm_pipelines;
CREATE TRIGGER trg_aa_carimba_created_by BEFORE INSERT ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.carimba_created_by_trg();
DROP TRIGGER IF EXISTS trg_aa_carimba_created_by ON public.crm_stages;
CREATE TRIGGER trg_aa_carimba_created_by BEFORE INSERT ON public.crm_stages
  FOR EACH ROW EXECUTE FUNCTION public.carimba_created_by_trg();

-- ============================================================ 2. as réguas
-- Todas com recorte de CLIENTE. A primeira versão de funil_tem_lead aceitava
-- uuid de funil de qualquer tenant e respondia — pouco (um booleano), mas é o
-- padrão de função aberta que as auditorias deste projeto vêm fechando.

-- O funil é dela?
CREATE OR REPLACE FUNCTION public.funil_meu(_pipeline_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_pipelines p
     WHERE p.id = _pipeline_id
       AND p.tenant_id = public.current_tenant_id()
       AND p.created_by IS NOT NULL
       AND p.created_by = auth.uid());
$fn$;

-- A etapa está num funil dela?
CREATE OR REPLACE FUNCTION public.etapa_em_funil_meu(_stage_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_stages s
      JOIN public.crm_pipelines p ON p.id = s.pipeline_id
     WHERE s.id = _stage_id
       AND p.tenant_id = public.current_tenant_id()
       AND p.created_by IS NOT NULL
       AND p.created_by = auth.uid());
$fn$;

-- Tem lead nesta etapa? (de QUALQUER pessoa — é o que a RLS da SDR esconde, e
-- por isso o contador da tela mostrava zero e o CASCADE apagava calado.)
CREATE OR REPLACE FUNCTION public.etapa_tem_lead(_stage_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_leads l
      JOIN public.crm_pipelines p ON p.id = l.pipeline_id
     WHERE l.stage_id = _stage_id
       AND p.tenant_id = public.current_tenant_id());
$fn$;

-- Tem lead neste funil?
CREATE OR REPLACE FUNCTION public.funil_tem_lead(_pipeline_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_leads l
      JOIN public.crm_pipelines p ON p.id = l.pipeline_id
     WHERE l.pipeline_id = _pipeline_id
       AND p.tenant_id = public.current_tenant_id());
$fn$;

REVOKE ALL ON FUNCTION public.funil_meu(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.etapa_em_funil_meu(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.etapa_tem_lead(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.funil_tem_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funil_meu(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.etapa_em_funil_meu(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.etapa_tem_lead(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.funil_tem_lead(uuid) TO authenticated, service_role;

-- ============================================================ 3. o funil dela nasce visível
-- SEM ISTO A CRIAÇÃO DE FUNIL NEM FUNCIONA, e era um dos "botões que não
-- funcionam" que o dono reclamou. O front faz .insert().select().single(), então
-- o Postgres avalia a policy de SELECT sobre a linha NOVA. A única PERMISSIVE de
-- SELECT de crm_pipelines ("Users can view allowed pipelines") só passa por
-- override de pipeline (que é concedido por gatilho AFTER INSERT, tarde demais),
-- por ser crc/gerente, ou por allowed_roles conter um papel do usuário. Para uma
-- SDR pura, nenhuma das três valia e o INSERT estourava com "new row violates
-- row-level security policy". Recepção e closer resolvem isso com um gatilho
-- BEFORE INSERT que põe o papel do criador em allowed_roles; a SDR ficou sem.
--
-- allowed_roles = {sdr, crc, gerente}: ela vê o que criou, as colegas veem, e a
-- GESTÃO vê (sem crc/gerente na lista o dono ficaria sem enxergar o funil).
-- allowed_roles preenchido também mantém o funil FORA do rodízio automático —
-- rodizio_definir_funis recusa funil com allowed_roles não nulo, de propósito:
-- funil de trabalho dela não recebe distribuição sem o dono mandar.
--
-- Só age quando quem cria é sdr e NÃO acumula papel de gestão. A primeira versão
-- não checava isso e apagava em silêncio a escolha de quem tem papel duplo,
-- além de rodar depois de trg_pipeline_inclui_papel_do_criador e desfazer o
-- allowed_roles que aquele gatilho tinha acabado de montar.
CREATE OR REPLACE FUNCTION public.sdr_funil_novo_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'superadmin'::app_role)
     OR public.has_role(auth.uid(), 'gerente'::app_role)
     OR public.has_role(auth.uid(), 'crc'::app_role)
     OR public.has_role(auth.uid(), 'posvenda'::app_role)
     OR public.has_role(auth.uid(), 'recepcao'::app_role)
     OR public.has_role(auth.uid(), 'closer'::app_role) THEN
    RETURN NEW;
  END IF;
  NEW.allowed_roles := ARRAY['sdr', 'crc', 'gerente'];
  NEW.is_instagram  := false;
  NEW.is_posvenda   := false;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_sdr_funil_novo_padrao ON public.crm_pipelines;
CREATE TRIGGER trg_zz_sdr_funil_novo_padrao BEFORE INSERT ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.sdr_funil_novo_padrao_trg();

-- ============================================================ 4. as policies
-- Postgres não tem CREATE POLICY IF NOT EXISTS; o DROP antes resolve, e também
-- limpa as policies que a 20260910130000 criou com a régua antiga (larga).
DO $pol$
DECLARE v_nome text;
BEGIN
  FOREACH v_nome IN ARRAY ARRAY[
    'sdr_ins_crm_pipelines','sdr_upd_crm_pipelines','sdr_del_crm_pipelines',
    'sdr_ins_crm_stages','sdr_upd_crm_stages','sdr_del_crm_stages',
    'sdr_ins_crm_automations','sdr_upd_crm_automations','sdr_del_crm_automations'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.crm_pipelines', v_nome);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.crm_stages', v_nome);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.crm_automations', v_nome);
  END LOOP;
END $pol$;

-- Funil: cria à vontade; mexe só no que é dela; só apaga funil vazio.
CREATE POLICY sdr_ins_crm_pipelines ON public.crm_pipelines
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'sdr'::app_role)
              AND tenant_id = public.current_tenant_id());
CREATE POLICY sdr_upd_crm_pipelines ON public.crm_pipelines
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'sdr'::app_role) AND public.funil_meu(id))
  WITH CHECK (public.has_role(auth.uid(), 'sdr'::app_role) AND public.funil_meu(id));
CREATE POLICY sdr_del_crm_pipelines ON public.crm_pipelines
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'sdr'::app_role)
         AND public.funil_meu(id)
         AND NOT public.funil_tem_lead(id));

-- Etapa: só dentro de funil dela. O DELETE exige etapa SEM LEAD DE NINGUÉM,
-- porque o CASCADE não pergunta a RLS: sem esta linha, apagar etapa apaga lead.
CREATE POLICY sdr_ins_crm_stages ON public.crm_stages
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'sdr'::app_role)
              AND public.funil_meu(pipeline_id)
              AND COALESCE(visivel_para_sdr, true));
CREATE POLICY sdr_upd_crm_stages ON public.crm_stages
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'sdr'::app_role) AND public.funil_meu(pipeline_id))
  WITH CHECK (public.has_role(auth.uid(), 'sdr'::app_role)
              AND public.funil_meu(pipeline_id)
              AND COALESCE(visivel_para_sdr, true));
CREATE POLICY sdr_del_crm_stages ON public.crm_stages
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'sdr'::app_role)
         AND public.funil_meu(pipeline_id)
         AND NOT public.etapa_tem_lead(id));

-- Gatilho e disparo: só em etapa de funil dela. Com isso a automação de entrada
-- que ela criar nunca alcança lead de colega, porque nenhum lead de colega está
-- num funil dela — e é o gatilho de banco, não a tela, que enfileira.
CREATE POLICY sdr_ins_crm_automations ON public.crm_automations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'sdr'::app_role)
              AND public.etapa_em_funil_meu(stage_id));
CREATE POLICY sdr_upd_crm_automations ON public.crm_automations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'sdr'::app_role) AND public.etapa_em_funil_meu(stage_id))
  WITH CHECK (public.has_role(auth.uid(), 'sdr'::app_role) AND public.etapa_em_funil_meu(stage_id));
CREATE POLICY sdr_del_crm_automations ON public.crm_automations
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'sdr'::app_role) AND public.etapa_em_funil_meu(stage_id));

-- ============================================================ 5. reordenar etapa é tudo ou nada
-- O "+" ENTRE colunas do Kanban insere uma etapa no meio, e para isso precisa
-- empurrar a posição de todas as etapas seguintes. O front fazia isso num LAÇO,
-- um UPDATE por etapa, com return no primeiro que a RLS barrava. Para a SDR num
-- funil da clínica isso significava: algumas etapas já deslocadas, nenhuma etapa
-- nova criada, e a ordem do funil quebrada pela metade — sem aviso de que ficou
-- assim. (UPDATE barrado por RLS não devolve erro; devolve zero linhas.)
--
-- Aqui é uma instrução só. SECURITY INVOKER de propósito: a RLS do chamador é
-- que decide o que ele pode empurrar. E a conferência não replica regra nenhuma
-- de papel — compara o que o UPDATE alcançou com o que o próprio chamador
-- CONSEGUE VER. Se não bate, o RAISE desfaz tudo e ninguém fica com a ordem
-- pela metade.
CREATE OR REPLACE FUNCTION public.crm_stages_empurrar_posicao(p_pipeline_id uuid, p_de_posicao integer)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $fn$
DECLARE v_esperado integer; n integer;
BEGIN
  IF p_pipeline_id IS NULL OR p_de_posicao IS NULL THEN
    RAISE EXCEPTION 'Informe o funil e a posição.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_esperado FROM public.crm_stages
   WHERE pipeline_id = p_pipeline_id AND position >= p_de_posicao;
  UPDATE public.crm_stages SET position = position + 1
   WHERE pipeline_id = p_pipeline_id AND position >= p_de_posicao;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> v_esperado THEN
    RAISE EXCEPTION 'Seu perfil não altera todas as etapas deste funil, então a ordem não foi mexida.'
      USING ERRCODE = '42501';
  END IF;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_stages_empurrar_posicao(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_stages_empurrar_posicao(uuid, integer) TO authenticated, service_role;
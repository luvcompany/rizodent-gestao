-- Autonomia da SDR com AUTORIA nas linhas — conserto da rodada de hoje
-- (10/09/2026, depois de os revisores reprovarem as 5 partes de
--  20260910130000_sdr_desfecho_e_autonomia.sql).
--
-- O BURACO, em uma frase: aquela migration deu à SDR UPDATE e DELETE em
-- crm_stages e crm_pipelines de todo funil que ela abre — e
-- crm_leads.stage_id REFERENCES crm_stages(id) ON DELETE CASCADE. Apagar uma
-- etapa do Funil Principal levava embora, em cascata e em silêncio, os leads
-- (e com eles as mensagens e os agendamentos) de TODAS as colegas. Dois
-- caminhos, os dois a um clique na tela de Automações:
--   • o menu "Excluir funil", que apaga as etapas antes de apagar o funil;
--   • a lixeira da etapa, cuja contagem de leads roda sob a RLS DELA — mostra
--     zero justamente quando o lead é da colega.
--
-- O dono pediu CRIAR: "O sdr também deve poder criar etapas, gatilhos,
-- disparos e funis". Ele NÃO pediu apagar nem renomear a estrutura que já
-- existe, e não pediu mexer na distribuição automática. O verbo é criar.
--
-- A SOLUÇÃO é dar AUTORIA às linhas, o que não existia hoje: crm_stages e
-- crm_pipelines ganham created_by, preenchida no INSERT. As 15 etapas e os 13
-- funis que já estão no ar ficam com created_by NULL, e NULL passa a significar
-- "estrutura da clínica" — ninguém com papel sdr mexe. Fica protegido de graça
-- tudo o que existe, sem precisar de lista de nomes nem de migração de dados.
--
-- O que entra aqui (C1 a C5, na ordem):
--   C1  created_by em crm_stages e crm_pipelines + gatilho que a preenche.
--   C2  as policies da SDR: INSERT liberado; UPDATE/DELETE só na linha dela,
--       só em etapa visível para ela e nunca em etapa canônica do ciclo;
--       DELETE de etapa exige ainda etapa_tem_lead = false. E o recorte de
--       cliente que faltava em funil_tem_lead.
--   C3  o gatilho do funil novo da SDR para de apagar a escolha de quem
--       acumula papel de gestão.
--   C4  os dois DELETE em crm_entregas_gestor passam a ser recortados PELA
--       CONSULTA (a tabela tem uma linha por lead: sem recorte, excluir a
--       consulta B matava a entrega da consulta A).
--   C5  entrada manual na etapa "Compareceu" para de gerar duas mensagens de
--       sistema que se contradizem 24 h depois.
--
-- Nada de policy anterior a hoje é tocado. As únicas policies derrubadas são
-- as nove sdr_ins_/sdr_upd_/sdr_del_ que a migration 20260910130000 criou hoje
-- e que ainda não valem em produção — elas são recriadas aqui, mais estreitas.
--
-- COMO DESFAZER: as policies voltam pelo corpo de 20260910130000 (seção 5.3);
-- as funções trocadas por CREATE OR REPLACE voltam pelo corpo da migration
-- anterior de cada uma (sdr_corrigir_desfecho e sdr_excluir_agendamento:
-- 20260910130000; sdr_entregas_pendentes: 20260910012000, seção 6;
-- sdr_funil_novo_padrao_trg e funil_tem_lead: 20260910130000, seções 5.2/5.1);
-- as colunas created_by saem por ALTER TABLE ... DROP COLUMN (mas aí as
-- policies novas precisam sair ANTES, porque dependem dela).

SET LOCAL lock_timeout = '5s';

-- ============================================================ C1. autoria da linha
-- Sem coluna de autor não existe frase "esta etapa é minha": foi por isso que a
-- rodada anterior só teve como escolher entre "a SDR não mexe em nada" e "a SDR
-- mexe em tudo do funil". Com created_by dá para separar o que ela criou (mexe)
-- do que a clínica já tinha (não mexe).
--
-- Sem DEFAULT de propósito: DEFAULT auth.uid() carimbaria também as linhas que
-- o service_role insere em nome de ninguém (clone de etapas, seed, importação),
-- e linha do sistema tem de ficar NULL = estrutura da clínica.
ALTER TABLE public.crm_stages    ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.crm_pipelines ADD COLUMN IF NOT EXISTS created_by uuid;

COMMENT ON COLUMN public.crm_stages.created_by IS
  'Quem criou a etapa (auth.uid() no INSERT, pelo gatilho trg_aa_crm_stages_autoria). NULL = estrutura da clínica (linha anterior a 10/09/2026 ou criada pelo serviço): o papel sdr pode CRIAR etapa, mas só altera/exclui etapa com created_by = ela.';
COMMENT ON COLUMN public.crm_pipelines.created_by IS
  'Quem criou o funil (auth.uid() no INSERT, pelo gatilho trg_aa_crm_pipelines_autoria). NULL = estrutura da clínica: o papel sdr pode CRIAR funil, mas só altera/exclui funil com created_by = ela.';

-- Índice pequeno e útil: toda policy da SDR filtra por created_by = auth.uid().
CREATE INDEX IF NOT EXISTS crm_stages_created_by_idx    ON public.crm_stages (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_pipelines_created_by_idx ON public.crm_pipelines (created_by) WHERE created_by IS NOT NULL;

-- Um gatilho só serve às duas tabelas: em PL/pgSQL, NEW.created_by é resolvido
-- no tipo da linha em tempo de execução.
-- "quando vier nula": valor explícito NÃO é sobrescrito, porque o service_role
-- precisa poder dizer de quem é a linha (é o que a tela de administração faria
-- ao criar um funil em nome de alguém). Quem chega pelo PostgREST como
-- authenticated não ganha nada com isso: forjar created_by de outra pessoa só
-- tira dela mesma o direito de editar, e forjar NULL é impossível — NULL é
-- exatamente o caso que o gatilho preenche.
CREATE OR REPLACE FUNCTION public.crm_estrutura_autoria_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();   -- NULL quando é o serviço: estrutura da clínica
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.crm_estrutura_autoria_trg() IS
  'Gatilho BEFORE INSERT de crm_stages e crm_pipelines: carimba created_by com auth.uid() quando a linha vem sem autor. Valor explícito é preservado (service_role). NULL final = linha do sistema/estrutura da clínica.';
REVOKE ALL ON FUNCTION public.crm_estrutura_autoria_trg() FROM PUBLIC, anon, authenticated;

-- Prefixo "aa" para rodar ANTES dos gatilhos "zz" das duas tabelas
-- (trg_zz_stage_regras_padrao pode recusar a linha; trg_zz_sdr_funil_novo_padrao
-- ajusta o formato do funil). A ordem é alfabética pelo nome do gatilho.
DROP TRIGGER IF EXISTS trg_aa_crm_stages_autoria ON public.crm_stages;
CREATE TRIGGER trg_aa_crm_stages_autoria
  BEFORE INSERT ON public.crm_stages
  FOR EACH ROW EXECUTE FUNCTION public.crm_estrutura_autoria_trg();

DROP TRIGGER IF EXISTS trg_aa_crm_pipelines_autoria ON public.crm_pipelines;
CREATE TRIGGER trg_aa_crm_pipelines_autoria
  BEFORE INSERT ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.crm_estrutura_autoria_trg();

-- ============================================================ C2. as travas
-- ------------------------------------------------------------ C2.1 etapa canônica do ciclo
-- Toda a máquina de desfecho casa etapa POR NOME dentro do funil do lead
-- (rodizio_*, sdr_marcar_comparecimento, sdr_corrigir_desfecho,
-- sdr_excluir_agendamento, sdr_entrega_lead_ao_gestor,
-- varre_agendado_sem_agendamento, os fluxos de agendar/reagendar…). Renomear
-- uma dessas etapas quebra o ciclo de todo mundo em silêncio: nada dá erro, o
-- lead só para de andar. Criar uma segunda com o mesmo nome canônico é o mesmo
-- estrago pelo outro lado — "a etapa chamada Reagendar, ORDER BY position
-- LIMIT 1" passa a ser outra para todas as colegas.
--
-- Por isso a lista vive numa função só, e a tela (src/pages/CrmAutomacoes.tsx,
-- ETAPAS_CANONICAS_DO_CICLO) é espelho dela — a autoridade é aqui.
-- Os nomes estão como normaliza_nome_etapa devolve: sem acento, minúsculos,
-- aparados nas pontas e SEM colapsar espaço interno (é daí que vêm
-- "follow - up" e "pre - agendado", que no banco são "Follow - up" e
-- "Pré - agendado").
CREATE OR REPLACE FUNCTION public.etapa_canonica_do_ciclo(p_nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT public.normaliza_nome_etapa(p_nome) IN (
    'novo lead', 'conversando', 'relacionamento', 'follow - up', 'recuperado',
    'pre - agendado', 'agendado', 'nao compareceu', 'reagendado', 'reagendar',
    'contratado', 'nao contratado', 'compareceu', 'compareceu e agendou'
  );
$fn$;
COMMENT ON FUNCTION public.etapa_canonica_do_ciclo(text) IS
  'true quando o nome (normalizado por normaliza_nome_etapa) é uma das etapas que o ciclo de agendamento/desfecho procura POR NOME. Usada pelas policies do papel sdr: renomear, excluir ou duplicar uma dessas quebra o ciclo de todo mundo em silêncio.';
REVOKE ALL ON FUNCTION public.etapa_canonica_do_ciclo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapa_canonica_do_ciclo(text) TO authenticated, service_role;

-- ------------------------------------------------------------ C2.2 "tem lead?" com recorte de cliente
-- As duas perguntas abaixo são o cinto e o suspensório do CASCADE. Precisam ser
-- SECURITY DEFINER: dentro de uma policy, um SELECT em crm_leads roda com a RLS
-- de quem chama, e a SDR só enxerga os leads DELA — "etapa vazia" viraria
-- "etapa sem lead meu", que é exatamente o defeito que o revisor mostrou na
-- lixeira da etapa.
--
-- Recorte de cliente (o conserto que a rodada anterior não fez em
-- funil_tem_lead): a função só responde sobre estrutura do PRÓPRIO cliente.
-- Fora dele a resposta é "tem lead" — a resposta que TRAVA o DELETE, nunca a
-- que libera. Assim a função não conta nada sobre outro cliente e, se um dia
-- alguém a usar sem o teste de tenant ao lado, o erro é para o lado seguro.
-- O serviço (auth.uid() NULL) e o superadmin recebem a verdade: um não tem
-- cliente atual, o outro atravessa clientes por contrato.
CREATE OR REPLACE FUNCTION public.etapa_tem_lead(_stage_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid; v_achou boolean; v_responde boolean;
BEGIN
  IF _stage_id IS NULL THEN RETURN true; END IF;   -- pergunta sem sujeito: trave
  SELECT p.tenant_id INTO v_tenant
    FROM public.crm_stages s JOIN public.crm_pipelines p ON p.id = s.pipeline_id
   WHERE s.id = _stage_id;
  IF NOT FOUND THEN RETURN true; END IF;           -- etapa que não existe: trave
  v_responde := (auth.uid() IS NULL)
             OR (v_tenant IS NOT NULL AND v_tenant = public.current_tenant_id())
             OR public.has_role(auth.uid(), 'superadmin'::app_role);
  IF NOT v_responde THEN RETURN true; END IF;
  -- Conta lead de QUALQUER dona (é o ponto da função), inclusive lead cujo
  -- pipeline_id divergiu do funil da etapa: quem cascateia é o stage_id.
  SELECT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.stage_id = _stage_id) INTO v_achou;
  RETURN v_achou;
END $fn$;
COMMENT ON FUNCTION public.etapa_tem_lead(uuid) IS
  'true quando a etapa tem pelo menos um lead, ignorando a RLS de quem pergunta e com recorte de cliente (só responde sobre etapa do próprio tenant; serviço e superadmin recebem a verdade, o resto recebe "true" = trava). Usada pela policy sdr_del_crm_stages: crm_leads.stage_id é ON DELETE CASCADE.';
REVOKE ALL ON FUNCTION public.etapa_tem_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapa_tem_lead(uuid) TO authenticated, service_role;

-- funil_tem_lead: mesmo recorte, e mais uma correção. A versão de
-- 20260910130000 olhava só crm_leads.pipeline_id — mas quem cascateia ao apagar
-- um funil são as ETAPAS dele, e um lead pode estar numa etapa deste funil com
-- pipeline_id apontando para outro (divergência que já apareceu na varredura de
-- 08/09). Agora as duas perguntas são feitas.
CREATE OR REPLACE FUNCTION public.funil_tem_lead(_pipeline_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid; v_responde boolean; v_achou boolean;
BEGIN
  IF _pipeline_id IS NULL THEN RETURN true; END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.crm_pipelines p WHERE p.id = _pipeline_id;
  IF NOT FOUND THEN RETURN true; END IF;
  v_responde := (auth.uid() IS NULL)
             OR (v_tenant IS NOT NULL AND v_tenant = public.current_tenant_id())
             OR public.has_role(auth.uid(), 'superadmin'::app_role);
  IF NOT v_responde THEN RETURN true; END IF;
  SELECT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.pipeline_id = _pipeline_id)
      OR EXISTS (SELECT 1 FROM public.crm_leads l
                   JOIN public.crm_stages s ON s.id = l.stage_id
                  WHERE s.pipeline_id = _pipeline_id)
    INTO v_achou;
  RETURN v_achou;
END $fn$;
COMMENT ON FUNCTION public.funil_tem_lead(uuid) IS
  'true quando o funil tem lead — pelo pipeline_id do lead OU por ele estar numa etapa do funil (é a etapa que cascateia) —, ignorando a RLS de quem pergunta e com recorte de cliente (fora do próprio tenant a resposta é "true" = trava). Usada pela policy sdr_del_crm_pipelines.';
REVOKE ALL ON FUNCTION public.funil_tem_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funil_tem_lead(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------ C2.3 "a etapa desta automação é minha?"
-- crm_automations pendura na ETAPA e não tem autor próprio: a autoria dela é a
-- da etapa. SECURITY DEFINER pelo mesmo motivo das duas acima (a etapa pode ser
-- invisível para quem pergunta).
CREATE OR REPLACE FUNCTION public.etapa_criada_por_mim(_stage_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.crm_stages s
                  WHERE s.id = _stage_id AND s.created_by = auth.uid());
$fn$;
COMMENT ON FUNCTION public.etapa_criada_por_mim(uuid) IS
  'true quando a etapa foi criada por quem chama (crm_stages.created_by = auth.uid()), ignorando a RLS de leitura de crm_stages. Usada pelas policies sdr_upd_/sdr_del_crm_automations: automação não tem autor próprio, o autor dela é o da etapa.';
REVOKE ALL ON FUNCTION public.etapa_criada_por_mim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapa_criada_por_mim(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------ C2.4 as policies
-- Só as nove de hoje (20260910130000) são derrubadas e recriadas. As
-- RESTRICTIVE que fazem o isolamento (tenant_isolation em
-- crm_pipelines/crm_stages, hide_posvenda_*, sdr_escopo_crm_stages_visiveis) e
-- todas as PERMISSIVE de gestão/recepção/closer continuam intactas: como
-- PERMISSIVE se somam com OR, quem acumula papel de gestão continua editando
-- por aquelas, e nada aqui reduz o que já tinha.
--
-- Nota sobre visivel_para_sdr: essa coluna É a trava do isolamento da SDR (a
-- policy sdr_escopo_crm_stages_visiveis esconde dela Contratado, Não contratado
-- e Compareceu e agendou — o pedido "não precisa aparecer para o sdr se o lead
-- é contratado ou não"). Uma trava que o travado pode escrever não é trava:
-- então visivel_para_sdr = true aparece no WITH CHECK do INSERT e do UPDATE
-- (ela nunca grava numa etapa de desfecho, nem cria uma) e no USING do UPDATE e
-- do DELETE (ela nunca torna visível o que é invisível, nem apaga o invisível).
-- Repare que o gatilho trg_zz_stage_regras_padrao força visivel_para_sdr =
-- false em etapa chamada Contratado/Não contratado/Compareceu e agendou ANTES
-- do WITH CHECK: os dois juntos fecham a porta de criar etapa de desfecho
-- mesmo que o nome canônico não estivesse na lista.

-- ---------------- crm_stages
DROP POLICY IF EXISTS sdr_ins_crm_stages ON public.crm_stages;
CREATE POLICY sdr_ins_crm_stages ON public.crm_stages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.sdr_pode_editar_funil(pipeline_id)
    AND created_by = auth.uid()                      -- a linha nasce dela (o gatilho C1 carimba)
    AND visivel_para_sdr = true                      -- nunca cria etapa de desfecho
    AND NOT public.etapa_canonica_do_ciclo(name)     -- nem uma segunda etapa canônica
  );

DROP POLICY IF EXISTS sdr_upd_crm_stages ON public.crm_stages;
CREATE POLICY sdr_upd_crm_stages ON public.crm_stages
  FOR UPDATE TO authenticated
  USING (
    public.sdr_pode_editar_funil(pipeline_id)
    AND created_by = auth.uid()                      -- NULL = estrutura da clínica: NULL = auth.uid() nunca é true
    AND visivel_para_sdr = true
    AND NOT public.etapa_canonica_do_ciclo(name)
  )
  WITH CHECK (
    public.sdr_pode_editar_funil(pipeline_id)        -- não empurra a etapa para funil que não é dela
    AND created_by = auth.uid()                      -- não transfere a autoria
    AND visivel_para_sdr = true                      -- não esconde a própria etapa
    AND NOT public.etapa_canonica_do_ciclo(name)     -- não renomeia a etapa dela PARA um nome canônico
  );

-- DELETE: além de ser dela, a etapa tem de estar VAZIA. crm_leads.stage_id é
-- ON DELETE CASCADE — sem esta linha, uma etapa dela com um lead da colega
-- dentro apaga o lead, as mensagens e os agendamentos daquela colega.
DROP POLICY IF EXISTS sdr_del_crm_stages ON public.crm_stages;
CREATE POLICY sdr_del_crm_stages ON public.crm_stages
  FOR DELETE TO authenticated
  USING (
    public.sdr_pode_editar_funil(pipeline_id)
    AND created_by = auth.uid()
    AND visivel_para_sdr = true
    AND NOT public.etapa_canonica_do_ciclo(name)
    AND NOT public.etapa_tem_lead(id)
  );

-- ---------------- crm_pipelines
DROP POLICY IF EXISTS sdr_ins_crm_pipelines ON public.crm_pipelines;
CREATE POLICY sdr_ins_crm_pipelines ON public.crm_pipelines
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_role(auth.uid(), 'sdr'::app_role))
    AND tenant_id = public.current_tenant_id()
    AND created_by = auth.uid()
    AND allowed_roles IS NULL                        -- formato que sdr_concede_funil_novo enxerga
    AND COALESCE(is_posvenda, false) = false
    AND COALESCE(is_instagram, false) = false
  );

DROP POLICY IF EXISTS sdr_upd_crm_pipelines ON public.crm_pipelines;
CREATE POLICY sdr_upd_crm_pipelines ON public.crm_pipelines
  FOR UPDATE TO authenticated
  USING (
    public.sdr_pode_editar_funil(id)
    AND created_by = auth.uid()
  )
  WITH CHECK (
    public.sdr_pode_editar_funil(id)
    AND created_by = auth.uid()
    AND allowed_roles IS NULL
    AND COALESCE(is_posvenda, false) = false
    AND COALESCE(is_instagram, false) = false
  );

-- DELETE: funil dela E sem lead nenhum. Apagar funil apaga as etapas em
-- cascata, e as etapas apagam os leads: é o caminho do menu "Excluir funil".
DROP POLICY IF EXISTS sdr_del_crm_pipelines ON public.crm_pipelines;
CREATE POLICY sdr_del_crm_pipelines ON public.crm_pipelines
  FOR DELETE TO authenticated
  USING (
    public.sdr_pode_editar_funil(id)
    AND created_by = auth.uid()
    AND NOT public.funil_tem_lead(id)
  );

-- ---------------- crm_automations (os "gatilhos e disparos" do pedido)
-- INSERT continua largo de propósito: criar gatilho e disparo em qualquer etapa
-- do funil que ela usa é exatamente o que o dono pediu, e automação não apaga
-- dado de ninguém. UPDATE e DELETE, sim, ficam presos à autoria da ETAPA: a
-- automação de "Agendado" do Funil Principal é da clínica, e desligá-la calava
-- o funil de todas as colegas.
DROP POLICY IF EXISTS sdr_ins_crm_automations ON public.crm_automations;
CREATE POLICY sdr_ins_crm_automations ON public.crm_automations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.sdr_pode_editar_funil_por_etapa(stage_id)
    AND tenant_id = public.current_tenant_id()
  );

DROP POLICY IF EXISTS sdr_upd_crm_automations ON public.crm_automations;
CREATE POLICY sdr_upd_crm_automations ON public.crm_automations
  FOR UPDATE TO authenticated
  USING (
    public.sdr_pode_editar_funil_por_etapa(stage_id)
    AND public.etapa_criada_por_mim(stage_id)
    AND tenant_id = public.current_tenant_id()
  )
  WITH CHECK (
    public.sdr_pode_editar_funil_por_etapa(stage_id)
    AND public.etapa_criada_por_mim(stage_id)
    AND tenant_id = public.current_tenant_id()
  );

DROP POLICY IF EXISTS sdr_del_crm_automations ON public.crm_automations;
CREATE POLICY sdr_del_crm_automations ON public.crm_automations
  FOR DELETE TO authenticated
  USING (
    public.sdr_pode_editar_funil_por_etapa(stage_id)
    AND public.etapa_criada_por_mim(stage_id)
    AND tenant_id = public.current_tenant_id()
  );

-- ============================================================ C3. funil novo: quem acumula papel escolhe
-- Defeito: sdr_funil_novo_padrao_trg (20260910130000, seção 5.2) roda em TODO
-- INSERT de crm_pipelines feito por alguém com papel sdr e força allowed_roles
-- := NULL, is_posvenda := false, is_instagram := false. Quem acumula papéis
-- (a gerente que também é sdr, o crc que cobre o turno) perdia em silêncio a
-- escolha que acabou de fazer na tela. Pior: o nome tem prefixo "zz", então ele
-- roda DEPOIS de trg_pipeline_inclui_papel_do_criador — que é justamente quem
-- monta allowed_roles = {gerente, recepcao|closer} para o criador continuar
-- vendo o funil dele. O gatilho de hoje desfazia o trabalho daquele e o funil
-- nascia geral, visível para gente que não deveria vê-lo.
--
-- Regra nova: o gatilho só age para quem é sdr E SÓ sdr. Quem acumula papel de
-- gestão (crc, gerente, superadmin, posvenda, recepcao, closer) escolhe o
-- formato do funil e insere pela policy do papel de gestão dele, que continua
-- de pé — a sdr_ins_crm_pipelines nem precisa aceitar essa linha.
CREATE OR REPLACE FUNCTION public.sdr_funil_novo_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN RETURN NEW; END IF;
  -- Acumula papel de gestão? Então a escolha é dela/dele, não do gatilho.
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = auth.uid()
       AND ur.role IN ('crc'::app_role, 'gerente'::app_role, 'superadmin'::app_role,
                       'posvenda'::app_role, 'recepcao'::app_role, 'closer'::app_role)
  ) THEN
    RETURN NEW;
  END IF;
  NEW.allowed_roles := NULL;     -- funil geral: é o formato que sdr_concede_funil_novo enxerga
  NEW.is_posvenda   := false;
  NEW.is_instagram  := false;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.sdr_funil_novo_padrao_trg() IS
  'Gatilho BEFORE INSERT de crm_pipelines: funil criado por quem é sdr E SÓ sdr nasce geral (allowed_roles NULL, sem pós-venda/Instagram), única forma de sdr_concede_funil_novo dar a ela acesso ao próprio funil. Desde 10/09/2026 o gatilho CALA para quem acumula papel de gestão (crc/gerente/superadmin/posvenda/recepcao/closer): ali a escolha é da pessoa, e trg_pipeline_inclui_papel_do_criador já montou allowed_roles.';
REVOKE ALL ON FUNCTION public.sdr_funil_novo_padrao_trg() FROM PUBLIC, anon, authenticated;
-- (o gatilho trg_zz_sdr_funil_novo_padrao continua apontando para esta função)

-- ============================================================ C4. a entrega ao administrador é DA CONSULTA
-- crm_entregas_gestor tem lead_id como PRIMARY KEY: UMA linha por lead. Os dois
-- "DELETE ... WHERE lead_id = l.id" da rodada anterior, portanto, não apagavam
-- "a entrega desta consulta" — apagavam A entrega do lead, qualquer que fosse a
-- consulta que a motivou.
--
-- Cenário real, com dois agendamentos no mesmo paciente: a consulta A já está
-- marcada Compareceu e a entrega ao administrador está agendada para dentro de
-- 24 h; a SDR exclui a consulta B, que ela criou por engano. A entrega de A
-- morria junto e o lead NUNCA chegava ao administrador — o comparecimento
-- ficava contado para ela e a venda não era trabalhada por ninguém.
--
-- Recorte: apaga quando a entrega é DAQUELA consulta (appointment_id = a.id) ou
-- quando ela não tem consulta casada (entrega antiga, ou vinda da etapa) E o
-- lead não tem OUTRA consulta com comparecimento para sustentá-la.

-- ------------------------------------------------------------ C4.1 sdr_corrigir_desfecho
-- Corpo de 20260910130000 (seção 3.2) com UMA mudança: o DELETE recortado.
CREATE OR REPLACE FUNCTION public.sdr_corrigir_desfecho(p_appointment_id uuid, p_compareceu boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_tenant uuid;
        v_gestao boolean; v_antes text; v_novo text; n integer;
        v_alvo uuid; v_alvo_nome text; v_movido boolean := false;
        v_quem text; v_entrega text; v_dona uuid; v_removidas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para corrigir o desfecho de uma consulta.' USING ERRCODE = '42501';
  END IF;
  IF p_compareceu IS NULL THEN
    RAISE EXCEPTION 'Diga se o paciente compareceu ou não.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM public.crm_appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O lead desta consulta não existe mais.' USING ERRCODE = '42501'; END IF;

  -- Isolamento por cliente: nem a gestão sai do próprio tenant.
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL OR l.tenant_id IS DISTINCT FROM v_tenant
     OR (a.tenant_id IS NOT NULL AND a.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION 'Esta consulta é de outra clínica.' USING ERRCODE = '42501';
  END IF;

  v_gestao := public.has_role(auth.uid(), 'crc'::app_role)
           OR public.has_role(auth.uid(), 'gerente'::app_role)
           OR public.has_role(auth.uid(), 'superadmin'::app_role);
  IF NOT v_gestao THEN
    IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
      RAISE EXCEPTION 'Seu perfil não corrige desfecho de consulta. Peça ao administrador da clínica.' USING ERRCODE = '42501';
    END IF;
    IF l.assigned_to IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Este lead não é seu — quem corrige é quem está com ele, ou o administrador.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Desfecho que veio do pagamento não se discute na tela do atendimento.
  IF a.status = 'contracted' AND COALESCE(a.outcome_source, '') <> 'sdr' THEN
    RAISE EXCEPTION 'Esta consulta está marcada como CONTRATADA pelo sistema de pagamentos — quem decide isso é o pagamento, não a marcação de presença. Fale com o administrador da clínica.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'rescheduled' THEN
    RAISE EXCEPTION 'Esta consulta foi remarcada — corrija a consulta NOVA, que é a que vale.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'cancelled' THEN
    RAISE EXCEPTION 'Esta consulta foi excluída. Crie um agendamento novo em vez de corrigir este.' USING ERRCODE = '42501';
  END IF;

  v_antes := a.status;
  v_novo  := CASE WHEN p_compareceu THEN 'not_contracted' ELSE 'no_show' END;
  IF v_antes = v_novo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_mudanca', 'status', v_antes,
                              'mensagem', CASE WHEN p_compareceu THEN 'A consulta já está marcada como Compareceu.'
                                               ELSE 'A consulta já está marcada como Não compareceu.' END);
  END IF;
  v_quem := public.rodizio_nome(auth.uid());

  -- "Não compareceu" desfaz a passagem ao administrador ANTES de mexer no
  -- desfecho: o lead é da SDR de novo, para ela reagendar.
  -- RECORTE PELA CONSULTA (10/09/2026): crm_entregas_gestor tem uma linha por
  -- lead, então "WHERE lead_id = l.id" apagava também a entrega que outra
  -- consulta do mesmo paciente havia motivado. Cai a entrega DESTA consulta —
  -- ou a entrega sem consulta casada, e só quando não há outra consulta com
  -- comparecimento para sustentá-la.
  IF NOT p_compareceu THEN
    DELETE FROM public.crm_entregas_gestor e
     WHERE e.lead_id = l.id
       AND (
         e.appointment_id = a.id
         OR (e.appointment_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a2
                              WHERE a2.lead_id = l.id AND a2.id <> a.id
                                AND a2.status IN ('contracted', 'not_contracted')))
       );
    GET DIAGNOSTICS v_removidas = ROW_COUNT;
  END IF;

  -- A trava de reabertura de stamp_appointment_update é aberta por UMA
  -- instrução e fechada em seguida (GUC transacional, 20260910130000 item 3.1).
  PERFORM set_config('sdr.correcao_desfecho', 'sim', true);
  UPDATE public.crm_appointments
     SET status = v_novo,
         outcome_source = 'sdr',
         outcome_at = now(),
         outcome_by = auth.uid(),
         updated_at = now()
   WHERE id = a.id AND status = v_antes;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('sdr.correcao_desfecho', '', true);
  IF n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'corrida',
                              'mensagem', 'O desfecho desta consulta mudou enquanto você corrigia — recarregue a tela.');
  END IF;

  -- Estado real depois do gatilho da consulta (que, com carência 0, pode ter
  -- entregado o lead ao administrador dentro do UPDATE acima).
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  v_dona := l.assigned_to;

  IF p_compareceu THEN
    -- Rede de segurança: se o gatilho não agendou nada (por exemplo porque a
    -- consulta já estava 'not_contracted' antes e só a etapa estava errada), a
    -- entrega é agendada aqui. Idempotente: devolve 'ja_agendada' se já existe.
    IF v_dona IS NOT NULL AND public.has_role(v_dona, 'sdr'::app_role)
       AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id) THEN
      BEGIN
        PERFORM public.sdr_agenda_entrega_ao_gestor(l.id,
          'desfecho corrigido para comparecimento em ' || to_char(a.scheduled_date, 'DD/MM'),
          '✅ Compareceu (corrigido)', a.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sdr_corrigir_desfecho: entrega não agendada (lead %): %', l.id, SQLERRM;
      END;
      SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
      v_dona := l.assigned_to;
    END IF;
  END IF;

  -- Etapa: "Compareceu" quando compareceu (só enquanto o lead ainda é da SDR —
  -- entregue, quem manda na etapa é a entrega), "Não compareceu" quando não.
  IF p_compareceu THEN
    IF v_dona IS NOT NULL AND public.has_role(v_dona, 'sdr'::app_role) THEN
      SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
       WHERE s.pipeline_id = l.pipeline_id
         AND public.normaliza_nome_etapa(s.name) = 'compareceu'
       ORDER BY s.position LIMIT 1;
    END IF;
  ELSE
    SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id
       AND public.normaliza_nome_etapa(s.name) = 'nao compareceu'
     ORDER BY s.position LIMIT 1;
  END IF;
  IF v_alvo IS NOT NULL AND v_alvo IS DISTINCT FROM l.stage_id THEN
    UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
    v_movido := true;
  END IF;

  -- O livro (quem mexeu, no quê e por quê) e o chat do lead. Fase 'saneamento':
  -- não é distribuição de lead, é conserto.
  PERFORM public.rodizio_livro(l, l.assigned_to, l.assigned_to, 'saneamento',
    'desfecho corrigido de ' || v_antes || ' para ' || v_novo || ' por ' || COALESCE(v_quem, 'usuário'), NULL);
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    CASE WHEN p_compareceu
         THEN '✏️ Correção: o paciente COMPARECEU em ' || to_char(a.scheduled_date, 'DD/MM')
         ELSE '✏️ Correção: o paciente NÃO compareceu em ' || to_char(a.scheduled_date, 'DD/MM') END
    || ' — corrigido por ' || COALESCE(v_quem, 'usuário')
    || CASE WHEN v_movido THEN ' · etapa ' || v_alvo_nome ELSE '' END
    || CASE WHEN NOT p_compareceu AND v_removidas > 0
            THEN ' · a passagem para o administrador foi cancelada; o lead continua com '
                 || COALESCE(public.rodizio_nome(l.assigned_to), 'a SDR')
            ELSE '' END);

  v_entrega := CASE
                 WHEN NOT p_compareceu AND v_removidas > 0 THEN 'removida'
                 WHEN v_dona IS NULL OR NOT public.has_role(v_dona, 'sdr'::app_role) THEN 'entregue'
                 WHEN EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id) THEN 'agendada'
                 ELSE 'nenhuma'
               END;

  -- 'stage_id' NULL de propósito: a automação de entrada da etapa é executada
  -- pela fila do banco, e devolver stage_id faria o front executá-la de novo
  -- (mensagem repetida para o paciente). Ver 20260910130000, item 2.
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'appointment_id', a.id,
                            'status_antes', v_antes, 'status', v_novo,
                            'compareceu', p_compareceu,
                            'stage_id', NULL::uuid, 'etapa_id', CASE WHEN v_movido THEN v_alvo ELSE NULL END,
                            'stage_nome', v_alvo_nome, 'etapa_mudou', v_movido,
                            'entrega', v_entrega, 'phone', l.phone);
END $fn$;
COMMENT ON FUNCTION public.sdr_corrigir_desfecho(uuid, boolean) IS
  'Corrige a marcação de presença de uma consulta (compareceu ↔ não compareceu) para a SDR dona do lead e para a gestão (crc/gerente/superadmin) do próprio cliente. Recusa consulta contratada pelo pagamento (Dontus). Desde 10/09/2026 cancela apenas a passagem ao administrador DAQUELA consulta — crm_entregas_gestor tem uma linha por lead, e sem o recorte a correção de uma consulta matava a entrega motivada por outra.';
REVOKE ALL ON FUNCTION public.sdr_corrigir_desfecho(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_corrigir_desfecho(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------ C4.2 sdr_excluir_agendamento
-- Corpo de 20260910130000 (seção 4) com DUAS mudanças: o DELETE recortado pela
-- consulta e a volta para "Conversando" que passa a olhar também o
-- comparecimento. Antes, excluir a consulta B de um paciente que JÁ COMPARECEU
-- na consulta A jogava o lead de volta para "Conversando" — a etapa dizia que
-- ninguém tinha ido, e o comparecimento de A desaparecia da tela.
CREATE OR REPLACE FUNCTION public.sdr_excluir_agendamento(p_appointment_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_tenant uuid;
        v_gestao boolean; v_antes text; n integer; v_motivo text;
        v_etapa_atual text; v_alvo uuid; v_alvo_nome text; v_movido boolean := false;
        v_quem text; v_removidas integer := 0; v_tem_outra boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para excluir um agendamento.' USING ERRCODE = '42501';
  END IF;
  v_motivo := btrim(COALESCE(p_motivo, ''));
  IF length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Escreva o motivo da exclusão (pelo menos 3 letras) — ele fica no histórico do paciente.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM public.crm_appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O lead desta consulta não existe mais.' USING ERRCODE = '42501'; END IF;

  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL OR l.tenant_id IS DISTINCT FROM v_tenant
     OR (a.tenant_id IS NOT NULL AND a.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION 'Esta consulta é de outra clínica.' USING ERRCODE = '42501';
  END IF;

  v_gestao := public.has_role(auth.uid(), 'crc'::app_role)
           OR public.has_role(auth.uid(), 'gerente'::app_role)
           OR public.has_role(auth.uid(), 'superadmin'::app_role);
  IF NOT v_gestao THEN
    IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
      RAISE EXCEPTION 'Seu perfil não exclui agendamento. Peça ao administrador da clínica.' USING ERRCODE = '42501';
    END IF;
    IF l.assigned_to IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Este lead não é seu — quem exclui é quem está com ele, ou o administrador.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Mesma recusa da correção: contrato é dado do pagamento.
  IF a.status = 'contracted' AND COALESCE(a.outcome_source, '') <> 'sdr' THEN
    RAISE EXCEPTION 'Esta consulta está marcada como CONTRATADA pelo sistema de pagamentos e não pode ser excluída aqui. Fale com o administrador da clínica.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'rescheduled' THEN
    RAISE EXCEPTION 'Esta consulta foi remarcada — ela é o histórico da remarcação. Exclua a consulta NOVA, que é a que vale.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ja_excluido', 'status', a.status,
                              'mensagem', 'Este agendamento já estava excluído.');
  END IF;

  v_antes := a.status;
  v_quem := public.rodizio_nome(auth.uid());

  -- Some o agendamento, some a passagem ao administrador QUE ELE motivou — e só
  -- ela. Ver o cabeçalho de C4: a tabela tem uma linha por lead, e o cenário do
  -- revisor é a consulta A comparecida com entrega agendada e a consulta B
  -- excluída por engano no mesmo paciente.
  DELETE FROM public.crm_entregas_gestor e
   WHERE e.lead_id = l.id
     AND (
       e.appointment_id = a.id
       OR (e.appointment_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a2
                            WHERE a2.lead_id = l.id AND a2.id <> a.id
                              AND a2.status IN ('contracted', 'not_contracted')))
     );
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  PERFORM set_config('sdr.correcao_desfecho', 'sim', true);
  UPDATE public.crm_appointments
     SET status = 'cancelled',
         cancelled_reason = v_motivo,
         outcome_source = 'sdr',
         outcome_at = now(),
         outcome_by = auth.uid(),
         updated_at = now()
   WHERE id = a.id AND status = v_antes;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('sdr.correcao_desfecho', '', true);
  IF n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'corrida',
                              'mensagem', 'O estado desta consulta mudou enquanto você excluía — recarregue a tela.');
  END IF;

  -- Etapa: o lead não pode ficar parado numa etapa que promete uma consulta que
  -- não existe mais. Volta para "Conversando" — e SÓ se ele não tiver NENHUMA
  -- outra consulta viva (confirmed/pending) NEM outra com comparecimento
  -- (contracted/not_contracted). O comparecimento entrou nesta conta em
  -- 10/09/2026: sem ele, excluir a consulta errada apagava da etapa o fato de o
  -- paciente ter ido à clínica.
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  SELECT s.name INTO v_etapa_atual FROM public.crm_stages s WHERE s.id = l.stage_id;
  v_tem_outra := EXISTS (SELECT 1 FROM public.crm_appointments a2
                          WHERE a2.lead_id = l.id AND a2.id <> a.id
                            AND a2.status IN ('confirmed', 'pending', 'contracted', 'not_contracted'));
  IF NOT v_tem_outra
     AND public.normaliza_nome_etapa(v_etapa_atual) IN
         ('agendado', 'reagendado', 'reagendar', 'compareceu', 'compareceu e agendou', 'nao compareceu') THEN
    SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id
       AND public.normaliza_nome_etapa(s.name) = 'conversando'
     ORDER BY s.position LIMIT 1;
    IF v_alvo IS NOT NULL AND v_alvo IS DISTINCT FROM l.stage_id THEN
      UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
      v_movido := true;
    END IF;
  END IF;

  PERFORM public.rodizio_livro(l, l.assigned_to, l.assigned_to, 'saneamento',
    'agendamento de ' || to_char(a.scheduled_date, 'DD/MM') || ' (' || v_antes || ') excluído por '
    || COALESCE(v_quem, 'usuário') || ': ' || v_motivo, NULL);
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    '🗑️ Agendamento de ' || to_char(a.scheduled_date, 'DD/MM') || ' excluído por ' || COALESCE(v_quem, 'usuário')
    || ' — ' || v_motivo
    || CASE WHEN v_movido THEN ' · etapa ' || v_alvo_nome ELSE '' END
    || CASE WHEN v_removidas > 0 THEN ' · a passagem para o administrador foi cancelada' ELSE '' END);

  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'appointment_id', a.id,
                            'status_antes', v_antes, 'status', 'cancelled', 'motivo_texto', v_motivo,
                            'stage_id', NULL::uuid, 'etapa_id', CASE WHEN v_movido THEN v_alvo ELSE NULL END,
                            'stage_nome', v_alvo_nome, 'etapa_mudou', v_movido,
                            'entrega_removida', (v_removidas > 0), 'phone', l.phone);
END $fn$;
COMMENT ON FUNCTION public.sdr_excluir_agendamento(uuid, text) IS
  'Exclui um agendamento marcando status ''cancelled'' com motivo (a linha fica, os relatórios já ignoram cancelled). Desde 10/09/2026 cancela só a passagem ao administrador daquela consulta e só devolve o lead para "Conversando" quando ele não tem outra consulta viva NEM outra com comparecimento. Aberta para a SDR dona do lead e para a gestão do próprio cliente; recusa consulta contratada pelo pagamento (Dontus).';
REVOKE ALL ON FUNCTION public.sdr_excluir_agendamento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_excluir_agendamento(uuid, text) TO authenticated, service_role;

-- ============================================================ C5. "Compareceu" à mão não gera duas mensagens que se contradizem
-- Defeito: com a etapa "Compareceu" agora VISÍVEL para a SDR (20260910130000,
-- item 1), quem arrasta o lead para lá à mão cai no tampão
-- sdr_etapa_oculta_entrega, que agenda a entrega SEM appointment_id (não existe
-- consulta nenhuma no arrasto). Vinte e quatro horas depois,
-- sdr_entregas_pendentes reconferia "o ciclo continua encerrado?" olhando
-- apenas (a) etapa invisível para a SDR e (b) consulta com comparecimento.
-- Nenhuma das duas era verdade: a etapa é visível e não há consulta. Conclusão:
-- "o desfecho foi corrigido", entrega cancelada e no chat do paciente ficavam
-- duas mensagens de sistema que se contradizem —
--   "✅ Etapa Compareceu — o lead passa para o administrador em 24 h"  e
--   "↩️ Entrega ao administrador cancelada: o desfecho foi corrigido".
-- O lead ficava para sempre numa etapa que promete 24 h e não cumpre.
--
-- Conserto: a etapa cujo nome normalizado é 'compareceu' também é ciclo
-- encerrado, ao lado do teste de NOT visivel_para_sdr. É a mesma frase que
-- sdr_etapa_oculta_entrega usa para AGENDAR — as duas pontas passam a ler a
-- mesma regra. Corpo de 20260910012000 (seção 6) com essa única mudança.
CREATE OR REPLACE FUNCTION public.sdr_entregas_pendentes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE e record; l public.crm_leads; v_n integer := 0; v_fechado boolean; v_gestor uuid;
BEGIN
  -- Cliente com o motor desligado nem entra na varredura: a linha fica na fila
  -- esperando o motor voltar.
  FOR e IN SELECT g.* FROM public.crm_entregas_gestor g
            WHERE g.entregar_em <= now()
              AND NOT EXISTS (SELECT 1 FROM public.crm_rodizio_config c
                               WHERE c.tenant_id = g.tenant_id AND c.modo = 'desligado')
            ORDER BY g.entregar_em LIMIT 200 LOOP
    BEGIN
      SELECT * INTO l FROM public.crm_leads WHERE id = e.lead_id;
      IF NOT FOUND THEN
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- Desistência: já tentou mais de 5 vezes (com recuo de 30 min × tentativa).
      IF COALESCE(e.tentativas, 0) > 5 THEN
        PERFORM public.rodizio_livro(l, e.de_user_id, NULL, 'saneamento',
          'entrega ao administrador desistiu depois de 5 tentativas', NULL);
        SELECT c.gestor_user_id INTO v_gestor FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
        PERFORM public.rodizio_notifica(v_gestor, l.id, 'Entrega de lead não concluída',
          'O lead ' || COALESCE(NULLIF(btrim(l.name), ''), l.phone, 'sem nome')
          || ' não pôde ser passado para o administrador depois de 5 tentativas e continua com '
          || public.rodizio_nome(l.assigned_to)
          || '. Verifique o administrador configurado no rodízio e passe o lead à mão se for o caso.');
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- A dona ainda é quem estava na hora da marcação? Se alguém transferiu no
      -- meio da carência, quem transferiu decidiu: a entrega agendada cai.
      IF l.assigned_to IS DISTINCT FROM e.de_user_id THEN
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- O ciclo continua encerrado? Etapa do administrador (invisível para a
      -- SDR) OU a etapa "Compareceu" — que é visível desde 10/09/2026 e é
      -- justamente a que a SDR usa à mão, sem consulta casada (é a mesma regra
      -- de sdr_etapa_oculta_entrega, que foi quem agendou esta linha) — OU A
      -- CONSULTA que motivou a entrega ainda com comparecimento (desfecho
      -- corrigido para falta/pendente = a SDR está reagendando, o lead é dela).
      v_fechado := EXISTS (SELECT 1 FROM public.crm_stages s
                            WHERE s.id = l.stage_id
                              AND (NOT COALESCE(s.visivel_para_sdr, true)
                                   OR public.normaliza_nome_etapa(s.name) = 'compareceu'))
                OR (e.appointment_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                              WHERE a.id = e.appointment_id AND a.status IN ('contracted', 'not_contracted')))
                OR (e.appointment_id IS NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                          WHERE a.lead_id = l.id AND a.status IN ('contracted', 'not_contracted')
                                                            AND a.updated_at >= e.criado_em - interval '1 hour'));
      IF NOT v_fechado THEN
        PERFORM public.rodizio_livro(l, e.de_user_id, NULL, 'saneamento',
          'entrega ao administrador cancelada: desfecho/etapa foram corrigidos durante a carência', NULL);
        PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
          '↩️ Entrega ao administrador cancelada: o desfecho foi corrigido durante a carência; o lead continua com ' || public.rodizio_nome(l.assigned_to));
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- A entrega leva a consulta: é ela que decide a etapa (Contratado / Não contratado).
      IF public.sdr_entrega_lead_ao_gestor(e.lead_id, COALESCE(e.motivo, 'comparecimento') || ' (após carência)',
                                           e.mensagem, e.appointment_id) THEN
        v_n := v_n + 1;
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
      ELSE
        -- Entrega recusada (sem gestor configurado, corrida na dona, lock): a
        -- linha FICA e é tentada de novo, mais tarde (recuo progressivo).
        UPDATE public.crm_entregas_gestor
           SET tentativas = COALESCE(tentativas, 0) + 1,
               entregar_em = now() + make_interval(mins => 30 * (COALESCE(tentativas, 0) + 1))
         WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sdr_entregas_pendentes: % (lead %)', SQLERRM, e.lead_id;
      -- Erro também é tentativa (o bloco acima foi desfeito), com o mesmo recuo.
      BEGIN
        UPDATE public.crm_entregas_gestor
           SET tentativas = COALESCE(tentativas, 0) + 1,
               entregar_em = now() + make_interval(mins => 30 * (COALESCE(tentativas, 0) + 1))
         WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
COMMENT ON FUNCTION public.sdr_entregas_pendentes() IS
  'Cron das entregas vencidas: passa ao administrador o lead cuja carência terminou, cancela a linha quando o desfecho/etapa foram corrigidos no meio, e desiste com aviso ao gestor depois de 5 tentativas. Desde 10/09/2026 a etapa "Compareceu" também conta como ciclo encerrado (ela é visível para a SDR e é a etapa que ela usa à mão, sem consulta casada) — sem isso, a entrada manual gerava duas mensagens de sistema que se contradiziam 24 h depois.';
REVOKE ALL ON FUNCTION public.sdr_entregas_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_entregas_pendentes() TO service_role;

-- O PostgREST precisa enxergar as colunas e as funções novas.
NOTIFY pgrst, 'reload schema';

-- ============================================================ VERIFICAÇÃO (só leitura, rodar depois do deploy)
-- 1. As colunas de autoria existem e as linhas ANTIGAS ficaram NULL
--    (= estrutura da clínica, protegida de graça):
-- SELECT 'etapas' AS o, count(*) AS total, count(created_by) AS com_autor FROM public.crm_stages
--  UNION ALL
-- SELECT 'funis', count(*), count(created_by) FROM public.crm_pipelines;
--   -- esperado logo depois do deploy: com_autor = 0 nas duas linhas.
--
-- 2. As nove policies da SDR estão no formato novo (e nenhuma antiga sumiu):
-- SELECT tablename, policyname, permissive, cmd, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename IN ('crm_stages','crm_pipelines','crm_automations')
--  ORDER BY tablename, policyname;
--   -- as sdr_* de crm_stages/crm_pipelines precisam citar created_by;
--   -- as de crm_stages, também visivel_para_sdr e etapa_canonica_do_ciclo.
--
-- 3. As funções novas são SECURITY DEFINER com search_path fixo (menos a
--    IMMUTABLE de comparar nome, que não toca em tabela):
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
--        coalesce(array_to_string(p.proconfig, ' | '), '(sem search_path)') AS config
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('etapa_canonica_do_ciclo','etapa_tem_lead','funil_tem_lead',
--                      'etapa_criada_por_mim','crm_estrutura_autoria_trg','sdr_funil_novo_padrao_trg',
--                      'sdr_corrigir_desfecho','sdr_excluir_agendamento','sdr_entregas_pendentes')
--  ORDER BY 1;
--
-- 4. anon nunca executa nada disto, e gatilho não é RPC:
-- SELECT p.proname, coalesce(array_to_string(p.proacl, ' | '), '(sem ACL = só o dono)') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('etapa_canonica_do_ciclo','etapa_tem_lead','funil_tem_lead','etapa_criada_por_mim',
--                      'crm_estrutura_autoria_trg','sdr_funil_novo_padrao_trg','sdr_entregas_pendentes');
--
-- 5. Os gatilhos de autoria estão ligados e rodam ANTES dos "zz":
-- SELECT c.relname AS tabela, t.tgname, t.tgenabled, p.proname AS funcao
--   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
--  WHERE NOT t.tgisinternal AND c.relname IN ('crm_stages','crm_pipelines')
--  ORDER BY 1, 2;
--   -- trg_aa_* antes de set_crm_*_tenant_id e de trg_zz_*; todos com tgenabled = 'O'.
--
-- 6. A lista canônica bate com o que existe no cliente (nenhuma etapa do ciclo
--    de fora, nenhum nome escrito diferente do que a função espera):
-- SELECT DISTINCT public.normaliza_nome_etapa(s.name) AS nome_normalizado,
--        public.etapa_canonica_do_ciclo(s.name) AS canonica, count(*) AS etapas
--   FROM public.crm_stages s JOIN public.crm_pipelines p ON p.id = s.pipeline_id
--  WHERE p.tenant_id = '00000000-0000-0000-0000-000000000010'
--  GROUP BY 1, 2 ORDER BY 2 DESC, 1;
--
-- 7. C4 na vida real (lead com duas consultas, uma comparecida):
-- SELECT a.id, a.scheduled_date, a.status, e.appointment_id, e.entregar_em
--   FROM public.crm_appointments a
--   LEFT JOIN public.crm_entregas_gestor e ON e.lead_id = a.lead_id
--  WHERE a.lead_id = '<lead>' ORDER BY a.scheduled_date;
--   -- depois de excluir a consulta que NÃO é a da entrega, a linha de
--   -- crm_entregas_gestor tem de continuar lá, com o mesmo appointment_id.

-- ============================================================ ENSAIOS (desfeitos)
-- Um bloco só, dentro de uma transação implícita que termina em RAISE EXCEPTION:
-- nada é gravado. Emula a SDR Bia (9c32408d-…) do jeito que o PostgREST faria —
-- JWT em request.jwt.claims e papel de banco 'authenticated' — porque é só
-- assim que a RLS entra em cena: rodando como dono do banco, TODA policy é
-- ignorada e o ensaio provaria nada.
--
-- Cada item devolve "N linha(s)" em vez de estourar: DELETE e UPDATE barrados
-- por RLS NÃO dão erro, dão ZERO LINHA — foi exatamente esse silêncio que
-- escondeu o defeito na tela (a lixeira dizia "0 leads" e apagava os da colega).
--
-- Para rodar: descomente daqui até o fim e execute no SQL editor como dono do
-- banco. Se o parser reclamar de "SET LOCAL ROLE" dentro do bloco, troque a
-- linha por PERFORM set_config('role', 'authenticated', true).
--
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_bia    uuid := '9c32408d-d852-4c55-9637-b30a59a16c13';
--   v_funil uuid; v_conversando uuid; v_agendado uuid; v_naocontratado uuid;
--   v_outra uuid; v_lead uuid; v_lead_colega uuid; v_apt_a uuid; v_apt_b uuid;
--   v_minha uuid; v_vazia uuid; v_com_lead uuid; v_meu_funil uuid;
--   v_created uuid; v_vis boolean; v_roles text;
--   v_entrega_a integer; v_etapa_final text; v_ret jsonb; v_colega_viva boolean;
--   n integer; rep text := E'\n';
-- BEGIN
--   -- ======================= montagem (dono do banco, sem JWT: nada aqui é o teste)
--   v_funil := public.rodizio_funil(v_tenant);
--   IF v_funil IS NULL THEN RAISE EXCEPTION 'ENSAIO: não achei o Funil Principal do cliente'; END IF;
--   SELECT id INTO v_conversando   FROM public.crm_stages WHERE pipeline_id = v_funil
--    AND public.normaliza_nome_etapa(name) = 'conversando'     ORDER BY position LIMIT 1;
--   SELECT id INTO v_agendado      FROM public.crm_stages WHERE pipeline_id = v_funil
--    AND public.normaliza_nome_etapa(name) = 'agendado'        ORDER BY position LIMIT 1;
--   SELECT id INTO v_naocontratado FROM public.crm_stages WHERE pipeline_id = v_funil
--    AND public.normaliza_nome_etapa(name) = 'nao contratado'  ORDER BY position LIMIT 1;
--   IF v_conversando IS NULL OR v_agendado IS NULL OR v_naocontratado IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: o Funil Principal não tem Conversando/Agendado/Não contratado';
--   END IF;
--   -- alguém que NÃO é a Bia, para ser a "colega" do item (c)
--   SELECT COALESCE((SELECT c.gestor_user_id FROM public.crm_rodizio_config c WHERE c.tenant_id = v_tenant),
--                   (SELECT p.id FROM public.profiles p WHERE p.tenant_id = v_tenant AND p.id <> v_bia LIMIT 1))
--     INTO v_outra;
--   -- carência > 0 para a entrega da consulta A ficar AGENDADA (com 0 ela sairia na hora)
--   UPDATE public.crm_rodizio_config SET entrega_gestor_apos_min = 1440 WHERE tenant_id = v_tenant;
--
--   -- lead da Bia: consulta A já comparecida (com entrega agendada) e consulta B viva
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, assigned_to)
--   VALUES (v_tenant, v_funil, v_agendado, 'ZZ ENSAIO paciente da Bia', '5577900000001', v_bia)
--   RETURNING id INTO v_lead;
--   INSERT INTO public.crm_appointments (tenant_id, lead_id, scheduled_date, scheduled_time, status)
--   VALUES (v_tenant, v_lead, current_date - 1, '09:00', 'not_contracted') RETURNING id INTO v_apt_a;
--   INSERT INTO public.crm_appointments (tenant_id, lead_id, scheduled_date, scheduled_time, status)
--   VALUES (v_tenant, v_lead, current_date + 3, '10:00', 'confirmed')      RETURNING id INTO v_apt_b;
--   -- o gatilho trg_zz_comparecimento_entrega deve ter agendado a entrega de A;
--   -- se a configuração do cliente não permitir, a linha entra à mão — o que
--   -- (h) mede é o DELETE recortado, não o agendamento.
--   IF NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor WHERE lead_id = v_lead) THEN
--     INSERT INTO public.crm_entregas_gestor (lead_id, tenant_id, de_user_id, motivo, mensagem, entregar_em, appointment_id)
--     VALUES (v_lead, v_tenant, v_bia, 'ensaio: compareceu na consulta A', '✅ Compareceu',
--             now() + interval '24 hours', v_apt_a);
--     rep := rep || '    (entrega da consulta A inserida à mão: a config do cliente não agendou)' || E'\n';
--   END IF;
--   UPDATE public.crm_entregas_gestor SET appointment_id = v_apt_a
--    WHERE lead_id = v_lead AND appointment_id IS NULL;
--
--   -- ======================= agora é a Bia (papel sdr, RLS valendo)
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', v_bia::text, 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--
--   rep := rep || format('contexto: has_role(sdr)=%s  tenant=%s  pode_editar(Funil Principal)=%s%s',
--                        public.has_role(v_bia, 'sdr'::app_role), public.current_tenant_id(),
--                        public.sdr_pode_editar_funil(v_funil), E'\n');
--
--   -- (f) INSERT de etapa nova pela SDR: funciona, nasce dela e visível
--   INSERT INTO public.crm_stages (pipeline_id, name, color, position)
--   VALUES (v_funil, 'ZZ Ensaio — etapa da Bia', '#6366f1', 999)
--   RETURNING id, created_by, visivel_para_sdr INTO v_minha, v_created, v_vis;
--   rep := rep || format('(f) INSERT de etapa pela SDR: criada=%s  created_by é dela=%s  visivel_para_sdr=%s  — esperado sim/sim%s',
--                        (v_minha IS NOT NULL), (v_created = v_bia), v_vis, E'\n');
--
--   -- (g) INSERT de funil novo pela SDR: funciona, allowed_roles NULL e created_by dela
--   INSERT INTO public.crm_pipelines (tenant_id, name, color)
--   VALUES (v_tenant, 'ZZ Ensaio — funil da Bia', '#22c55e')
--   RETURNING id, created_by, COALESCE(array_to_string(allowed_roles, ','), '(NULL)')
--     INTO v_meu_funil, v_created, v_roles;
--   rep := rep || format('(g) INSERT de funil pela SDR: criado=%s  created_by é dela=%s  allowed_roles=%s  — esperado sim/sim/(NULL)%s',
--                        (v_meu_funil IS NOT NULL), (v_created = v_bia), v_roles, E'\n');
--
--   -- (b) DELETE de etapa criada por ela e SEM lead: funciona
--   INSERT INTO public.crm_stages (pipeline_id, name, color, position)
--   VALUES (v_funil, 'ZZ Ensaio — etapa vazia', '#6366f1', 998) RETURNING id INTO v_vazia;
--   DELETE FROM public.crm_stages WHERE id = v_vazia;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   rep := rep || format('(b) DELETE de etapa dela e vazia: %s linha(s) — esperado 1%s', n, E'\n');
--
--   -- etapa dela que vai receber o lead da colega (o DELETE é tentado em (c))
--   INSERT INTO public.crm_stages (pipeline_id, name, color, position)
--   VALUES (v_funil, 'ZZ Ensaio — etapa com lead da colega', '#6366f1', 997) RETURNING id INTO v_com_lead;
--
--   -- (a) DELETE de etapa do Funil Principal (created_by NULL = estrutura da clínica).
--   --     Era ESTE o caminho que levava embora, em cascata, os leads das colegas.
--   DELETE FROM public.crm_stages WHERE id = v_conversando;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   rep := rep || format('(a) DELETE de "Conversando" do Funil Principal: %s linha(s) — esperado 0%s', n, E'\n');
--
--   -- (d) UPDATE de visivel_para_sdr em "Não contratado" (a trava do isolamento dela)
--   UPDATE public.crm_stages SET visivel_para_sdr = true WHERE id = v_naocontratado;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   rep := rep || format('(d) UPDATE de visivel_para_sdr em "Não contratado": %s linha(s) — esperado 0%s', n, E'\n');
--
--   -- (e) UPDATE do nome de "Agendado" (renomear etapa canônica quebra o ciclo de todos)
--   UPDATE public.crm_stages SET name = 'Agendadinho' WHERE id = v_agendado;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   rep := rep || format('(e) UPDATE do nome de "Agendado": %s linha(s) — esperado 0%s', n, E'\n');
--
--   -- de brinde, o outro lado da mesma trava: renomear a etapa DELA para um nome
--   -- canônico. Aqui a recusa vem do WITH CHECK, e WITH CHECK não devolve zero
--   -- linha — ESTOURA ("new row violates row-level security policy"). É a recusa
--   -- barulhenta, a boa: a tela mostra a mensagem em vez de fingir que salvou.
--   BEGIN
--     UPDATE public.crm_stages SET name = 'Reagendar' WHERE id = v_minha;
--     GET DIAGNOSTICS n = ROW_COUNT;
--     rep := rep || format('(e2) UPDATE da etapa DELA para o nome canônico "Reagendar": %s linha(s) SEM recusa — REPROVADO%s', n, E'\n');
--   EXCEPTION WHEN insufficient_privilege OR check_violation THEN
--     rep := rep || format('(e2) UPDATE da etapa DELA para o nome canônico "Reagendar": recusado pelo WITH CHECK (%s) — esperado%s', SQLERRM, E'\n');
--   END;
--
--   -- (h) excluir a consulta B (criada por engano) não pode apagar a entrega da consulta A
--   v_ret := public.sdr_excluir_agendamento(v_apt_b, 'agendei no lead errado');
--
--   -- ======================= dono do banco de novo (para ver o que a RLS dela esconde)
--   RESET ROLE;
--   PERFORM set_config('request.jwt.claims', '', true);
--
--   -- lead DA COLEGA dentro da etapa que a Bia criou
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, assigned_to)
--   VALUES (v_tenant, v_funil, v_com_lead, 'ZZ ENSAIO paciente da colega', '5577900000002', v_outra)
--   RETURNING id INTO v_lead_colega;
--
--   SELECT count(*) INTO v_entrega_a FROM public.crm_entregas_gestor
--    WHERE lead_id = v_lead AND appointment_id = v_apt_a;
--   SELECT s.name INTO v_etapa_final
--     FROM public.crm_leads l JOIN public.crm_stages s ON s.id = l.stage_id WHERE l.id = v_lead;
--   rep := rep || format('(h) sdr_excluir_agendamento(B) devolveu: %s%s', v_ret::text, E'\n');
--   rep := rep || format('(h) entrega da consulta A sobreviveu: %s linha(s) — esperado 1%s', v_entrega_a, E'\n');
--   rep := rep || format('(h) etapa do lead depois de excluir B: "%s" — esperado NÃO ser "Conversando" (o paciente compareceu em A)%s',
--                        v_etapa_final, E'\n');
--
--   -- ======================= a Bia outra vez, para (c)
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', v_bia::text, 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   -- (c) DELETE de etapa criada por ela COM lead de outra pessoa dentro.
--   --     A contagem que a TELA faz aqui dá zero (a RLS dela não vê o lead da
--   --     colega); quem sabe a verdade é etapa_tem_lead, que é SECURITY DEFINER.
--   DELETE FROM public.crm_stages WHERE id = v_com_lead;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   rep := rep || format('(c) DELETE de etapa dela COM lead da colega: %s linha(s) — esperado 0%s', n, E'\n');
--
--   RESET ROLE;
--   PERFORM set_config('request.jwt.claims', '', true);
--   v_colega_viva := EXISTS (SELECT 1 FROM public.crm_leads WHERE id = v_lead_colega);
--   rep := rep || format('(c) o lead da colega continua vivo: %s — esperado sim%s', v_colega_viva, E'\n');
--
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;
--
-- LEITURA ESPERADA (o que reprova a migration, item por item):
--   (a) diferente de 0 linhas  → o CASCADE do Funil Principal está aberto de novo.
--   (b) diferente de 1 linha   → ela não consegue apagar a própria etapa vazia:
--                                o dono volta a reclamar de botão que não funciona.
--   (c) diferente de 0 linhas  → etapa_tem_lead não está vendo o lead da colega
--                                (provavelmente perdeu o SECURITY DEFINER).
--   (d) diferente de 0 linhas  → ela consegue destravar o próprio isolamento e
--                                passa a ver se o lead contratou.
--   (e)/(e2) diferente de 0    → renomear etapa canônica quebra o ciclo calado.
--   (f)/(g) sem criar, ou com created_by de outro, ou allowed_roles preenchido
--                              → o pedido do dono (CRIAR) não foi entregue.
--   (h) entrega de A com 0 linhas, ou etapa "Conversando"
--                              → C4 não pegou: o lead nunca chega ao
--                                administrador e o comparecimento de A some.
--
-- ------------------------------------------------------------------------------
-- O QUE ESTES ENSAIOS JÁ MEDIRAM (rodados em 10/09/2026, num Postgres 17 local
-- de rascunho com este esquema recortado — tabelas, gatilhos e policies que
-- importam —, NUNCA no banco do cliente):
--
--   com esta migration aplicada:
--     (a) 0 linha(s)   (b) 1 linha   (c) 0 linha(s) e o lead da colega vivo
--     (d) 0 linha(s)   (e) 0 linha(s)   (e2) recusado pelo WITH CHECK
--     (f) etapa criada, created_by dela, visivel_para_sdr = true
--     (g) funil criado, created_by dela, allowed_roles NULL
--     (h) entrega da consulta A intacta (1 linha) e o lead seguiu em "Agendado"
--
--   CONTROLE NEGATIVO — as MESMAS provas com as policies da rodada reprovada
--   (só as três de crm_stages voltaram ao corpo de 20260910130000):
--     (a) 1 linha  → a etapa "Conversando" do Funil Principal foi APAGADA
--     (e) 1 linha  → "Agendado" virou "Agendadinho" para todas as colegas
--     (e2) 1 linha → a etapa dela virou "Reagendar" e sequestrou o botão de reagendar
--     (c) 1 linha  → a etapa saiu E O LEAD DA COLEGA FOI COM ELA (o CASCADE)
--     (d) 0 linhas → esta já estava fechada, mas só pela policy de LEITURA
--                    (sdr_escopo_crm_stages_visiveis); agora é explícita também
--                    na escrita, que é onde ela precisa estar.
--   E, no mesmo esquema, para C4 e C5:
--     C4: o DELETE antigo ("WHERE lead_id = l.id") apagou 1 linha — a entrega da
--         consulta A — ao excluir a consulta B; o DELETE novo apagou 0.
--     C5: lead arrastado à mão para "Compareceu", com entrega sem consulta
--         casada e vencida: sdr_entregas_pendentes ENTREGOU (1) e não escreveu
--         nenhuma mensagem "Entrega ao administrador cancelada".
--   De brinde, o que o dono pediu continua de pé: a SDR CRIA disparo na etapa
--   canônica do Funil Principal (INSERT aceito), não altera nem apaga a
--   automação da clínica (0 e 0), e apaga a automação da etapa dela (1).

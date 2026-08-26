-- Excluir lead dizia "excluído" e o lead continuava lá.
--
-- Causa: a única permissão de DELETE em crm_leads exigia gerente ou superadmin
-- ("Managers can delete crm_leads"), e no Rizodent não existe usuário gerente —
-- então, na prática, só uma conta no sistema inteiro conseguia apagar. Quando a
-- RLS recusa, o PostgREST NÃO devolve erro: devolve sucesso com zero linhas
-- afetadas. A tela lia só o `error`, não via nenhum, e anunciava a exclusão.
--
-- Decisão do dono (26/08/2026): quem apaga é o crc e o closer, cada um dentro
-- do próprio mundo. Recepção e pós-venda continuam sem apagar.
--
-- CUIDADO ao mexer aqui: apagar um lead leva junto, em cascata, mensagens,
-- agendamentos, tarefas, notas, histórico de etapa e gravações de ligação.
-- Paciente e pagamento do closer sobrevivem (o vínculo vira nulo).

-- ------------------------------------------------------------ quem pode
-- Mesmas condições da LEITURA (pipeline, número e conta de Instagram): quem
-- alcança o lead na tela é quem pode apagá-lo. Sem isso, DELETE e SELECT
-- divergem — e um perfil apagaria o que nem enxerga, já que o Postgres avalia
-- as regras de leitura e de exclusão separadamente.
DROP POLICY IF EXISTS operacao_apaga_leads ON public.crm_leads;
CREATE POLICY operacao_apaga_leads ON public.crm_leads
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'closer'::app_role)
    )
    AND public.can_access_pipeline(pipeline_id)
    AND public.can_access_whatsapp_number(whatsapp_number_id)
    AND public.can_access_instagram_account(ig_account_uuid)
  );

-- --------------------------------------------------- o mundo do closer
-- Troca o bloqueio total por bloqueio de ESCOPO, na mesma forma da regra de
-- leitura `closer_number_scope_leads`. O `IS NOT NULL` é o que segura o mundo
-- legado: can_access_whatsapp_number(NULL) responde TRUE por definição, então
-- sem essa cláusula o closer alcançaria os leads do número principal.
DROP POLICY IF EXISTS closer_no_lead_delete ON public.crm_leads;
DROP POLICY IF EXISTS closer_number_scope_lead_delete ON public.crm_leads;
CREATE POLICY closer_number_scope_lead_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
    OR (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

-- `recepcao_no_lead_delete` fica como está: a recepção segue sem apagar lead.
-- O pós-venda também não apaga — simplesmente não entra na permissão acima.

-- ------------------------------------------- funil do pós-venda, no crc
-- A regra `hide_posvenda_leads` esconde esse funil do crc na LEITURA, mas vale
-- só para SELECT. Sem o espelho abaixo, o crc apagaria pelo id um lead que a
-- tela nunca mostrou a ele. Escrita mirando só o crc, para não alterar em nada
-- o que gerente e superadmin já podiam fazer.
DROP POLICY IF EXISTS hide_posvenda_lead_delete ON public.crm_leads;
CREATE POLICY hide_posvenda_lead_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'crc'::app_role))
    OR pipeline_id IS NULL
    OR NOT public.is_posvenda_pipeline(pipeline_id)
  );

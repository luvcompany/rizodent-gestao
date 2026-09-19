-- ============================================================================
-- CANCELADO CONTINUA SENDO AGENDAMENTO
--
-- Dono, 17/09/2026, conferindo o CRClin contra a planilha da gestão:
--   "Cancelados são pacientes que avisaram que não viriam mais, é diferente dos
--    pacientes que não comparecem. Conta ainda como agendamento. Os pacientes
--    que não comparecem eles geralmente não avisam que não vem, então as
--    meninas marcam como não compareceu (No-show). Os que avisam que não vem
--    são cancelados, caso eles não reagendem."
--
-- O relatório da SDR tirava TODA consulta cancelada da conta de "Agendamentos".
-- A planilha (conferida à mão e tratada como verdade) conta. Resultado: o
-- sistema mostrava menos agendamentos do que a gestão.
--
-- Régua nova de "Agendamentos" (a coorte continua pelo dia em que a SDR marcou):
--   • entra tudo que ela marcou no período;
--   • sai a consulta SUBSTITUÍDA por uma remarcação da mesma janela (já existia:
--     a mesma consulta não pode contar duas vezes);
--   • sai a consulta CANCELADA quando o paciente remarcou — quando existe, no
--     mesmo período, outra consulta do mesmo lead criada DEPOIS do cancelamento.
--     É exatamente o "caso eles não reagendem" do dono.
--   • a coluna "Cancelados" continua existindo, agora como recorte de dentro do
--     total, não como desconto.
--
-- Efeito medido em 11–17/09/2026 (período em que o rodízio distribui):
--   Bia 65 → 71, Kelly 15 → 16, Fabíola 3 → 3 (total 83 → 90).
--
-- A função é alterada NO LUGAR (pg_get_functiondef + replace com âncora
-- literal): relatorio_sdr_calc tem ~300 linhas e já sofreu ajustes em produção;
-- recolar uma cópia do repositório desfaria correções. Se a âncora não existir
-- mais, a migration FALHA em vez de gravar algo diferente do esperado.
-- ============================================================================

DO $apply$
DECLARE
  d text;
  alvo text := '             WHERE COALESCE(a.status, '''''''') <> ''''cancelled''''';
BEGIN
  d := pg_get_functiondef('public.relatorio_sdr_calc(uuid, date, date, uuid, boolean)'::regprocedure);

  -- O texto real dentro da definição (sem o escape duplo do bloco DO).
  alvo := 'WHERE COALESCE(a.status, '''') <> ''cancelled''';

  -- Já aplicada (o Lovable grava uma cópia desta migration com outro carimbo):
  -- rodar de novo não pode falhar nem trocar duas vezes.
  IF position('remarcada.created_at' IN d) > 0 THEN
    RETURN;
  END IF;

  IF position(alvo IN d) = 0 THEN
    RAISE EXCEPTION 'relatorio_sdr_calc: âncora de "cancelled" não encontrada — a função mudou; revise a migration antes de aplicar';
  END IF;

  d := replace(d, alvo,
    'WHERE NOT (
                     COALESCE(a.status, '''') = ''cancelled''
                 AND EXISTS (SELECT 1 FROM public.crm_appointments remarcada
                              WHERE remarcada.lead_id = a.lead_id
                                AND remarcada.id <> a.id
                                AND remarcada.created_at > COALESCE(a.outcome_at, a.updated_at)
                                AND remarcada.created_at >= (SELECT j.ini FROM janela j)
                                AND remarcada.created_at <  (SELECT j.fim FROM janela j))
               )');

  EXECUTE d;
END $apply$;

COMMENT ON FUNCTION public.relatorio_sdr_calc(uuid, date, date, uuid, boolean) IS
  'Relatório da SDR. Agendamentos = consultas marcadas no período (coorte por created_at), sem a linha substituída por remarcação e sem a cancelada que o paciente remarcou depois. Cancelada sem remarcação CONTA como agendamento (decisão do dono, 17/09/2026, para bater com a planilha da gestão).';
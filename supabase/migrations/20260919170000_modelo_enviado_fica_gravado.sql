-- ============================================================================
-- O BALÃO DO MODELO MOSTRA O QUE O PACIENTE RECEBEU — E NÃO MUDA MAIS
--
-- Dono, 19/09/2026 (mandou um modelo para si mesmo, remarcou a consulta e
-- recarregou a página):
--   "No crclin não aparece o dia da consulta como aparece para o cliente. [...]
--    quando eu mudo a data do agendamento e atualizo a página. Para o cliente
--    não muda a data, mas no crclin [...] atualiza os dados do modelo, o que
--    está completamente errado, deveria ficar fixo de acordo como chegou para
--    o cliente. [...] Isso deve estar acontecendo em outras variáveis também."
--
-- Causa: o chat (TemplateMessageBubble) remontava o texto a cada abertura, com
-- o NOME ATUAL do lead, a consulta mais próxima entre as que existem HOJE e o
-- texto ATUAL do modelo — num formato próprio ("21/09/2026 às 09:00") diferente
-- do que o servidor manda ("Segunda, 21/09 às 09:00").
--
-- Correção:
--   1. messages.template_snapshot — o servidor que envia (send-whatsapp-message)
--      grava, na própria mensagem, exatamente o texto que foi para a Meta. Só o
--      servidor escreve nela (gatilho abaixo).
--   2. mensagens_template_historico — para as ~91 mil mensagens antigas, um
--      registro RECONSTRUÍDO uma única vez, "como era no dia do envio", com o
--      grau de certeza marcado. Tabela separada de propósito: reescrever 91 mil
--      linhas de `messages` mandaria 91 mil eventos de Realtime às telas abertas.
--   3. A tela nunca mais remonta com dados de hoje.
--
-- Como a data ({{2}}) das mensagens antigas é reconstruída — medido contra as
-- notas do próprio chat antes de aplicar (revisão adversarial, 34 revisores):
--   • desde 17/08/2026 14:46 UTC existe auditoria de crm_appointments: a
--     consulta entra no estado exato em que estava no envio;
--   • antes disso, vale a nota que o chat grava a cada agendamento
--     ("✅ Agendamento confirmado: 26/05/2026 às 09:00", "📅 Agendamento
--     atualizado", "✅ Reagendamento confirmado", "🔁 Consulta remarcada de … para
--     …"), desde que a data seja do dia do envio em diante e nada tenha encerrado
--     a consulta entre a nota e o envio — e respeitando a regra da época: se
--     outra consulta mais antiga ainda estava pendente, a data enviada foi a
--     dela. Sem como decidir, "[data não registrada]" — nunca uma data inventada. A primeira versão desta migration usava a consulta como está
--     HOJE e teria congelado "data a confirmar" em ~1.465 balões errados.
--   • regra de escolha e formato da época: até 19/09/2026 15h04 UTC, a consulta
--     pendente de data mais antiga e "19/09/2026 às 09:00"; depois, a próxima
--     consulta e "Sábado, 19/09 às 09:00".
--   • {{1}} (nome): o nome gravado na consulta da época; sem consulta, o nome de
--     hoje (não existe histórico de nome) — a tela avisa.
-- ============================================================================

-- ----------------------------------------------------------------- 1. a coluna
-- Coluna nula sem default: só metadado, não reescreve a tabela.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS template_snapshot jsonb;

COMMENT ON COLUMN public.messages.template_snapshot IS
  'Modelo do WhatsApp como FOI ENVIADO (nome, cabeçalho com o link enviado, corpo com as variáveis preenchidas, rodapé, botões, parâmetros). Gravado por send-whatsapp-message no envio; a tela mostra isto e nunca remonta com dados atuais. Usuário comum não escreve nesta coluna.';

-- O registro vale como prova do que foi enviado: quem está logado no app (a
-- policy de messages deixa qualquer usuário do tenant fazer UPDATE) não pode
-- criar nem alterar. Só o servidor (service_role) e funções do banco escrevem.
-- Sem SECURITY DEFINER de propósito: current_user tem de ser quem chamou.
CREATE OR REPLACE FUNCTION public.messages_template_snapshot_so_servidor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.template_snapshot := NULL;
    ELSIF NEW.template_snapshot IS DISTINCT FROM OLD.template_snapshot THEN
      RAISE EXCEPTION 'O registro do modelo enviado não pode ser alterado.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- WHEN / UPDATE OF: o webhook do WhatsApp insere sem esta coluna e só atualiza
-- status — nenhum dos dois gatilhos dispara para ele.
DROP TRIGGER IF EXISTS trg_messages_template_snapshot_insert ON public.messages;
CREATE TRIGGER trg_messages_template_snapshot_insert
BEFORE INSERT ON public.messages
FOR EACH ROW WHEN (NEW.template_snapshot IS NOT NULL)
EXECUTE FUNCTION public.messages_template_snapshot_so_servidor();

DROP TRIGGER IF EXISTS trg_messages_template_snapshot_update ON public.messages;
CREATE TRIGGER trg_messages_template_snapshot_update
BEFORE UPDATE OF template_snapshot ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_template_snapshot_so_servidor();

-- --------------------------------------------------------- 2. o histórico
-- Sem chave estrangeira para messages, de propósito: apagar um lead apaga as
-- mensagens (CASCADE) e restore_deleted_lead as devolve com o MESMO id — o
-- registro sobrevive e volta a valer. Enquanto a mensagem não existe, a policy
-- abaixo esconde a linha.
CREATE TABLE IF NOT EXISTS public.mensagens_template_historico (
  message_id uuid PRIMARY KEY,
  tenant_id  uuid,
  snapshot   jsonb NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mensagens_template_historico IS
  'Texto reconstruído (uma vez, em 19/09/2026) dos modelos enviados antes de messages.template_snapshot existir, com o grau de certeza (data_certeza). Congelado: não muda quando a consulta, o lead ou o modelo mudam.';

ALTER TABLE public.mensagens_template_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mensagens_template_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mensagens_template_historico TO authenticated;
GRANT ALL ON TABLE public.mensagens_template_historico TO service_role;

-- Quem vê a mensagem vê o registro dela — e só ela. A subconsulta passa pela
-- RLS de `messages` de quem pergunta (tenant, número/mundo, dona do lead da SDR).
DROP POLICY IF EXISTS historico_modelo_quem_ve_a_mensagem ON public.mensagens_template_historico;
CREATE POLICY historico_modelo_quem_ve_a_mensagem
  ON public.mensagens_template_historico
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = mensagens_template_historico.message_id));

-- ------------------------------------------------------- 3. a reconstrução

-- Formato de {{2}} de 14/04/2026 até 19/09/2026 15h04 UTC.
CREATE OR REPLACE FUNCTION public.modelo_data_formato_antigo(p_data date, p_hora time)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT to_char(p_data, 'DD/MM/YYYY') || COALESCE(' às ' || to_char(p_hora, 'HH24:MI'), '');
$function$;

-- Formato de {{2}} de 19/09/2026 15h04 UTC até o registro no envio existir.
CREATE OR REPLACE FUNCTION public.modelo_data_formato_semana(p_data date, p_hora time)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT (ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])[extract(dow FROM p_data)::int + 1]
         || ', ' || to_char(p_data, 'DD/MM') || COALESCE(' às ' || to_char(p_hora, 'HH24:MI'), '');
$function$;

-- Reconstrói o que o servidor montou para UMA mensagem antiga. Espelha
-- send-whatsapp-message: variáveis por posição — 1 nome, 2 data, 3 serviço,
-- 4 telefone, 5 origem (buildTemplateFallbacks), da 6ª em diante o nome.
-- data_certeza: 'auditoria' | 'nota' | 'sem_consulta' | 'desconhecida'.
CREATE OR REPLACE FUNCTION public.modelo_reconstroi_snapshot(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  m record; l record;
  v_nome_modelo text; v_header_type text; v_header_content text; v_corpo text; v_rodape text; v_botoes jsonb;
  v_do_log boolean := false; v_log jsonb;
  v_idx int[]; v_params text[] := '{}';
  v_T timestamptz; v_dia_T date; v_semana boolean; v_auditoria timestamptz;
  v_data text; v_d date; v_h time; v_nome_consulta text; v_certeza text;
  v_nota_em timestamptz; v_nota_txt text; v_mt text[]; v_interrompida boolean;
  v_outra record; v_pendente boolean; v_incerta boolean := false; v_nome_antigo text;
  v_nome text; v_servico text; v_tel text; v_origem text; i int;
  c_corte constant timestamptz := '2026-09-19 15:04:00+00';
BEGIN
  SELECT id, lead_id, tenant_id, whatsapp_number_id, created_at, content INTO m
    FROM public.messages WHERE id = p_message_id;
  IF NOT FOUND OR m.content IS NULL OR m.content NOT LIKE '📋 Template: %' THEN RETURN NULL; END IF;
  v_nome_modelo := btrim(substr(m.content, length('📋 Template: ') + 1));
  v_T := m.created_at;

  -- O modelo: o do cadastro (mesmo tenant, preferindo o do mesmo número); se foi
  -- apagado, o texto que o CRClin mandou à Meta ao criá-lo (whatsapp_template_logs).
  SELECT tt.header_type, tt.header_content, tt.body_text, tt.footer_text, tt.buttons
    INTO v_header_type, v_header_content, v_corpo, v_rodape, v_botoes
    FROM public.crm_whatsapp_templates tt
   WHERE tt.name = v_nome_modelo
     AND (m.tenant_id IS NULL OR tt.tenant_id = m.tenant_id)
   ORDER BY (tt.whatsapp_number_id IS NOT DISTINCT FROM m.whatsapp_number_id) DESC, tt.updated_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT g.request_payload INTO v_log
      FROM public.whatsapp_template_logs g
     WHERE g.action = 'create_request' AND g.template_name = v_nome_modelo
       AND (m.tenant_id IS NULL OR g.tenant_id = m.tenant_id)
       AND g.created_at <= v_T
     ORDER BY g.created_at DESC LIMIT 1;
    IF v_log IS NULL THEN
      RETURN jsonb_build_object('v', 1, 'origem', 'sem_modelo', 'nome', v_nome_modelo);
    END IF;
    v_do_log := true;
    SELECT c ->> 'text' INTO v_corpo FROM jsonb_array_elements(v_log -> 'components') c WHERE upper(c ->> 'type') = 'BODY' LIMIT 1;
    SELECT c ->> 'text' INTO v_rodape FROM jsonb_array_elements(v_log -> 'components') c WHERE upper(c ->> 'type') = 'FOOTER' LIMIT 1;
    SELECT c -> 'buttons' INTO v_botoes FROM jsonb_array_elements(v_log -> 'components') c WHERE upper(c ->> 'type') = 'BUTTONS' LIMIT 1;
    SELECT upper(c ->> 'format'), CASE WHEN upper(c ->> 'format') = 'TEXT' THEN c ->> 'text' END
      INTO v_header_type, v_header_content
      FROM jsonb_array_elements(v_log -> 'components') c WHERE upper(c ->> 'type') = 'HEADER' LIMIT 1;
  END IF;

  v_corpo := COALESCE(v_corpo, '');
  SELECT array_agg(DISTINCT x.n ORDER BY x.n) INTO v_idx
    FROM (SELECT (regexp_matches(v_corpo, '\{\{\s*(\d+)\s*\}\}', 'g'))[1]::int AS n) x;

  IF v_idx IS NOT NULL THEN
    SELECT ld.name, ld.servico_interesse, ld.phone, ld.source INTO l FROM public.crm_leads ld WHERE ld.id = m.lead_id;
    v_dia_T := (v_T AT TIME ZONE 'America/Bahia')::date;
    v_semana := v_T >= c_corte;
    SELECT min(changed_at) INTO v_auditoria FROM public.crm_appointments_audit;

    IF v_auditoria IS NOT NULL AND v_T >= v_auditoria THEN
      -- ---- Desde a auditoria: o estado exato de cada consulta no envio.
      -- Estado no envio = old_row da 1ª alteração depois do envio (UPDATE ou
      -- DELETE); sem alteração depois, a linha de hoje. Consultas apagadas
      -- depois do envio entram pelo old_row do DELETE.
      WITH ap AS (
        SELECT a.id AS aid, a.created_at AS criada, to_jsonb(a) AS agora
          FROM public.crm_appointments a WHERE a.lead_id = m.lead_id
        UNION ALL
        SELECT x.appointment_id, (x.old_row ->> 'created_at')::timestamptz, x.old_row
          FROM public.crm_appointments_audit x
         WHERE x.action = 'DELETE' AND x.changed_at > v_T
           AND (x.old_row ->> 'lead_id')::uuid = m.lead_id
      ), estado AS (
        SELECT COALESCE(
                 (SELECT x.old_row FROM public.crm_appointments_audit x
                   WHERE x.appointment_id = ap.aid AND x.action IN ('UPDATE', 'DELETE') AND x.changed_at > v_T
                   ORDER BY x.changed_at, x.id LIMIT 1),
                 ap.agora) AS r,
               COALESCE((SELECT min(x.changed_at) FROM public.crm_appointments_audit x
                          WHERE x.appointment_id = ap.aid AND x.action = 'INSERT'), ap.criada) AS nasceu
          FROM ap
      ), vivas AS (
        SELECT (r ->> 'scheduled_date')::date AS d, (r ->> 'scheduled_time')::time AS h, r ->> 'lead_name' AS nome_da_consulta
          FROM estado
         WHERE nasceu <= v_T AND r ->> 'status' IN ('confirmed', 'pending') AND r ->> 'scheduled_date' IS NOT NULL
      ), ordenadas AS (
        SELECT d, h, nome_da_consulta, row_number() OVER (ORDER BY d, h NULLS LAST) AS ordem, count(*) OVER () AS total
          FROM vivas
      )
      SELECT o.d, o.h, o.nome_da_consulta INTO v_d, v_h, v_nome_consulta
        FROM ordenadas o
       WHERE CASE WHEN v_semana
                  -- regra desde 19/09: a próxima (hoje em diante); sem ela, a última
                  THEN o.ordem = COALESCE((SELECT min(ordem) FROM ordenadas WHERE d >= v_dia_T), o.total)
                  -- regra até 19/09: a pendente de data mais antiga
                  ELSE o.ordem = 1 END
       LIMIT 1;
      v_certeza := 'auditoria';
      IF v_d IS NULL THEN v_data := 'data a confirmar'; END IF;

    ELSE
      -- ---- Antes da auditoria: a última nota de agendamento do chat antes do envio.
      SELECT n.created_at, n.content INTO v_nota_em, v_nota_txt
        FROM public.messages n
       WHERE n.lead_id = m.lead_id AND n.type = 'system' AND n.created_at <= v_T
         AND (n.content LIKE '✅ Agendamento confirmado:%' OR n.content LIKE '📅 Agendamento atualizado:%'
              OR n.content LIKE '✅ Reagendamento confirmado:%' OR n.content LIKE '🔁 Consulta remarcada de%')
       ORDER BY n.created_at DESC LIMIT 1;

      IF v_nota_em IS NOT NULL THEN
        -- a data no FIM da nota ("… para 22/09/2026 às 09:00" na remarcação)
        v_mt := regexp_match(v_nota_txt, '(\d{2}/\d{2}/\d{4})(?: às (\d{2}:\d{2}))?\s*$');
        v_d := to_date(v_mt[1], 'DD/MM/YYYY');
        v_h := CASE WHEN v_mt[2] IS NOT NULL THEN v_mt[2]::time END;
        -- a consulta foi encerrada/cancelada entre a nota e o envio?
        v_interrompida := EXISTS (
          SELECT 1 FROM public.messages i
           WHERE i.lead_id = m.lead_id AND i.type = 'system' AND i.created_at > v_nota_em AND i.created_at < v_T
             AND (i.content LIKE '🚫 Marcado como%' OR i.content LIKE '❌ Marcado como%' OR i.content LIKE '🤝 Marcado como%'
                  OR i.content LIKE '🗓️ Agendamento cancelado%' OR i.content LIKE '❌ Agendamento cancelado%'
                  OR i.content LIKE '✅ Compareceu%' OR i.content LIKE '📅 Compareceu e agendou%'));
      END IF;

      IF v_d IS NOT NULL AND v_d >= v_dia_T AND NOT COALESCE(v_interrompida, false) THEN
        -- Regra da época: o servidor mandava a consulta PENDENTE de data mais
        -- antiga. Outra consulta anterior à da nota que ainda estava pendente no
        -- envio teria sido a escolhida. Pendente no envio = pendente hoje, ou o
        -- 1º desfecho registrado no chat depois de ela nascer veio depois do envio.
        -- Sem como decidir → não inventa: "[data não registrada]".
        FOR v_outra IN
          SELECT a.scheduled_date AS d, a.scheduled_time AS h, a.status, a.created_at, a.updated_at
            FROM public.crm_appointments a
           WHERE a.lead_id = m.lead_id AND a.created_at <= v_T
             AND (a.scheduled_date, COALESCE(a.scheduled_time, time '00:00')) < (v_d, COALESCE(v_h, time '23:59'))
           ORDER BY a.scheduled_date, a.scheduled_time NULLS LAST
        LOOP
          IF v_outra.status IN ('confirmed', 'pending') THEN
            v_pendente := true;
          ELSIF v_outra.updated_at <= v_T THEN
            -- a linha não mudou desde antes do envio: o desfecho já estava lá
            v_pendente := false;
          ELSE
            SELECT CASE WHEN min(o.created_at) IS NULL THEN NULL ELSE min(o.created_at) > v_T END INTO v_pendente
              FROM public.messages o
             WHERE o.lead_id = m.lead_id AND o.type = 'system' AND o.created_at > v_outra.created_at
               AND (o.content LIKE '🚫 Marcado como%' OR o.content LIKE '❌ Marcado como%' OR o.content LIKE '🤝 Marcado como%'
                    OR o.content LIKE '🗓️ Agendamento cancelado%' OR o.content LIKE '❌ Agendamento cancelado%'
                    OR o.content LIKE '✅ Compareceu%' OR o.content LIKE '📅 Compareceu e agendou%'
                    OR o.content LIKE '🔁 Consulta remarcada de%' OR o.content LIKE '✅ Reagendamento confirmado:%');
          END IF;
          IF v_pendente IS NULL THEN v_incerta := true; EXIT; END IF;
          IF v_pendente THEN v_d := v_outra.d; v_h := v_outra.h; EXIT; END IF;
        END LOOP;
        v_certeza := CASE WHEN v_incerta THEN 'desconhecida' ELSE 'nota' END;
        IF v_incerta THEN v_d := NULL; v_data := '[data não registrada]'; END IF;
      ELSIF v_nota_em IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = m.lead_id AND a.created_at <= v_T) THEN
        -- não existia consulta nenhuma: o servidor mandou "data a confirmar"
        v_d := NULL; v_data := 'data a confirmar'; v_certeza := 'sem_consulta';
      ELSE
        -- não dá para saber: nunca inventar uma data
        v_d := NULL; v_data := '[data não registrada]'; v_certeza := 'desconhecida';
      END IF;
    END IF;

    IF v_d IS NOT NULL THEN
      v_data := CASE WHEN v_semana THEN public.modelo_data_formato_semana(v_d, v_h)
                     ELSE public.modelo_data_formato_antigo(v_d, v_h) END;
    END IF;

    IF v_certeza <> 'auditoria' THEN
      -- Antes da auditoria não há nome da época: crm_appointments.lead_name é
      -- regravado a cada renomeação (gatilho sync_appt_lead_snapshot). O mais
      -- perto do envio é o nome antes da 1ª renomeação auditada; senão, o atual.
      -- Em ambos os casos a tela avisa "nome do cadastro atual".
      v_nome_consulta := NULL;
      SELECT x.old_row ->> 'lead_name' INTO v_nome_antigo
        FROM public.crm_appointments_audit x
        JOIN public.crm_appointments a ON a.id = x.appointment_id
       WHERE a.lead_id = m.lead_id AND x.action = 'UPDATE' AND x.changed_at > v_T
         AND (x.old_row ->> 'lead_name') IS DISTINCT FROM (x.new_row ->> 'lead_name')
       ORDER BY x.changed_at LIMIT 1;
    END IF;
    v_nome    := COALESCE(NULLIF(btrim(v_nome_consulta), ''), NULLIF(btrim(v_nome_antigo), ''), NULLIF(btrim(l.name), ''), 'cliente');
    v_servico := COALESCE(NULLIF(btrim(l.servico_interesse), ''), 'consulta');
    v_tel     := COALESCE(NULLIF(btrim(l.phone), ''), v_nome);
    v_origem  := COALESCE(NULLIF(btrim(l.source), ''), v_nome);

    FOR i IN 1 .. array_length(v_idx, 1) LOOP
      v_params := v_params || CASE i WHEN 1 THEN v_nome WHEN 2 THEN v_data WHEN 3 THEN v_servico
                                     WHEN 4 THEN v_tel WHEN 5 THEN v_origem ELSE v_nome END;
      -- replace() é literal: nenhum caractere do valor vira padrão.
      v_corpo := replace(v_corpo, '{{' || v_idx[i] || '}}', v_params[i]);
      -- Variantes com espaço ("{{ 2 }}"): na substituição do regexp_replace só a
      -- barra invertida é especial (\1, \&), então é a única escapada.
      v_corpo := regexp_replace(v_corpo, '\{\{\s+' || v_idx[i] || '\s*\}\}|\{\{' || v_idx[i] || '\s+\}\}',
                                replace(v_params[i], '\', '\\'), 'g');
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'v', 1,
    'origem', 'reconstruido',
    'nome', v_nome_modelo,
    'header_type', v_header_type,
    'header_content', v_header_content,
    'body', v_corpo,
    'footer', v_rodape,
    'buttons', v_botoes,
    'params', to_jsonb(v_params),
    'variaveis_reconstruidas', v_idx IS NOT NULL,
    'data_certeza', v_certeza,
    'nome_da_epoca', v_nome_consulta IS NOT NULL,
    'modelo_do_log', v_do_log
  );
END $function$;

-- Um lote da reconstrução. Mais recentes primeiro (são as que a equipe abre).
-- Uma mensagem que falha não trava as outras nem volta à fila. O cron só se
-- desliga quando não sobra nada E a função nova de envio já está gravando o
-- registro (prova: existe mensagem com template_snapshot) — antes disso, as
-- mensagens que a função antiga ainda envia continuam entrando aqui.
CREATE OR REPLACE FUNCTION public.modelo_snapshots_historico_lote(p_limite integer DEFAULT 3000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; v_snap jsonb; n integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('modelo_snapshots_historico')) THEN RETURN 0; END IF;

  FOR r IN
    SELECT ms.id, ms.tenant_id
      FROM public.messages ms
     WHERE ms.content LIKE '📋 Template: %'
       AND ms.template_snapshot IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.mensagens_template_historico h WHERE h.message_id = ms.id)
     ORDER BY ms.created_at DESC
     LIMIT p_limite
  LOOP
    BEGIN
      v_snap := COALESCE(public.modelo_reconstroi_snapshot(r.id), jsonb_build_object('v', 1, 'origem', 'sem_modelo'));
    EXCEPTION WHEN OTHERS THEN
      v_snap := jsonb_build_object('v', 1, 'origem', 'erro', 'detalhe', left(SQLERRM, 200));
    END;
    INSERT INTO public.mensagens_template_historico (message_id, tenant_id, snapshot)
    VALUES (r.id, r.tenant_id, v_snap)
    ON CONFLICT (message_id) DO NOTHING;
    n := n + 1;
  END LOOP;

  IF n = 0 AND EXISTS (SELECT 1 FROM public.messages WHERE template_snapshot ->> 'origem' = 'envio') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'modelo-snapshots-historico';
  END IF;
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.messages_template_snapshot_so_servidor()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.modelo_data_formato_antigo(date, time)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.modelo_data_formato_semana(date, time)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.modelo_reconstroi_snapshot(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.modelo_snapshots_historico_lote(integer)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.modelo_snapshots_historico_lote(integer) TO service_role;

-- ------------------------------------------- 4. lead apagado e restaurado
-- restore_deleted_lead devolve as mensagens do backup (que já guarda a linha
-- inteira, com template_snapshot), mas listava as colunas uma a uma — a nova
-- ficava de fora. Alteração no lugar, com âncora: se a função mudou, falha.
DO $apply$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.restore_deleted_lead(uuid)'::regprocedure);
  IF position('template_snapshot' IN d) > 0 THEN
    RETURN;  -- já aplicada
  END IF;
  IF position('instagram_sender_id, whatsapp_number_id' IN d) = 0
     OR position('NULLIF(v_msg->>''whatsapp_number_id'','''')::uuid' IN d) = 0 THEN
    RAISE EXCEPTION 'restore_deleted_lead mudou: âncoras de messages não encontradas — revise antes de aplicar';
  END IF;
  d := replace(d, 'instagram_sender_id, whatsapp_number_id',
                  'instagram_sender_id, whatsapp_number_id, template_snapshot');
  d := replace(d, 'NULLIF(v_msg->>''whatsapp_number_id'','''')::uuid',
                  'NULLIF(v_msg->>''whatsapp_number_id'','''')::uuid,' || chr(10)
                  || '        CASE WHEN jsonb_typeof(v_msg->''template_snapshot'') = ''object'' THEN v_msg->''template_snapshot'' END');
  EXECUTE d;
END $apply$;

-- A reconstrução roda sozinha, um lote por minuto, e se desliga ao terminar.
SELECT cron.schedule('modelo-snapshots-historico', '* * * * *',
                     'SELECT public.modelo_snapshots_historico_lote(3000);');

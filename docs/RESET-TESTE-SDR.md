# Reset dos dados de teste do rodízio (Bia)

Executar SÓ quando o dono disser "pode resetar". Apaga o rastro dos testes de
09/09/2026 e devolve os leads ao administrador, sem apagar a conta da Bia.

O que o reset faz, nesta ordem:

1. Devolve ao administrador (`rizodentvca2`, `d9b27aa3-…`) todos os leads que
   hoje são da Bia ou estão reservados para ela: `assigned_to` = administrador,
   `distribuido_em` = NULL, `rodizio_reservado_para/_em` = NULL,
   `conversa_fechada_em/por` = NULL.
2. Apaga as mensagens de sistema do rodízio nesses chats ("🔀 Lead
   distribuído…", "🔀 … realocado…", "Conversa fechada…").
3. Apaga as linhas do livro (`crm_lead_atribuicoes`) em que a Bia é origem ou
   destino, inclusive as anotações de sombra.
4. Apaga os eventos de ponto da Bia (`crm_ponto_eventos`), as notificações
   dela (`crm_notifications`) e as respostas de pesquisa ligadas a ela.
5. Zera o ponteiro do rodízio (`crm_rodizio_config.ponteiro_user_id` = NULL).
6. Reativa a troca obrigatória de senha (`profiles.must_change_password = true`)
   e zera `last_login_at`, para a conta voltar ao estado de recém-criada.

O reset NÃO apaga a conta, NÃO tira a Bia do rodízio e NÃO muda o modo.

```sql
-- Prompt para o agente do Lovable (com a autorização literal do dono):
DO $reset$
DECLARE
  v_bia uuid := (SELECT id FROM public.profiles WHERE email = 'bia.rizodent@gmail.com');
  v_admin uuid := 'd9b27aa3-049e-4ec9-9ae3-fb160a9544fa';
  v_leads uuid[];
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_leads FROM public.crm_leads
   WHERE assigned_to = v_bia OR rodizio_reservado_para = v_bia;

  SET LOCAL session_replication_role = 'replica'; -- gatilhos-guarda do rodízio/SDR não disparam no reset
  UPDATE public.crm_leads
     SET assigned_to = v_admin, distribuido_em = NULL, rodizio_reservado_para = NULL,
         rodizio_reservado_em = NULL, conversa_fechada_em = NULL, conversa_fechada_por = NULL
   WHERE id = ANY(v_leads);
  SET LOCAL session_replication_role = 'origin';

  DELETE FROM public.messages
   WHERE lead_id = ANY(v_leads) AND type = 'system'
     AND (content LIKE '🔀%' OR content ILIKE '%conversa fechada%' OR content ILIKE '%pelo rodízio%');
  DELETE FROM public.crm_lead_atribuicoes WHERE de_user_id = v_bia OR para_user_id = v_bia;
  DELETE FROM public.crm_ponto_eventos WHERE user_id = v_bia;
  DELETE FROM public.crm_notifications WHERE user_id = v_bia;
  DELETE FROM public.crm_pesquisa_respostas WHERE responsavel_credito_id = v_bia;
  UPDATE public.crm_rodizio_config SET ponteiro_user_id = NULL WHERE ponteiro_user_id = v_bia;
  UPDATE public.profiles SET must_change_password = true, last_login_at = NULL WHERE id = v_bia;
END $reset$;
```

Conferência depois: `SELECT count(*) FROM crm_leads WHERE assigned_to = <bia>`
= 0; `SELECT count(*) FROM crm_ponto_eventos WHERE user_id = <bia>` = 0;
`SELECT count(*) FROM crm_lead_atribuicoes WHERE para_user_id = <bia>` = 0.

Atenção: se o dono também quiser apagar as MENSAGENS de teste trocadas com o
número dele (lead Vitor Santos), isso é apagar mensagem de conversa — pedir
confirmação separada, porque não é reversível.

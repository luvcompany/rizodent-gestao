-- ============================================================================
-- HARDENING 3/3 — Isolamento entre CLIENTES garantido por baixo, de uma vez.
-- ============================================================================
-- Este é o item que o produto precisa para ser vendido a várias clínicas.
--
-- Achado da auditoria: dezenas de tabelas têm policies PERMISSIVE do tipo
-- "auth.uid() IS NOT NULL" (basta estar logado) para UPDATE/DELETE — e policies
-- permissivas se somam por OR. Ou seja, um usuário do cliente A conseguia
-- alterar agendamentos, tarefas, transmissões e notas do cliente B.
--
-- Em vez de caçar policy por policy (e esquecer alguma na próxima), criamos uma
-- policy RESTRICTIVE de cliente em TODA tabela que tenha tenant_id. RESTRICTIVE
-- entra por AND: nenhuma policy permissiva — nem as futuras — consegue furar.
--
-- Não afeta: service_role (edge functions/crons ignoram RLS) e superadmin.
-- ============================================================================

-- 1) Linhas órfãs (tenant_id nulo) antes de exigir o vínculo — senão sumiriam.
--    Derivadas do dono real de cada linha, nunca chutadas.
UPDATE public.crm_user_labels l
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE l.tenant_id IS NULL AND p.id = l.user_id;

UPDATE public.access_logs a
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE a.tenant_id IS NULL AND p.id = a.user_id;

UPDATE public.instagram_messages m
   SET tenant_id = l.tenant_id
  FROM public.crm_leads l
 WHERE m.tenant_id IS NULL AND l.id = m.lead_id;

-- 1b) Tabelas com tenant_id que NÃO têm trigger nem default para preenchê-lo:
--     sem isto o WITH CHECK abaixo avaliaria NULL = uuid → NULL → nega, e criar
--     etiqueta deixaria de funcionar para crc, gerente, posvenda e recepção.
--     (useLeadLabels.tsx insere sem tenant_id.)
ALTER TABLE public.crm_user_labels ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

-- 2) A trava estrutural.
DO $$
DECLARE
  r record;
  pol text;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.column_name = 'tenant_id'
       AND c.table_schema = 'public'
       -- `tenants` é a própria tabela de clientes (id, não tenant_id) e
       -- `profiles` precisa continuar legível no login, antes do tenant resolver.
       AND c.table_name NOT IN ('tenants', 'profiles')
  LOOP
    pol := 'tenant_hard_isolation_' || r.table_name;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, r.table_name);
    -- USING vale para SELECT/UPDATE/DELETE; WITH CHECK impede gravar em cliente
    -- alheio. Linha com tenant_id nulo fica invisível de propósito: dado sem
    -- dono não pertence a ninguém.
    -- (SELECT ...) é obrigatório aqui: sem ele o OR impede o uso do índice de
    -- tenant_id e a função passa a ser chamada por linha — medido na `messages`
    -- (159 mil linhas): 0,17 ms com InitPlan contra 2.799 ms sem. Afetaria
    -- TODOS os papéis em todas as tabelas.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (tenant_id = (SELECT public.current_tenant_id()) '
      || '       OR (SELECT public.has_role(auth.uid(), ''superadmin''::app_role))) '
      || 'WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) '
      || '       OR (SELECT public.has_role(auth.uid(), ''superadmin''::app_role)))',
      pol, r.table_name);
  END LOOP;
END $$;

-- 3) Segredos que estavam legíveis por qualquer pessoa logada do cliente.
--    (a) Token do Instagram: mesma proteção por coluna já usada em
--        whatsapp_numbers — quem opera o app não precisa ler credencial.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='ig_accounts' AND column_name='access_token') THEN
    EXECUTE 'REVOKE SELECT ON public.ig_accounts FROM anon, authenticated';
    -- `active` e `cidade` são lidas pelo chat e pela tela de Integrações: sem elas
    -- no GRANT, a lista de contas do Instagram quebra com erro 42501 para crc,
    -- gerente e pós-venda. Só o access_token e o token_expires_at ficam de fora.
    EXECUTE 'GRANT SELECT (id, tenant_id, ig_user_id, username, active, cidade, created_at, updated_at) ON public.ig_accounts TO authenticated';
  END IF;
END $$;

--    (b) integrations guarda access_token da Meta em `config` (jsonb) — não dá
--        para esconder por coluna. A tabela inteira sai do alcance do app:
--        quem precisa dela são as edge functions (service_role) e o crc. A tela
--        de Integrações lê a tabela direto e continua funcionando para o crc —
--        gerente e pós-venda já hoje a abrem vazia, porque as policies
--        permissivas atuais já exigem crc. Não há regressão.
DROP POLICY IF EXISTS integrations_sem_segredo_no_app ON public.integrations;
CREATE POLICY integrations_sem_segredo_no_app ON public.integrations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::app_role)
         OR public.has_role(auth.uid(), 'crc'::app_role));

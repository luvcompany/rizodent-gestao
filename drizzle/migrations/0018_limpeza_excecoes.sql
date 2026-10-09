-- Exceções de acesso por usuário (user_permission_overrides): limpeza e
-- integridade (09/10/2026). Cópia antes da limpeza em
-- public._backup_overrides_20261009.
--
-- 1) Exceções de usuários que não existem mais (28) e de funis apagados (11):
--    sobras de contas excluídas e funis removidos, sem efeito nenhum além de
--    confundir a tela de permissões.
-- 2) As 18 exceções de número que só repetiam a regra da equipe — gravadas
--    pelos gatilhos antigos de "conceder número". Desde a 0014 quem usa um
--    número é decidido pela equipe dele; exceção de número passa a ser só a que
--    o superadmin cria de propósito. Deixá-las aqui faria uma SDR promovida a
--    closer continuar vendo os números da central.
-- 3) Integridade: exceção morre com o usuário (FK com CASCADE) e com o
--    recurso (funil, conta do Instagram, número) — sem órfãos daqui em diante.

DELETE FROM public.user_permission_overrides o
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.user_id);

DELETE FROM public.user_permission_overrides o
 WHERE o.scope = 'pipeline'
   AND NOT EXISTS (SELECT 1 FROM public.crm_pipelines p WHERE p.id::text = o.resource_id);

DELETE FROM public.user_permission_overrides o
 USING public.whatsapp_numbers w
 WHERE o.scope = 'whatsapp_number'
   AND w.id::text = o.resource_id
   AND o.granted
   AND (
         EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = o.user_id AND ur.role IN ('superadmin', 'gerente'))
      OR (COALESCE(w.mundo, 'crc') = 'crc'
          AND EXISTS (SELECT 1 FROM public.user_roles ur
                       WHERE ur.user_id = o.user_id AND ur.role IN ('crc', 'sdr', 'crc_legacy', 'posvenda')))
      OR (w.mundo IN ('closer', 'recepcao')
          AND (w.dono_user_id = o.user_id
               OR (w.dono_user_id IS NULL
                   AND EXISTS (SELECT 1 FROM public.user_roles ur
                                WHERE ur.user_id = o.user_id AND ur.role::text = w.mundo))))
       );

ALTER TABLE public.user_permission_overrides
  ADD CONSTRAINT user_permission_overrides_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.apaga_excecoes_do_recurso()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.user_permission_overrides
   WHERE scope = TG_ARGV[0] AND resource_id = OLD.id::text;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.apaga_excecoes_do_recurso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apaga_excecoes_funil ON public.crm_pipelines;
CREATE TRIGGER trg_apaga_excecoes_funil AFTER DELETE ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.apaga_excecoes_do_recurso('pipeline');
DROP TRIGGER IF EXISTS trg_apaga_excecoes_instagram ON public.ig_accounts;
CREATE TRIGGER trg_apaga_excecoes_instagram AFTER DELETE ON public.ig_accounts
  FOR EACH ROW EXECUTE FUNCTION public.apaga_excecoes_do_recurso('instagram_account');
DROP TRIGGER IF EXISTS trg_apaga_excecoes_numero ON public.whatsapp_numbers;
CREATE TRIGGER trg_apaga_excecoes_numero AFTER DELETE ON public.whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.apaga_excecoes_do_recurso('whatsapp_number');

# Erro ao mover lead de etapa (SDRs) + auditoria das funções da SDR

## Causa (confirmada no banco)
Toda vez que um lead da RizoDent **sem cidade preenchida** é salvo (mover de etapa, editar, etc.), o sistema tenta descobrir a cidade pelo anúncio. Essa função de "descobrir cidade" ficou bloqueada para usuários logados no endurecimento de segurança, então a gravação inteira falha. Os leads das SDRs costumam ainda não ter cidade, por isso elas sentem mais. Para quem tem cidade preenchida o erro não aparece.

Foi a única dependência bloqueada que encontrei nas gravações feitas pela tela: varri todas as regras de acesso, valores padrão e funções automáticas.

## Correção
1. Liberar para usuários logados a função de descobrir cidade e as funções auxiliares de texto, que só leem e não expõem dados (tirar acentos, normalizar nome de etapa, classificar origem, montar a data do modelo, etc.).
2. As funções internas de sistema (limpezas, rodízio, depuração, segredos, Meta CAPI) continuam bloqueadas, como devem.

## Auditoria das ações da SDR (depois da correção)
Testar logado como uma SDR real, no navegador e direto no banco, cada ação:
- mover lead de etapa (inclusive para Desqualificado, com motivo) e entre funis permitidos;
- criar lead, editar nome/dados, salvar nota, criar tarefa, criar/remarcar agendamento;
- enviar mensagem, fechar/reabrir conversa, aplicar etiqueta;
- ver histórico, Meu desempenho, expediente/ponto.
Cada falha encontrada é corrigida do mesmo jeito (permissão faltando) sem abrir acesso a dados que a SDR não deve ver (ex.: contratou ou não). Relato final com o que foi testado e o resultado.

## Detalhes técnicos
- `GRANT EXECUTE TO authenticated` em: `rizodent_infer_cidade`, `sem_acento`, `normaliza_nome_etapa`, `termo_regex_acento_indiferente`, `rpt_norm_txt`, `rpt_classify_origem`, `rpt_creative_key`, `map_source_to_origem`, `modelo_data_formato_antigo`, `modelo_data_formato_semana`, `rodizio_msg_humana`, `api4com_call_label`, `etapa_e_contratado` (todas SECURITY INVOKER, puras).
- Causa: `rizodent_fill_cidade_trg` (INVOKER, BEFORE INSERT/UPDATE em `crm_leads`) chama `rizodent_infer_cidade`, sem EXECUTE.
- Auditoria via `lovable auth-session --user <sdr>` + Playwright e chamadas REST com o token da SDR.

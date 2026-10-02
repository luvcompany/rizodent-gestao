import LegalLayout, { EmailLegal, OperadorLegal, useDadosLegais } from "./LegalLayout";

const Privacidade = () => {
  const { atualizadoEm, endereco } = useDadosLegais();
  return (
    <LegalLayout
      title="Política de Privacidade"
      subtitle={`Última atualização: ${atualizadoEm}`}
      metaDescription="Política de Privacidade da plataforma — como coletamos, usamos, armazenamos e protegemos dados pessoais, em conformidade com a LGPD."
    >
      <section>
        <h2>1. Quem somos</h2>
        <p>
          Esta plataforma de CRM e atendimento, que centraliza atendimento, agendamentos, automações e gestão de relacionamento de clínicas e empresas, é operada por <OperadorLegal /> ("nós"). Esta Política descreve como coletamos, usamos, armazenamos e protegemos dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (LGPD – Lei nº 13.709/2018) e com as políticas das plataformas Meta (Facebook, Instagram e WhatsApp).
        </p>
        <p>Contato do responsável pelo tratamento de dados: <EmailLegal />.</p>
        {endereco && <p>Endereço: {endereco.replace(/\.+$/, "")}.</p>}
      </section>

      <section>
        <h2>2. Dados que coletamos</h2>
        <p>a) Dados de cadastro e uso da plataforma: nome, e-mail, telefone, função/permissões, e registros de uso da plataforma.</p>
        <p>b) Dados obtidos por meio das plataformas Meta, quando você conecta suas contas: conteúdo de mensagens e comentários trocados no Instagram Direct, Messenger e WhatsApp; nome de usuário e nome do perfil; identificadores de conta; número de telefone informado pelo contato; e metadados dessas conversas (data, hora e canal). Esses dados são acessados por meio das APIs oficiais da Meta, mediante permissão concedida por você.</p>
        <p>c) Dados de leads e contatos: informações fornecidas por potenciais clientes durante o atendimento, formulários e campanhas.</p>
      </section>

      <section>
        <h2>3. Como usamos os dados</h2>
        <p>
          Utilizamos os dados para: prestar e operar o atendimento e o CRM; organizar leads no funil de vendas; enviar e responder mensagens nos canais conectados; executar automações e follow-ups configurados por você; transcrever áudios e ligações gravadas; gerar, com inteligência artificial, sugestões de resposta, resumos e análises das conversas; realizar e gravar ligações; gerar relatórios e métricas; e melhorar o serviço. Não vendemos dados pessoais.
        </p>
      </section>

      <section>
        <h2>4. Compartilhamento e suboperadores</h2>
        <p>
          Compartilhamos dados apenas com os fornecedores abaixo, cada um na medida necessária à finalidade indicada, e com autoridades quando exigido por lei ou ordem judicial:
        </p>
        <ul>
          <li>
            <strong>Supabase e Lovable (Lovable Cloud)</strong>: hospedagem da plataforma, banco de dados, armazenamento de arquivos (inclusive áudios, imagens, documentos e gravações de ligações) e execução das funções do servidor.
          </li>
          <li>
            <strong>Meta (WhatsApp, Instagram e Messenger)</strong>: envio e recebimento das mensagens nos canais conectados; e, quando a clínica ativa a mensuração de anúncios, envio de eventos de conversão pela API de Conversões, com telefone, nome e cidade do contato pseudonimizados (hash SHA-256) e o identificador do clique no anúncio, informando a etapa alcançada no atendimento (por exemplo, lead qualificado ou compra, com o valor). Como o evento indica que o contato procurou ou contratou um serviço de saúde, ele é tratado com o mesmo cuidado dos dados de saúde descritos abaixo.
          </li>
          <li>
            <strong>Gateway de IA da Lovable</strong> (que encaminha as solicitações aos modelos do Google Gemini e da OpenAI): transcrição de áudios recebidos e de ligações gravadas; sugestões de resposta, resumos e análises das conversas; e geração de vetores de busca a partir dos exemplos de atendimento aprovados pela equipe.
          </li>
          <li>
            <strong>OpenAI</strong>: transcrição de áudio, quando a clínica escolhe um modelo de transcrição da OpenAI.
          </li>
          <li>
            <strong>Anthropic</strong>: sugestões de resposta e resumos das conversas, quando a clínica escolhe um modelo Claude.
          </li>
          <li>
            <strong>Api4Com</strong>: telefonia (discagem, gravação e registro das ligações), quando a clínica usa o módulo de ligações.
          </li>
          <li>
            <strong>Google Fonts</strong>: entrega das fontes da interface; o navegador de quem usa a plataforma se conecta aos servidores do Google, que recebem o endereço IP e dados técnicos do navegador.
          </li>
        </ul>
        <p>
          O que vai aos provedores de IA inclui o conteúdo das conversas, dos áudios e das ligações, que pode conter dados de saúde (dados pessoais sensíveis, art. 11 da LGPD). Esses dados são enviados só para gerar o resultado pedido (transcrição, sugestão, resumo, análise ou vetor de busca) e ficam sujeitos também às políticas de privacidade de cada provedor. As sugestões, os resumos e as análises por IA são habilitados por clínica.
        </p>
      </section>

      <section>
        <h2>5. Armazenamento e segurança</h2>
        <p>
          Os dados são armazenados em ambiente de nuvem com controle de acesso e criptografia em trânsito. Aplicamos medidas técnicas e organizacionais para proteger os dados contra acesso não autorizado, perda ou uso indevido.
        </p>
      </section>

      <section>
        <h2>6. Retenção</h2>
        <p>
          Mantemos os dados pelo tempo necessário às finalidades descritas ou conforme exigido por lei. Você pode solicitar a exclusão a qualquer momento (ver seção 8 e a página de Exclusão de Dados).
        </p>
      </section>

      <section>
        <h2>7. Seus direitos (LGPD)</h2>
        <p>
          Você pode solicitar: confirmação de tratamento, acesso, correção, anonimização, portabilidade, informação sobre compartilhamento e exclusão dos seus dados. Para exercer esses direitos, escreva para <EmailLegal />.
        </p>
      </section>

      <section>
        <h2>8. Exclusão de dados</h2>
        <p>
          Para solicitar a exclusão dos seus dados, acesse nossa página de Exclusão de Dados em /exclusao-de-dados ou envie um pedido para <EmailLegal />. Atenderemos em até 30 dias.
        </p>
      </section>

      <section>
        <h2>9. Alterações desta Política</h2>
        <p>Podemos atualizar esta Política periodicamente. A data no topo indica a versão vigente.</p>
      </section>

      <section>
        <h2>10. Contato</h2>
        <p>Dúvidas sobre esta Política ou sobre seus dados: <EmailLegal />.</p>
      </section>
    </LegalLayout>
  );
};

export default Privacidade;

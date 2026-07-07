import LegalLayout from "./LegalLayout";

const Privacidade = () => (
  <LegalLayout
    title="Política de Privacidade"
    subtitle="Última atualização: 6 de julho de 2026"
    metaDescription="Política de Privacidade do CRClin — como coletamos, usamos, armazenamos e protegemos dados pessoais, em conformidade com a LGPD."
  >
    <section>
      <h2>1. Quem somos</h2>
      <p>
        O CRClin é uma plataforma de CRM e atendimento operada pela Rizodent ("nós"), que centraliza atendimento, agendamentos, automações e gestão de relacionamento de clínicas e empresas. Esta Política descreve como coletamos, usamos, armazenamos e protegemos dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (LGPD – Lei nº 13.709/2018) e com as políticas das plataformas Meta (Facebook, Instagram e WhatsApp).
      </p>
      <p>Contato do responsável pelo tratamento de dados: rizodentmarketing@gmail.com.</p>
    </section>

    <section>
      <h2>2. Dados que coletamos</h2>
      <p>a) Dados de cadastro e uso do CRClin: nome, e-mail, telefone, função/permissões, e registros de uso da plataforma.</p>
      <p>b) Dados obtidos por meio das plataformas Meta, quando você conecta suas contas: conteúdo de mensagens e comentários trocados no Instagram Direct, Messenger e WhatsApp; nome de usuário e nome do perfil; identificadores de conta; número de telefone informado pelo contato; e metadados dessas conversas (data, hora e canal). Esses dados são acessados por meio das APIs oficiais da Meta, mediante permissão concedida por você.</p>
      <p>c) Dados de leads e contatos: informações fornecidas por potenciais clientes durante o atendimento, formulários e campanhas.</p>
    </section>

    <section>
      <h2>3. Como usamos os dados</h2>
      <p>
        Utilizamos os dados para: prestar e operar o atendimento e o CRM; organizar leads no funil de vendas; enviar e responder mensagens nos canais conectados; executar automações e follow-ups configurados por você; gerar relatórios e métricas; e melhorar o serviço. Não vendemos dados pessoais.
      </p>
    </section>

    <section>
      <h2>4. Compartilhamento</h2>
      <p>
        Compartilhamos dados apenas com: provedores de infraestrutura necessários à operação (por exemplo, Supabase, para banco de dados e armazenamento) e as próprias plataformas Meta, quando o envio/recebimento de mensagens exige. Podemos divulgar dados quando exigido por lei ou ordem judicial.
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
        Você pode solicitar: confirmação de tratamento, acesso, correção, anonimização, portabilidade, informação sobre compartilhamento e exclusão dos seus dados. Para exercer esses direitos, escreva para rizodentmarketing@gmail.com.
      </p>
    </section>

    <section>
      <h2>8. Exclusão de dados</h2>
      <p>
        Para solicitar a exclusão dos seus dados, acesse nossa página de Exclusão de Dados em /exclusao-de-dados ou envie um pedido para rizodentmarketing@gmail.com. Atenderemos em até 30 dias.
      </p>
    </section>

    <section>
      <h2>9. Alterações desta Política</h2>
      <p>Podemos atualizar esta Política periodicamente. A data no topo indica a versão vigente.</p>
    </section>

    <section>
      <h2>10. Contato</h2>
      <p>Dúvidas sobre esta Política ou sobre seus dados: rizodentmarketing@gmail.com.</p>
    </section>
  </LegalLayout>
);

export default Privacidade;

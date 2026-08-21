import MinhasConexoes from "@/pages/crm/MinhasConexoes";

/**
 * Conexões da Recepção — agora é a mesma tela do closer: cada pessoa conecta o
 * próprio número. Toda a lógica vive em `MinhasConexoes`, que fala apenas com a
 * edge function `minha-conexao-whatsapp` (o token nunca passa pelo navegador
 * até o banco).
 */
export default function RecepcaoConexoes() {
  return <MinhasConexoes />;
}

import MinhasConexoes from "@/pages/crm/MinhasConexoes";

/**
 * Conexões da Recepção — a mesma tela do closer. Toda a lógica vive em
 * `MinhasConexoes`: lista dos números visíveis (RPC whatsapp_numeros_visiveis),
 * "Testar conexão" pela function minha-conexao-whatsapp e conexão do próprio
 * número pelo Facebook (Embedded Signup em coexistência). Nenhum token passa
 * pelo navegador.
 */
export default function RecepcaoConexoes() {
  return <MinhasConexoes />;
}

import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * /crm/conversa/:id → /crm/conversas?lead=:id (CONV-29).
 *
 * Esta rota é a entrada de muitos pontos: notificação, Kanban, Dashboard,
 * Calendário, Relatórios, Ligações. Ela era uma SEGUNDA tela de chat, mantida
 * em paralelo à caixa de conversas, e divergia dela em tudo que só a caixa
 * recebia: telefone cru, sem o botão da Api4Com, 70%/30% espremido no celular,
 * botão de IA com o módulo desligado, spinner eterno para lead sem acesso
 * (CONV-13, REC-04, CRC-14, CRC-15) e presença carimbada antes de o lead
 * existir (CLO-04). Agora há uma tela só: a caixa de conversas abre o lead pelo
 * ?lead=, avisa quando ele não está disponível e mantém o link na URL.
 *
 * O redirecionamento usa `replace`, então o "voltar" do navegador — e o botão
 * Voltar que a caixa mostra para quem chegou por aqui (`veioDeOutraTela`) —
 * leva de volta à tela de origem. App.tsx não muda: a rota continua existindo.
 */
export default function CrmConversa() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const estado = (location.state && typeof location.state === "object" ? location.state : {}) as Record<string, unknown>;
  const busca = new URLSearchParams(location.search);
  if (id) busca.set("lead", id);
  const query = busca.toString();
  return (
    <Navigate
      to={{ pathname: "/crm/conversas", search: query ? `?${query}` : "" }}
      replace
      state={{ ...estado, veioDeOutraTela: true }}
    />
  );
}

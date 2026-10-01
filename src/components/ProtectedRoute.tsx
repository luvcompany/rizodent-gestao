import { Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { useModulos } from "@/hooks/useModule";
import { moduloDaRota } from "@/lib/modulos";

const AVISO_MODULO_DESLIGADO = "Este recurso não está disponível para a sua clínica.";
/** Destino de último recurso: não depende de módulo nenhum. */
const DESTINO_SEM_MODULO = "/crm/dashboard";

/** Home de cada papel — o mesmo destino que os guards abaixo usam para rota não permitida. */
function homeDoPapel(role: string | null): string {
  switch (role) {
    case "recepcao":
      return "/crm/recepcao";
    case "closer":
      return "/crm/closer";
    case "sdr":
      return "/crm/sdr";
    default:
      return "/crm";
  }
}

/**
 * Redireciona para fora de uma rota de módulo desligado e avisa. O aviso sai
 * aqui (e não no ProtectedRoute) para só aparecer quando o redirecionamento
 * acontece de fato; o id evita aviso duplicado (StrictMode, re-render).
 */
function SaidaDeModuloDesligado({ destino }: { destino: string }) {
  useEffect(() => {
    toast.error(AVISO_MODULO_DESLIGADO, { id: "modulo-desligado" });
  }, []);
  return <Navigate to={destino} replace />;
}

// Rotas liberadas para o papel Recepção (chat + disparos + modelos + bots).
// Qualquer outra rota redireciona para Conversas.
const RECEPCAO_PREFIXES = [
  "/crm/recepcao",
  "/crm/conversas",
  "/crm/conversa",
  "/crm/campanhas",
  "/crm/modelos",
  "/crm/respostas-rapidas",
  "/crm/bots",
  "/crm/conexoes",
  "/crm/automacoes",
];
/** O Kanban é rota exata "/crm" — prefixo liberaria o CRM inteiro. */
const RECEPCAO_ROTAS_EXATAS = ["/crm"];

// Closer: espelho da recepção, mas sem Instagram. Tem Conexões porque conecta
// o próprio número de WhatsApp.
const CLOSER_PREFIXES = [
  "/crm/closer",
  // Calendário dos agendamentos dele (a RLS já limita ao número do closer) e
  // a aba de pacientes/pagamentos próprios.
  "/crm/calendario",
  "/crm/conversas",
  "/crm/conversa",
  "/crm/campanhas",
  "/crm/modelos",
  "/crm/respostas-rapidas",
  "/crm/bots",
  "/crm/automacoes",
  "/crm/conexoes",
];
const CLOSER_ROTAS_EXATAS = ["/crm"];

// SDR (rodízio): mesma base da recepção, mas o eixo de isolamento é "leads
// dela" (crm_leads.assigned_to) e não o número — ela opera o número principal
// do cliente. Por isso não tem Conexões (não conecta número próprio) nem
// Transmissão; tem Calendário/Tarefas porque agenda e faz follow-up dos
// próprios leads. Bots/modelos/respostas são os do mundo do CRC
// (compartilhados).
//
// Automações AGORA ENTRA (antes ficava fora "nesta fase"). São dois motivos:
//   1. "/crm/automacoes" é o destino do botão AUTOMATIZE do funil (CrmKanban).
//      Sem o prefixo, o guarda devolvia a SDR para "/crm/sdr" — exatamente o
//      "manda para a página de início" que o dono relatou.
//   2. É a única tela onde se cria funil, etapa, gatilho e disparo. A escrita
//      em si é liberada por policies novas em crm_stages, crm_pipelines e
//      crm_automations; aqui só se abre a porta da navegação.
// Nada além deste prefixo é necessário para ela criar FUNIL e ETAPA: tudo isso
// vive dentro de /crm/automacoes e, no caso de etapa, também no Kanban, que é a
// rota exata "/crm" (já liberada em SDR_ROTAS_EXATAS).
// "/crm/integracoes" continua FORA de propósito: ali moram token do WhatsApp,
// contas de Instagram e Api4Com. Aquela tela só duplica a gestão de funil e
// abriria credencial do cliente para a SDR — seria alargar o acesso sem
// necessidade.
// O menu espelho fica em CrmLayout (role === "sdr").
const SDR_PREFIXES = [
  "/crm/sdr",
  "/crm/conversas",
  "/crm/conversa",
  "/crm/calendario",
  "/crm/ligacoes",
  "/crm/automacoes",
  "/crm/modelos",
  "/crm/respostas-rapidas",
  "/crm/bots",
];
const SDR_ROTAS_EXATAS = ["/crm"];

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading, profile, signOut, user, userRole, roleResolved } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const location = useLocation();
  const { ligado: moduloLigado } = useModulos();

  // Bloqueio cross-tenant: se logou com conta de outro cliente nesta URL,
  // desloga imediatamente para impedir o acesso. Só a sessão deste navegador
  // (scope 'local'): a mesma conta pode estar em uso legítimo no endereço do
  // próprio cliente, em outros aparelhos.
  useEffect(() => {
    if (loading || tenantLoading) return;
    if (!user) return;
    if (!tenant.id) return;
    const userTenantId = (profile as any)?.tenant_id;
    if (userTenantId && userTenantId !== tenant.id) {
      toast.error("Esta conta não pertence a este cliente.");
      signOut({ scope: "local" });
    }
  }, [user, profile, tenant.id, loading, tenantLoading, signOut]);

  useEffect(() => {
    if (profile?.is_blocked) {
      toast.error("Seu acesso foi bloqueado pelo administrador.");
      signOut();
    }
  }, [profile?.is_blocked, signOut]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  if (profile?.is_blocked) {
    return <Navigate to="/" replace />;
  }

  if (profile?.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  // Guards de papel só decidem com o papel resolvido (cache válido ou 1º fetch).
  // Sem isso, um deep-link renderia (e consultaria dados de) uma rota proibida
  // na janela entre o boot e a chegada do papel.
  if (!roleResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  // Pós-venda só acessa o CRM
  if (
    userRole === "posvenda" &&
    !location.pathname.startsWith("/crm") &&
    location.pathname !== "/change-password"
  ) {
    return <Navigate to="/crm" replace />;
  }

  // Recepção só acessa Conversas/Transmissão/Modelos/Respostas Rápidas/Bots
  if (userRole === "recepcao") {
    const path = location.pathname;
    const allowed =
      path === "/change-password" ||
      RECEPCAO_ROTAS_EXATAS.includes(path) ||
      RECEPCAO_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
    if (!allowed) {
      return <Navigate to="/crm/recepcao" replace />;
    }
  }

  // Closer: mesmo escopo da recepção, home na tela inicial ("/crm/closer")
  if (userRole === "closer") {
    const path = location.pathname;
    const allowed =
      path === "/change-password" ||
      CLOSER_ROTAS_EXATAS.includes(path) ||
      CLOSER_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
    if (!allowed) return <Navigate to="/crm/closer" replace />;
  }

  // SDR: regra AFIRMATIVA (só age quando o papel É sdr) — nunca decide por
  // negação, então um papel ainda nulo não expulsa ninguém. Home: "/crm/sdr".
  if (userRole === "sdr") {
    const path = location.pathname;
    const allowed =
      path === "/change-password" ||
      SDR_ROTAS_EXATAS.includes(path) ||
      SDR_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
    if (!allowed) return <Navigate to="/crm/sdr" replace />;
  }

  // As telas de /crm/closer são o universo do closer: pacientes e faturamento
  // dele, que por decisão do produto não se misturam com os da clínica. A RLS
  // já devolve vazio para os demais perfis; aqui o acesso nem chega a abrir.
  // `userRole &&` é o que impede a expulsão por papel desconhecido: esta é a
  // única regra que decide por NEGAÇÃO, então um papel ainda nulo — instante em
  // que a busca do perfil não voltou — casaria com "não é closer" e jogaria o
  // próprio closer para fora da casa dele. Sem papel, ninguém é redirecionado.
  if (
    userRole &&
    location.pathname.startsWith("/crm/closer") &&
    userRole !== "closer" &&
    userRole !== "gerente" &&
    userRole !== "superadmin"
  ) {
    return <Navigate to="/crm" replace />;
  }

  // Módulo desligado para o cliente: só decide com a config RESOLVIDA e o
  // módulo explicitamente false (undefined = ainda carregando, não expulsa).
  // O pathname já vem sem o basename do cliente (/<slug>), porque o
  // BrowserRouter recebe o basename.
  const moduloDaTela = moduloDaRota(location.pathname);
  if (moduloDaTela && moduloLigado(moduloDaTela) === false) {
    const home = homeDoPapel(userRole);
    const moduloDaHome = moduloDaRota(home);
    // Se a home do papel também estiver desligada (ou for a própria tela),
    // vai para o painel, que não depende de módulo: nunca entra em laço.
    const destino =
      home === location.pathname || (moduloDaHome && moduloLigado(moduloDaHome) === false)
        ? DESTINO_SEM_MODULO
        : home;
    return <SaidaDeModuloDesligado destino={destino} />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

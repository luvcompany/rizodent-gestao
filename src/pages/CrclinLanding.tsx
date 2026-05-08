import { useEffect } from "react";
import { MessageCircle, Calendar, Users, Bot, BarChart3, CreditCard, CheckCircle2, Sparkles, Zap, Shield, ArrowRight, Phone } from "lucide-react";
import crclinBrand from "@/assets/crclin-brand.png";
import crclinIcon from "@/assets/crclin-icon.png";

const WHATSAPP_URL = "https://wa.me/5577981223133?text=Ol%C3%A1!%20Quero%20conhecer%20o%20CRClin";

const features = [
  { icon: Users, title: "Kanban de Leads", desc: "Visualize todo o seu funil de vendas em um quadro intuitivo, arraste e solte para mover etapas." },
  { icon: MessageCircle, title: "WhatsApp Integrado", desc: "Atenda todos os seus clientes pelo WhatsApp Business API direto na plataforma, com histórico completo." },
  { icon: Bot, title: "Bots e Automações", desc: "Construa fluxos automáticos para atender, qualificar e dar follow-up sem perder nenhum lead." },
  { icon: Calendar, title: "Agenda Completa", desc: "Gerencie agendamentos, confirmações e remarcações em uma agenda visual por unidade e profissional." },
  { icon: BarChart3, title: "Relatórios em Tempo Real", desc: "Acompanhe conversões, origem de leads, performance da equipe e previsão de faturamento." },
  { icon: CreditCard, title: "Gestão de Pagamentos", desc: "Controle orçamentos, contratos fechados, pagamentos recebidos e a receber, tudo em um só lugar." },
];

const benefits = [
  "Aumente a conversão de leads em até 3x com follow-up automático",
  "Centralize WhatsApp, Instagram e ligações em uma única caixa de entrada",
  "Reduza no-show com confirmações automáticas de agendamento",
  "Tenha visão completa do funil — do primeiro contato à venda fechada",
  "Equipe organizada com tarefas, lembretes e distribuição inteligente",
  "Suporte humano e personalização da plataforma com a sua marca",
];

const targets = [
  { title: "Clínicas Odontológicas", desc: "Implantes, ortodontia, harmonização — controle do orçamento ao pagamento." },
  { title: "Clínicas Médicas e Estéticas", desc: "Agendamentos, prontuários básicos, recall de pacientes." },
  { title: "Profissionais Liberais", desc: "Psicólogos, fisioterapeutas, nutricionistas — gestão completa da agenda." },
  { title: "Empresas com Vendas Consultivas", desc: "Qualquer negócio que viva de agendamento + atendimento + venda." },
];

const faqs = [
  { q: "Quanto tempo leva para começar a usar?", a: "Em até 24h após a contratação seu acesso é liberado, com a plataforma já personalizada com a sua logo e cores." },
  { q: "Preciso ter WhatsApp Business API?", a: "Nós ajudamos você a configurar tudo do zero, inclusive a aprovação do número junto à Meta." },
  { q: "Posso migrar meus dados atuais?", a: "Sim. Importamos seus contatos, leads e histórico de planilhas ou outros CRMs." },
  { q: "Tem fidelidade?", a: "Não. Nossos planos são mensais, sem multa de cancelamento." },
  { q: "Funciona no celular?", a: "Sim. A plataforma é 100% responsiva — funciona perfeitamente em iPad, tablet e celular." },
];

const CrclinLanding = () => {
  useEffect(() => {
    document.title = "CRClin — CRM completo para clínicas e empresas de agendamento";
    const setMeta = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!tag) { tag = document.createElement("meta"); tag.setAttribute("name", name); document.head.appendChild(tag); }
      tag.setAttribute("content", content);
    };
    setMeta("description", "CRClin é o CRM white-label para clínicas e empresas que vivem de agendamento. WhatsApp, bots, agenda e relatórios em uma só plataforma.");

    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "CRClin",
      url: typeof window !== "undefined" ? window.location.origin : "",
      description: "CRM completo para clínicas e empresas que trabalham com agendamento e gestão de clientes.",
      contactPoint: { "@type": "ContactPoint", telephone: "+5577981223133", contactType: "sales", areaServed: "BR" },
    });
    document.head.appendChild(ld);
    return () => { document.head.removeChild(ld); };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <img src={crclinIcon} alt="CRClin" className="h-9 w-9" />
            <span className="text-lg font-bold tracking-tight">CRClin</span>
          </div>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 via-blue-500 to-purple-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-blue-500/20 hover:opacity-90">
            <MessageCircle size={16} /> Falar no WhatsApp
          </a>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.15),transparent_50%)]" />
        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <img src={crclinBrand} alt="CRClin — CRM completo para clínicas" className="mx-auto mb-8 w-full max-w-md rounded-2xl shadow-2xl shadow-blue-500/20" />
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-300">
              <Sparkles size={14} /> CRM completo para quem vive de agendamento
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Transforme leads em clientes.<br />
              <span className="bg-gradient-to-r from-emerald-300 via-blue-400 to-purple-400 bg-clip-text text-transparent">Pare de perder vendas no WhatsApp.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
              O CRClin centraliza atendimento, agenda, automações e gestão de pagamentos da sua clínica ou empresa em uma única plataforma — personalizada com a sua marca.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 via-blue-500 to-purple-500 px-7 py-4 text-base font-semibold text-slate-950 shadow-xl shadow-blue-500/30 transition hover:scale-[1.02]">
                <MessageCircle size={18} /> Falar com um especialista
                <ArrowRight size={18} />
              </a>
              <a href="#funcionalidades" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-7 py-4 text-base font-medium text-slate-200 hover:bg-slate-900">
                Ver funcionalidades
              </a>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
              <div className="flex items-center gap-1.5"><Shield size={14} /> Dados criptografados</div>
              <div className="flex items-center gap-1.5"><Zap size={14} /> Setup em 24h</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 size={14} /> Sem fidelidade</div>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="border-y border-slate-800 bg-slate-900/30">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">Por que clínicas escolhem o CRClin</h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {benefits.map((b) => (
              <div key={b} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={20} />
                <p className="text-sm text-slate-200">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="funcionalidades" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">Tudo que você precisa em um só lugar</h2>
          <p className="mt-4 text-slate-400">Do primeiro contato no anúncio à venda fechada — sem planilhas, sem ferramentas espalhadas.</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-purple-500/40 hover:bg-slate-900/70">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-400/20 text-emerald-300">
                <f.icon size={22} />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TARGETS */}
      <section className="border-y border-slate-800 bg-slate-900/30">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Para quem é o CRClin</h2>
            <p className="mt-4 text-slate-400">Feito para negócios que vivem de agendamento e atendimento personalizado.</p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {targets.map((t) => (
              <div key={t.title} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
                <h3 className="font-semibold text-slate-100">{t.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">Perguntas frequentes</h2>
        <div className="mt-10 space-y-4">
          {faqs.map((f) => (
            <details key={f.q} className="group rounded-xl border border-slate-800 bg-slate-900/40 p-5 open:bg-slate-900/70">
              <summary className="flex cursor-pointer items-center justify-between font-medium text-slate-100">
                {f.q}
                <span className="ml-4 text-emerald-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-slate-400">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-blue-500/30 bg-gradient-to-br from-blue-600/20 via-slate-900 to-cyan-500/10 p-10 text-center sm:p-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.25),transparent_60%)]" />
          <div className="relative">
            <h2 className="text-3xl font-bold sm:text-4xl">Pronto para organizar sua clínica?</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">Fale agora com nosso time pelo WhatsApp e veja uma demonstração personalizada gratuita.</p>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 via-blue-500 to-purple-500 px-8 py-4 text-base font-bold text-slate-950 shadow-xl shadow-blue-500/30 transition hover:scale-[1.02]">
              <MessageCircle size={20} /> Falar no WhatsApp
            </a>
            <p className="mt-4 text-xs text-slate-400 inline-flex items-center gap-1.5"><Phone size={12} /> (77) 98122-3133</p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} CRClin. Todos os direitos reservados.</p>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-300">Contato</a>
        </div>
      </footer>

      {/* Floating WhatsApp */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl shadow-green-500/40 transition hover:scale-110"
      >
        <MessageCircle size={26} />
      </a>
    </div>
  );
};

export default CrclinLanding;

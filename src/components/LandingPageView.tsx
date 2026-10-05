import React from "react";
import {
  MessageSquare,
  Bot,
  KanbanSquare,
  Megaphone,
  Smartphone,
  Lock,
  ArrowRight,
  CheckCircle2,
  Zap,
  Check,
} from "lucide-react";

interface LandingPageViewProps {
  onGoToLogin: () => void;
}

const WHATSAPP_NUMBER = "5565996221282";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Olá! Vim pelo site do FitMind CRM & Robô WhatsApp e quero saber mais sobre os planos e contratação."
)}`;

export const LandingPageView: React.FC<LandingPageViewProps> = ({ onGoToLogin }) => {
  return (
    <div className="min-h-screen bg-black text-slate-100 selection:bg-red-500/30 selection:text-white overflow-x-hidden">
      {/* Background Glows */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-gradient-to-b from-red-600/20 via-red-950/10 to-transparent blur-[140px] pointer-events-none -z-10" />

      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-black/85 border-b border-white/10 px-6 lg:px-16 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="FitMind" className="h-9 w-auto object-contain" />
          <span className="text-red-400 font-bold text-xs px-2.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30">
            CRM & Bot
          </span>
        </div>

        {/* Nav Links & Actions */}
        <div className="flex items-center gap-4">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white transition"
          >
            Falar com Consultor
          </a>

          <button
            onClick={onGoToLogin}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#121216] hover:bg-[#1c1c22] text-white font-semibold text-xs border border-white/10 hover:border-red-500/40 transition shadow-inner"
          >
            <Lock className="w-3.5 h-3.5 text-red-500" />
            Acessar Sistema
          </button>

          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition shadow-lg shadow-red-950/40"
          >
            Quero Me Cadastrar
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <section className="px-6 lg:px-16 pt-20 pb-24 max-w-7xl mx-auto text-center space-y-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold animate-pulse">
          <Zap className="w-3.5 h-3.5 text-red-500" /> A Plataforma Nº 1 de Vendas & Automação por WhatsApp
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-5xl mx-auto leading-[1.15]">
          Transforme conversas no WhatsApp em <span className="bg-gradient-to-r from-red-500 via-rose-400 to-white bg-clip-text text-transparent">Vendas Fechadas no CRM</span>
        </h1>

        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Robô de atendimento inteligente, Kanban de funil automático, chat ao vivo e disparador de campanhas em massa com proteção anti-ban. Tudo em um único lugar.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-sm transition shadow-xl shadow-red-950/50 hover:scale-[1.02]"
          >
            <Smartphone className="w-4 h-4" />
            Começar Agora pelo WhatsApp
            <ArrowRight className="w-4 h-4" />
          </a>

          <button
            onClick={onGoToLogin}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-[#121216] hover:bg-[#1a1a20] text-white font-bold text-sm border border-white/10 hover:border-red-500/40 transition"
          >
            Já sou cadastrado (Fazer Login)
          </button>
        </div>

        {/* Floating Metrics Badge */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-12">
          <div className="glass-card rounded-2xl p-4 text-center">
            <span className="text-2xl font-extrabold text-white font-mono">100%</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Sincronização com CRM</p>
          </div>
          <div className="glass-card rounded-2xl p-4 text-center">
            <span className="text-2xl font-extrabold text-red-500 font-mono">20s</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Intervalo Anti-Bloqueio</p>
          </div>
          <div className="glass-card rounded-2xl p-4 text-center">
            <span className="text-2xl font-extrabold text-white font-mono">24/7</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Atendimento Automático</p>
          </div>
          <div className="glass-card rounded-2xl p-4 text-center">
            <span className="text-2xl font-extrabold text-red-400 font-mono">Multi</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Tenant / Multi-Empresas</p>
          </div>
        </div>
      </section>

      {/* Feature Showcase Grid */}
      <section className="px-6 lg:px-16 py-20 bg-[#08080a] border-y border-white/5">
        <div className="max-w-7xl mx-auto space-y-16">
          <div className="text-center space-y-3">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Tudo o que você precisa para escalar seu atendimento
            </h2>
            <p className="text-sm text-slate-400 max-w-xl mx-auto">
              Projetado para empresas que não podem perder nenhuma oportunidade de venda.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1: Robô WhatsApp */}
            <div className="glass-panel rounded-3xl p-8 border border-white/10 space-y-4 hover:border-red-500/40 transition group">
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-500 group-hover:scale-110 transition-transform">
                <Bot className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Robô de Atendimento Interativo</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Crie fluxos de mensagens, menus com opções numéricas, respostas automáticas e transferência inteligente para atendentes humanos.
              </p>
              <ul className="space-y-2 text-xs text-slate-300 pt-2">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-red-500" /> Reconhece sinônimos e números</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-red-500" /> Não bloqueia atendente humano</li>
              </ul>
            </div>

            {/* Feature 2: Funil CRM Kanban */}
            <div className="glass-panel rounded-3xl p-8 border border-white/10 space-y-4 hover:border-red-500/40 transition group">
              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                <KanbanSquare className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Funil de Vendas Visual (Kanban)</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Toda mensagem que chega pelo WhatsApp vira um lead no funil automaticamente. Acompanhe o avanço de cada negociação até o fechamento.
              </p>
              <ul className="space-y-2 text-xs text-slate-300 pt-2">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-red-400" /> Arraste cartões entre etapas</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-red-400" /> Envio direto de WhatsApp pelo card</li>
              </ul>
            </div>

            {/* Feature 3: Disparos em Massa */}
            <div className="glass-panel rounded-3xl p-8 border border-white/10 space-y-4 hover:border-red-500/40 transition group">
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-500 group-hover:scale-110 transition-transform">
                <Megaphone className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Disparos & Campanhas em Massa</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Dispare mensagens personalizadas para seus leads por coluna do CRM ou lista colada. Intervalo inteligente que evita banimento de chip.
              </p>
              <ul className="space-y-2 text-xs text-slate-300 pt-2">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-red-500" /> Personalização com &#123;nome&#125;</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-red-500" /> Controle de cota diária (300/dia)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Plans & Pricing Section */}
      <section className="px-6 lg:px-16 py-24 max-w-7xl mx-auto space-y-16">
        <div className="text-center space-y-3">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Planos sob medida para o seu crescimento
          </h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Fale conosco pelo WhatsApp para ativar sua conta e começar a vender em minutos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* Plan 1 */}
          <div className="glass-panel rounded-3xl p-8 border border-white/10 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Acesso Mensal</span>
              <h3 className="text-2xl font-extrabold text-white">30 Dias</h3>
              <p className="text-xs text-slate-400">Ideal para testar e validar suas automações.</p>
              <ul className="space-y-2.5 text-xs text-slate-300 pt-4 border-t border-white/10">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> 1 Conexão de WhatsApp</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Funil Kanban Ilimitado</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Robô de Atendimento 24/7</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Suporte Técnico Dedicado</li>
              </ul>
            </div>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3 rounded-xl bg-[#141418] hover:bg-[#1c1c22] text-white font-bold text-xs text-center border border-white/10 hover:border-red-500/40 transition block"
            >
              Contratar no WhatsApp
            </a>
          </div>

          {/* Plan 2: Destaque */}
          <div className="glass-panel rounded-3xl p-8 border-2 border-red-500/50 bg-gradient-to-b from-red-950/30 via-black to-black space-y-6 flex flex-col justify-between relative shadow-2xl shadow-red-950/40">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-red-600 text-white font-extrabold text-[10px] uppercase tracking-wider shadow-md">
              Mais Escolhido
            </div>
            <div className="space-y-4">
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Trimestral / Semestral</span>
              <h3 className="text-2xl font-extrabold text-white">90 a 180 Dias</h3>
              <p className="text-xs text-slate-400">Para empresas que querem escala contínua e descontos exclusivos.</p>
              <ul className="space-y-2.5 text-xs text-slate-300 pt-4 border-t border-white/10">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Múltiplas Conexões WhatsApp</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Disparos em Massa com Fila Anti-Ban</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Central de Chat Multi-Atendentes</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Onboarding & Setup Personalizado</li>
              </ul>
            </div>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs text-center shadow-lg shadow-red-950/40 transition block"
            >
              Garantir com Desconto
            </a>
          </div>

          {/* Plan 3 */}
          <div className="glass-panel rounded-3xl p-8 border border-white/10 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Anual / Vitalício</span>
              <h3 className="text-2xl font-extrabold text-white">1 Ano / Completo</h3>
              <p className="text-xs text-slate-400">Máxima economia e estabilidade para sua operação.</p>
              <ul className="space-y-2.5 text-xs text-slate-300 pt-4 border-t border-white/10">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Todos os recursos inclusos</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Suporte Prioritário VIP</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Treinamento de Equipe</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-red-500" /> Atualizações contínuas de versão</li>
              </ul>
            </div>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3 rounded-xl bg-[#141418] hover:bg-[#1c1c22] text-white font-bold text-xs text-center border border-white/10 hover:border-red-500/40 transition block"
            >
              Falar no WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-black py-12 px-6 lg:px-16 text-center text-xs text-slate-500 space-y-4">
        <p>© 2026 FitMind CRM & WhatsApp Bot. Todos os direitos reservados.</p>
        <p className="text-[11px] text-slate-600">
          Atendimento comercial: <span className="font-mono text-red-400">+55 (65) 99622-1282</span>
        </p>
      </footer>
    </div>
  );
};

export default LandingPageView;

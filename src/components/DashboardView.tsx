import React from "react";
import { Partner, Conexao, CartaoCrm, Conversa, DisparoCampanha } from "@/types";
import {
  Users,
  Smartphone,
  Send,
  MessageSquare,
  TrendingUp,
  ArrowUpRight,
  PlusCircle,
  Megaphone,
  KanbanSquare,
} from "lucide-react";
import type { TabType } from "@/lib/rotas";
import { BaixarDiaCompleto } from "@/components/BaixarDiaCompleto";
import {
  formatarMomento,
  formatarTelefone,
  iniciaisDe,
  roboLigado,
  rotuloStatus,
  telefoneDaConversa,
  tituloDaConversa,
} from "@/lib/whatsapp";

interface DashboardViewProps {
  partner: Partner | null;
  conexoes: Conexao[];
  cartoes: CartaoCrm[];
  conversas: Conversa[];
  campanhas: DisparoCampanha[];
  /** Fuso da empresa (vem do /api/data). */
  fuso?: string;
  onNavigate: (tab: TabType) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  partner,
  conexoes,
  cartoes,
  conversas,
  campanhas,
  fuso,
  onNavigate,
}) => {
  const conexaoAtiva = conexoes.find((c) => c.status === "conectado");
  const conexaoPrincipal = conexaoAtiva || conexoes[0] || null;
  const robo = roboLigado(conexaoAtiva);
  const totalEnviadasHoje = conexoes.reduce((acc, c) => acc + (c.enviadas_hoje || 0), 0);
  const totalCartoes = cartoes.length;
  const conversasAtivas = conversas.filter((c) => c.estado === "bot" || c.estado === "humano").length;

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="hidden md:block relative overflow-hidden rounded-3xl bg-gradient-to-r from-black via-[#14080a] to-black border border-red-500/30 p-5 md:p-8 shadow-2xl">
        <div className="absolute right-0 top-0 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 font-bold text-xs border border-red-500/30">
                Painel Integrado
              </span>
              <span className="text-xs text-slate-400">{partner?.fantasy_name || "Sua Empresa"}</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              Visão Geral de Vendas & Atendimento
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Monitore conversas no WhatsApp, leads do funil e disparos em massa em tempo real.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onNavigate("crm")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition shadow-lg shadow-red-950/40"
            >
              <KanbanSquare className="w-4 h-4" />
              Abrir Funil CRM
            </button>
            <button
              onClick={() => onNavigate("disparos")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#141418] hover:bg-[#1c1c22] text-white font-semibold text-xs border border-white/10 hover:border-red-500/40 transition"
            >
              <Megaphone className="w-4 h-4 text-red-500" />
              Nova Campanha
            </button>
            <button
              onClick={() => onNavigate("conectar")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#141418] hover:bg-[#1c1c22] text-white font-semibold text-xs border border-white/10 hover:border-red-500/40 transition"
            >
              <Smartphone className="w-4 h-4 text-red-500" />
              Conectar WhatsApp
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
        {/* Card 1: Leads no Funil */}
        <div className="glass-card rounded-2xl p-5 relative overflow-hidden group hover:border-red-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Total de Leads no CRM</span>
            <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-500">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{totalCartoes}</span>
            <span className="text-xs text-red-400 flex items-center font-bold">
              <TrendingUp className="w-3 h-3 mr-0.5" /> Ativos
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Sincronizado automaticamente com WhatsApp</p>
        </div>

        {/* Card 2: Conexões WhatsApp */}
        <div className="glass-card rounded-2xl p-5 relative overflow-hidden group hover:border-white/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Conexões WhatsApp</span>
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white">
              <Smartphone className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{conexoes.length}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
              conexaoAtiva ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-amber-500/20 text-amber-300"
            }`}>
              {conexaoAtiva ? `${conexoes.filter((c) => c.status === "conectado").length} Online` : "Desconectado"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">{conexaoAtiva?.numero ? `Número: ${formatarTelefone(conexaoAtiva.numero)}` : "Aguardando pareamento"}</p>
        </div>

        {/* Card 3: Mensagens Enviadas Hoje */}
        <div className="glass-card rounded-2xl p-5 relative overflow-hidden group hover:border-red-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Enviadas Hoje (WhatsApp)</span>
            <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-500">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{totalEnviadasHoje}</span>
            <span className="text-xs text-slate-400 font-medium">/ 300 cota diária</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Proteção anti-bloqueio ativa</p>
        </div>

        {/* Card 4: Conversas no Chat */}
        <div className="glass-card rounded-2xl p-5 relative overflow-hidden group hover:border-white/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Atendimentos Ativos</span>
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{conversasAtivas}</span>
            <span className="text-xs text-slate-300 font-medium">No Robô / Humano</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Central de chat disponível</p>
        </div>
      </div>

      {/* Arquivo completo do dia (só do dono; nunca vai para a IA) */}
      <BaixarDiaCompleto partnerId={partner?.id ?? null} fuso={fuso} />

      {/* Two Columns: Recent WhatsApp Chats & Active Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Atendimentos Recentes */}
        <div className="glass-panel rounded-3xl p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-bold text-white">Últimas Conversas no WhatsApp</h3>
            </div>
            <button
              onClick={() => onNavigate("conversas")}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-semibold"
            >
              Ver todas <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2.5">
            {conversas.slice(0, 5).map((conversa) => {
              const titulo = tituloDaConversa(conversa);
              const tel = telefoneDaConversa(conversa);
              return (
              <button
                type="button"
                key={conversa.id}
                onClick={() => onNavigate("conversas")}
                className="w-full text-left p-3.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 transition cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-black border border-white/10 flex items-center justify-center font-bold text-xs text-red-500">
                    {iniciaisDe(titulo)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-white truncate">{titulo}</h4>
                    <p className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2">
                      <span className="font-mono">
                        {tel ? formatarTelefone(tel) : conversa.tipo === "grupo" ? "Grupo" : "Número não revelado"}
                      </span>
                      {conversa.tipo !== "grupo" && (
                        <>
                          <span>•</span>
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                            conversa.estado === "humano" ? "bg-amber-500/20 text-amber-300" : "bg-red-500/20 text-red-400"
                          }`}>
                            {conversa.estado === "humano" ? "Você atende" : robo === false ? "Só registro" : "Robô atende"}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10px] text-slate-500">
                    {formatarMomento(conversa.ultima_mensagem_em) || "Recente"}
                  </span>
                </div>
              </button>
              );
            })}

            {conversas.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-xs">
                Nenhuma conversa registrada ainda. Quando alguém mandar mensagem no WhatsApp, aparecerá aqui instantaneamente.
              </div>
            )}
          </div>
        </div>

        {/* Right: Status do Conector & Campanhas */}
        <div className="glass-panel rounded-3xl p-4 md:p-6 space-y-6">
          {/* Conector Status Box */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-bold text-white">WhatsApp</h3>
              </div>
              <button
                onClick={() => onNavigate("conectar")}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-semibold"
              >
                Gerenciar <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-black border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Status da Sessão:</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  conexaoAtiva ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-amber-500/20 text-amber-400"
                }`}>
                  {conexaoAtiva ? "Conectado" : conexaoPrincipal ? rotuloStatus(conexaoPrincipal.status) : "Nenhuma conexão"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Último sinal:</span>
                <span className="text-xs font-mono text-white">
                  {formatarMomento(conexaoPrincipal?.visto_em) || "Nunca"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Robô:</span>
                <span className={`text-xs font-bold ${robo ? "text-amber-300" : "text-slate-300"}`}>
                  {robo === null ? "—" : robo ? "Ligado" : "Desligado (só registra)"}
                </span>
              </div>
            </div>
          </div>

          {/* Campanhas Ativas */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-bold text-white">Campanhas Recentes</h3>
              </div>
              <button
                onClick={() => onNavigate("disparos")}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-semibold"
              >
                Criar Disparo <PlusCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2">
              {campanhas.slice(0, 3).map((camp) => (
                <div key={camp.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white">{camp.nome}</h4>
                    <p className="text-[11px] text-slate-400">
                      {camp.total_enviados} de {camp.total_alvos} enviados ({camp.status})
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    camp.status === "concluido" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-white/10 text-white"
                  }`}>
                    {camp.status}
                  </span>
                </div>
              ))}

              {campanhas.length === 0 && (
                <p className="text-xs text-slate-500 py-3 text-center">Nenhuma campanha disparada ainda.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

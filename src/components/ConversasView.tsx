import React, { useState, useEffect, useRef } from "react";
import { Conversa, Mensagem, Conexao } from "@/types";
import { supabase } from "@/lib/supabase";
import {
  MessageSquare,
  Send,
  Bot,
  UserCheck,
  Clock,
  CheckCheck,
  AlertCircle,
  Search,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface ConversasViewProps {
  conversas: Conversa[];
  conexoes: Conexao[];
  onRefresh: () => void;
}

export const ConversasView: React.FC<ConversasViewProps> = ({
  conversas,
  conexoes,
  onRefresh,
}) => {
  const [conversaAtiva, setConversaAtiva] = useState<Conversa | null>(conversas[0] || null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [textoEnvio, setTextoEnvio] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Carrega mensagens da conversa ativa
  const carregarMensagens = async (conversaId: string) => {
    try {
      const { data } = await supabase
        .from("bot_mensagens")
        .select("*")
        .eq("conversa_id", conversaId)
        .order("created_at", { ascending: true });

      setMensagens((data as Mensagem[]) || []);
    } catch {
      setMensagens([]);
    }
  };

  useEffect(() => {
    if (conversaAtiva?.id) {
      carregarMensagens(conversaAtiva.id);
      const interval = setInterval(() => carregarMensagens(conversaAtiva.id), 2000);
      return () => clearInterval(interval);
    }
  }, [conversaAtiva?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  // Alterna atendimento entre robô e humano
  const alternarEstadoAtendimento = async () => {
    if (!conversaAtiva) return;
    const novoEstado = conversaAtiva.estado === "humano" ? "bot" : "humano";

    try {
      const { error } = await supabase
        .from("bot_conversas")
        .update({ estado: novoEstado })
        .eq("id", conversaAtiva.id);

      if (error) throw error;
      setConversaAtiva({ ...conversaAtiva, estado: novoEstado });
      toast.success(
        novoEstado === "humano"
          ? "Atendimento assumido por humano (Robô pausado)"
          : "Robô reativado para esta conversa"
      );
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro ao alternar modo: ${err.message}`);
    }
  };

  // Enviar mensagem humana
  const enviarMensagem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversaAtiva || !textoEnvio.trim()) return;

    setEnviando(true);
    try {
      const conexaoId = conversaAtiva.conexao_id || conexoes[0]?.id;
      if (!conexaoId) throw new Error("Nenhuma conexão de WhatsApp ativa");

      const res = await fetch("/api/bot/disparos/enviar-direta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conexaoId,
          telefone: conversaAtiva.telefone,
          texto: textoEnvio.trim(),
          cartaoId: conversaAtiva.cartao_id,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || "Falha ao enviar");

      setTextoEnvio("");
      carregarMensagens(conversaAtiva.id);
      toast.success("Mensagem enviada!");
    } catch (err: any) {
      toast.error(`Erro ao enviar: ${err.message}`);
    } finally {
      setEnviando(false);
    }
  };

  const conversasFiltradas = conversas.filter((c) => {
    const termo = busca.toLowerCase();
    return (
      (c.nome && c.nome.toLowerCase().includes(termo)) ||
      (c.telefone && c.telefone.includes(termo))
    );
  });

  return (
    <div className="p-6 h-[calc(100vh-4rem)] flex gap-6 max-w-7xl mx-auto">
      {/* Left Column: Conversas List */}
      <div className="w-80 glass-panel rounded-3xl p-4 flex flex-col border border-white/10 overflow-hidden">
        <div className="space-y-3 pb-3 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-red-500" /> Central de Chat
            </h3>
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por nome ou número..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-black border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
            />
          </div>
        </div>

        {/* Lista de Contatos */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pt-3 pr-1">
          {conversasFiltradas.map((c) => {
            const isSelected = conversaAtiva?.id === c.id;

            return (
              <div
                key={c.id}
                onClick={() => setConversaAtiva(c)}
                className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? "bg-red-600/20 border-red-500/40 text-white font-bold shadow-sm shadow-red-950/30"
                    : "bg-white/[0.02] border-white/5 text-slate-300 hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-black border border-white/10 flex items-center justify-center font-bold text-xs text-red-500">
                    {(c.nome || c.telefone).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <h4 className="text-xs font-bold truncate">{c.nome || c.telefone}</h4>
                    <p className="text-[11px] text-slate-400 font-mono truncate">{c.telefone}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      c.estado === "humano"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-red-500/20 text-red-300 border border-red-500/30"
                    }`}
                  >
                    {c.estado === "humano" ? "Humano" : "Robô"}
                  </span>
                </div>
              </div>
            );
          })}

          {conversasFiltradas.length === 0 && (
            <p className="text-center py-8 text-xs text-slate-500">Nenhuma conversa encontrada.</p>
          )}
        </div>
      </div>

      {/* Right Column: Chat Box */}
      <div className="flex-1 glass-panel rounded-3xl p-6 flex flex-col border border-white/10 overflow-hidden bg-black/60">
        {conversaAtiva ? (
          <>
            {/* Header da Conversa */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center font-bold text-sm border border-red-500/30">
                  {(conversaAtiva.nome || conversaAtiva.telefone).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {conversaAtiva.nome || conversaAtiva.telefone}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
                    <span>{conversaAtiva.telefone}</span>
                    <span>•</span>
                    <span className="text-red-400 font-semibold">
                      {conversaAtiva.cartao_id ? "Lead Vinculado ao CRM" : "Novo Contato"}
                    </span>
                  </p>
                </div>
              </div>

              {/* Bot / Humano Switcher */}
              <div className="flex items-center gap-3">
                <button
                  onClick={alternarEstadoAtendimento}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                    conversaAtiva.estado === "humano"
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                      : "bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25"
                  }`}
                >
                  {conversaAtiva.estado === "humano" ? (
                    <>
                      <UserCheck className="w-4 h-4 text-amber-400" />
                      <span>Atendente Humano Ativo</span>
                    </>
                  ) : (
                    <>
                      <Bot className="w-4 h-4 text-red-500" />
                      <span>Robô Automático Ativo</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Mensagens Timeline */}
            <div className="flex-1 overflow-y-auto py-6 space-y-4 pr-2">
              {mensagens.map((msg) => {
                const isSaida = msg.direcao === "saida";

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isSaida ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-lg rounded-2xl p-4 space-y-1.5 shadow-md ${
                        isSaida
                          ? "bg-red-600 text-white rounded-tr-none font-medium shadow-red-950/40"
                          : "bg-[#101014] border border-white/10 text-white rounded-tl-none"
                      }`}
                    >
                      <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.corpo}</p>
                      
                      <div
                        className={`flex items-center justify-end gap-1.5 text-[10px] ${
                          isSaida ? "text-white/80" : "text-slate-500"
                        }`}
                      >
                        <span>
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {isSaida && (
                          <span>
                            {msg.status === "enviada" ? (
                              <CheckCheck className="w-3.5 h-3.5 text-white" />
                            ) : msg.status === "erro" ? (
                              <AlertCircle className="w-3.5 h-3.5 text-red-300" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-white/70" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />

              {mensagens.length === 0 && (
                <div className="text-center py-16 text-xs text-slate-500">
                  Nenhuma mensagem trocada com este contato ainda.
                </div>
              )}
            </div>

            {/* Input de Envio */}
            <form onSubmit={enviarMensagem} className="pt-4 border-t border-white/10 flex gap-3">
              <input
                type="text"
                placeholder="Digite sua resposta no WhatsApp..."
                value={textoEnvio}
                onChange={(e) => setTextoEnvio(e.target.value)}
                className="flex-1 rounded-2xl bg-black border border-white/10 px-4 py-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500 shadow-inner"
              />
              <button
                type="submit"
                disabled={enviando || !textoEnvio.trim()}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-red-950/40 transition"
              >
                <Send className="w-4 h-4" />
                {enviando ? "Enviando..." : "Enviar"}
              </button>
            </form>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
            <MessageSquare className="w-8 h-8 text-slate-600" />
            <p>Selecione uma conversa ao lado para visualizar e responder.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversasView;

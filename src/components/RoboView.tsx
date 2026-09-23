import React, { useState } from "react";
import { Conexao, Fluxo, Passo, Opcao, Partner } from "@/types";
import { supabase } from "@/lib/supabase";
import {
  Bot,
  Smartphone,
  Plus,
  Trash2,
  Copy,
  Check,
  Play,
  Pause,
  AlertTriangle,
  QrCode,
  Wifi,
  WifiOff,
  ChevronRight,
  Edit2,
  X,
  Send,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";

interface RoboViewProps {
  partner: Partner | null;
  conexoes: Conexao[];
  fluxos: Fluxo[];
  passos: Passo[];
  onRefresh: () => void;
}

export const RoboView: React.FC<RoboViewProps> = ({
  partner,
  conexoes,
  fluxos,
  passos,
  onRefresh,
}) => {
  const [abaAtiva, setAbaAtiva] = useState<"conexoes" | "fluxos">("conexoes");
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Modal Nova Conexão
  const [modalNovaConexao, setModalNovaConexao] = useState(false);
  const [nomeConexao, setNomeConexao] = useState("");
  const [limiteDiario, setLimiteDiario] = useState(300);

  // Modal Novo Fluxo
  const [modalNovoFluxo, setModalNovoFluxo] = useState(false);
  const [nomeFluxo, setNomeFluxo] = useState("");
  const [gatilhoTipo, setGatilhoTipo] = useState<"primeira_mensagem" | "palavra_chave">("primeira_mensagem");
  const [gatilhoValor, setGatilhoValor] = useState("");

  // Fluxo Selecionado para Edição de Passos
  const [fluxoSelecionado, setFluxoSelecionado] = useState<Fluxo | null>(fluxos[0] || null);
  const [modalNovoPasso, setModalNovoPasso] = useState(false);
  const [passoChave, setPassoChave] = useState("");
  const [passoTipo, setPassoTipo] = useState<"mensagem" | "pergunta" | "transferir" | "encerrar">("pergunta");
  const [passoConteudo, setPassoConteudo] = useState("");

  const copiarSegredo = (segredo: string, id: string) => {
    navigator.clipboard.writeText(segredo);
    setCopiadoId(id);
    toast.success("Segredo do conector copiado!");
    setTimeout(() => setCopiadoId(null), 2000);
  };

  const criarConexao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner || !nomeConexao.trim()) return;

    try {
      const { error } = await supabase.from("bot_conexoes").insert({
        escopo: "parceiro",
        owner_id: partner.id,
        nome: nomeConexao.trim(),
        limite_diario: Number(limiteDiario) || 300,
        status: "desconectado",
      });

      if (error) throw error;
      toast.success("Conexão criada! Copie o segredo para o conector.");
      setNomeConexao("");
      setModalNovaConexao(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const alternarStatusFluxo = async (fluxo: Fluxo) => {
    try {
      const { error } = await supabase
        .from("bot_fluxos")
        .update({ ativo: !fluxo.ativo })
        .eq("id", fluxo.id);
      if (error) throw error;
      toast.success(fluxo.ativo ? "Fluxo desativado" : "Fluxo ativado");
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const criarFluxo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner || !nomeFluxo.trim()) return;

    try {
      const { data, error } = await supabase
        .from("bot_fluxos")
        .insert({
          escopo: "parceiro",
          owner_id: partner.id,
          nome: nomeFluxo.trim(),
          ativo: true,
          gatilho_tipo: gatilhoTipo,
          gatilho_valor: gatilhoTipo === "palavra_chave" ? gatilhoValor.trim() : null,
        })
        .select()
        .single();

      if (error) throw error;
      toast.success("Fluxo criado!");
      setNomeFluxo("");
      setGatilhoValor("");
      setModalNovoFluxo(false);
      onRefresh();
      if (data) setFluxoSelecionado(data as Fluxo);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const criarPasso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fluxoSelecionado || !passoChave.trim() || !passoConteudo.trim()) return;

    try {
      const { data: passoCriado, error } = await supabase
        .from("bot_passos")
        .insert({
          fluxo_id: fluxoSelecionado.id,
          chave: passoChave.trim(),
          tipo: passoTipo,
          conteudo: passoConteudo.trim(),
          posicao: passos.length + 1,
        })
        .select()
        .single();

      if (error) throw error;

      // Se o fluxo ainda não tinha passo inicial, define este como o inicial
      if (!fluxoSelecionado.passo_inicial_id && passoCriado) {
        await supabase
          .from("bot_fluxos")
          .update({ passo_inicial_id: passoCriado.id })
          .eq("id", fluxoSelecionado.id);
      }

      toast.success("Passo adicionado ao fluxo!");
      setPassoChave("");
      setPassoConteudo("");
      setModalNovoPasso(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header with Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-400" /> Automação de Atendimento (Robô WhatsApp)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Gerencie conexões do WhatsApp, menus interativos e fluxos automáticos.
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 bg-slate-900 border border-white/10 p-1 rounded-2xl">
          <button
            onClick={() => setAbaAtiva("conexoes")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              abaAtiva === "conexoes"
                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Conexões & Números
          </button>
          <button
            onClick={() => setAbaAtiva("fluxos")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              abaAtiva === "fluxos"
                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Construtor de Fluxos
          </button>
        </div>
      </div>

      {/* ABA 1: CONEXÕES & NÚMEROS */}
      {abaAtiva === "conexoes" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Conexões do WhatsApp ({conexoes.length})
            </h3>
            <button
              onClick={() => setModalNovaConexao(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Nova Conexão
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {conexoes.map((conexao) => {
              const isConectado = conexao.status === "conectado";

              return (
                <div
                  key={conexao.id}
                  className="glass-panel rounded-3xl p-6 border border-white/10 space-y-5 relative overflow-hidden"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">{conexao.nome}</h4>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        {conexao.numero || "Número não pareado"}
                      </p>
                    </div>

                    <span
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        isConectado
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      }`}
                    >
                      {isConectado ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                      {conexao.status}
                    </span>
                  </div>

                  {/* Limits & Stats */}
                  <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-900/80 border border-white/5 text-xs">
                    <div>
                      <span className="text-[11px] text-slate-400 block">Enviadas Hoje</span>
                      <span className="text-sm font-bold text-white font-mono">{conexao.enviadas_hoje || 0}</span>
                      <span className="text-[10px] text-slate-500"> / {conexao.limite_diario || 300} max</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">Último Batimento</span>
                      <span className="text-xs font-mono text-emerald-400">
                        {conexao.visto_em ? new Date(conexao.visto_em).toLocaleTimeString() : "Nunca"}
                      </span>
                    </div>
                  </div>

                  {/* Credentials / Secret for Connector */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                      <span>Segredo do Conector</span>
                      <span className="text-[10px] text-slate-500">Copiar para o conector</span>
                    </label>
                    <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
                      <code className="text-xs text-emerald-400 font-mono truncate flex-1 select-all">
                        {conexao.webhook_segredo}
                      </code>
                      <button
                        onClick={() => copiarSegredo(conexao.webhook_segredo, conexao.id)}
                        className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                        title="Copiar segredo"
                      >
                        {copiadoId === conexao.id ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      ID da Conexão: <span className="font-mono text-slate-400">{conexao.id}</span>
                    </p>
                  </div>
                </div>
              );
            })}

            {conexoes.length === 0 && (
              <div className="col-span-full py-12 text-center glass-panel rounded-3xl border border-dashed border-white/10 text-xs text-slate-400 space-y-3">
                <p>Nenhuma conexão criada ainda.</p>
                <button
                  onClick={() => setModalNovaConexao(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold"
                >
                  Criar Primeira Conexão
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: CONSTRUTOR DE FLUXOS */}
      {abaAtiva === "fluxos" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Lista de Fluxos */}
          <div className="glass-panel rounded-3xl p-6 border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Fluxos Criados</h3>
              <button
                onClick={() => setModalNovoFluxo(true)}
                className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              {fluxos.map((fluxo) => {
                const isSelected = fluxoSelecionado?.id === fluxo.id;

                return (
                  <div
                    key={fluxo.id}
                    onClick={() => setFluxoSelecionado(fluxo)}
                    className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-emerald-500/10 border-emerald-500/40 text-white"
                        : "bg-white/[0.02] border-white/5 text-slate-300 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div>
                      <h4 className="text-xs font-bold">{fluxo.nome}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {fluxo.gatilho_tipo === "primeira_mensagem"
                          ? "Gatilho: Primeira Mensagem"
                          : `Palavra-chave: "${fluxo.gatilho_valor}"`}
                      </p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        alternarStatusFluxo(fluxo);
                      }}
                      className={`p-1.5 rounded-lg text-xs font-semibold ${
                        fluxo.ativo ? "text-emerald-400 hover:bg-emerald-500/20" : "text-slate-500 hover:bg-white/10"
                      }`}
                      title={fluxo.ativo ? "Desativar" : "Ativar"}
                    >
                      {fluxo.ativo ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })}

              {fluxos.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-6">Nenhum fluxo cadastrado.</p>
              )}
            </div>
          </div>

          {/* Right: Passos do Fluxo Selecionado */}
          <div className="lg:col-span-2 glass-panel rounded-3xl p-6 border border-white/10 space-y-6">
            {fluxoSelecionado ? (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div>
                    <h3 className="text-base font-bold text-white">{fluxoSelecionado.nome}</h3>
                    <p className="text-xs text-slate-400">
                      Configuração das etapas e mensagens que o robô responderá
                    </p>
                  </div>
                  <button
                    onClick={() => setModalNovoPasso(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20"
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar Passo
                  </button>
                </div>

                {/* Passos List */}
                <div className="space-y-4">
                  {passos
                    .filter((p) => p.fluxo_id === fluxoSelecionado.id)
                    .map((passo, idx) => (
                      <div
                        key={passo.id}
                        className="p-4 rounded-2xl bg-slate-900/80 border border-white/5 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold font-mono">
                              {idx + 1}
                            </span>
                            <h4 className="text-xs font-bold text-white">{passo.chave}</h4>
                            <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-semibold text-slate-300">
                              {passo.tipo}
                            </span>
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-slate-200 whitespace-pre-wrap">
                          {passo.conteudo}
                        </div>
                      </div>
                    ))}

                  {passos.filter((p) => p.fluxo_id === fluxoSelecionado.id).length === 0 && (
                    <div className="text-center py-12 text-slate-500 text-xs">
                      Este fluxo ainda não tem passos. Clique em "Adicionar Passo" acima para criar a mensagem de boas-vindas.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-16 text-slate-500 text-xs">
                Selecione ou crie um fluxo ao lado para editar seus passos.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Nova Conexão */}
      {modalNovaConexao && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Adicionar Conexão de WhatsApp</h3>
              <button onClick={() => setModalNovaConexao(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={criarConexao} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Nome da Conexão / Chip *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: WhatsApp Vendas 01"
                  value={nomeConexao}
                  onChange={(e) => setNomeConexao(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Limite Diário de Disparos</label>
                <input
                  type="number"
                  value={limiteDiario}
                  onChange={(e) => setLimiteDiario(Number(e.target.value))}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Recomendado: 300 mensagens/dia por chip para prevenir bloqueios.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNovaConexao(false)}
                  className="px-4 py-2 text-xs text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                >
                  Criar Conexão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Novo Fluxo */}
      {modalNovoFluxo && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Novo Fluxo de Atendimento</h3>
              <button onClick={() => setModalNovoFluxo(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={criarFluxo} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Nome do Fluxo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Boas-vindas Geral"
                  value={nomeFluxo}
                  onChange={(e) => setNomeFluxo(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Gatilho de Disparo</label>
                <select
                  value={gatilhoTipo}
                  onChange={(e: any) => setGatilhoTipo(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="primeira_mensagem">Primeira Mensagem (Boas-vindas)</option>
                  <option value="palavra_chave">Palavra-chave específica</option>
                </select>
              </div>

              {gatilhoTipo === "palavra_chave" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    Palavras-chave (separadas por vírgula)
                  </label>
                  <input
                    type="text"
                    placeholder="preço, planos, catálogo, cardápio"
                    value={gatilhoValor}
                    onChange={(e) => setGatilhoValor(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNovoFluxo(false)}
                  className="px-4 py-2 text-xs text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                >
                  Salvar Fluxo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Novo Passo */}
      {modalNovoPasso && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-lg p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Adicionar Passo ao Fluxo</h3>
              <button onClick={() => setModalNovoPasso(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={criarPasso} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Identificador (Chave) *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: menu_principal"
                    value={passoChave}
                    onChange={(e) => setPassoChave(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Tipo de Passo</label>
                  <select
                    value={passoTipo}
                    onChange={(e: any) => setPassoTipo(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="pergunta">Pergunta com Menu/Opções</option>
                    <option value="mensagem">Apenas Mensagem e Segue</option>
                    <option value="transferir">Transferir para Atendente</option>
                    <option value="encerrar">Encerrar Atendimento</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Texto da Mensagem *</label>
                <textarea
                  rows={5}
                  required
                  placeholder="Olá! Como podemos te ajudar hoje?&#10;&#10;1 - Conhecer nossos produtos&#10;2 - Falar com atendente"
                  value={passoConteudo}
                  onChange={(e) => setPassoConteudo(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 p-3 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none font-sans"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNovoPasso(false)}
                  className="px-4 py-2 text-xs text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                >
                  Salvar Passo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

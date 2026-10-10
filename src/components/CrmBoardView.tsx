import React, { useState } from "react";
import { QuadroCrm, ColunaCrm, CartaoCrm, AtividadeCrm } from "@/types";
import { supabase, exigirLinhas } from "@/lib/supabase";
import { apiJson } from "@/lib/api";
import {
  Plus,
  Trash2,
  Phone,
  Mail,
  Send,
  Upload,
  Clock,
  X,
  User,
  DollarSign,
  AlertCircle,
  CheckCircle,
  MessageSquare,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";

interface CrmBoardViewProps {
  quadros: QuadroCrm[];
  quadroAtivo: QuadroCrm | null;
  colunas: ColunaCrm[];
  cartoes: CartaoCrm[];
  onSelectQuadro: (quadro: QuadroCrm) => void;
  onRefresh: () => void;
  conexaoId?: string;
}

export const CrmBoardView: React.FC<CrmBoardViewProps> = ({
  quadros,
  quadroAtivo,
  colunas,
  cartoes,
  onSelectQuadro,
  onRefresh,
  conexaoId,
}) => {
  const [modalNovoCartao, setModalNovoCartao] = useState(false);
  const [colunaDestinoId, setColunaDestinoId] = useState<string>("");
  const [cartaoDetalhes, setCartaoDetalhes] = useState<CartaoCrm | null>(null);
  const [atividadesCartao, setAtividadesCartao] = useState<AtividadeCrm[]>([]);
  const [modalImportar, setModalImportar] = useState(false);
  const [textoImportacao, setTextoImportacao] = useState("");
  const [msgDiretaTexto, setMsgDiretaTexto] = useState("");
  const [enviandoMsg, setEnviandoMsg] = useState(false);

  // Form novo cartão
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novoValor, setNovoValor] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");

  const abrirNovoCartao = (colunaId: string) => {
    setColunaDestinoId(colunaId);
    setNovoTitulo("");
    setNovoNome("");
    setNovoTelefone("");
    setNovoEmail("");
    setNovoValor("");
    setNovaDescricao("");
    setModalNovoCartao(true);
  };

  const salvarNovoCartao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quadroAtivo || !colunaDestinoId || !novoTitulo.trim()) {
      toast.error("Preencha o título do lead");
      return;
    }

    try {
      const { error } = await supabase.from("crm_cartoes").insert({
        quadro_id: quadroAtivo.id,
        coluna_id: colunaDestinoId,
        titulo: novoTitulo.trim(),
        contato_nome: novoNome.trim() || null,
        contato_telefone: novoTelefone.replace(/\D/g, "") || null,
        contato_email: novoEmail.trim() || null,
        // crm_cartoes.valor não existe no banco instalado hoje: só envia quando preenchido.
        ...(novoValor ? { valor: parseFloat(novoValor) } : {}),
        descricao: novaDescricao.trim() || null,
        posicao: 9999,
        prioridade: "normal",
      });

      if (error) throw error;
      toast.success("Lead adicionado com sucesso!");
      setModalNovoCartao(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro ao criar lead: ${err.message}`);
    }
  };

  const carregarAtividades = async (cartaoId: string) => {
    const { data, error } = await supabase
      .from("crm_atividades")
      .select("*")
      .eq("cartao_id", cartaoId)
      .order("created_at", { ascending: false });
    if (error) console.warn("Erro ao carregar atividades:", error.message);
    setAtividadesCartao((data as AtividadeCrm[]) || []);
  };

  const abrirDetalhes = async (cartao: CartaoCrm) => {
    setCartaoDetalhes(cartao);
    setAtividadesCartao([]);
    await carregarAtividades(cartao.id);
  };

  const moverCartao = async (cartaoId: string, novaColunaId: string) => {
    try {
      exigirLinhas(
        await supabase
          .from("crm_cartoes")
          .update({ coluna_id: novaColunaId, updated_at: new Date().toISOString() })
          .eq("id", cartaoId)
          .select("id")
      );
      toast.success("Lead movido de coluna");
      onRefresh();
      if (cartaoDetalhes && cartaoDetalhes.id === cartaoId) {
        setCartaoDetalhes({ ...cartaoDetalhes, coluna_id: novaColunaId });
      }
    } catch (err: any) {
      toast.error(`Erro ao mover lead: ${err.message}`);
    }
  };

  const deletarCartao = async (cartaoId: string) => {
    if (!confirm("Deseja realmente excluir este lead?")) return;
    try {
      exigirLinhas(await supabase.from("crm_cartoes").delete().eq("id", cartaoId).select("id"));
      toast.success("Lead excluído");
      setCartaoDetalhes(null);
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro ao excluir: ${err.message}`);
    }
  };

  const enviarWhatsAppDireto = async () => {
    if (!cartaoDetalhes || !cartaoDetalhes.contato_telefone || !msgDiretaTexto.trim()) {
      toast.error("Preencha a mensagem e certifique-se de que o lead possui telefone");
      return;
    }

    if (!conexaoId) {
      toast.error("Nenhuma conexão de WhatsApp ativa selecionada");
      return;
    }

    setEnviandoMsg(true);
    try {
      await apiJson("/api/bot/disparos/enviar-direta", {
        method: "POST",
        body: JSON.stringify({
          conexaoId,
          telefone: cartaoDetalhes.contato_telefone,
          texto: msgDiretaTexto,
          cartaoId: cartaoDetalhes.id,
        }),
      });

      toast.success("Mensagem enfileirada no WhatsApp!");
      setMsgDiretaTexto("");
      await carregarAtividades(cartaoDetalhes.id);
    } catch (err: any) {
      toast.error(`Erro no envio: ${err.message}`);
    } finally {
      setEnviandoMsg(false);
    }
  };

  const processarImportacao = async () => {
    if (!quadroAtivo || !textoImportacao.trim()) {
      toast.error("Cole a lista de contatos");
      return;
    }

    const primeiraColuna = colunas[0];
    if (!primeiraColuna) {
      toast.error("O funil precisa ter ao menos uma coluna");
      return;
    }

    const linhas = textoImportacao.split("\n").map((l) => l.trim()).filter(Boolean);
    const novos = [];

    for (const linha of linhas) {
      const partes = linha.split(/[,;\t]/).map((p) => p.trim());
      const nome = partes[0] || "Contato Importado";
      const tel = (partes[1] || "").replace(/\D/g, "") || (partes[0] || "").replace(/\D/g, "");

      if (tel) {
        novos.push({
          quadro_id: quadroAtivo.id,
          coluna_id: primeiraColuna.id,
          titulo: nome,
          contato_nome: nome,
          contato_telefone: tel,
          posicao: 9999,
          prioridade: "normal",
        });
      }
    }

    if (novos.length === 0) {
      toast.error("Nenhuma linha com telefone encontrada");
      return;
    }

    // Um insert só: ou entram todos, ou nenhum (e o erro aparece).
    const { error } = await supabase.from("crm_cartoes").insert(novos);
    if (error) {
      toast.error(`Erro ao importar: ${error.message}`);
      return;
    }

    toast.success(`${novos.length} contatos importados com sucesso!`);
    setTextoImportacao("");
    setModalImportar(false);
    onRefresh();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 flex flex-col h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-4rem)]">
      {/* Top Controls: Funil Selector & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">Funil de Vendas (Kanban)</h2>
          {quadros.length > 0 && (
            <select
              value={quadroAtivo?.id || ""}
              onChange={(e) => {
                const found = quadros.find((q) => q.id === e.target.value);
                if (found) onSelectQuadro(found);
              }}
              className="bg-black border border-white/10 text-xs font-semibold text-red-500 rounded-xl px-3 py-1.5 focus:outline-none"
            >
              {quadros.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.nome}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setModalImportar(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#16161c] hover:bg-[#202028] text-white text-xs font-semibold border border-white/10 hover:border-red-500/40 transition"
          >
            <Upload className="w-3.5 h-3.5 text-red-500" />
            Importar Contatos
          </button>
          {colunas.length > 0 && (
            <button
              onClick={() => abrirNovoCartao(colunas[0].id)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-950/40 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Lead
            </button>
          )}
        </div>
      </div>

      {/* Kanban Columns Board */}
      <div className="flex-1 min-h-0 overflow-x-auto snap-x snap-mandatory overscroll-x-contain -mx-4 px-4 md:mx-0 md:px-0 pb-4">
        <div className="flex gap-3 md:gap-4 h-full min-w-max items-start">
          {colunas.map((coluna) => {
            const cartoesDaColuna = cartoes.filter((c) => c.coluna_id === coluna.id);

            return (
              <div
                key={coluna.id}
                className="w-[85vw] max-w-[20rem] sm:w-80 snap-start flex flex-col rounded-2xl bg-slate-900/60 border border-white/10 p-3 h-full max-h-full"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-3 px-1 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: coluna.cor || "#10b981" }}
                    />
                    <h3 className="text-xs font-bold text-white tracking-wide uppercase">
                      {coluna.nome}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-bold text-slate-300">
                      {cartoesDaColuna.length}
                    </span>
                  </div>

                  <button
                    onClick={() => abrirNovoCartao(coluna.id)}
                    className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Cards Container */}
                <div className="flex-1 overflow-y-auto space-y-3 pt-3 pr-1">
                  {cartoesDaColuna.map((cartao) => (
                    <div
                      key={cartao.id}
                      onClick={() => abrirDetalhes(cartao)}
                      className="glass-card rounded-xl p-3.5 border border-white/5 hover:border-red-500/40 transition-all cursor-pointer space-y-2 group shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-white group-hover:text-red-400 transition">
                          {cartao.titulo}
                        </h4>
                        {cartao.valor && (
                          <span className="text-[11px] font-bold text-white font-mono bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 rounded">
                            R$ {cartao.valor.toFixed(2)}
                          </span>
                        )}
                      </div>

                      {cartao.contato_nome && cartao.contato_nome !== cartao.titulo && (
                        <p className="text-[11px] text-slate-300 flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-500" />
                          {cartao.contato_nome}
                        </p>
                      )}

                      {cartao.contato_telefone && (
                        <p className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-red-500" />
                          {cartao.contato_telefone}
                        </p>
                      )}

                      <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(cartao.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-red-400 group-hover:translate-x-0.5 transition-transform flex items-center font-bold">
                          Ver detalhes <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  ))}

                  {cartoesDaColuna.length === 0 && (
                    <div className="py-8 text-center border-2 border-dashed border-white/5 rounded-xl text-[11px] text-slate-500">
                      Nenhum lead nesta etapa
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal: Novo Cartão */}
      {modalNovoCartao && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-lg p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Criar Novo Lead no Funil</h3>
              <button
                onClick={() => setModalNovoCartao(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={salvarNovoCartao} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Título do Lead / Oportunidade *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Consultoria - Carlos Silva"
                  value={novoTitulo}
                  onChange={(e) => setNovoTitulo(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    Nome do Contato
                  </label>
                  <input
                    type="text"
                    placeholder="Carlos Silva"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    WhatsApp / Telefone
                  </label>
                  <input
                    type="text"
                    placeholder="11999999999"
                    value={novoTelefone}
                    onChange={(e) => setNovoTelefone(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">E-mail</label>
                  <input
                    type="email"
                    placeholder="carlos@email.com"
                    value={novoEmail}
                    onChange={(e) => setNovoEmail(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Valor (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="1500.00"
                    value={novoValor}
                    onChange={(e) => setNovoValor(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Observações / Descrição
                </label>
                <textarea
                  rows={3}
                  placeholder="Informações relevantes sobre a negociação..."
                  value={novaDescricao}
                  onChange={(e) => setNovaDescricao(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNovoCartao(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-950/40"
                >
                  Criar Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Detalhes do Lead & Envio de WhatsApp */}
      {cartaoDetalhes && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-2xl p-6 space-y-6 border border-white/10 animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-bold text-white">{cartaoDetalhes.titulo}</h3>
                <p className="text-xs text-slate-400">ID: {cartaoDetalhes.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => deletarCartao(cartaoDetalhes.id)}
                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition"
                  title="Excluir lead"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCartaoDetalhes(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-y-auto pr-1">
              {/* Left: Lead Info & Mover Coluna */}
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-white/5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Dados do Lead
                  </h4>
                  {cartaoDetalhes.contato_nome && (
                    <p className="text-xs text-white flex items-center gap-2">
                      <User className="w-4 h-4 text-slate-400" />
                      {cartaoDetalhes.contato_nome}
                    </p>
                  )}
                  {cartaoDetalhes.contato_telefone && (
                    <p className="text-xs text-white flex items-center gap-2 font-mono">
                      <Phone className="w-4 h-4 text-red-500" />
                      {cartaoDetalhes.contato_telefone}
                    </p>
                  )}
                  {cartaoDetalhes.contato_email && (
                    <p className="text-xs text-white flex items-center gap-2">
                      <Mail className="w-4 h-4 text-slate-400" />
                      {cartaoDetalhes.contato_email}
                    </p>
                  )}
                  {cartaoDetalhes.valor && (
                    <p className="text-xs text-white font-bold flex items-center gap-2 font-mono">
                      <DollarSign className="w-4 h-4 text-red-500" />
                      R$ {cartaoDetalhes.valor.toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Mover Etapa */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400">Etapa Atual do Funil</label>
                  <select
                    value={cartaoDetalhes.coluna_id}
                    onChange={(e) => moverCartao(cartaoDetalhes.id, e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-red-500"
                  >
                    {colunas.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.nome}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Envio direto de WhatsApp */}
                <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/20 space-y-3">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-red-500" /> Enviar WhatsApp Direto
                  </h4>
                  <textarea
                    rows={3}
                    placeholder="Digite a mensagem para enviar agora pelo WhatsApp..."
                    value={msgDiretaTexto}
                    onChange={(e) => setMsgDiretaTexto(e.target.value)}
                    className="w-full rounded-xl bg-black border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-red-500 resize-none"
                  />
                  <button
                    onClick={enviarWhatsAppDireto}
                    disabled={enviandoMsg || !msgDiretaTexto.trim()}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold transition shadow-lg shadow-red-950/40"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {enviandoMsg ? "Enviando..." : "Disparar Mensagem"}
                  </button>
                </div>
              </div>

              {/* Right: Histórico & Atividades */}
              <div className="space-y-3 flex flex-col">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Histórico de Atividades & Mensagens
                </h4>
                <div className="flex-1 overflow-y-auto space-y-2.5 p-3 rounded-2xl bg-slate-900/60 border border-white/5 max-h-80">
                  {atividadesCartao.map((ativ) => (
                    <div key={ativ.id} className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-semibold text-red-400 uppercase">{ativ.tipo}</span>
                        <span>{new Date(ativ.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-200 text-[11px] whitespace-pre-wrap">{ativ.corpo || "Atividade registrada"}</p>
                    </div>
                  ))}
                  {atividadesCartao.length === 0 && (
                    <p className="text-xs text-slate-500 text-center py-6">Nenhuma atividade registrada ainda.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Importar Contatos */}
      {modalImportar && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-lg p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Importar Lista de Contatos</h3>
              <button
                onClick={() => setModalImportar(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Cole abaixo sua lista de contatos (um por linha). Formato recomendado: <br />
              <code className="text-red-400 font-mono">Nome, Telefone com DDD</code> ou apenas <code className="text-red-400 font-mono">Telefone</code>.
            </p>

            <textarea
              rows={8}
              placeholder="Maria Oliveira, 11988887777&#10;João Santos, 21977776666&#10;11966665555"
              value={textoImportacao}
              onChange={(e) => setTextoImportacao(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-white/10 p-3 text-xs text-white focus:outline-none focus:border-red-500 font-mono resize-none"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setModalImportar(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={processarImportacao}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-950/40"
              >
                Importar Contatos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

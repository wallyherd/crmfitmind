import React, { useState } from "react";
import { Partner, Conexao, DisparoCampanha, ColunaCrm, CartaoCrm } from "@/types";
import { supabase } from "@/lib/supabase";
import {
  Megaphone,
  Plus,
  Play,
  X,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  Pause,
  Send,
  FileText,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

interface DisparosViewProps {
  partner: Partner | null;
  conexoes: Conexao[];
  campanhas: DisparoCampanha[];
  colunas: ColunaCrm[];
  cartoes: CartaoCrm[];
  onRefresh: () => void;
}

export const DisparosView: React.FC<DisparosViewProps> = ({
  partner,
  conexoes,
  campanhas,
  colunas,
  cartoes,
  onRefresh,
}) => {
  const [modalNovaCampanha, setModalNovaCampanha] = useState(false);
  const [nomeCampanha, setNomeCampanha] = useState("");
  const [mensagemCampanha, setMensagemCampanha] = useState("");
  const [intervaloSegundos, setIntervaloSegundos] = useState(20);
  const [origemAlvos, setOrigemAlvos] = useState<"coluna_crm" | "lista_colada">("coluna_crm");
  const [colunaSelecionadaId, setColunaSelecionadaId] = useState<string>(colunas[0]?.id || "");
  const [textoListaColada, setTextoListaColada] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Calcula estimativa de alvos
  const alvosEstimados =
    origemAlvos === "coluna_crm"
      ? cartoes.filter((c) => c.coluna_id === colunaSelecionadaId && c.contato_telefone).length
      : textoListaColada.split("\n").filter((l) => l.replace(/\D/g, "").length >= 10).length;

  const criarCampanha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner || !nomeCampanha.trim() || !mensagemCampanha.trim()) {
      toast.error("Preencha todos os campos da campanha");
      return;
    }

    if (alvosEstimados === 0) {
      toast.error("Nenhum contato válido encontrado para o disparo");
      return;
    }

    const conexaoAtiva = conexoes.find((c) => c.status === "conectado") || conexoes[0];
    if (!conexaoAtiva) {
      toast.error("Crie ao menos uma conexão de WhatsApp antes de disparar");
      return;
    }

    setSalvando(true);
    try {
      // 1. Cria a campanha
      const { data: camp, error: erroCamp } = await supabase
        .from("bot_disparos")
        .insert({
          escopo: "parceiro",
          owner_id: partner.id,
          nome: nomeCampanha.trim(),
          mensagem: mensagemCampanha.trim(),
          intervalo_segundos: Number(intervaloSegundos) || 20,
          status: "em_andamento",
          iniciado_em: new Date().toISOString(),
        })
        .select()
        .single();

      if (erroCamp) throw erroCamp;

      // 2. Coleta a lista de alvos
      let listaAlvos: Array<{ telefone: string; nome: string | null; cartao_id?: string }> = [];

      if (origemAlvos === "coluna_crm") {
        listaAlvos = cartoes
          .filter((c) => c.coluna_id === colunaSelecionadaId && c.contato_telefone)
          .map((c) => ({
            telefone: c.contato_telefone!.replace(/\D/g, ""),
            nome: c.contato_nome || c.titulo,
            cartao_id: c.id,
          }));
      } else {
        const linhas = textoListaColada.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const linha of linhas) {
          const partes = linha.split(/[,;\t]/).map((p) => p.trim());
          const nome = partes.length > 1 ? partes[0] : null;
          const tel = (partes.length > 1 ? partes[1] : partes[0]).replace(/\D/g, "");
          if (tel.length >= 10) {
            listaAlvos.push({ telefone: tel, nome });
          }
        }
      }

      // 3. Enfileira as mensagens no Supabase com espaçamento de tempo
      const agora = new Date();
      let index = 0;

      for (const alvo of listaAlvos) {
        // Data agendada com intervalo em segundos
        const agendado = new Date(agora.getTime() + index * (Number(intervaloSegundos) || 20) * 1000);

        // Acha ou cria conversa
        let { data: conversa } = await supabase
          .from("bot_conversas")
          .select("id")
          .eq("conexao_id", conexaoAtiva.id)
          .eq("telefone", alvo.telefone)
          .maybeSingle();

        let conversaId = conversa?.id;
        if (!conversaId) {
          const { data: nova } = await supabase
            .from("bot_conversas")
            .insert({
              conexao_id: conexaoAtiva.id,
              telefone: alvo.telefone,
              nome: alvo.nome,
              estado: "humano", // Campanha nasce em estado humano para não prender em fluxo indesejado
              cartao_id: alvo.cartao_id || null,
            })
            .select("id")
            .single();
          conversaId = nova?.id;
        }

        if (conversaId) {
          // Substitui variáveis {nome}
          const textoPersonalizado = mensagemCampanha.replace(
            /{nome}/gi,
            alvo.nome || "Cliente"
          );

          await supabase.from("bot_mensagens").insert({
            conversa_id: conversaId,
            direcao: "saida",
            tipo: "texto",
            corpo: textoPersonalizado,
            status: "pendente",
            agendado_para: agendado.toISOString(),
          });
        }

        index++;
      }

      toast.success(`Campanha "${nomeCampanha}" iniciada! ${listaAlvos.length} mensagens enfileiradas.`);
      setModalNovaCampanha(false);
      setNomeCampanha("");
      setMensagemCampanha("");
      setTextoListaColada("");
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro ao criar disparo: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const cancelarCampanha = async (id: string) => {
    if (!confirm("Deseja realmente cancelar os envios pendentes desta campanha?")) return;
    try {
      const { error } = await supabase
        .from("bot_disparos")
        .update({ status: "cancelado", concluido_em: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast.success("Campanha cancelada!");
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-emerald-400" /> Campanhas & Disparos em Massa
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Envie mensagens para listas segmentadas com intervalo anti-ban e personalização por nome.
          </p>
        </div>

        <button
          onClick={() => setModalNovaCampanha(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition"
        >
          <Plus className="w-4 h-4" /> Nova Campanha de Disparo
        </button>
      </div>

      {/* Campanhas Grid */}
      <div className="space-y-4">
        {campanhas.map((camp) => (
          <div
            key={camp.id}
            className="glass-panel rounded-3xl p-6 border border-white/10 space-y-4 flex flex-col md:flex-row md:items-center justify-between gap-6"
          >
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-bold text-white">{camp.nome}</h3>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    camp.status === "concluido"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : camp.status === "em_andamento"
                      ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      : "bg-white/10 text-slate-400"
                  }`}
                >
                  {camp.status}
                </span>
              </div>

              <p className="text-xs text-slate-300 bg-black/40 p-3 rounded-xl border border-white/5 font-sans whitespace-pre-wrap max-h-24 overflow-y-auto">
                {camp.mensagem}
              </p>

              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  Intervalo: {camp.intervalo_segundos}s
                </span>
                <span>•</span>
                <span>
                  Criada em: {new Date(camp.created_at).toLocaleDateString()} às{" "}
                  {new Date(camp.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {camp.status === "em_andamento" && (
                <button
                  onClick={() => cancelarCampanha(camp.id)}
                  className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-bold transition flex items-center gap-1.5"
                >
                  <Pause className="w-3.5 h-3.5" /> Cancelar Restantes
                </button>
              )}
            </div>
          </div>
        ))}

        {campanhas.length === 0 && (
          <div className="text-center py-16 glass-panel rounded-3xl border border-dashed border-white/10 text-xs text-slate-500 space-y-2">
            <Megaphone className="w-8 h-8 text-slate-600 mx-auto" />
            <p>Nenhuma campanha criada ainda. Clique em "Nova Campanha de Disparo" para começar.</p>
          </div>
        )}
      </div>

      {/* Modal Nova Campanha */}
      {modalNovaCampanha && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-2xl p-6 space-y-6 border border-white/10 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold text-white">Criar Campanha de Disparo</h3>
              <button
                onClick={() => setModalNovaCampanha(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={criarCampanha} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Nome da Campanha *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Oferta Especial de Lançamento"
                  value={nomeCampanha}
                  onChange={(e) => setNomeCampanha(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Origem dos Contatos */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400">Público / Alvos *</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setOrigemAlvos("coluna_crm")}
                    className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition ${
                      origemAlvos === "coluna_crm"
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                        : "bg-slate-900 border-white/10 text-slate-400"
                    }`}
                  >
                    <Users className="w-4 h-4" /> Coluna do Funil CRM
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrigemAlvos("lista_colada")}
                    className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition ${
                      origemAlvos === "lista_colada"
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                        : "bg-slate-900 border-white/10 text-slate-400"
                    }`}
                  >
                    <FileText className="w-4 h-4" /> Colar Lista de Telefones
                  </button>
                </div>
              </div>

              {origemAlvos === "coluna_crm" ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    Selecione a Etapa do Funil
                  </label>
                  <select
                    value={colunaSelecionadaId}
                    onChange={(e) => setColunaSelecionadaId(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    {colunas.map((col) => {
                      const qtd = cartoes.filter((c) => c.coluna_id === col.id && c.contato_telefone).length;
                      return (
                        <option key={col.id} value={col.id}>
                          {col.nome} ({qtd} contatos com WhatsApp)
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    Cole a Lista (Nome, Telefone ou apenas Telefone)
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Ana Souza, 11988887777&#10;Marcos Paulo, 21999998888&#10;11977776666"
                    value={textoListaColada}
                    onChange={(e) => setTextoListaColada(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 p-3 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono resize-none"
                  />
                </div>
              )}

              {/* Mensagem Template */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-400">Mensagem do Disparo *</label>
                  <span className="text-[10px] text-emerald-400">Dica: use &#123;nome&#125; para personalizar</span>
                </div>
                <textarea
                  rows={5}
                  required
                  placeholder="Olá {nome}! Tudo bem? Temos uma novidade imperdível para você..."
                  value={mensagemCampanha}
                  onChange={(e) => setMensagemCampanha(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 p-3 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none font-sans"
                />
              </div>

              {/* Intervalo Anti-Ban */}
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
                  <ShieldAlert className="w-4 h-4" /> Proteção Anti-Bloqueio
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-slate-300">Intervalo entre mensagens:</label>
                  <input
                    type="number"
                    min={10}
                    max={120}
                    value={intervaloSegundos}
                    onChange={(e) => setIntervaloSegundos(Number(e.target.value))}
                    className="w-20 rounded-lg bg-slate-900 border border-white/10 px-2 py-1 text-xs text-white font-mono text-center focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-xs text-slate-400">segundos (padrão seguro: 20s)</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400">
                  Total de contatos: <strong className="text-emerald-400">{alvosEstimados}</strong>
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModalNovaCampanha(false)}
                    className="px-4 py-2 text-xs text-slate-400"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={salvando || alvosEstimados === 0}
                    className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20"
                  >
                    {salvando ? "Iniciando..." : "Iniciar Disparos"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

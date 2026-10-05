import React, { useState, useEffect } from "react";
import {
  Partner,
  Conexao,
  QuadroCrm,
  IaRelatorioDiario,
  IaRetroalimentacaoConfig,
  LeadAnalise,
} from "@/types";
import {
  Sparkles,
  RefreshCw,
  Upload,
  Calendar,
  Send,
  Copy,
  Check,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Sliders,
  TrendingUp,
  MessageSquare,
  FileText,
  HelpCircle,
  X,
  FileCode,
  ArrowRight,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

interface RetroalimentacaoViewProps {
  partner: Partner | null;
  conexoes: Conexao[];
  quadros: QuadroCrm[];
  onNavigateToCrm?: () => void;
}

export const RetroalimentacaoView: React.FC<RetroalimentacaoViewProps> = ({
  partner,
  conexoes,
  quadros,
  onNavigateToCrm,
}) => {
  const [config, setConfig] = useState<IaRetroalimentacaoConfig | null>(null);
  const [relatorios, setRelatorios] = useState<IaRelatorioDiario[]>([]);
  const [relatorioAtivo, setRelatorioAtivo] = useState<IaRelatorioDiario | null>(null);
  const [loading, setLoading] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [buscaTexto, setBuscaTexto] = useState("");

  // Modais
  const [modalConfig, setModalConfig] = useState(false);
  const [modalUpload, setModalUpload] = useState(false);
  const [textoManual, setTextoManual] = useState("");
  const [nomeArquivoManual, setNomeArquivoManual] = useState("");

  // Form Config
  const [formRepo, setFormRepo] = useState("");
  const [formBranch, setFormBranch] = useState("main");
  const [formToken, setFormToken] = useState("");
  const [formPadrao, setFormPadrao] = useState("conversas/{data}.txt");
  const [formGeminiKey, setFormGeminiKey] = useState("");
  const [formHorario, setFormHorario] = useState("07:30");
  const [formQuadroId, setFormQuadroId] = useState("");
  const [formAutoSync, setFormAutoSync] = useState(true);

  const conexaoAtiva = conexoes.find((c) => c.status === "conectado") || conexoes[0] || null;

  // Carregar dados
  const carregarDados = async () => {
    if (!partner?.id) return;
    setLoading(true);
    try {
      // 1. Carrega configuração
      const resCfg = await fetch(`/api/retroalimentacao/config?partnerId=${partner.id}`);
      if (resCfg.ok) {
        const jsonCfg = await resCfg.json();
        if (jsonCfg.config) {
          setConfig(jsonCfg.config);
          setFormRepo(jsonCfg.config.github_repo || "");
          setFormBranch(jsonCfg.config.github_branch || "main");
          setFormToken(jsonCfg.config.github_token || "");
          setFormPadrao(jsonCfg.config.github_path_pattern || "conversas/{data}.txt");
          setFormGeminiKey(jsonCfg.config.gemini_api_key || "");
          setFormHorario(jsonCfg.config.horario_execucao || "07:30");
          setFormQuadroId(jsonCfg.config.quadro_id || quadros[0]?.id || "");
          setFormAutoSync(jsonCfg.config.auto_sincronizar !== false);
        }
      }

      // 2. Carrega relatórios
      const resRel = await fetch(`/api/retroalimentacao/relatorios?partnerId=${partner.id}`);
      if (resRel.ok) {
        const jsonRel = await resRel.json();
        const lista = (jsonRel.relatorios as IaRelatorioDiario[]) || [];
        setRelatorios(lista);
        if (lista.length > 0 && !relatorioAtivo) {
          setRelatorioAtivo(lista[0]);
        }
      }
    } catch (err: any) {
      console.warn("Erro ao carregar dados de retroalimentação:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [partner?.id]);

  // Salvar Configuração
  const salvarConfiguracoes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner?.id) return;

    try {
      const res = await fetch("/api/retroalimentacao/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: partner.id,
          github_repo: formRepo,
          github_branch: formBranch,
          github_token: formToken,
          github_path_pattern: formPadrao,
          gemini_api_key: formGeminiKey,
          horario_execucao: formHorario,
          quadro_id: formQuadroId || null,
          auto_sincronizar: formAutoSync,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.erro || "Falha ao salvar");
      }

      toast.success("Configurações salvas com sucesso!");
      setModalConfig(false);
      carregarDados();
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    }
  };

  // Executar sincronização via GitHub
  const executarSincronizacaoGit = async () => {
    if (!partner?.id) return;
    if (!config?.github_repo) {
      toast.error("Configure o repositório do GitHub antes de sincronizar!");
      setModalConfig(true);
      return;
    }

    setExecutando(true);
    const toastId = toast.loading("Buscando conversas no GitHub e analisando com Gemini IA...");

    try {
      const res = await fetch("/api/retroalimentacao/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: partner.id,
          modo: "github",
          quadroId: config.quadro_id || quadros[0]?.id,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || "Falha na sincronização");

      toast.success("Retroalimentação concluída! CRM atualizado com sucesso.", { id: toastId });
      carregarDados();
      if (json.relatorio) {
        setRelatorioAtivo(json.relatorio);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`, { id: toastId });
    } finally {
      setExecutando(false);
    }
  };

  // Executar sincronização com upload manual de .txt
  const executarUploadManual = async () => {
    if (!partner?.id) return;
    if (!textoManual.trim()) {
      toast.error("Cole ou carregue um arquivo com as conversas do dia");
      return;
    }

    setExecutando(true);
    const toastId = toast.loading("Processando arquivo e auditando conversas com IA...");

    try {
      const res = await fetch("/api/retroalimentacao/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: partner.id,
          modo: "upload",
          conteudoTxt: textoManual,
          nomeArquivo: nomeArquivoManual || "conversas_manual.txt",
          quadroId: config?.quadro_id || quadros[0]?.id,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || "Falha ao processar arquivo");

      toast.success("Conversas processadas e CRM retroalimentado com sucesso!", { id: toastId });
      setModalUpload(false);
      setTextoManual("");
      setNomeArquivoManual("");
      carregarDados();
      if (json.relatorio) {
        setRelatorioAtivo(json.relatorio);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`, { id: toastId });
    } finally {
      setExecutando(false);
    }
  };

  // Carregar arquivo .txt via input file
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setNomeArquivoManual(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setTextoManual(text || "");
    };
    reader.readAsText(file);
  };

  // Copiar mensagem
  const copiarMensagem = (id: string, texto: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoId(id);
    toast.success("Mensagem copiada para a área de transferência!");
    setTimeout(() => setCopiadoId(null), 2000);
  };

  // Enviar mensagem direto pelo WhatsApp Web
  const abrirWhatsAppWeb = (telefone: string | null, texto: string) => {
    if (!telefone) {
      toast.error("Telefone não identificado na conversa.");
      return;
    }
    const telLimpo = telefone.replace(/\D/g, "");
    const telFormatado = telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`;
    const url = `https://web.whatsapp.com/send?phone=${telFormatado}&text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank");
  };

  // Enviar mensagem direta via Conector do CRM
  const enviarPeloCrm = async (telefone: string | null, texto: string) => {
    if (!conexaoAtiva || conexaoAtiva.status !== "conectado") {
      toast.error("Nenhuma conexão de WhatsApp ativa no momento. Enviando pelo WhatsApp Web...");
      abrirWhatsAppWeb(telefone, texto);
      return;
    }

    if (!telefone) {
      toast.error("Telefone não identificado.");
      return;
    }

    try {
      const res = await fetch("/api/bot/disparos/enviar-direta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conexaoId: conexaoAtiva.id,
          telefone,
          texto,
        }),
      });

      if (!res.ok) throw new Error("Erro ao disparar mensagem");
      toast.success("Mensagem enviada para a fila de disparo do WhatsApp!");
    } catch (err: any) {
      toast.error(`Falha ao enviar pelo CRM: ${err.message}`);
    }
  };

  // Filtragem dos leads analisados
  const leadsFiltrados = (relatorioAtivo?.leads_analisados || []).filter((lead: LeadAnalise) => {
    if (filtroStatus === "venda_ganha" && lead.status_comercial !== "venda_ganha") return false;
    if (filtroStatus === "perda_venda" && lead.status_comercial !== "perda_venda") return false;
    if (filtroStatus === "em_aberto" && lead.status_comercial !== "em_aberto") return false;
    if (filtroStatus === "iniciada_nao_finalizada" && lead.status_comercial !== "iniciada_nao_finalizada") return false;
    if (filtroStatus === "follow_up" && lead.acao_recomendada !== "follow_up") return false;
    if (filtroStatus === "remarketing" && lead.acao_recomendada !== "remarketing") return false;

    if (buscaTexto.trim()) {
      const q = buscaTexto.toLowerCase();
      const matchNome = lead.nome?.toLowerCase().includes(q);
      const matchTel = lead.telefone?.includes(q);
      const matchMotivo = lead.motivo_status?.toLowerCase().includes(q);
      return matchNome || matchTel || matchMotivo;
    }
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* 1. Header com Status e Ações */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-[#111625] to-slate-900 border border-emerald-500/20 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/30">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </span>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Retroalimentação IA & Auditoria de Atendimento
            </h1>
          </div>
          <p className="text-sm text-slate-400">
            Leitura diária das conversas do Git / WhatsApp, detecção de perdas, follow-ups e auto-alimentação do CRM.
          </p>

          {config?.ultima_execucao && (
            <div className="flex items-center gap-2 pt-1 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Última auditoria:{" "}
                <b className="text-slate-200">
                  {new Date(config.ultima_execucao).toLocaleString("pt-BR")}
                </b>
              </span>
              <span
                className={`px-2 py-0.5 rounded-full font-medium ${
                  config.ultimo_status === "sucesso"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}
              >
                {config.ultimo_status === "sucesso" ? "✓ Atualizado" : "Erro na última execução"}
              </span>
            </div>
          )}
        </div>

        {/* Botões de Ação */}
        <div className="flex flex-wrap items-center gap-2 relative z-10">
          <button
            onClick={() => setModalConfig(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
          >
            <Sliders className="w-4 h-4 text-slate-400" />
            Configurar Git & IA
          </button>

          <button
            onClick={() => setModalUpload(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-xl text-xs font-semibold border border-indigo-500/30 transition"
          >
            <Upload className="w-4 h-4 text-indigo-400" />
            Upload Manual .TXT
          </button>

          <button
            onClick={executarSincronizacaoGit}
            disabled={executando}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 transition"
          >
            <RefreshCw className={`w-4 h-4 ${executando ? "animate-spin" : ""}`} />
            {executando ? "Auditando com IA..." : "Sincronizar Git Agora"}
          </button>
        </div>
      </div>

      {/* 2. Seletor de Relatórios Salvos / Datas */}
      {relatorios.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-[#0d101a] border border-white/5 p-3 rounded-xl">
          <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
            <span className="text-xs text-slate-400 flex items-center gap-1 font-semibold pl-2 pr-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" /> Datas de Auditoria:
            </span>
            {relatorios.map((rel) => {
              const selecionado = relatorioAtivo?.id === rel.id;
              return (
                <button
                  key={rel.id}
                  onClick={() => setRelatorioAtivo(rel)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                    selecionado
                      ? "bg-emerald-500 text-white font-bold shadow-md shadow-emerald-500/20"
                      : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"
                  }`}
                >
                  {new Date(rel.data_referencia + "T12:00:00").toLocaleDateString("pt-BR")} (
                  {rel.total_conversas} chats)
                </button>
              );
            })}
          </div>

          {relatorioAtivo?.arquivo_origem && (
            <span className="hidden lg:flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap pr-2">
              <FileCode className="w-3 h-3 text-slate-500" />
              Fonte: <code className="text-slate-300">{relatorioAtivo.arquivo_origem}</code>
            </span>
          )}
        </div>
      )}

      {/* 3. Cards de Resumo / Métricas */}
      {relatorioAtivo ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* Total Analisadas */}
            <div className="bg-[#0e121d] border border-white/10 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-600 transition">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold">Total de Conversas</span>
                <span className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg">
                  <MessageSquare className="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-white">
                  {relatorioAtivo.total_conversas || 0}
                </span>
                <span className="text-[11px] text-slate-400">interações</span>
              </div>
            </div>

            {/* Vendas Fechadas */}
            <div className="bg-[#0e121d] border border-emerald-500/20 rounded-2xl p-4 flex flex-col justify-between hover:border-emerald-500/40 transition">
              <div className="flex items-center justify-between text-emerald-400 mb-2">
                <span className="text-xs font-semibold">Vendas Ganhas</span>
                <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg">
                  <CheckCircle2 className="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-400">
                  {relatorioAtivo.vendas_fechadas || 0}
                </span>
                <span className="text-[11px] text-emerald-500/80">fechamentos</span>
              </div>
            </div>

            {/* Vendas Perdidas */}
            <div className="bg-[#0e121d] border border-rose-500/20 rounded-2xl p-4 flex flex-col justify-between hover:border-rose-500/40 transition">
              <div className="flex items-center justify-between text-rose-400 mb-2">
                <span className="text-xs font-semibold">Perdas de Venda</span>
                <span className="p-1.5 bg-rose-500/10 text-rose-400 rounded-lg">
                  <XCircle className="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-400">
                  {relatorioAtivo.perdas_vendas || 0}
                </span>
                <span className="text-[11px] text-rose-500/80">desistências/objeções</span>
              </div>
            </div>

            {/* Conversas em Aberto */}
            <div className="bg-[#0e121d] border border-amber-500/20 rounded-2xl p-4 flex flex-col justify-between hover:border-amber-500/40 transition">
              <div className="flex items-center justify-between text-amber-400 mb-2">
                <span className="text-xs font-semibold">Em Aberto / Dúvidas</span>
                <span className="p-1.5 bg-amber-500/10 text-amber-400 rounded-lg">
                  <Clock className="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-amber-400">
                  {relatorioAtivo.conversas_abertas || 0}
                </span>
                <span className="text-[11px] text-amber-500/80">aguardam proposta</span>
              </div>
            </div>

            {/* Abandonadas / Não Finalizadas */}
            <div className="bg-[#0e121d] border border-orange-500/20 rounded-2xl p-4 flex flex-col justify-between hover:border-orange-500/40 transition">
              <div className="flex items-center justify-between text-orange-400 mb-2">
                <span className="text-xs font-semibold">Iniciadas s/ Fim</span>
                <span className="p-1.5 bg-orange-500/10 text-orange-400 rounded-lg">
                  <AlertTriangle className="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-orange-400">
                  {relatorioAtivo.iniciadas_nao_finalizadas || 0}
                </span>
                <span className="text-[11px] text-orange-500/80">resgate urgente</span>
              </div>
            </div>
          </div>

          {/* 4. Diagnóstico Executivo & Pontos de Melhoria */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Resumo Executivo */}
            <div className="bg-[#0e121d] border border-white/10 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-indigo-400">
                <TrendingUp className="w-4 h-4" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                  Diagnóstico Executivo do Dia
                </h3>
              </div>
              <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line bg-black/30 p-4 rounded-xl border border-white/5">
                {relatorioAtivo.resumo_executivo || "Nenhum resumo gerado."}
              </div>
            </div>

            {/* Pontos de Atenção & Melhoria */}
            <div className="bg-[#0e121d] border border-amber-500/20 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                  O Que a Equipe Precisa Melhorar
                </h3>
              </div>
              <div className="text-sm text-amber-200/90 leading-relaxed whitespace-pre-line bg-amber-950/20 p-4 rounded-xl border border-amber-500/10">
                {relatorioAtivo.pontos_melhoria || "Nenhum ponto crítico detectado."}
              </div>
            </div>
          </div>

          {/* 5. Lista de Clientes e Fila de Mensagens / Follow-up */}
          <div className="bg-[#0e121d] border border-white/10 rounded-2xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>Fila de Ação Imediata & Mensagens Recomendadas</span>
                  <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-semibold">
                    {leadsFiltrados.length} clientes
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Envie mensagens prontas de follow-up, quebra de objeções e recuperação com 1 clique.
                </p>
              </div>

              {/* Busca rápida */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Buscar cliente, telefone..."
                  value={buscaTexto}
                  onChange={(e) => setBuscaTexto(e.target.value)}
                  className="bg-black/40 border border-slate-700 text-xs text-slate-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-48"
                />
              </div>
            </div>

            {/* Filtros por Categoria */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-xs text-slate-500 font-semibold flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Filtrar:
              </span>
              {[
                { id: "todos", rotulo: "Todos" },
                { id: "follow_up", rotulo: "Follow-Up Imediato" },
                { id: "em_aberto", rotulo: "Em Aberto" },
                { id: "iniciada_nao_finalizada", rotulo: "Abandonadas" },
                { id: "perda_venda", rotulo: "Perdas de Venda" },
                { id: "remarketing", rotulo: "Remarketing" },
                { id: "venda_ganha", rotulo: "Vendas Ganhas" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFiltroStatus(f.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    filtroStatus === f.id
                      ? "bg-white/10 text-white border border-white/20"
                      : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                  }`}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>

            {/* Cards de Leads */}
            {leadsFiltrados.length === 0 ? (
              <div className="text-center py-12 text-slate-500 space-y-2">
                <HelpCircle className="w-8 h-8 mx-auto text-slate-600" />
                <p className="text-sm">Nenhum cliente encontrado com os filtros atuais.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {leadsFiltrados.map((lead: LeadAnalise, idx: number) => {
                  const cardId = `lead-${idx}`;
                  const isCopiado = copiadoId === cardId;

                  const statusConfig = {
                    venda_ganha: {
                      badge: "Venda Ganha",
                      corBadge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                      icone: CheckCircle2,
                    },
                    perda_venda: {
                      badge: "Venda Perdida",
                      corBadge: "bg-rose-500/10 text-rose-400 border-rose-500/30",
                      icone: XCircle,
                    },
                    em_aberto: {
                      badge: "Em Aberto",
                      corBadge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
                      icone: Clock,
                    },
                    iniciada_nao_finalizada: {
                      badge: "Não Finalizada",
                      corBadge: "bg-orange-500/10 text-orange-400 border-orange-500/30",
                      icone: AlertTriangle,
                    },
                  }[lead.status_comercial] || {
                    badge: "Em Aberto",
                    corBadge: "bg-slate-500/10 text-slate-400 border-slate-500/30",
                    icone: Clock,
                  };

                  const StatusIcon = statusConfig.icone;

                  return (
                    <div
                      key={cardId}
                      className="bg-black/30 border border-white/5 hover:border-white/15 rounded-2xl p-5 flex flex-col justify-between space-y-4 transition group"
                    >
                      {/* Topo do Lead */}
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="text-base font-bold text-white group-hover:text-emerald-300 transition">
                              {lead.nome || "Cliente WhatsApp"}
                            </h4>
                            {lead.telefone && (
                              <p className="text-xs text-slate-400 font-mono">
                                📞 {lead.telefone}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border flex items-center gap-1 ${statusConfig.corBadge}`}
                            >
                              <StatusIcon className="w-3 h-3" />
                              {statusConfig.badge}
                            </span>
                            {lead.urgencia === "alta" && (
                              <span className="text-[10px] px-2 py-0.2 font-semibold bg-rose-500/20 text-rose-300 rounded-full">
                                Urgência Alta
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Motivo do Status */}
                        <div className="bg-slate-900/60 p-3 rounded-xl border border-white/5 text-xs text-slate-300 space-y-1">
                          <p className="font-semibold text-slate-200">
                            🔍 Diagnóstico:{" "}
                            <span className="font-normal text-slate-300">
                              {lead.motivo_status}
                            </span>
                          </p>
                          {lead.pontos_atencao_vendedor && (
                            <p className="text-amber-300/90 text-[11px]">
                              ⚠️ <b>Atenção vendedor:</b> {lead.pontos_atencao_vendedor}
                            </p>
                          )}
                        </div>

                        {/* Script de Mensagem Sugerido */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span className="font-semibold text-emerald-400 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" /> Script Recomendado para Envio:
                            </span>
                          </div>
                          <div className="bg-emerald-950/20 border border-emerald-500/20 p-3 rounded-xl text-xs text-emerald-100 font-normal leading-relaxed relative">
                            "{lead.mensagem_sugerida}"
                          </div>
                        </div>
                      </div>

                      {/* Botões de Ação Rápida */}
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                        <button
                          onClick={() => copiarMensagem(cardId, lead.mensagem_sugerida)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition"
                        >
                          {isCopiado ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-400" /> Copiar Texto
                            </>
                          )}
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => abrirWhatsAppWeb(lead.telefone, lead.mensagem_sugerida)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-semibold rounded-lg border border-emerald-500/30 transition"
                            title="Abrir no WhatsApp Web"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            WhatsApp Web
                          </button>

                          <button
                            onClick={() => enviarPeloCrm(lead.telefone, lead.mensagem_sugerida)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition"
                            title="Enviar diretamente pela conexão do CRM"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Enviar no CRM
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        /* Caso não haja relatório ainda */
        <div className="bg-[#0e121d] border border-white/10 rounded-2xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/20">
            <Sparkles className="w-8 h-8" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-white">Nenhuma auditoria realizada ainda</h3>
            <p className="text-xs text-slate-400">
              Conecte seu repositório Git ou envie manualmente um arquivo <code>.txt</code> de conversas para que o CRM faça a auditoria completa, identifique perdas de vendas e gere a lista de follow-up.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => setModalConfig(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
            >
              Configurar Repositório Git
            </button>
            <button
              onClick={() => setModalUpload(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 transition"
            >
              Fazer Upload Manual de .TXT
            </button>
          </div>
        </div>
      )}

      {/* MODAL 1: Configuração Git & Gemini */}
      {modalConfig && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#101422] border border-white/15 rounded-2xl w-full max-w-xl p-6 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Configurações de Retroalimentação IA</h3>
              </div>
              <button
                onClick={() => setModalConfig(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={salvarConfiguracoes} className="space-y-4">
              {/* Repositório GitHub */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Repositório GitHub (dono/repositorio) *
                </label>
                <input
                  type="text"
                  placeholder="ex: hdsolucoes/whatsapp-conversas"
                  value={formRepo}
                  onChange={(e) => setFormRepo(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs text-white p-2.5 rounded-xl focus:border-emerald-500 outline-none"
                  required
                />
                <p className="text-[11px] text-slate-400">
                  O repositório onde o outro sistema sobe o arquivo de conversas no fim do dia.
                </p>
              </div>

              {/* Branch e Padrão de Caminho */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Branch do Git</label>
                  <input
                    type="text"
                    placeholder="main"
                    value={formBranch}
                    onChange={(e) => setFormBranch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-xs text-white p-2.5 rounded-xl focus:border-emerald-500 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Padrão do Caminho do Arquivo
                  </label>
                  <input
                    type="text"
                    placeholder="conversas/{data}.txt"
                    value={formPadrao}
                    onChange={(e) => setFormPadrao(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-xs text-white p-2.5 rounded-xl focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                Substituições automáticas disponíveis: <code>{"{data}"}</code> (2026-10-05),{" "}
                <code>{"{ano}"}</code>, <code>{"{mes}"}</code>, <code>{"{dia}"}</code>.
              </p>

              {/* GitHub Token */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  GitHub Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={formToken}
                  onChange={(e) => setFormToken(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs text-white p-2.5 rounded-xl focus:border-emerald-500 outline-none"
                />
                <p className="text-[11px] text-slate-400">
                  Necessário para repositórios privados do GitHub (permissão: <code>repo</code> ou{" "}
                  <code>contents:read</code>).
                </p>
              </div>

              {/* Google Gemini API Key */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Chave da API Google Gemini
                </label>
                <input
                  type="password"
                  placeholder="AIzaSyxxxxxxxxxxxxxxxxx (opcional se configurado no servidor)"
                  value={formGeminiKey}
                  onChange={(e) => setFormGeminiKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs text-white p-2.5 rounded-xl focus:border-emerald-500 outline-none"
                />
                <p className="text-[11px] text-slate-400">
                  Obtida gratuitamente no Google AI Studio (aistudio.google.com).
                </p>
              </div>

              {/* Horário Matinal e Quadro do CRM */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Horário de Leitura Matinal
                  </label>
                  <input
                    type="time"
                    value={formHorario}
                    onChange={(e) => setFormHorario(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-xs text-white p-2.5 rounded-xl focus:border-emerald-500 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Funil / Quadro de Destino no CRM
                  </label>
                  <select
                    value={formQuadroId}
                    onChange={(e) => setFormQuadroId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-xs text-white p-2.5 rounded-xl focus:border-emerald-500 outline-none"
                  >
                    {quadros.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Automação Diária Toggle */}
              <div className="flex items-center gap-3 p-3 bg-slate-900/60 rounded-xl border border-white/5">
                <input
                  type="checkbox"
                  id="autoSyncCheck"
                  checked={formAutoSync}
                  onChange={(e) => setFormAutoSync(e.target.checked)}
                  className="w-4 h-4 text-emerald-500 rounded bg-slate-800 border-slate-600 focus:ring-emerald-500"
                />
                <label htmlFor="autoSyncCheck" className="text-xs text-slate-300 cursor-pointer">
                  <b>Executar automaticamente todas as manhãs</b> (o servidor lê o Git no horário
                  estabelecido e atualiza os leads no CRM)
                </label>
              </div>

              {/* Botões do modal */}
              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setModalConfig(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg"
                >
                  Salvar Configurações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Upload Manual .TXT */}
      {modalUpload && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#101422] border border-white/15 rounded-2xl w-full max-w-2xl p-6 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">
                  Auditar Arquivo .TXT de Conversas
                </h3>
              </div>
              <button
                onClick={() => setModalUpload(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Arraste ou selecione o arquivo <code>.txt</code> exportado pelo seu sistema de WhatsApp
                ou cole o texto diretamente abaixo para auditoria imediata.
              </p>

              {/* Input file */}
              <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500/50 p-6 rounded-2xl text-center cursor-pointer transition bg-slate-900/40">
                <input
                  type="file"
                  accept=".txt"
                  id="arquivoTxtInput"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="arquivoTxtInput"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <FileText className="w-8 h-8 text-indigo-400" />
                  <span className="text-xs font-bold text-white">
                    {nomeArquivoManual
                      ? `Arquivo selecionado: ${nomeArquivoManual}`
                      : "Clique aqui para escolher o arquivo .txt"}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Suporta arquivos com histórico completo de conversas do dia
                  </span>
                </label>
              </div>

              {/* Textarea alternativa */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Ou cole o conteúdo do texto aqui:
                </label>
                <textarea
                  rows={8}
                  placeholder={`Exemplo de formato aceito:\n[05/10/2026, 09:15] João Silva (11988887777): Olá, quanto custa o plano?\n[05/10/2026, 09:16] Vendedor: Olá João! Custa R$ 197/mês.\n[05/10/2026, 09:17] João Silva: Achei caro agora...`}
                  value={textoManual}
                  onChange={(e) => setTextoManual(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 p-3 rounded-xl focus:border-indigo-500 outline-none"
                />
              </div>

              {/* Ações */}
              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setModalUpload(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={executando || !textoManual.trim()}
                  onClick={executarUploadManual}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {executando ? "Processando..." : "Auditar e Retroalimentar CRM"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RetroalimentacaoView;

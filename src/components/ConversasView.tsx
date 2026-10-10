import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AnuncioWhatsApp, Conversa, Mensagem, Conexao, PrivacidadeConversa } from "@/types";
import { apiJson } from "@/lib/api";
import { buscarAnunciosDasConversas, buscarMensagens } from "@/lib/conversas-db";
import { atualizarConversa } from "@/lib/conexoes-api";
import { baixarConversaCompleta } from "@/lib/baixar";
import {
  ROTULO_PRIVACIDADE,
  descreverMensagem,
  diaLocal,
  ehGrupo,
  formatarMomento,
  formatarTelefone,
  iniciaisDe,
  linkWhatsApp,
  momentoDaMensagem,
  ordenarMensagens,
  privacidadeDaConversa,
  resumoAnuncio,
  roboLigado,
  rotuloAutor,
  soDigitos,
  telefoneDaConversa,
  temAnuncio,
  tituloDaConversa,
} from "@/lib/whatsapp";
import { BaixarDiaCompleto } from "@/components/BaixarDiaCompleto";
import { VerComprovante } from "@/components/VerComprovante";
import { tipoDoArquivo } from "@/lib/comprovantes";
import { ModalConfirmacao } from "@/components/ModalConfirmacao";
import { ApagarPessoaModal } from "@/components/ApagarPessoaModal";
import { podeApagarDados } from "@/lib/lgpd";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Download,
  EyeOff,
  Loader2,
  Megaphone,
  MessageSquare,
  MoreVertical,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";

interface ConversasViewProps {
  conversas: Conversa[];
  conexoes: Conexao[];
  /** Conversa aberta: vem do endereço /conversas/:id, para o voltar do celular fechar a conversa. */
  conversaAtivaId: string | null;
  onAbrirConversa: (id: string | null) => void;
  partnerId: string | null;
  /** Empresas em que o usuário é dono (GET /api/me): só ele vê "Apagar dados desta pessoa". */
  donoDe?: string[];
  /** Fuso da empresa (vem do /api/data): o dia do arquivo completo é recortado nele. */
  fuso?: string;
  onRefresh: () => void;
}

// A tela mostra as mais recentes; a conversa inteira sai no "Baixar conversa completa".
const LIMITE_MENSAGENS = 400;
const CONSULTA_MENSAGENS_MS = 3000;
// O selo "Anúncio" da lista é relido de tempos em tempos (e sempre que aparece conversa nova).
const CONSULTA_ANUNCIOS_MS = 60_000;

const SeloAnuncio: React.FC<{ anuncio: AnuncioWhatsApp | null | undefined }> = ({ anuncio }) =>
  temAnuncio(anuncio) ? (
    <span
      title={resumoAnuncio(anuncio)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0"
    >
      <Megaphone className="w-3 h-3" /> Anúncio
    </span>
  ) : null;

const Tiques: React.FC<{ msg: Mensagem }> = ({ msg }) => {
  if (msg.status === "pendente") return <Clock className="w-3.5 h-3.5 text-white/70" aria-label="Na fila" />;
  if (msg.status === "erro")
    return <AlertCircle className="w-3.5 h-3.5 text-amber-300" aria-label={`Erro: ${msg.erro || "não enviada"}`} />;
  if (msg.wa_lida_em) return <CheckCheck className="w-3.5 h-3.5 text-sky-300" aria-label="Lida" />;
  if (msg.wa_entregue_em) return <CheckCheck className="w-3.5 h-3.5 text-white/80" aria-label="Entregue" />;
  return <Check className="w-3.5 h-3.5 text-white/80" aria-label="Enviada" />;
};

export const ConversasView: React.FC<ConversasViewProps> = ({
  conversas,
  conexoes,
  conversaAtivaId,
  onAbrirConversa,
  partnerId,
  donoDe,
  fuso,
  onRefresh,
}) => {
  // Mudança já confirmada pelo servidor, enquanto o /api/data não traz a lista nova.
  const [ajustes, setAjustes] = useState<Record<string, { mudanca: Partial<Conversa>; em: number }>>({});
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregandoMensagens, setCarregandoMensagens] = useState(false);
  const [erroMensagens, setErroMensagens] = useState<string | null>(null);
  const [textoEnvio, setTextoEnvio] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState("");
  const [menuAberto, setMenuAberto] = useState(false);
  const [periodo, setPeriodo] = useState<{ de: string; ate: string }>({ de: "", ate: "" });
  const [baixando, setBaixando] = useState(false);
  const [privacidadeAConfirmar, setPrivacidadeAConfirmar] = useState<PrivacidadeConversa | null>(null);
  const [apagandoPessoa, setApagandoPessoa] = useState<{ contatoId: string; nome: string } | null>(null);
  const [anuncios, setAnuncios] = useState<Map<string, AnuncioWhatsApp>>(() => new Map());
  const fimRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const conversaAtualRef = useRef<string | null>(null);
  conversaAtualRef.current = conversaAtivaId;
  const ultimaMensagemRef = useRef<string | null>(null);

  const lista = useMemo(
    () => conversas.map((c) => (ajustes[c.id] ? { ...c, ...ajustes[c.id].mudanca } : c)),
    [conversas, ajustes]
  );
  const conversaAtiva = lista.find((c) => c.id === conversaAtivaId) || null;
  // A conversa não guarda o anúncio (C3): ele vem da mensagem que chegou pelo anúncio.
  const anuncioDe = (c: Conversa) => anuncios.get(c.id) ?? null;
  const conexaoDaAtiva = conversaAtiva ? conexoes.find((x) => x.id === conversaAtiva.conexao_id) || null : null;
  const robo = roboLigado(conexaoDaAtiva);

  // O ajuste sai quando a lista nova já o reflete (ou depois de 20 s, para nunca esconder o dado real).
  useEffect(() => {
    const agora = Date.now();
    setAjustes((atual) => {
      let mudou = false;
      const proximo: typeof atual = {};
      for (const [id, ajuste] of Object.entries(atual)) {
        const c = conversas.find((x) => x.id === id) as unknown as Record<string, unknown> | undefined;
        const refletido = c && Object.entries(ajuste.mudanca).every(([k, v]) => c[k] === v);
        if (c && !refletido && agora - ajuste.em < 20_000) proximo[id] = ajuste;
        else mudou = true;
      }
      return mudou ? proximo : atual;
    });
  }, [conversas]);

  const idsConversas = useMemo(() => conversas.map((c) => c.id).sort().join(","), [conversas]);

  useEffect(() => {
    let vivo = true;
    const ler = () =>
      buscarAnunciosDasConversas(idsConversas ? idsConversas.split(",") : [])
        .then((mapa) => {
          if (vivo && mapa) setAnuncios(mapa);
        })
        .catch(() => undefined); // selo é enfeite: falha aqui não atrapalha o chat
    ler();
    const t = setInterval(ler, CONSULTA_ANUNCIOS_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [idsConversas]);

  const carregarMensagens = async (conversaId: string) => {
    const { mensagens: lidas, erro } = await buscarMensagens(conversaId, LIMITE_MENSAGENS);

    // Resposta atrasada de outra conversa: ignora.
    if (conversaAtualRef.current !== conversaId) return;
    setCarregandoMensagens(false);

    // Erro no polling não apaga o que já está na tela; só avisa.
    if (erro) {
      setErroMensagens(erro);
      return;
    }
    setErroMensagens(null);
    setMensagens(ordenarMensagens(lidas));
  };

  useEffect(() => {
    setMensagens([]);
    setErroMensagens(null);
    setMenuAberto(false);
    setPeriodo({ de: "", ate: "" });
    ultimaMensagemRef.current = null;
    if (!conversaAtivaId) return;
    setCarregandoMensagens(true);
    carregarMensagens(conversaAtivaId);
    const intervalo = setInterval(() => carregarMensagens(conversaAtivaId), CONSULTA_MENSAGENS_MS);
    return () => clearInterval(intervalo);
  }, [conversaAtivaId]);

  // Fecha o menu ao tocar fora dele ou com Esc.
  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !privacidadeAConfirmar) setMenuAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [menuAberto, privacidadeAConfirmar]);

  // Desce até o fim só quando chega mensagem nova (o polling não pode arrancar quem está lendo acima).
  useEffect(() => {
    const ultima = mensagens[mensagens.length - 1]?.id ?? null;
    if (ultima && ultima !== ultimaMensagemRef.current) {
      fimRef.current?.scrollIntoView({ behavior: ultimaMensagemRef.current ? "smooth" : "auto" });
    }
    ultimaMensagemRef.current = ultima;
  }, [mensagens]);

  const ajustar = (id: string, mudanca: Partial<Conversa>) =>
    setAjustes((atual) => ({ ...atual, [id]: { mudanca: { ...atual[id]?.mudanca, ...mudanca }, em: Date.now() } }));

  const alternarEstadoAtendimento = async () => {
    if (!conversaAtiva) return;
    const novoEstado = conversaAtiva.estado === "humano" ? "bot" : "humano";
    try {
      await atualizarConversa(conversaAtiva.id, { estado: novoEstado });
      ajustar(conversaAtiva.id, { estado: novoEstado });
      toast.success(
        novoEstado === "humano"
          ? "Atendimento assumido por você (robô pausado nesta conversa)."
          : "Robô reativado para esta conversa."
      );
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro ao alternar o atendimento: ${err.message}`);
    }
  };

  const mudarPrivacidade = async (privacidade: PrivacidadeConversa) => {
    if (!conversaAtiva) return;
    try {
      await atualizarConversa(conversaAtiva.id, { privacidade });
      ajustar(conversaAtiva.id, { privacidade, ignorar: privacidade === "ignorar" });
      toast.success(`Privacidade: ${ROTULO_PRIVACIDADE[privacidade]}.`);
      onRefresh();
    } catch (err: any) {
      toast.error(`Não foi possível mudar a privacidade: ${err.message}`);
    } finally {
      setPrivacidadeAConfirmar(null);
      setMenuAberto(false);
    }
  };

  const escolherPrivacidade = (p: PrivacidadeConversa) => {
    if (!conversaAtiva || p === privacidadeDaConversa(conversaAtiva)) return;
    if (p === "normal") mudarPrivacidade(p);
    else setPrivacidadeAConfirmar(p);
  };

  const baixarCompleta = async () => {
    if (!conversaAtiva) return;
    if (periodo.de && periodo.ate && periodo.de > periodo.ate) {
      toast.error("A data inicial é depois da final.");
      return;
    }
    setBaixando(true);
    try {
      await baixarConversaCompleta(conversaAtiva.id, { de: periodo.de || undefined, ate: periodo.ate || undefined });
      setMenuAberto(false);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível baixar a conversa.");
    } finally {
      setBaixando(false);
    }
  };

  const enviarMensagem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversaAtiva || !textoEnvio.trim()) return;
    const telefone = telefoneDaConversa(conversaAtiva);
    if (!telefone) {
      toast.error("O WhatsApp ainda não revelou o número deste contato: responda pelo celular.");
      return;
    }

    setEnviando(true);
    try {
      const conexaoId = conversaAtiva.conexao_id || conexoes[0]?.id;
      if (!conexaoId) throw new Error("Nenhuma conexão de WhatsApp ativa");

      await apiJson("/api/bot/disparos/enviar-direta", {
        method: "POST",
        body: JSON.stringify({
          conexaoId,
          telefone,
          texto: textoEnvio.trim(),
          cartaoId: conversaAtiva.cartao_id,
        }),
      });

      setTextoEnvio("");
      carregarMensagens(conversaAtiva.id);
      toast.success("Mensagem na fila de envio.");
    } catch (err: any) {
      const motivos: Record<string, string> = {
        envio_desligado: "O envio está desligado nesta conexão. Ligue o robô em Conectar WhatsApp.",
        contato_nunca_escreveu: "Este contato nunca escreveu para você, então o WhatsApp não deixa começar a conversa por aqui.",
        limite_de_conexoes_do_gateway: "O servidor do WhatsApp chegou ao limite de conexões. Tente mais tarde.",
      };
      const chave = [err?.codigo, err?.message].find((v) => typeof v === "string" && motivos[v]);
      toast.error(chave ? motivos[chave] : `Erro ao enviar: ${err.message}`);
    } finally {
      setEnviando(false);
    }
  };

  const termo = busca.trim().toLowerCase();
  const termoDigitos = soDigitos(termo);
  const conversasFiltradas = termo
    ? lista.filter((c) => {
        const textos = [tituloDaConversa(c), c.nome, c.nome_agenda, c.grupo_nome].filter(Boolean) as string[];
        if (textos.some((t) => t.toLowerCase().includes(termo))) return true;
        return termoDigitos.length >= 3 && soDigitos(c.telefone).includes(termoDigitos);
      })
    : lista;

  const telAtivo = conversaAtiva ? telefoneDaConversa(conversaAtiva) : null;
  const grupoAtivo = conversaAtiva ? ehGrupo(conversaAtiva) : false;
  const privacidadeAtiva = conversaAtiva ? privacidadeDaConversa(conversaAtiva) : "normal";
  const hoje = diaLocal(new Date(), fuso);

  return (
    <div className="h-[calc(100dvh-3.5rem-4rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-4rem)] flex flex-col max-w-7xl mx-auto">
      {/* Topo: título e o arquivo completo do dia */}
      <div
        className={`${conversaAtiva ? "hidden md:flex" : "flex"} flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 md:px-6 pt-4`}
      >
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-red-500" /> Central de Chat
        </h2>
        <BaixarDiaCompleto partnerId={partnerId} fuso={fuso} compacto />
      </div>

      <div className="flex-1 min-h-0 flex gap-4 md:gap-6 p-2 md:p-6">
        {/* Lista de conversas */}
        <section
          className={`${conversaAtiva ? "hidden md:flex" : "flex"} w-full md:w-80 shrink-0 glass-panel rounded-3xl p-3 md:p-4 flex-col border border-white/10 overflow-hidden`}
        >
          <div className="flex items-center gap-2 pb-3 border-b border-white/10">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                placeholder="Buscar por nome ou número"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-black border border-white/10 text-base md:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
              />
            </div>
            <button
              onClick={onRefresh}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition"
              aria-label="Atualizar lista"
              title="Atualizar lista"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pt-3 pr-1">
            {conversasFiltradas.map((c) => {
              const selecionada = conversaAtivaId === c.id;
              const grupo = ehGrupo(c);
              const titulo = tituloDaConversa(c);
              const tel = telefoneDaConversa(c);
              const privacidade = privacidadeDaConversa(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onAbrirConversa(c.id)}
                  className={`w-full text-left p-3 rounded-2xl border transition flex items-center gap-3 ${
                    selecionada
                      ? "bg-red-600/20 border-red-500/40 text-white"
                      : "bg-white/[0.02] border-white/5 text-slate-300 hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="w-10 h-10 shrink-0 rounded-full bg-black border border-white/10 flex items-center justify-center font-bold text-xs text-red-500">
                    {grupo ? <Users className="w-4 h-4" /> : iniciaisDe(titulo)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm md:text-xs font-bold truncate">{titulo}</span>
                      <SeloAnuncio anuncio={anuncioDe(c)} />
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono truncate">
                      {grupo ? "Grupo" : tel ? formatarTelefone(tel) : "Número ainda não revelado"}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-[10px] text-slate-500">
                      {formatarMomento(c.ultima_mensagem_em)}
                    </span>
                    {privacidade !== "normal" ? (
                      <span title={ROTULO_PRIVACIDADE[privacidade]}>
                        <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                      </span>
                    ) : c.estado === "humano" ? (
                      <UserCheck className="w-3.5 h-3.5 text-amber-400" aria-label="Atendimento humano" />
                    ) : null}
                  </div>
                </button>
              );
            })}

            {conversasFiltradas.length === 0 && (
              <p className="text-center py-8 text-xs text-slate-500">
                {termo ? "Nenhuma conversa encontrada." : "Nenhuma conversa registrada ainda."}
              </p>
            )}
          </div>
        </section>

        {/* Conversa aberta */}
        <section
          className={`${conversaAtiva ? "flex" : "hidden md:flex"} flex-1 min-w-0 glass-panel rounded-3xl p-3 md:p-6 flex-col border border-white/10 overflow-hidden bg-black/60`}
        >
          {conversaAtiva ? (
            <>
              <header className="flex items-start gap-2 md:gap-3 pb-3 md:pb-4 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => onAbrirConversa(null)}
                  className="md:hidden min-h-[44px] min-w-[44px] -ml-1 flex items-center justify-center rounded-xl text-slate-300 hover:bg-white/10"
                  aria-label="Voltar para a lista"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="hidden sm:flex w-10 h-10 shrink-0 rounded-full bg-red-500/20 text-red-500 items-center justify-center font-bold text-sm border border-red-500/30">
                  {grupoAtivo ? <Users className="w-4 h-4" /> : iniciaisDe(tituloDaConversa(conversaAtiva))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">{tituloDaConversa(conversaAtiva)}</h3>
                    <SeloAnuncio anuncio={anuncioDe(conversaAtiva)} />
                  </div>
                  <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {grupoAtivo ? (
                      <span>Grupo</span>
                    ) : telAtivo ? (
                      <a
                        href={linkWhatsApp(telAtivo) || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono hover:text-white underline-offset-2 hover:underline"
                        title="Abrir no WhatsApp"
                      >
                        {formatarTelefone(telAtivo)}
                      </a>
                    ) : (
                      <span title="O WhatsApp ainda não revelou o número deste contato">Número ainda não revelado</span>
                    )}
                    {!grupoAtivo && conversaAtiva.nome && (
                      <span className="truncate">· WhatsApp: {conversaAtiva.nome}</span>
                    )}
                    {!grupoAtivo && conversaAtiva.nome_agenda && conversaAtiva.nome_agenda !== conversaAtiva.nome && (
                      <span className="truncate">· Agenda: {conversaAtiva.nome_agenda}</span>
                    )}
                  </p>
                  {temAnuncio(anuncioDe(conversaAtiva)) && (
                    <p className="text-[11px] text-sky-300/90 truncate" title={resumoAnuncio(anuncioDe(conversaAtiva))}>
                      Veio de anúncio: {resumoAnuncio(anuncioDe(conversaAtiva))}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {robo === false ? (
                    <span
                      className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-white/10 text-slate-400"
                      title="O robô está desligado neste número: o CRM só registra. Ligue em Conectar WhatsApp."
                    >
                      <Bot className="w-4 h-4" /> Robô desligado
                    </span>
                  ) : (
                    !grupoAtivo && (
                      <button
                        onClick={alternarEstadoAtendimento}
                        className={`min-h-[40px] flex items-center gap-2 px-3 rounded-xl text-xs font-bold border transition ${
                          conversaAtiva.estado === "humano"
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                            : "bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25"
                        }`}
                        title={conversaAtiva.estado === "humano" ? "Devolver para o robô" : "Assumir a conversa"}
                      >
                        {conversaAtiva.estado === "humano" ? (
                          <UserCheck className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Bot className="w-4 h-4 text-red-500" />
                        )}
                        <span className="hidden sm:inline">
                          {conversaAtiva.estado === "humano" ? "Você atende" : "Robô atende"}
                        </span>
                      </button>
                    )
                  )}

                  <div className="relative" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setMenuAberto((v) => !v)}
                      aria-expanded={menuAberto}
                      aria-haspopup="menu"
                      aria-label="Mais opções da conversa"
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-white/10 text-slate-300 hover:text-white hover:bg-white/10"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {menuAberto && (
                      <>
                        <div
                          role="menu"
                          className="absolute right-0 top-full mt-2 z-40 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#0c0c10] shadow-2xl p-3 space-y-4"
                        >
                          <div className="space-y-1.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
                              <ShieldCheck className="w-3.5 h-3.5" /> Privacidade deste contato
                            </p>
                            {(Object.keys(ROTULO_PRIVACIDADE) as PrivacidadeConversa[]).map((p) => (
                              <button
                                key={p}
                                type="button"
                                role="menuitemradio"
                                aria-checked={privacidadeAtiva === p}
                                onClick={() => escolherPrivacidade(p)}
                                className={`w-full min-h-[40px] flex items-center gap-2 px-2 rounded-xl text-left text-sm ${
                                  privacidadeAtiva === p ? "bg-red-600/20 text-white font-semibold" : "text-slate-300 hover:bg-white/5"
                                }`}
                              >
                                <span
                                  className={`w-3.5 h-3.5 shrink-0 rounded-full border ${
                                    privacidadeAtiva === p ? "border-red-400 bg-red-500" : "border-slate-500"
                                  }`}
                                />
                                {ROTULO_PRIVACIDADE[p]}
                              </button>
                            ))}
                          </div>

                          <div className="space-y-2 pt-3 border-t border-white/10">
                            <p className="text-[11px] text-slate-400 px-1 leading-relaxed">
                              Conversa exata, com telefone e nome do WhatsApp. Uso interno: não vai para a IA.
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-[11px] text-slate-400 space-y-1">
                                <span className="block px-1">De (opcional)</span>
                                <input
                                  type="date"
                                  value={periodo.de}
                                  max={hoje}
                                  onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))}
                                  className="w-full min-h-[40px] rounded-xl bg-black border border-white/15 px-2 text-base md:text-xs text-white [color-scheme:dark]"
                                />
                              </label>
                              <label className="text-[11px] text-slate-400 space-y-1">
                                <span className="block px-1">Até (opcional)</span>
                                <input
                                  type="date"
                                  value={periodo.ate}
                                  max={hoje}
                                  onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))}
                                  className="w-full min-h-[40px] rounded-xl bg-black border border-white/15 px-2 text-base md:text-xs text-white [color-scheme:dark]"
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={baixarCompleta}
                              disabled={baixando}
                              className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-bold text-white disabled:opacity-50"
                            >
                              {baixando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                              Baixar conversa completa (.txt)
                            </button>
                          </div>

                          {podeApagarDados(donoDe, partnerId, conversaAtiva.contato_id) && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuAberto(false);
                                setApagandoPessoa({ contatoId: conversaAtiva.contato_id!, nome: tituloDaConversa(conversaAtiva) });
                              }}
                              className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-xl text-left text-sm font-semibold text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 className="w-4 h-4 shrink-0" />
                              Apagar todos os dados desta pessoa (LGPD)
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </header>

              {privacidadeAtiva !== "normal" && (
                <p className="mt-3 text-xs text-slate-400 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center gap-2">
                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                  {privacidadeAtiva === "ignorar"
                    ? "Este contato não é registrado: mensagens novas não são gravadas."
                    : "Deste contato o CRM registra só que houve conversa, sem o texto."}
                </p>
              )}

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto py-4 md:py-6 space-y-3 pr-1">
                {mensagens.length >= LIMITE_MENSAGENS && (
                  <p className="text-center text-[11px] text-slate-500">
                    Mostrando as {LIMITE_MENSAGENS} mensagens mais recentes. A conversa inteira sai em "Baixar conversa
                    completa".
                  </p>
                )}

                {mensagens.map((msg) => {
                  const saida = msg.direcao === "saida";
                  const autor = rotuloAutor(msg, grupoAtivo);
                  const texto = descreverMensagem(msg);
                  return (
                    <div key={msg.id} className={`flex ${saida ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] md:max-w-lg rounded-2xl px-3.5 py-2.5 space-y-1 shadow-md ${
                          saida
                            ? "bg-red-600 text-white rounded-tr-none shadow-red-950/40"
                            : "bg-[#101014] border border-white/10 text-white rounded-tl-none"
                        }`}
                      >
                        <div
                          className={`flex items-center gap-1.5 text-[11px] font-bold ${
                            saida ? "text-white/80" : grupoAtivo ? "text-sky-300" : "text-slate-400"
                          }`}
                        >
                          <span className="truncate">{autor}</span>
                          {temAnuncio(msg.anuncio) && (
                            <span
                              title={resumoAnuncio(msg.anuncio)}
                              className="inline-flex items-center gap-0.5 font-semibold text-sky-300"
                            >
                              <Megaphone className="w-3 h-3" /> anúncio
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-sm md:text-xs whitespace-pre-wrap break-words leading-relaxed ${
                            msg.apagada_em ? "italic opacity-70" : ""
                          }`}
                        >
                          {texto}
                        </p>
                        {msg.arquivo_path && !msg.apagada_em && (
                          <VerComprovante
                            mensagemId={msg.id}
                            tipo={tipoDoArquivo(msg.arquivo_path)}
                            className="inline-flex items-center gap-1.5 min-h-8 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-semibold text-white disabled:opacity-60 transition"
                          />
                        )}
                        <div
                          className={`flex items-center justify-end gap-1.5 text-[10px] ${
                            saida ? "text-white/80" : "text-slate-500"
                          }`}
                        >
                          {msg.apagada_em && <span>apagada</span>}
                          {msg.editada_em && !msg.apagada_em && <span>editada</span>}
                          <time dateTime={momentoDaMensagem(msg)} title={new Date(momentoDaMensagem(msg)).toLocaleString("pt-BR")}>
                            {formatarMomento(momentoDaMensagem(msg))}
                          </time>
                          {saida && <Tiques msg={msg} />}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div ref={fimRef} />

                {erroMensagens && (
                  <div className="text-center py-3 text-xs text-amber-400">
                    Não foi possível atualizar as mensagens: {erroMensagens}
                  </div>
                )}

                {carregandoMensagens && mensagens.length === 0 && !erroMensagens && (
                  <div className="py-16 flex justify-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                )}

                {!carregandoMensagens && mensagens.length === 0 && !erroMensagens && (
                  <div className="text-center py-16 text-xs text-slate-500">
                    Nenhuma mensagem registrada com este contato ainda.
                  </div>
                )}
              </div>

              {/* Envio */}
              {grupoAtivo ? (
                <p className="pt-3 border-t border-white/10 text-xs text-slate-500">
                  O CRM não envia mensagens para grupos. Responda pelo celular.
                </p>
              ) : !telAtivo ? (
                <p className="pt-3 border-t border-white/10 text-xs text-slate-400 leading-relaxed">
                  O WhatsApp ainda não revelou o número deste contato, então o CRM não consegue enviar por aqui.
                  Responda pelo celular.
                </p>
              ) : robo === false ? (
                <p className="pt-3 border-t border-white/10 text-xs text-slate-400 leading-relaxed">
                  O envio pelo CRM está desligado neste número (robô desligado): responda pelo celular
                  {telAtivo ? (
                    <>
                      {" "}
                      ou{" "}
                      <a
                        href={linkWhatsApp(telAtivo) || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="text-red-300 underline underline-offset-2"
                      >
                        abra no WhatsApp
                      </a>
                    </>
                  ) : null}
                  . Para enviar daqui, ligue o robô da conexão em Conectar WhatsApp.
                </p>
              ) : (
                <form onSubmit={enviarMensagem} className="pt-3 md:pt-4 border-t border-white/10 flex gap-2 md:gap-3">
                  <input
                    type="text"
                    placeholder="Digite sua resposta no WhatsApp..."
                    value={textoEnvio}
                    onChange={(e) => setTextoEnvio(e.target.value)}
                    className="flex-1 min-w-0 min-h-[44px] rounded-2xl bg-black border border-white/10 px-4 text-base md:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
                  />
                  <button
                    type="submit"
                    disabled={enviando || !textoEnvio.trim()}
                    className="min-h-[44px] flex items-center gap-2 px-4 md:px-5 rounded-2xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-red-950/40 transition"
                    aria-label="Enviar"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">{enviando ? "Enviando..." : "Enviar"}</span>
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-600" />
              <p>Selecione uma conversa ao lado para ver e responder.</p>
            </div>
          )}
        </section>
      </div>

      {apagandoPessoa && (
        <ApagarPessoaModal
          contatoId={apagandoPessoa.contatoId}
          nome={apagandoPessoa.nome}
          onCancelar={() => setApagandoPessoa(null)}
          onApagado={() => {
            setApagandoPessoa(null);
            onAbrirConversa(null);
            onRefresh();
          }}
        />
      )}

      {privacidadeAConfirmar && (
        <ModalConfirmacao
          titulo={
            privacidadeAConfirmar === "ignorar" ? "Não registrar este contato?" : "Só registrar que houve conversa?"
          }
          textoConfirmar={privacidadeAConfirmar === "ignorar" ? "Não registrar" : "Registrar só que houve conversa"}
          perigo
          onConfirmar={() => mudarPrivacidade(privacidadeAConfirmar)}
          onCancelar={() => setPrivacidadeAConfirmar(null)}
        >
          {privacidadeAConfirmar === "ignorar" ? (
            <p>
              A partir de agora, as mensagens deste contato <strong className="text-white">não são gravadas</strong>{" "}
              no CRM. Use para família, amigos e outros contatos pessoais.
            </p>
          ) : (
            <p>
              A partir de agora, o CRM guarda só a data, a hora e quem mandou cada mensagem deste contato,{" "}
              <strong className="text-white">sem o texto</strong>. Use para contatos pessoais que você quer contar,
              mas não ler.
            </p>
          )}
          <p>Dá para voltar para "Normal" depois.</p>
        </ModalConfirmacao>
      )}
    </div>
  );
};

export default ConversasView;

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Hash,
  Laptop,
  Loader2,
  Plus,
  PlugZap,
  QrCode,
  RefreshCw,
  Server,
  Smartphone,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import type { ConexaoPainel } from "@/types";
import {
  arquivarConexao,
  criarConexao,
  desconectarConexao,
  listarConexoes,
  pedirPareamento,
} from "@/lib/conexoes-api";
import {
  estaPareando,
  explicarDetalheStatus,
  formatarTelefone,
  pareamentoAndando,
  telefoneParaEnvio,
  telefoneParaPareamento,
  vistoHa,
} from "@/lib/whatsapp";
import { ModalConfirmacao } from "@/components/ModalConfirmacao";
import { SeloStatus } from "@/components/conectar/SeloStatus";
import { PainelPareamento, type MetodoPareamento } from "@/components/conectar/PainelPareamento";
import { OpcoesDaConexao } from "@/components/conectar/OpcoesDaConexao";
import { UsarNoComputador } from "@/components/conectar/UsarNoComputador";

interface ConectarWhatsAppViewProps {
  partnerId: string | null;
  /** Avisa o App para recarregar o /api/data (status na barra do topo, listas). */
  onAlterou: () => void;
}

type PedidoPareamento = {
  metodo: MetodoPareamento;
  telefone: string | null;
  em: number;
  /** Já houve uma consulta mostrando o pareamento em curso. */
  viuEmCurso: boolean;
};

const CONSULTA_PAREANDO_MS = 3000;
const CONSULTA_PARADA_MS = 30_000;
// Sem campainha o gateway relê as conexões a cada 60 s: dá folga antes de desistir do pedido.
const ESPERA_MAXIMA_PEDIDO_MS = 150_000;

function metodoEmCurso(c: ConexaoPainel, pedido?: PedidoPareamento): MetodoPareamento {
  if (pedido) return pedido.metodo;
  if (c.pareamento?.codigo || c.status === "aguardando_codigo") return "codigo";
  return "qr";
}

export const ConectarWhatsAppView: React.FC<ConectarWhatsAppViewProps> = ({ partnerId, onAlterou }) => {
  const [conexoes, setConexoes] = useState<ConexaoPainel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<Record<string, PedidoPareamento>>({});
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => new Date());
  const [criando, setCriando] = useState(false);
  const [nomeNova, setNomeNova] = useState("");
  const [modoNova, setModoNova] = useState<"gateway" | "pc">("gateway");
  const [removendo, setRemovendo] = useState<ConexaoPainel | null>(null);
  const [mostrarNova, setMostrarNova] = useState(false);
  const [desconectando, setDesconectando] = useState<ConexaoPainel | null>(null);
  const [computadorAberto, setComputadorAberto] = useState(false);
  const [computadorConexaoId, setComputadorConexaoId] = useState<string | null>(null);

  const partnerRef = useRef(partnerId);
  partnerRef.current = partnerId;
  const pedidosRef = useRef(pedidos);
  pedidosRef.current = pedidos;
  const pareandoAntesRef = useRef<Set<string>>(new Set());
  const onAlterouRef = useRef(onAlterou);
  onAlterouRef.current = onAlterou;

  const carregar = useCallback(async () => {
    const pedidoPara = partnerId;
    if (!pedidoPara) return;
    try {
      const lista = await listarConexoes(pedidoPara);
      if (partnerRef.current !== pedidoPara) return;
      const instante = new Date();

      // Acompanha os pedidos de pareamento feitos nesta tela.
      const atuais = pedidosRef.current;
      const proximos: Record<string, PedidoPareamento> = {};
      const avisos: Array<() => void> = [];
      let conectou = false;
      for (const [id, pedido] of Object.entries(atuais)) {
        const c = lista.find((x) => x.id === id);
        if (!c) continue;
        if (c.status === "conectado") continue;
        if (estaPareando(c, instante)) {
          // "solicitado" é só o pedido gravado: o gateway ainda não respondeu. Sem QR/código em 150 s, avisa.
          const andando = pareamentoAndando(c);
          if (!andando && !pedido.viuEmCurso && instante.getTime() - pedido.em > ESPERA_MAXIMA_PEDIDO_MS) {
            avisos.push(() =>
              toast.error(`${c.nome}: o servidor do WhatsApp não respondeu ao pedido. Tente de novo em instantes.`)
            );
          } else {
            proximos[id] = { ...pedido, viuEmCurso: pedido.viuEmCurso || andando };
          }
        } else if (pedido.viuEmCurso) {
          const motivo = explicarDetalheStatus(c.status_detalhe) || "O pareamento não terminou. Gere um novo QR ou código.";
          avisos.push(() => toast.error(`${c.nome}: ${motivo}`));
        } else if (instante.getTime() - pedido.em > ESPERA_MAXIMA_PEDIDO_MS) {
          avisos.push(() =>
            toast.error(`${c.nome}: o servidor do WhatsApp não respondeu ao pedido. Tente de novo em instantes.`)
          );
        } else {
          proximos[id] = pedido;
        }
      }

      // Conectou agora: quem estava pareando (por esta tela ou não) e virou "conectado".
      const pareandoAgora = new Set<string>();
      for (const c of lista) {
        const estava = pareandoAntesRef.current.has(c.id) || Boolean(atuais[c.id]);
        if (c.status === "conectado" && estava) {
          conectou = true;
          avisos.push(() =>
            toast.success(`WhatsApp conectado${c.numero ? `: ${formatarTelefone(c.numero)}` : ""}.`)
          );
        }
        if (estaPareando(c, instante) || proximos[c.id]) pareandoAgora.add(c.id);
      }
      pareandoAntesRef.current = pareandoAgora;

      pedidosRef.current = proximos;
      setPedidos(proximos);
      setConexoes(lista);
      setErro(null);
      setAgora(instante);
      setAbertaId((atual) => {
        if (atual && lista.some((c) => c.id === atual)) return atual;
        return (lista.find((c) => c.status !== "conectado") || lista[0])?.id ?? null;
      });
      avisos.forEach((f) => f());
      if (conectou) onAlterouRef.current();
    } catch (err: any) {
      if (partnerRef.current === pedidoPara) setErro(err?.message || "Não foi possível carregar as conexões.");
    }
  }, [partnerId]);

  // Troca de empresa: começa do zero.
  useEffect(() => {
    setConexoes(null);
    setErro(null);
    setPedidos({});
    pedidosRef.current = {};
    pareandoAntesRef.current = new Set();
    setAbertaId(null);
    carregar();
  }, [carregar]);

  const algumaPareando =
    Object.keys(pedidos).length > 0 || (conexoes ?? []).some((c) => estaPareando(c, agora));

  // 3 s enquanto pareia; fora disso, só para manter status e "visto há" em dia.
  useEffect(() => {
    if (!partnerId) return;
    const t = setInterval(carregar, algumaPareando ? CONSULTA_PAREANDO_MS : CONSULTA_PARADA_MS);
    return () => clearInterval(t);
  }, [partnerId, algumaPareando, carregar]);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = nomeNova.trim();
    if (!partnerId || !nome) return;
    setCriando(true);
    try {
      const id = await criarConexao(partnerId, nome, modoNova);
      toast.success(
        modoNova === "pc" ? "Conexão criada. Abra \"Ver como usar no computador\"." : "Conexão criada. Agora conecte o WhatsApp."
      );
      setNomeNova("");
      setMostrarNova(false);
      if (id) setAbertaId(id);
      await carregar();
      onAlterou();
    } catch (err: any) {
      toast.error(`Não foi possível criar a conexão: ${err.message}`);
    } finally {
      setCriando(false);
    }
  };

  const parear = async (c: ConexaoPainel, metodo: MetodoPareamento, telefone: string | null) => {
    if (metodo === "codigo" && !telefone) {
      toast.error("Digite o número do WhatsApp para gerar o código.");
      return;
    }
    setOcupadoId(c.id);
    try {
      await pedirPareamento(c.id, metodo === "codigo" ? { metodo, telefone: telefone! } : { metodo });
      const pedido: PedidoPareamento = { metodo, telefone, em: Date.now(), viuEmCurso: false };
      pedidosRef.current = { ...pedidosRef.current, [c.id]: pedido };
      setPedidos(pedidosRef.current);
      await carregar();
    } catch (err: any) {
      toast.error(`Não foi possível pedir o pareamento: ${err.message}`);
    } finally {
      setOcupadoId(null);
    }
  };

  const desconectar = async (c: ConexaoPainel, silencioso = false) => {
    setOcupadoId(c.id);
    try {
      await desconectarConexao(c.id);
      const { [c.id]: _, ...resto } = pedidosRef.current;
      pedidosRef.current = resto;
      setPedidos(resto);
      pareandoAntesRef.current.delete(c.id);
      if (!silencioso) toast.success("Pedido enviado: o WhatsApp vai sair deste aparelho conectado.");
      await carregar();
      onAlterou();
    } catch (err: any) {
      toast.error(`Não foi possível desconectar: ${err.message}`);
    } finally {
      setOcupadoId(null);
      setDesconectando(null);
    }
  };

  const remover = async (c: ConexaoPainel) => {
    setOcupadoId(c.id);
    try {
      await arquivarConexao(c.id);
      const { [c.id]: _, ...resto } = pedidosRef.current;
      pedidosRef.current = resto;
      setPedidos(resto);
      pareandoAntesRef.current.delete(c.id);
      toast.success("Conexão removida.");
      await carregar();
      onAlterou();
    } catch (err: any) {
      toast.error(`Não foi possível remover: ${err.message}`);
    } finally {
      setOcupadoId(null);
      setRemovendo(null);
    }
  };

  const abrirComputador = (conexaoId: string) => {
    setComputadorConexaoId(conexaoId);
    setComputadorAberto(true);
    setTimeout(() => document.getElementById("usar-no-computador")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-red-500" /> Conectar WhatsApp
          </h2>
          <p className="text-sm text-slate-400 mt-1 leading-relaxed">
            O CRM registra as conversas do seu WhatsApp como um aparelho conectado. O robô começa desligado.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => carregar()}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
            aria-label="Atualizar"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMostrarNova((v) => !v)}
            disabled={!partnerId}
            className="min-h-[44px] flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold text-white disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Nova conexão
          </button>
        </div>
      </div>

      {mostrarNova && (
        <form onSubmit={criar} className="glass-panel rounded-3xl p-5 border border-white/10 space-y-3">
          <label htmlFor="nome-nova-conexao" className="block text-sm font-bold text-white">
            Nome da conexão
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="nome-nova-conexao"
              autoFocus
              maxLength={80}
              value={nomeNova}
              onChange={(e) => setNomeNova(e.target.value)}
              placeholder="Ex.: WhatsApp de vendas"
              className="flex-1 min-h-[44px] rounded-xl bg-black border border-white/15 px-3 text-base md:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
            />
            <button
              type="submit"
              disabled={criando || !nomeNova.trim()}
              className="min-h-[44px] flex items-center justify-center gap-2 px-5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold text-white disabled:opacity-50"
            >
              {criando && <Loader2 className="w-4 h-4 animate-spin" />} Criar
            </button>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-400">Onde o WhatsApp vai ficar conectado</legend>
            {(
              [
                ["gateway", "No servidor", "Recomendado: conecta por QR ou código, sem instalar nada."],
                ["pc", "No meu computador", "Piloto: o programa roda no seu PC; só ele envia campanhas."],
              ] as const
            ).map(([valor, rotulo, ajuda]) => (
              <label
                key={valor}
                className={`flex items-start gap-3 min-h-[44px] rounded-xl border px-3 py-2 cursor-pointer ${
                  modoNova === valor ? "border-red-500/60 bg-red-500/5" : "border-white/10"
                }`}
              >
                <input
                  type="radio"
                  name="modo-nova-conexao"
                  checked={modoNova === valor}
                  onChange={() => setModoNova(valor)}
                  className="mt-1 accent-red-500"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">{rotulo}</span>
                  <span className="block text-xs text-slate-400">{ajuda}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </form>
      )}

      {erro && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Não foi possível carregar as conexões: {erro}</span>
        </div>
      )}

      {conexoes === null && !erro && (
        <div className="py-16 flex justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {conexoes !== null && conexoes.length === 0 && (
        <div className="glass-panel rounded-3xl p-8 border border-dashed border-white/10 text-center space-y-3">
          <PlugZap className="w-8 h-8 text-red-500 mx-auto" />
          <p className="text-sm font-bold text-white">Nenhum WhatsApp conectado ainda</p>
          <p className="text-sm text-slate-400">Crie uma conexão e leia o QR ou digite o código no celular.</p>
          {!mostrarNova && (
            <button
              type="button"
              onClick={() => setMostrarNova(true)}
              className="min-h-[44px] px-5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold text-white"
            >
              Criar a primeira conexão
            </button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {(conexoes ?? []).map((c) => (
          <CartaoConexao
            key={c.id}
            conexao={c}
            aberta={abertaId === c.id}
            onAlternar={() => setAbertaId((atual) => (atual === c.id ? null : c.id))}
            agora={agora}
            pedido={pedidos[c.id]}
            ocupado={ocupadoId === c.id}
            onParear={(metodo, telefone) => parear(c, metodo, telefone)}
            onCancelarPareamento={() => desconectar(c, true)}
            onDesconectar={() => setDesconectando(c)}
            onOpcoesSalvas={() => {
              carregar();
              onAlterou();
            }}
            onUsarNoComputador={() => abrirComputador(c.id)}
            onRemover={() => setRemovendo(c)}
          />
        ))}
      </div>

      <UsarNoComputador
        conexoes={conexoes ?? []}
        aberto={computadorAberto}
        onAlternar={() => setComputadorAberto((v) => !v)}
        conexaoInicialId={computadorConexaoId}
      />

      {removendo && (
        <ModalConfirmacao
          titulo={`Remover "${removendo.nome}"?`}
          textoConfirmar="Remover"
          perigo
          onConfirmar={() => remover(removendo)}
          onCancelar={() => setRemovendo(null)}
        >
          <p>
            A conexão sai da lista{removendo.modo === "gateway" ? " e o WhatsApp sai dos aparelhos conectados" : ""}. As
            conversas já registradas continuam aqui.
          </p>
        </ModalConfirmacao>
      )}

      {desconectando && (
        <ModalConfirmacao
          titulo={`Desconectar "${desconectando.nome}"?`}
          textoConfirmar="Desconectar"
          perigo
          onConfirmar={() => desconectar(desconectando)}
          onCancelar={() => setDesconectando(null)}
        >
          <p>
            O CRM sai dos aparelhos conectados deste WhatsApp e a sessão guardada no servidor é apagada. As conversas
            já registradas continuam aqui.
          </p>
          <p>Para voltar a registrar, será preciso conectar de novo com QR ou código.</p>
        </ModalConfirmacao>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- cartão de uma conexão

interface CartaoConexaoProps {
  conexao: ConexaoPainel;
  aberta: boolean;
  onAlternar: () => void;
  agora: Date;
  pedido?: PedidoPareamento;
  ocupado: boolean;
  onParear: (metodo: MetodoPareamento, telefone: string | null) => void;
  onCancelarPareamento: () => void;
  onDesconectar: () => void;
  onOpcoesSalvas: () => void;
  onUsarNoComputador: () => void;
  onRemover: () => void;
}

const CartaoConexao: React.FC<CartaoConexaoProps> = ({
  conexao: c,
  aberta,
  onAlternar,
  agora,
  pedido,
  ocupado,
  onParear,
  onCancelarPareamento,
  onDesconectar,
  onOpcoesSalvas,
  onUsarNoComputador,
  onRemover,
}) => {
  const pareando = Boolean(pedido) || estaPareando(c, agora);
  // Durante o pareamento dá para voltar à escolha (trocar QR/código ou o número).
  const [escolhendo, setEscolhendo] = useState(false);
  useEffect(() => {
    if (!pareando) setEscolhendo(false);
  }, [pareando]);
  const metodo = metodoEmCurso(c, pedido);
  const telefonePedido = pedido?.telefone ?? null;
  const detalhe = c.status !== "conectado" && !pareando ? explicarDetalheStatus(c.status_detalhe) : null;
  const podeDesconectar = c.modo === "gateway" && !pareando && c.status !== "deslogado" && (c.status !== "desconectado" || Boolean(c.numero));

  return (
    <article className="glass-panel rounded-3xl border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberta}
        className="w-full text-left px-4 sm:px-5 py-4 flex items-start gap-3 hover:bg-white/[0.02]"
      >
        <div className="w-10 h-10 shrink-0 rounded-2xl bg-black border border-white/10 flex items-center justify-center">
          {c.modo === "pc" ? <Laptop className="w-5 h-5 text-red-400" /> : <Server className="w-5 h-5 text-red-400" />}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-white truncate max-w-full">{c.nome}</h3>
            <SeloStatus status={c.status} />
          </div>
          <p className="text-xs text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5">
            <span className="font-mono">{c.numero ? formatarTelefone(c.numero) : "Sem número ainda"}</span>
            <span aria-hidden>·</span>
            <span>{vistoHa(c.visto_em, agora)}</span>
            <span aria-hidden>·</span>
            <span>{c.modo === "pc" ? "No computador" : "No servidor"}</span>
            <span aria-hidden>·</span>
            <span className={c.opcoes.botAtivo ? "text-amber-300" : ""}>
              Robô {c.opcoes.botAtivo ? "ligado" : "desligado"}
            </span>
          </p>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-500 shrink-0 mt-2 transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>

      {aberta && (
        <div className="px-4 sm:px-5 pb-5 pt-4 space-y-6 border-t border-white/10">
          {c.modo === "pc" ? (
            <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
              <p>
                Esta conexão usa o programa no computador. O pareamento (QR ou código) fica no painel do programa,
                nesse computador. O robô e os grupos valem aqui: é o CRM que decide se o robô responde.
              </p>
              <button
                type="button"
                onClick={onUsarNoComputador}
                className="min-h-[44px] flex items-center gap-2 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-semibold text-white"
              >
                <Laptop className="w-4 h-4" /> Ver como usar no computador
              </button>
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Opções</h4>
                <OpcoesDaConexao conexao={c} onSalvo={onOpcoesSalvas} />
              </div>
              <div className="pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={onRemover}
                  disabled={ocupado}
                  className="min-h-[44px] w-full sm:w-auto flex items-center justify-center gap-2 px-4 rounded-xl border border-red-500/40 text-sm font-bold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Unplug className="w-4 h-4" /> Remover conexão
                </button>
              </div>
            </div>
          ) : (
            <>
              {detalhe && (
                <div
                  className={`rounded-2xl border p-3 text-sm flex items-start gap-2 ${
                    c.status === "erro" || c.status === "deslogado"
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : "border-white/10 bg-white/[0.03] text-slate-300"
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{detalhe}</span>
                </div>
              )}

              {c.status === "conectado" ? null : pareando && !escolhendo ? (
                <PainelPareamento
                  conexao={c}
                  metodo={metodo}
                  telefone={telefonePedido}
                  pedidoEm={pedido?.em ?? null}
                  ocupado={ocupado}
                  onGerarDeNovo={() =>
                    // Sem o número (tela recarregada no meio do código), pede de novo.
                    metodo === "codigo" && !telefonePedido ? setEscolhendo(true) : onParear(metodo, telefonePedido)
                  }
                  onTrocarJeito={() => setEscolhendo(true)}
                  onCancelar={onCancelarPareamento}
                />
              ) : (
                <EscolhaPareamento
                  ocupado={ocupado}
                  metodoInicial={pareando ? metodo : undefined}
                  onParear={(m, tel) => {
                    setEscolhendo(false);
                    onParear(m, tel);
                  }}
                  onVoltar={escolhendo ? () => setEscolhendo(false) : undefined}
                />
              )}

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Opções</h4>
                <OpcoesDaConexao conexao={c} onSalvo={onOpcoesSalvas} />
              </div>

              {(podeDesconectar || !pareando) && (
                <div className="pt-2 border-t border-white/10 flex flex-col sm:flex-row gap-2">
                  {podeDesconectar && (
                  <button
                    type="button"
                    onClick={onDesconectar}
                    disabled={ocupado}
                    className="min-h-[44px] w-full sm:w-auto flex items-center justify-center gap-2 px-4 rounded-xl border border-red-500/40 text-sm font-bold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
                    Desconectar
                  </button>
                  )}
                  {!pareando && (
                    <button
                      type="button"
                      onClick={onRemover}
                      disabled={ocupado}
                      className="min-h-[44px] w-full sm:w-auto flex items-center justify-center gap-2 px-4 rounded-xl border border-white/15 text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
                    >
                      Remover conexão
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
};

// ---------------------------------------------------------------- escolha do jeito de parear

const EscolhaPareamento: React.FC<{
  ocupado: boolean;
  metodoInicial?: MetodoPareamento;
  onParear: (metodo: MetodoPareamento, telefone: string | null) => void;
  /** Só quando aberta no meio de um pareamento: volta para o QR/código em curso. */
  onVoltar?: () => void;
}> = ({ ocupado, metodoInicial, onParear, onVoltar }) => {
  const [metodo, setMetodo] = useState<MetodoPareamento>(metodoInicial ?? "codigo");
  const [telefone, setTelefone] = useState("");
  const normalizado = telefoneParaPareamento(telefone);

  const pedirCodigo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizado) {
      toast.error("Digite o número com DDD, por exemplo (65) 99999-0000.");
      return;
    }
    onParear("codigo", telefoneParaEnvio(telefone));
  };

  const abas: Array<{ id: MetodoPareamento; rotulo: string; icone: React.ElementType }> = [
    { id: "codigo", rotulo: "Código pelo celular", icone: Hash },
    { id: "qr", rotulo: "QR na tela", icone: QrCode },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4 sm:p-5 space-y-4">
      <div role="tablist" aria-label="Como conectar" className="grid grid-cols-2 gap-1 bg-black border border-white/10 p-1 rounded-2xl">
        {abas.map((a) => {
          const Icone = a.icone;
          const ativa = metodo === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setMetodo(a.id)}
              className={`min-h-[44px] flex items-center justify-center gap-2 px-2 rounded-xl text-xs sm:text-sm font-bold transition ${
                ativa ? "bg-red-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Icone className="w-4 h-4 shrink-0" /> {a.rotulo}
            </button>
          );
        })}
      </div>

      {metodo === "codigo" ? (
        <form onSubmit={pedirCodigo} className="space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">
            Sem precisar de outra tela: digite o número deste WhatsApp e o CRM mostra um código de 8 letras para você
            digitar no celular.
          </p>
          <label htmlFor="telefone-pareamento" className="block text-xs font-semibold text-slate-400">
            Número do WhatsApp (com DDD)
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="telefone-pareamento"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(65) 99999-0000"
              className="flex-1 min-h-[44px] rounded-xl bg-black border border-white/15 px-3 text-base md:text-sm text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-red-500"
            />
            <button
              type="submit"
              disabled={ocupado || !telefone.trim()}
              className="min-h-[44px] flex items-center justify-center gap-2 px-5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold text-white disabled:opacity-50"
            >
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />} Gerar código
            </button>
          </div>
          {normalizado && (
            <p className="text-xs text-slate-500">
              O código será pedido para <span className="font-mono text-slate-300">{formatarTelefone(normalizado)}</span>.
            </p>
          )}
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">
            Abra esta tela num computador (ou outro aparelho) e leia o QR com o celular do WhatsApp que vai ser
            conectado.
          </p>
          <button
            type="button"
            onClick={() => onParear("qr", null)}
            disabled={ocupado}
            className="min-h-[44px] w-full sm:w-auto flex items-center justify-center gap-2 px-5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold text-white disabled:opacity-50"
          >
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} Mostrar QR
          </button>
        </div>
      )}

      {onVoltar && (
        <button
          type="button"
          onClick={onVoltar}
          className="min-h-[44px] px-4 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5"
        >
          Voltar ao pareamento em curso
        </button>
      )}

      <p className="text-xs text-slate-500 leading-relaxed">
        É uma conexão não oficial do WhatsApp: existe risco de bloqueio do número, menor com o robô desligado. O
        CRM nunca marca mensagens como lidas nem fica "online" no seu lugar.
      </p>
    </div>
  );
};

export default ConectarWhatsAppView;

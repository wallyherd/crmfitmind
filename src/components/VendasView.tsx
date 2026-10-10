// Aba Vendas: o que já está confirmado e o que a IA achou e espera um toque seu.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CircleDollarSign, Plus, Quote, RefreshCw, X } from "lucide-react";
import { buscarVendas, criarVendaManual, decidirVenda, listarProdutos } from "@/lib/api-comercial";
import {
  brl,
  dataBr,
  ehDataIso,
  hojeIso,
  intervaloDoFiltro,
  lerValor,
  numeroWhatsApp,
  paresOrdenados,
  telefoneLegivel,
  type FiltroPeriodo,
} from "@/lib/formatos";
import { VerComprovante } from "@/components/VerComprovante";
import { FONTES_VENDA, FORMAS_ESCOLHA, FORMAS_PAGAMENTO, ORIGENS, STATUS_VENDA, rotulo } from "@/lib/rotulos";
import {
  CLASSE_BOTAO,
  CLASSE_BOTAO_LEVE,
  CLASSE_BOTAO_SEC,
  CLASSE_INPUT,
  CLASSE_ROTULO,
  Cabecalho,
  Carregando,
  ErroCarga,
  Modal,
  Painel,
  Selo,
  Vazio,
  mensagemDeErro,
} from "@/components/Pecas";
import type { FormaPagamento, Venda, VendasResposta } from "@/types";

type Filtro = FiltroPeriodo | "intervalo";
type FiltroStatus = "todas" | "pendente_confirmacao" | "confirmada" | "rejeitada";

const FILTROS: Array<{ id: Filtro; texto: string }> = [
  { id: "hoje", texto: "Hoje" },
  { id: "7d", texto: "7 dias" },
  { id: "mes", texto: "Mês" },
  { id: "intervalo", texto: "Escolher datas" },
];

const FILTROS_STATUS: Array<{ id: FiltroStatus; texto: string }> = [
  { id: "todas", texto: "Todas" },
  { id: "pendente_confirmacao", texto: "A confirmar" },
  { id: "confirmada", texto: "Confirmadas" },
  { id: "rejeitada", texto: "Não foram venda" },
];

const ORDEM_STATUS: Record<string, number> = { pendente_confirmacao: 0, confirmada: 1, estornada: 2, rejeitada: 3 };

function valorParaCampo(valor: number | null): string {
  return valor === null || valor === undefined ? "" : Number(valor).toFixed(2).replace(".", ",");
}

const SeloStatus: React.FC<{ status: string }> = ({ status }) => (
  <Selo tom={status === "pendente_confirmacao" ? "ambar" : status === "confirmada" ? "claro" : "neutro"}>
    {rotulo(STATUS_VENDA, status)}
  </Selo>
);

// ------------------------------------------------------------------ cartão de venda
const CartaoVenda: React.FC<{ venda: Venda; aoDecidir: () => void }> = ({ venda, aoDecidir }) => {
  const [valorTexto, setValorTexto] = useState(valorParaCampo(venda.valor));
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const pendente = venda.status === "pendente_confirmacao";
  const nome = venda.contato?.nome || telefoneLegivel(venda.contato?.telefone) || "Contato não identificado";

  const confirmar = async () => {
    const valor = lerValor(valorTexto);
    if (valor === null || valor <= 0) {
      toast.error("Digite o valor da venda, por exemplo 497,00.");
      return;
    }
    setEnviando(true);
    try {
      // Só manda o valor quando o mentorado corrigiu: assim a IA aprende a diferença.
      const corrigiu = venda.valor === null || Math.abs(valor - Number(venda.valor)) >= 0.01;
      await decidirVenda(venda.id, corrigiu ? { acao: "confirmar", valor } : { acao: "confirmar" });
      toast.success("Venda confirmada.");
      aoDecidir();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  const rejeitar = async () => {
    setEnviando(true);
    try {
      await decidirVenda(venda.id, motivo.trim() ? { acao: "rejeitar", motivo: motivo.trim().slice(0, 200) } : { acao: "rejeitar" });
      toast.success("Marcado como não foi venda. A IA não vai sugerir esta de novo.");
      aoDecidir();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <li
      className={`p-3.5 md:p-4 rounded-2xl border space-y-3 ${
        pendente ? "bg-amber-500/[0.04] border-amber-500/30" : "bg-white/[0.02] border-white/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">{nome}</p>
          <p className="text-[11px] text-slate-500">
            {dataBr(venda.dia)}
            {venda.contato?.nome && venda.contato?.telefone ? ` · ${telefoneLegivel(venda.contato.telefone)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Selo>{rotulo(FONTES_VENDA, venda.fonte)}</Selo>
          <SeloStatus status={venda.status} />
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`text-lg font-extrabold ${
            venda.status === "rejeitada" || venda.status === "estornada" ? "text-slate-500 line-through" : "text-white"
          }`}
        >
          {brl(venda.valor)}
        </span>
        <span className="text-[11px] text-slate-400">{rotulo(FORMAS_PAGAMENTO, venda.forma || "desconhecida")}</span>
        {venda.produto && <span className="text-[11px] text-slate-400">· {venda.produto}</span>}
      </div>

      {venda.evidencia_trecho && (
        <blockquote className="flex gap-2 text-[11px] text-slate-300 bg-black/40 border border-white/10 rounded-xl p-2.5 leading-relaxed">
          <Quote className="w-3.5 h-3.5 shrink-0 text-slate-500 mt-0.5" />
          <span className="break-words">
            <span className="text-slate-500">Prova na conversa: </span>“{venda.evidencia_trecho}”
          </span>
        </blockquote>
      )}

      {venda.alerta && (
        <p className="flex gap-2 text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
          <span className="break-words">{venda.alerta}</span>
        </p>
      )}

      {pendente && venda.comprovante_leitura && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-300 bg-black/40 border border-white/10 rounded-xl p-2.5 break-words">
            {venda.comprovante_leitura.resumo}
            <span className="text-slate-500"> (leitura da IA: é só uma pista, confira a imagem)</span>
          </p>
          {venda.comprovante_leitura.alertas.map((texto) => (
            <p key={texto} className="flex gap-2 text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
              <span className="break-words">{texto}</span>
            </p>
          ))}
        </div>
      )}

      {pendente && !rejeitando && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <label className="sm:w-40">
            <span className={CLASSE_ROTULO}>Valor (R$)</span>
            <input
              value={valorTexto}
              onChange={(e) => setValorTexto(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className={CLASSE_INPUT}
            />
          </label>
          <div className="flex gap-2">
            <button onClick={confirmar} disabled={enviando} className={`${CLASSE_BOTAO} flex-1 sm:flex-none`}>
              <Check className="w-3.5 h-3.5" /> Confirmar
            </button>
            <button
              onClick={() => setRejeitando(true)}
              disabled={enviando}
              className={`${CLASSE_BOTAO_SEC} flex-1 sm:flex-none`}
            >
              <X className="w-3.5 h-3.5" /> Não foi venda
            </button>
            {venda.comprovante_mensagem_id && (
              <VerComprovante
                mensagemId={venda.comprovante_mensagem_id}
                rotulo="Ver comprovante"
                className={`${CLASSE_BOTAO_SEC} flex-1 sm:flex-none`}
              />
            )}
          </div>
        </div>
      )}

      {pendente && rejeitando && (
        <div className="space-y-2">
          <label className="block">
            <span className={CLASSE_ROTULO}>Por que não foi venda? (opcional)</span>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={200}
              placeholder="Ex.: era só orçamento, o cliente desistiu..."
              className={CLASSE_INPUT}
            />
          </label>
          <div className="flex gap-2">
            <button onClick={rejeitar} disabled={enviando} className={`${CLASSE_BOTAO} flex-1 sm:flex-none`}>
              Confirmar: não foi venda
            </button>
            <button onClick={() => setRejeitando(false)} disabled={enviando} className={`${CLASSE_BOTAO_SEC} flex-1 sm:flex-none`}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

// -------------------------------------------------------------- venda manual
const NovaVendaManual: React.FC<{ partnerId: string; aoFechar: () => void; aoSalvar: () => void }> = ({
  partnerId,
  aoFechar,
  aoSalvar,
}) => {
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [valorTexto, setValorTexto] = useState("");
  const [forma, setForma] = useState<FormaPagamento>("pix");
  const [produto, setProduto] = useState("");
  const [dia, setDia] = useState(hojeIso());
  const [produtos, setProdutos] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    listarProdutos(partnerId)
      .then((lista) => setProdutos(lista.filter((p) => p.ativo !== false).map((p) => p.nome)))
      .catch(() => setProdutos([]));
  }, [partnerId]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = lerValor(valorTexto);
    const numero = telefone.trim() ? numeroWhatsApp(telefone) : null;
    if (!telefone.trim() && !nome.trim()) return toast.error("Informe o telefone ou o nome do cliente.");
    if (telefone.trim() && !numero) return toast.error("Telefone inválido. Use DDD + número.");
    if (valor === null || valor <= 0) return toast.error("Digite o valor da venda, por exemplo 497,00.");
    if (!ehDataIso(dia)) return toast.error("Escolha o dia da venda.");

    setSalvando(true);
    try {
      await criarVendaManual({
        partnerId,
        ...(numero ? { telefone: numero } : {}),
        ...(nome.trim() ? { nome: nome.trim() } : {}),
        valor,
        forma,
        ...(produto.trim() ? { produto: produto.trim() } : {}),
        dia,
      });
      toast.success("Venda lançada.");
      aoSalvar();
    } catch (err) {
      toast.error(mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo="Lançar venda manual" aoFechar={aoFechar}>
      <p className="text-[11px] text-slate-400">
        Venda que você fez e quer registrar já como confirmada. Busque o cliente pelo telefone ou pelo nome.
      </p>
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={CLASSE_ROTULO}>Telefone (WhatsApp)</span>
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              inputMode="tel"
              placeholder="(65) 99999-0000"
              className={CLASSE_INPUT}
            />
          </label>
          <label className="block">
            <span className={CLASSE_ROTULO}>Nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" className={CLASSE_INPUT} />
          </label>
          <label className="block">
            <span className={CLASSE_ROTULO}>Valor (R$) *</span>
            <input
              value={valorTexto}
              onChange={(e) => setValorTexto(e.target.value)}
              inputMode="decimal"
              placeholder="497,00"
              required
              className={CLASSE_INPUT}
            />
          </label>
          <label className="block">
            <span className={CLASSE_ROTULO}>Forma de pagamento *</span>
            <select value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)} className={CLASSE_INPUT}>
              {FORMAS_ESCOLHA.map((f) => (
                <option key={f} value={f}>
                  {rotulo(FORMAS_PAGAMENTO, f)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={CLASSE_ROTULO}>Produto</span>
            <input
              value={produto}
              onChange={(e) => setProduto(e.target.value)}
              list="produtos-venda-manual"
              placeholder="Opcional"
              className={CLASSE_INPUT}
            />
            <datalist id="produtos-venda-manual">
              {produtos.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className={CLASSE_ROTULO}>Dia da venda</span>
            <input type="date" value={dia} max={hojeIso()} onChange={(e) => setDia(e.target.value)} className={CLASSE_INPUT} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={aoFechar} className={CLASSE_BOTAO_SEC}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className={CLASSE_BOTAO}>
            {salvando ? "Salvando..." : "Lançar venda"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------------- a tela
export const VendasView: React.FC<{ partnerId: string }> = ({ partnerId }) => {
  const [filtro, setFiltro] = useState<Filtro>("7d");
  const [de, setDe] = useState(() => intervaloDoFiltro("7d").de);
  const [ate, setAte] = useState(() => hojeIso());
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todas");
  const [dados, setDados] = useState<VendasResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [modalManual, setModalManual] = useState(false);
  const pedido = useRef(0);

  const periodo = useMemo(() => (filtro === "intervalo" ? { de, ate } : intervaloDoFiltro(filtro)), [filtro, de, ate]);
  const periodoValido = ehDataIso(periodo.de) && ehDataIso(periodo.ate) && periodo.de <= periodo.ate;

  const carregar = useCallback(async () => {
    if (!periodoValido) return;
    const meu = ++pedido.current;
    setCarregando(true);
    try {
      const resposta = await buscarVendas(partnerId, periodo.de, periodo.ate);
      if (meu !== pedido.current) return;
      setDados(resposta);
      setErro(null);
    } catch (e) {
      if (meu === pedido.current) setErro(mensagemDeErro(e, "Não foi possível carregar as vendas."));
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [partnerId, periodo.de, periodo.ate, periodoValido]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setDados(null);
  }, [partnerId]);

  const vendas = useMemo(() => {
    const todas = [...(dados?.vendas || [])].sort(
      (a, b) =>
        (ORDEM_STATUS[a.status] ?? 9) - (ORDEM_STATUS[b.status] ?? 9) ||
        b.dia.localeCompare(a.dia) ||
        (b.criado_em || "").localeCompare(a.criado_em || ""),
    );
    if (filtroStatus === "todas") return todas;
    if (filtroStatus === "rejeitada") return todas.filter((v) => v.status === "rejeitada" || v.status === "estornada");
    return todas.filter((v) => v.status === filtroStatus);
  }, [dados, filtroStatus]);

  const qtd = (status: string) => (dados?.vendas || []).filter((v) => v.status === status).length;
  const porForma = paresOrdenados(dados?.totais?.por_forma);
  const porOrigem = paresOrdenados(dados?.totais?.por_origem);

  return (
    <div className="p-4 md:p-8 space-y-5 md:space-y-6 max-w-6xl mx-auto">
      <Cabecalho
        icone={CircleDollarSign}
        titulo="Vendas"
        subtitulo="Confirmado é o que conta no painel. O que a IA achou nas conversas fica “a confirmar” até você decidir."
        acoes={
          <>
            <button onClick={carregar} disabled={carregando} className={CLASSE_BOTAO_SEC} aria-label="Atualizar vendas">
              <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            </button>
            <button onClick={() => setModalManual(true)} className={CLASSE_BOTAO}>
              <Plus className="w-4 h-4" /> Venda manual
            </button>
          </>
        }
      />

      {/* Período */}
      <div className="space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                filtro === f.id
                  ? "bg-red-600 border-red-500 text-white"
                  : "bg-white/[0.03] border-white/10 text-slate-300 hover:border-red-500/40"
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>
        {filtro === "intervalo" && (
          <div className="grid grid-cols-2 gap-2 max-w-sm">
            <label>
              <span className={CLASSE_ROTULO}>De</span>
              <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className={CLASSE_INPUT} />
            </label>
            <label>
              <span className={CLASSE_ROTULO}>Até</span>
              <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className={CLASSE_INPUT} />
            </label>
          </div>
        )}
        {!periodoValido && <p className="text-[11px] text-amber-300">Escolha um período válido (início antes do fim).</p>}
      </div>

      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && !dados && <Carregando texto="Carregando vendas..." />}

      {dados && (
        <>
          {/* Totais lado a lado: confirmado x a confirmar */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card rounded-2xl p-3.5 md:p-5 border-white/20 min-w-0">
              <p className="text-[11px] font-semibold text-slate-400">Confirmado</p>
              <p className="mt-1.5 text-xl md:text-3xl font-extrabold text-white tracking-tight break-words">
                {brl(dados.totais?.confirmado ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {qtd("confirmada")} {qtd("confirmada") === 1 ? "venda" : "vendas"}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-3.5 md:p-5 border-amber-500/40 min-w-0">
              <p className="text-[11px] font-semibold text-amber-300">A confirmar (IA)</p>
              <p className="mt-1.5 text-xl md:text-3xl font-extrabold text-amber-200 tracking-tight break-words">
                {brl(dados.totais?.a_confirmar ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {qtd("pendente_confirmacao")} esperando sua decisão
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Painel titulo="Por forma de pagamento">
              {porForma.length === 0 ? (
                <p className="text-[11px] text-slate-500">Nada confirmado no período.</p>
              ) : (
                <ul className="space-y-1.5">
                  {porForma.map(([forma, valor]) => (
                    <li key={forma} className="flex justify-between gap-3 text-xs">
                      <span className="text-slate-400">{rotulo(FORMAS_PAGAMENTO, forma)}</span>
                      <span className="text-white font-semibold">{brl(valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Painel>
            <Painel titulo="Por origem">
              {porOrigem.length === 0 ? (
                <p className="text-[11px] text-slate-500">Nada confirmado no período.</p>
              ) : (
                <ul className="space-y-1.5">
                  {porOrigem.map(([origem, valor]) => (
                    <li key={origem} className="flex justify-between gap-3 text-xs">
                      <span className="text-slate-400">{rotulo(ORIGENS, origem)}</span>
                      <span className="text-white font-semibold">{brl(valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Painel>
          </div>

          <Painel
            titulo="Lista de vendas"
            acoes={
              <div className="flex gap-1 overflow-x-auto max-w-full">
                {FILTROS_STATUS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFiltroStatus(f.id)}
                    className={`${CLASSE_BOTAO_LEVE} shrink-0 ${filtroStatus === f.id ? "!border-red-500/60 !text-white" : ""}`}
                  >
                    {f.texto}
                  </button>
                ))}
              </div>
            }
          >
            {vendas.length === 0 ? (
              <Vazio>
                Nenhuma venda aqui no período. Quando a IA achar uma venda nas conversas, ela aparece como “a
                confirmar”. Vendas feitas fora do WhatsApp você lança em “Venda manual”.
              </Vazio>
            ) : (
              <ul className="space-y-2.5">
                {vendas.map((v) => (
                  <CartaoVenda key={`${v.id}-${v.status}`} venda={v} aoDecidir={carregar} />
                ))}
              </ul>
            )}
          </Painel>
        </>
      )}

      {modalManual && (
        <NovaVendaManual
          partnerId={partnerId}
          aoFechar={() => setModalManual(false)}
          aoSalvar={() => {
            setModalManual(false);
            carregar();
          }}
        />
      )}
    </div>
  );
};

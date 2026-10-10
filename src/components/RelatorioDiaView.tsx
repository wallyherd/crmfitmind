// Relatório do dia: os números contados pelo sistema (SQL) e, se o lote já foi analisado,
// o que a IA achou de cada conversa. Substitui a antiga tela de Retroalimentação.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  Flag,
  Megaphone,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  UserX,
  Hourglass,
  CircleDollarSign,
  TrendingUp,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { buscarRelatorioDia } from "@/lib/api-comercial";
import {
  brl,
  dataComSemana,
  duracaoMin,
  ehDataIso,
  hojeIso,
  metaBatida,
  ontemIso,
  paresOrdenados,
  pct,
  progressoMeta,
  somarDias,
} from "@/lib/formatos";
import { copiarTexto } from "@/lib/navegador";
import { FONTES_TRAFEGO, METAS, MOTORES, STATUS_LOTE, rotulo } from "@/lib/rotulos";
import { ContatoAnalisado } from "@/components/ContatoAnalisado";
import {
  CLASSE_BOTAO_LEVE,
  CLASSE_BOTAO_SEC,
  CLASSE_INPUT,
  Cabecalho,
  Carregando,
  ErroCarga,
  Numero,
  Painel,
  Selo,
  Vazio,
  mensagemDeErro,
} from "@/components/Pecas";
import type { ContatoAnalise, DicaMensagem, EstadoLote, FocoSugerido, MetaRealizada, RelatorioDia } from "@/types";

type Destino = "vendas" | "ia";

const TEXTO_METAS: Record<string, string> = Object.fromEntries(Object.entries(METAS).map(([k, v]) => [k, v.texto]));
const PESO_PRIORIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const POR_PAGINA = 30;

function valorDaMeta(tipo: string, valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  const unidade = METAS[tipo]?.unidade;
  if (unidade === "brl") return brl(valor);
  if (unidade === "min") return duracaoMin(valor);
  return String(valor);
}

// --------------------------------------------------------------------- estado do lote
const EstadoDoLote: React.FC<{ lote: EstadoLote | null; temAnalise: boolean; aoIrPara: (d: Destino) => void }> = ({
  lote,
  temAnalise,
  aoIrPara,
}) => {
  const status = lote?.status || "sem_lote";
  const info = STATUS_LOTE[status] || { texto: status, tom: "neutro" as const };
  const explicacao: Record<string, string> = {
    sem_lote: "As conversas deste dia ainda não foram separadas para a IA. Isso acontece sozinho às 04:30 do dia seguinte.",
    pronto: "As conversas já foram separadas e estão esperando a IA analisar.",
    reservado: "A IA está analisando as conversas agora.",
    concluido: "A IA já analisou as conversas deste dia.",
    erro: "A análise automática falhou. Fale com o mentor ou faça a análise manual.",
  };
  const manualPendente = (status === "pronto" || status === "erro") && lote?.motor === "manual";

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border ${
        info.tom === "erro"
          ? "bg-red-500/10 border-red-500/30"
          : info.tom === "fila"
            ? "bg-amber-500/[0.06] border-amber-500/25"
            : "bg-white/[0.02] border-white/10"
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <FileText className={`w-4 h-4 shrink-0 mt-0.5 ${info.tom === "erro" ? "text-red-400" : "text-slate-400"}`} />
        <div className="min-w-0">
          <p className="text-xs font-bold text-white flex flex-wrap items-center gap-2">
            Análise da IA: {info.texto}
            {lote && lote.partes > 1 && <Selo>{lote.partes} partes</Selo>}
            {lote?.motor && <Selo>{rotulo(MOTORES, lote.motor)}</Selo>}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {explicacao[status] || ""}
            {status === "concluido" && !temAnalise ? " Não há contatos comerciais neste dia." : ""}
          </p>
        </div>
      </div>
      {manualPendente && (
        <button onClick={() => aoIrPara("ia")} className={`${CLASSE_BOTAO_SEC} shrink-0`}>
          Fazer a análise manual
        </button>
      )}
    </div>
  );
};

// ------------------------------------------------------------------- metas
export const MetasDoDia: React.FC<{ metas: MetaRealizada[]; aoIrPara?: (d: Destino) => void; somenteLeitura?: boolean }> = ({
  metas,
  aoIrPara,
  somenteLeitura,
}) => (
  <Painel titulo="Metas x realizado" icone={Target}>
    {metas.length === 0 ? (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">Nenhuma meta diária cadastrada.</p>
        {!somenteLeitura && aoIrPara && (
          <button onClick={() => aoIrPara("ia")} className={CLASSE_BOTAO_LEVE}>
            Cadastrar metas
          </button>
        )}
      </div>
    ) : (
      <ul className="space-y-3">
        {metas.map((m) => {
          const batida = metaBatida(m.tipo, m.meta, m.realizado);
          const progresso = progressoMeta(m.tipo, m.meta, m.realizado);
          return (
            <li key={m.tipo} className="space-y-1">
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <span className="text-slate-300">{rotulo(TEXTO_METAS, m.tipo)}</span>
                <span className={batida ? "text-white font-bold" : "text-slate-400"}>
                  {valorDaMeta(m.tipo, m.realizado)} <span className="text-slate-600">/ {valorDaMeta(m.tipo, m.meta)}</span>
                  {batida && " ✓"}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full ${batida ? "bg-red-500" : "bg-slate-500"}`}
                  style={{ width: `${progresso}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </Painel>
);

// --------------------------------------------------------------- análise (resumo)
function textoDoFoco(f: FocoSugerido): string {
  if (typeof f === "string") return f;
  return f.quantidade !== null && f.quantidade !== undefined ? `${f.descricao} (${f.quantidade})` : f.descricao;
}

const Lista: React.FC<{ itens: string[] }> = ({ itens }) => (
  <ul className="space-y-1.5">
    {itens.map((t, i) => (
      <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed">
        <span className="text-red-500 shrink-0">•</span>
        <span className="break-words">{t}</span>
      </li>
    ))}
  </ul>
);

const Dica: React.FC<{ dica: DicaMensagem }> = ({ dica }) => {
  const texto = typeof dica === "string" ? dica : dica.mensagem;
  const situacao = typeof dica === "string" ? null : dica.situacao;
  const copiar = async () => {
    if (await copiarTexto(texto)) toast.success("Mensagem copiada.");
    else toast.error("Não consegui copiar. Selecione o texto e copie à mão.");
  };
  return (
    <li className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-1.5">
      {situacao && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{situacao}</p>}
      <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words">{texto}</p>
      <button onClick={copiar} className={CLASSE_BOTAO_LEVE}>
        <Copy className="w-3 h-3" /> Copiar
      </button>
    </li>
  );
};

const BlocoTexto: React.FC<{ titulo: string; texto: string | null; icone: React.ElementType }> = ({
  titulo,
  texto,
  icone,
}) =>
  texto ? (
    <Painel titulo={titulo} icone={icone}>
      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{texto}</p>
    </Painel>
  ) : null;

// ----------------------------------------------------------------------- a tela
export const RelatorioDiaView: React.FC<{
  partnerId: string;
  aoIrPara: (destino: Destino) => void;
  /** Dono da empresa (GET /api/me): libera o botão de apagar dados da pessoa. */
  ehDono?: boolean;
}> = ({ partnerId, aoIrPara, ehDono }) => {
  const [dia, setDia] = useState(() => ontemIso());
  const [relatorio, setRelatorio] = useState<RelatorioDia | null>(null);
  const [contatos, setContatos] = useState<ContatoAnalise[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState("");
  const [soComAcao, setSoComAcao] = useState(false);
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const pedido = useRef(0);
  const hoje = hojeIso();

  const carregar = useCallback(async () => {
    if (!ehDataIso(dia)) return;
    const meu = ++pedido.current;
    setCarregando(true);
    try {
      const r = await buscarRelatorioDia(partnerId, dia);
      if (meu !== pedido.current) return;
      setRelatorio(r);
      setContatos(r.analise?.contatos || []);
      setErro(null);
    } catch (e) {
      if (meu === pedido.current) setErro(mensagemDeErro(e, "Não foi possível carregar o relatório."));
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [partnerId, dia]);

  useEffect(() => {
    setRelatorio(null);
    setContatos([]);
    setMostrar(POR_PAGINA);
    carregar();
  }, [carregar]);

  const contatosVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contatos
      .filter((c) => !soComAcao || (c.proxima_acao && c.proxima_acao.tipo !== "nenhuma"))
      .filter(
        (c) =>
          !termo ||
          (c.nome || "").toLowerCase().includes(termo) ||
          (c.telefone || "").includes(termo.replace(/\D/g, "") || "§") ||
          c.tags.some((t) => t.includes(termo)),
      )
      .sort(
        (a, b) =>
          (PESO_PRIORIDADE[a.proxima_acao?.prioridade || ""] ?? 3) - (PESO_PRIORIDADE[b.proxima_acao?.prioridade || ""] ?? 3) ||
          (a.nome || "").localeCompare(b.nome || "", "pt-BR"),
      );
  }, [contatos, busca, soComAcao]);

  const corrigido = (novo: ContatoAnalise) =>
    setContatos((lista) => lista.map((c) => (c.contato_id === novo.contato_id ? novo : c)));

  const apagado = (contatoId: string) => setContatos((lista) => lista.filter((c) => c.contato_id !== contatoId));

  const m = relatorio?.metricas;
  const resumo = relatorio?.analise?.resumo;
  const campanhas = paresOrdenados(m?.trafego_pago?.por_campanha);
  const fontes = paresOrdenados(m?.trafego_pago?.por_fonte);

  return (
    <div className="p-4 md:p-8 space-y-5 md:space-y-6 max-w-6xl mx-auto">
      <Cabecalho
        icone={Sparkles}
        titulo="Relatório do dia"
        subtitulo={
          relatorio
            ? `${dataComSemana(relatorio.dia)} · números contados pelo sistema, análise feita pela IA`
            : "Números contados pelo sistema e a análise da IA de cada conversa."
        }
        acoes={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setDia((d) => somarDias(d, -1))}
              className={CLASSE_BOTAO_SEC}
              aria-label="Dia anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <label className="relative">
              <CalendarDays className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={dia}
                max={hoje}
                onChange={(e) => e.target.value && setDia(e.target.value)}
                className={`${CLASSE_INPUT} pl-8 w-40`}
                aria-label="Dia do relatório"
              />
            </label>
            <button
              onClick={() => setDia((d) => (d < hoje ? somarDias(d, 1) : d))}
              disabled={dia >= hoje}
              className={CLASSE_BOTAO_SEC}
              aria-label="Dia seguinte"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={carregar} disabled={carregando} className={CLASSE_BOTAO_SEC} aria-label="Atualizar relatório">
              <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && !relatorio && <Carregando texto="Montando o relatório..." />}

      {relatorio && m && (
        <>
          <EstadoDoLote lote={relatorio.lote} temAnalise={contatos.length > 0} aoIrPara={aoIrPara} />

          {/* Números do sistema */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Numero
              rotulo="Conversas novas"
              valor={m.novas}
              icone={MessageSquarePlus}
              detalhe={`${m.novas_contato_iniciou} chamaram você · ${m.novas_eu_iniciei} você chamou`}
            />
            <Numero
              rotulo="Do tráfego pago"
              valor={m.trafego_pago.total}
              icone={Megaphone}
              detalhe={campanhas.length ? campanhas.slice(0, 2).map(([c, q]) => `${c}: ${q}`).join(" · ") : "Nenhuma campanha"}
            />
            <Numero
              rotulo="Esperando você"
              valor={m.esperando_voce}
              icone={Hourglass}
              destaque={m.esperando_voce > 0 ? "vermelho" : undefined}
              detalhe="O cliente mandou por último"
            />
            <Numero
              rotulo="Cliente sumiu"
              valor={m.cliente_sumiu}
              icone={UserX}
              destaque={m.cliente_sumiu > 0 ? "ambar" : undefined}
              detalhe="Você mandou por último e ele não voltou"
            />
            <Numero
              rotulo="Tempo de resposta (metade em até)"
              valor={duracaoMin(m.resposta.mediana_min)}
              icone={Clock}
              detalhe={`9 em cada 10 em até ${duracaoMin(m.resposta.p90_min)} · ${pct(m.resposta.ate5min_pct)} em até 5 min · ${m.resposta.acima1h} acima de 1 h · ${m.resposta.sem_resposta} sem resposta`}
            />
            <Numero
              rotulo="Follow-ups feitos"
              valor={m.followups.feitos}
              icone={ListChecks}
              destaque={m.followups.vencidos > 0 ? "ambar" : undefined}
              detalhe={`${m.followups.vencidos} vencidos · ${m.followups.abertos} em aberto`}
            />
            <Numero
              rotulo="Conversas ativas"
              valor={m.conversas_ativas}
              icone={FileText}
              detalhe="Teve mensagem no dia"
            />
            <Numero
              rotulo="Conversão (7 dias)"
              valor={pct(m.conversao.coorte7d_pct)}
              icone={TrendingUp}
              detalhe={`Do dia: ${pct(m.conversao.dia_pct)} · ${m.conversao.ganhos} ganhos x ${m.conversao.perdidos} perdidos`}
            />
          </div>

          {/* Vendas lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <Numero
              rotulo="Vendas confirmadas"
              valor={brl(m.vendas.confirmado_valor)}
              icone={CircleDollarSign}
              detalhe={`${m.vendas.confirmado_qtd} ${m.vendas.confirmado_qtd === 1 ? "venda" : "vendas"}`}
            />
            <Numero
              rotulo="A confirmar (IA)"
              valor={brl(m.vendas.a_confirmar_valor)}
              icone={CircleDollarSign}
              destaque="ambar"
              detalhe={
                m.vendas.a_confirmar_qtd ? (
                  <button onClick={() => aoIrPara("vendas")} className="text-amber-300 hover:text-amber-200 font-semibold text-left">
                    {m.vendas.a_confirmar_qtd} esperando você · decidir agora ›
                  </button>
                ) : (
                  "Nada pendente"
                )
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <MetasDoDia metas={m.metas || []} aoIrPara={aoIrPara} />
            <Painel titulo="Tráfego pago" icone={Megaphone}>
              {m.trafego_pago.total === 0 ? (
                <p className="text-[11px] text-slate-500">
                  Nenhuma conversa nova veio de anúncio neste dia. Confira se a mensagem do anúncio está cadastrada em
                  Inteligência artificial › Rastreio.
                </p>
              ) : (
                <div className="space-y-3">
                  <ul className="space-y-1.5">
                    {campanhas.map(([c, q]) => (
                      <li key={c} className="flex justify-between gap-3 text-xs">
                        <span className="text-slate-300 break-words">{c}</span>
                        <span className="text-white font-semibold">{q}</span>
                      </li>
                    ))}
                  </ul>
                  {fontes.length > 0 && (
                    <p className="text-[11px] text-slate-500">
                      Como soubemos: {fontes.map(([f, q]) => `${rotulo(FONTES_TRAFEGO, f)} (${q})`).join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </Painel>
          </div>

          {/* Análise da IA */}
          {resumo ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <BlocoTexto titulo="Diagnóstico" texto={resumo.diagnostico} icone={Sparkles} />
                <BlocoTexto titulo="O que foi feito" texto={resumo.o_que_foi_feito} icone={ListChecks} />
                <BlocoTexto titulo="Melhor estratégia" texto={resumo.melhor_estrategia} icone={Target} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {resumo.pontos_melhoria?.length > 0 && (
                  <Painel titulo="Pontos de melhoria" icone={TrendingUp}>
                    <Lista itens={resumo.pontos_melhoria} />
                  </Painel>
                )}
                {resumo.foco_sugerido?.length > 0 && (
                  <Painel titulo="Foco sugerido pela IA" icone={Flag}>
                    <p className="text-[11px] text-slate-500 -mt-1">Sugestão para o próximo dia. As metas oficiais são as suas.</p>
                    <Lista itens={resumo.foco_sugerido.map(textoDoFoco)} />
                  </Painel>
                )}
                {resumo.alertas?.length > 0 && (
                  <Painel titulo="Alertas" icone={AlertTriangle} className="border-amber-500/30">
                    <Lista itens={resumo.alertas} />
                  </Painel>
                )}
                {resumo.dicas_mensagens?.length > 0 && (
                  <Painel titulo="Dicas de mensagens" icone={MessageSquarePlus}>
                    <ul className="space-y-2">
                      {resumo.dicas_mensagens.map((d, i) => (
                        <Dica key={i} dica={d} />
                      ))}
                    </ul>
                  </Painel>
                )}
              </div>

              {/* Contatos */}
              <Painel titulo={`Contatos analisados (${contatos.length})`} icone={Search}>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por nome, telefone ou etiqueta"
                      className={`${CLASSE_INPUT} pl-8`}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300 shrink-0">
                    <input
                      type="checkbox"
                      checked={soComAcao}
                      onChange={(e) => setSoComAcao(e.target.checked)}
                      className="accent-red-600"
                    />
                    Só quem tem algo a fazer
                  </label>
                </div>

                {contatosVisiveis.length === 0 ? (
                  <Vazio>Nenhum contato com esse filtro.</Vazio>
                ) : (
                  <ul className="space-y-2.5">
                    {contatosVisiveis.slice(0, mostrar).map((c) => (
                      <ContatoAnalisado
                        key={c.contato_id}
                        contato={c}
                        diaRelatorio={relatorio.dia}
                        aoCorrigir={corrigido}
                        podeApagar={ehDono}
                        aoApagar={apagado}
                      />
                    ))}
                  </ul>
                )}
                {contatosVisiveis.length > mostrar && (
                  <button onClick={() => setMostrar((n) => n + POR_PAGINA)} className={CLASSE_BOTAO_SEC}>
                    Mostrar mais ({contatosVisiveis.length - mostrar})
                  </button>
                )}
              </Painel>
            </>
          ) : (
            <Painel titulo="Análise da IA" icone={Sparkles}>
              <Vazio>
                Ainda não há análise da IA para este dia. Os números acima já valem: eles são contados pelo sistema,
                sem IA.
              </Vazio>
            </Painel>
          )}
        </>
      )}
    </div>
  );
};

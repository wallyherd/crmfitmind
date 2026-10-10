// Tela do mentor: quem precisa de ajuda hoje, de relance. Cada mentorado é um cartão com os números do dia
// e selos de alerta; ao abrir, os números do dia. Resumo da IA, contatos e conversas só com a liberação do dono.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Flag,
  GraduationCap,
  Hourglass,
  ListChecks,
  Lock,
  MessageSquarePlus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  UserX,
} from "lucide-react";
import { buscarPainelMentor, buscarRelatorioMentor } from "@/lib/mentor-api";
import { FUSO_PADRAO, brl, dataComSemana, duracaoMin, ehDataIso, hojeNoFuso, pct, somarDias } from "@/lib/formatos";
import {
  TEXTO_SITUACAO,
  infoAlerta,
  ordenarPorAtencao,
  resumoDeContagens,
  situacaoDaLinha,
  textoSinal,
} from "@/lib/mentor";
import { ACOES, MOTORES, STATUS_LOTE, rotulo } from "@/lib/rotulos";
import { MetasDoDia } from "@/components/RelatorioDiaView";
import {
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
import type { ContatoAnalise, FocoSugerido, LinhaPainelMentor, RelatorioMentor } from "@/types";

const COR_SITUACAO = {
  ajuda: "border-red-500/40 bg-red-500/[0.05]",
  olhar: "border-amber-500/30 bg-amber-500/[0.04]",
  ok: "border-white/10",
} as const;

const TOM_SITUACAO = { ajuda: "vermelho", olhar: "ambar", ok: "neutro" } as const;

const textoDoFoco = (f: FocoSugerido) =>
  typeof f === "string" ? f : f.quantidade !== null && f.quantidade !== undefined ? `${f.descricao} (${f.quantidade})` : f.descricao;

const valor = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));

// ------------------------------------------------------------------ cartão do mentorado
const Mini: React.FC<{ rotulo: string; valor: React.ReactNode; destaque?: boolean }> = ({ rotulo, valor, destaque }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-semibold text-slate-500 leading-tight">{rotulo}</p>
    <p className={`text-base font-extrabold leading-tight break-words ${destaque ? "text-red-300" : "text-white"}`}>{valor}</p>
  </div>
);

const CartaoMentorado: React.FC<{ linha: LinhaPainelMentor; aoAbrir: () => void }> = ({ linha, aoAbrir }) => {
  const situacao = situacaoDaLinha(linha);
  const n = linha.numeros || ({} as LinhaPainelMentor["numeros"]);
  const semConexao = linha.conexoes.length === 0;
  const pior = [...linha.conexoes].sort((a, b) => (b.minutos_sem_sinal ?? 1e9) - (a.minutos_sem_sinal ?? 1e9))[0];

  return (
    <li>
      <button
        type="button"
        onClick={aoAbrir}
        className={`w-full text-left glass-card rounded-2xl p-4 space-y-3 border ${COR_SITUACAO[situacao]} hover:border-red-500/50 transition`}
        aria-label={`Abrir ${linha.empresa}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white break-words">{linha.empresa}</p>
            {linha.mentorado && <p className="text-[11px] text-slate-400 break-words">{linha.mentorado}</p>}
          </div>
          <Selo tom={TOM_SITUACAO[situacao]} className="shrink-0">
            {TEXTO_SITUACAO[situacao]}
          </Selo>
        </div>

        {linha.alertas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {linha.alertas.map((a) => {
              const info = infoAlerta(a);
              return (
                <Selo key={a} tom={info.tom}>
                  <AlertTriangle className="w-3 h-3" /> {info.texto}
                </Selo>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
          <Mini rotulo="Conversas novas" valor={valor(n.novas)} />
          <Mini rotulo="Esperando resposta" valor={valor(n.esperando_voce)} destaque={(n.esperando_voce ?? 0) > 0} />
          <Mini rotulo="Cliente sumiu" valor={valor(n.cliente_sumiu)} />
          <Mini rotulo="Vendas" valor={brl(n.vendas_confirmado_valor)} />
          <Mini rotulo="Para confirmar" valor={valor(linha.vendas_a_confirmar)} />
          <Mini rotulo="Conversão (7 dias)" valor={pct(n.conversao_coorte7d_pct)} />
        </div>

        <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <Smartphone className="w-3 h-3 shrink-0" />
          {semConexao ? "Nenhum WhatsApp conectado" : `${linha.conexoes.length} ${linha.conexoes.length === 1 ? "WhatsApp" : "WhatsApps"} · ${textoSinal(pior?.minutos_sem_sinal)}`}
        </p>
      </button>
    </li>
  );
};

// --------------------------------------------------------------------- detalhe
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

const BlocoTexto: React.FC<{ titulo: string; texto: string | null; icone: React.ElementType }> = ({ titulo, texto, icone }) =>
  texto ? (
    <Painel titulo={titulo} icone={icone}>
      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{texto}</p>
    </Painel>
  ) : null;

const LinhaContato: React.FC<{ c: ContatoAnalise }> = ({ c }) => (
  <li className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-1">
    <p className="text-xs font-bold text-white break-words">
      {c.nome || "Sem nome"} {c.telefone && <span className="font-normal text-slate-500">· {c.telefone}</span>}
    </p>
    {c.proxima_acao && c.proxima_acao.tipo !== "nenhuma" && (
      <p className="text-[11px] text-amber-300 break-words">Próximo passo: {rotulo(ACOES, c.proxima_acao.tipo)}</p>
    )}
    {c.resumo && <p className="text-xs text-slate-300 leading-relaxed break-words">{c.resumo}</p>}
  </li>
);

const DetalheMentorado: React.FC<{ linha: LinhaPainelMentor; dia: string; aoVoltar: () => void }> = ({ linha, dia, aoVoltar }) => {
  const [relatorio, setRelatorio] = useState<RelatorioMentor | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setErro(null);
    try {
      const r = await buscarRelatorioMentor(linha.partner_id, dia);
      if (meu === pedido.current) setRelatorio(r);
    } catch (e) {
      if (meu === pedido.current) setErro(mensagemDeErro(e, "Não foi possível carregar o relatório deste mentorado."));
    }
  }, [linha.partner_id, dia]);

  useEffect(() => {
    setRelatorio(null);
    carregar();
  }, [carregar]);

  const m = relatorio?.metricas;
  const resumo = relatorio?.analise?.resumo;
  const contatos = relatorio?.analise?.contatos || [];
  const textoOculto = relatorio?.analise?.texto_oculto === true;
  const situacao = situacaoDaLinha(linha);
  const lote = relatorio?.lote;
  const infoLote = STATUS_LOTE[lote?.status || "sem_lote"] || { texto: lote?.status || "—" };

  return (
    <div className="space-y-4">
      <button type="button" onClick={aoVoltar} className={CLASSE_BOTAO_SEC}>
        <ChevronLeft className="w-4 h-4" /> Todos os mentorados
      </button>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white break-words">{linha.empresa}</h3>
          {linha.mentorado && <p className="text-xs text-slate-400">{linha.mentorado}</p>}
        </div>
        <Selo tom={TOM_SITUACAO[situacao]}>{TEXTO_SITUACAO[situacao]}</Selo>
      </div>

      {linha.alertas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {linha.alertas.map((a) => (
            <Selo key={a} tom={infoAlerta(a).tom}>
              <AlertTriangle className="w-3 h-3" /> {infoAlerta(a).texto}
            </Selo>
          ))}
        </div>
      )}

      {linha.conexoes.length > 0 && (
        <Painel titulo="WhatsApp" icone={Smartphone}>
          <ul className="space-y-1.5">
            {linha.conexoes.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 text-xs">
                <span className="text-slate-300 break-words">{c.nome || "WhatsApp"}</span>
                <span className="text-slate-400">
                  {c.status.replace(/_/g, " ")} · {textoSinal(c.minutos_sem_sinal)}
                </span>
              </li>
            ))}
          </ul>
        </Painel>
      )}

      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && !relatorio && <Carregando texto="Abrindo o mentorado..." />}

      {relatorio && m && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Numero rotulo="Conversas novas" valor={m.novas} icone={MessageSquarePlus} detalhe={`${m.trafego_pago.total} do tráfego pago`} />
            <Numero
              rotulo="Esperando resposta"
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
              detalhe="O mentorado mandou por último e o cliente não voltou"
            />
            <Numero
              rotulo="Tempo de resposta"
              valor={duracaoMin(m.resposta.mediana_min)}
              icone={Clock}
              detalhe={`Metade em até isso · 9 em cada 10 em até ${duracaoMin(m.resposta.p90_min)}`}
            />
            <Numero
              rotulo="Follow-ups vencidos"
              valor={m.followups.vencidos}
              icone={ListChecks}
              destaque={m.followups.vencidos > 0 ? "ambar" : undefined}
              detalhe={`${m.followups.feitos} feitos no dia`}
            />
            <Numero
              rotulo="Vendas confirmadas"
              valor={brl(m.vendas.confirmado_valor)}
              icone={CircleDollarSign}
              detalhe={`${m.vendas.confirmado_qtd} ${m.vendas.confirmado_qtd === 1 ? "venda" : "vendas"}`}
            />
            <Numero
              rotulo="A confirmar"
              valor={brl(m.vendas.a_confirmar_valor)}
              icone={CircleDollarSign}
              destaque={m.vendas.a_confirmar_qtd > 0 ? "ambar" : undefined}
              detalhe={`${m.vendas.a_confirmar_qtd} esperando o mentorado decidir`}
            />
            <Numero
              rotulo="Conversão (7 dias)"
              valor={pct(m.conversao.coorte7d_pct)}
              icone={TrendingUp}
              detalhe={`Do dia: ${pct(m.conversao.dia_pct)}`}
            />
          </div>

          <MetasDoDia metas={m.metas || []} somenteLeitura />

          <Painel titulo="Análise da IA" icone={Sparkles}>
            <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
              Estado: {infoLote.texto}
              {lote?.motor && <Selo>{rotulo(MOTORES, lote.motor)}</Selo>}
            </p>
            {textoOculto && (
              <Vazio>A análise do dia existe, mas o texto cita nomes e o que cada pessoa disse: só aparece se o mentorado liberar as conversas.</Vazio>
            )}
            {!resumo && !textoOculto && (
              <Vazio>
                Ainda não há análise para este dia. A IA analisa o dia de manhã, no dia seguinte; os números acima já valem.
              </Vazio>
            )}
          </Painel>

          {resumo && (
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
                    <Lista itens={resumo.foco_sugerido.map(textoDoFoco)} />
                  </Painel>
                )}
                {resumo.alertas?.length > 0 && (
                  <Painel titulo="Alertas da IA" icone={AlertTriangle} className="border-amber-500/30">
                    <Lista itens={resumo.alertas} />
                  </Painel>
                )}
              </div>
            </>
          )}

          {relatorio.opt_in ? (
            contatos.length > 0 && (
              <Painel titulo={`Contatos analisados (${contatos.length})`} icone={MessageSquarePlus}>
                <ul className="space-y-2">
                  {contatos.map((c) => (
                    <LinhaContato key={c.contato_id} c={c} />
                  ))}
                </ul>
              </Painel>
            )
          ) : (
            <Painel className="border-white/10">
              <p className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                O mentorado não liberou as conversas. Você vê os números, as metas e o estado da análise; o resumo, os contatos e as mensagens só aparecem se
                ele ligar essa opção em Minha Conta.
              </p>
            </Painel>
          )}
        </>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------- a tela
export const MentoriaView: React.FC = () => {
  const [dia, setDia] = useState(() => hojeNoFuso(FUSO_PADRAO));
  const [linhas, setLinhas] = useState<LinhaPainelMentor[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const pedido = useRef(0);
  // O dia das empresas (Cuiabá), não o do navegador do mentor: entre 0h e 1h em São Paulo ainda é ontem lá.
  const hoje = hojeNoFuso(FUSO_PADRAO);

  const carregar = useCallback(async () => {
    if (!ehDataIso(dia)) return;
    const meu = ++pedido.current;
    setCarregando(true);
    try {
      const r = await buscarPainelMentor(dia);
      if (meu !== pedido.current) return;
      setLinhas(r.empresas);
      setErro(null);
    } catch (e) {
      if (meu === pedido.current) setErro(mensagemDeErro(e, "Não foi possível carregar o painel da mentoria."));
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [dia]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const ordenadas = useMemo(() => ordenarPorAtencao(linhas || []), [linhas]);
  const contagem = useMemo(() => resumoDeContagens(linhas || []), [linhas]);
  const aberta = aberto ? ordenadas.find((l) => l.partner_id === aberto) || null : null;

  return (
    <div className="p-4 md:p-8 space-y-5 md:space-y-6 max-w-6xl mx-auto">
      <Cabecalho
        icone={GraduationCap}
        titulo="Mentoria"
        subtitulo={`${dataComSemana(dia)} · quem precisa de ajuda aparece primeiro`}
        acoes={
          <div className="flex items-center gap-1.5">
            <button onClick={() => setDia((d) => somarDias(d, -1))} className={CLASSE_BOTAO_SEC} aria-label="Dia anterior">
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
                aria-label="Dia da mentoria"
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
            <button onClick={carregar} disabled={carregando} className={CLASSE_BOTAO_SEC} aria-label="Atualizar painel">
              <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && !linhas && <Carregando texto="Olhando como estão os mentorados..." />}

      {aberta ? (
        <DetalheMentorado linha={aberta} dia={dia} aoVoltar={() => setAberto(null)} />
      ) : (
        linhas && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Numero rotulo="Precisam de ajuda" valor={contagem.ajuda} destaque={contagem.ajuda > 0 ? "vermelho" : undefined} />
              <Numero rotulo="Vale olhar" valor={contagem.olhar} destaque={contagem.olhar > 0 ? "ambar" : undefined} />
              <Numero rotulo="Tudo certo" valor={contagem.ok} />
            </div>

            {ordenadas.length === 0 ? (
              <Vazio>Nenhuma empresa ativa ainda. Cadastre os mentorados em Gestão de Empresas.</Vazio>
            ) : (
              <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {ordenadas.map((l) => (
                  <CartaoMentorado key={l.partner_id} linha={l} aoAbrir={() => setAberto(l.partner_id)} />
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Os números são contados pelo sistema. Os alertas são calculados na hora: WhatsApp sem sinal há mais de 10 minutos,
              análise atrasada ou com erro, 2 dias sem conversa, mais de 5 vendas para confirmar e acesso vencendo em 7 dias.
            </p>
          </>
        )
      )}
    </div>
  );
};

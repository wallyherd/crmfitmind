// Tela "Hoje": a primeira coisa que o mentorado vê ao abrir o app de manhã.
// Só junta o que já existe: metas do dia, quem espera resposta, vendas a confirmar e mensagens prontas.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, CircleDollarSign, Check, X } from "lucide-react";
import { buscarRelatorioDia, buscarVendas, decidirVenda } from "@/lib/api-comercial";
import { brl, dataComSemana, hojeIso, somarDias, telefoneLegivel } from "@/lib/formatos";
import { rotulo } from "@/lib/rotulos";
import { OQueFazerAgora } from "@/components/OQueFazerAgora";
import { VerComprovante } from "@/components/VerComprovante";
import { MetasDoDia } from "@/components/RelatorioDiaView";
import { CLASSE_BOTAO, CLASSE_BOTAO_SEC, Cabecalho, Carregando, ErroCarga, Painel, Selo, mensagemDeErro } from "@/components/Pecas";
import type { MetaRealizada, Venda } from "@/types";

const ATUALIZAR_A_CADA_MS = 120_000;
const DIAS_PARA_TRAS = 30;

interface Props {
  partnerId: string;
  /** Leva para outra tela (ex.: cadastrar metas, ver todas as vendas). */
  aoIrPara: (destino: "vendas" | "ia") => void;
}

const FORMAS: Record<string, string> = {
  pix: "PIX",
  cartao: "cartão",
  boleto: "boleto",
  dinheiro: "dinheiro",
  transferencia: "transferência",
  link_pagamento: "link de pagamento",
  outro: "outra forma",
  desconhecida: "forma não informada",
};

const VendaAConfirmar: React.FC<{ venda: Venda; aoDecidir: () => void }> = ({ venda, aoDecidir }) => {
  const [enviando, setEnviando] = useState(false);
  const nome = venda.contato?.nome || telefoneLegivel(venda.contato?.telefone) || "Contato não identificado";
  const temValor = venda.valor !== null && Number(venda.valor) > 0;

  const decidir = async (acao: "confirmar" | "rejeitar") => {
    setEnviando(true);
    try {
      await decidirVenda(venda.id, { acao });
      toast.success(acao === "confirmar" ? "Venda confirmada." : "Marcado como não foi venda.");
      aoDecidir();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <li className="p-3 rounded-2xl bg-amber-500/[0.04] border border-amber-500/30 space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-white break-words">{nome}</span>
        <span className="text-sm font-bold text-white">{temValor ? brl(venda.valor) : "valor não identificado"}</span>
      </div>
      <p className="text-xs text-slate-400">
        {[venda.produto, venda.forma ? rotulo(FORMAS, venda.forma) : null].filter(Boolean).join(" · ") || "Sem detalhes"}
      </p>
      {venda.evidencia_trecho && (
        <p className="text-xs text-slate-300 italic leading-relaxed line-clamp-3 break-words">“{venda.evidencia_trecho}”</p>
      )}
      {temValor ? (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => decidir("confirmar")} disabled={enviando} className={`${CLASSE_BOTAO} min-h-11`}>
            <Check className="w-4 h-4" /> Foi venda
          </button>
          <button onClick={() => decidir("rejeitar")} disabled={enviando} className={`${CLASSE_BOTAO_SEC} min-h-11`}>
            <X className="w-4 h-4" /> Não foi
          </button>
          {venda.comprovante_mensagem_id && (
            <VerComprovante
              mensagemId={venda.comprovante_mensagem_id}
              rotulo="Ver comprovante"
              className={`${CLASSE_BOTAO_SEC} min-h-11 col-span-2`}
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-300">Falta o valor. Abra a tela de Vendas para digitar e confirmar.</p>
      )}
    </li>
  );
};

export const HojeView: React.FC<Props> = ({ partnerId, aoIrPara }) => {
  const [metas, setMetas] = useState<MetaRealizada[] | null>(null);
  const [vendas, setVendas] = useState<Venda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);
  const hoje = hojeIso();

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    // Falha numa fonte não derruba a outra: cada bloco mostra o que conseguiu.
    const [relatorio, lista] = await Promise.allSettled([
      buscarRelatorioDia(partnerId, hoje),
      buscarVendas(partnerId, somarDias(hoje, -DIAS_PARA_TRAS), hoje),
    ]);
    if (meu !== pedido.current) return;
    if (relatorio.status === "fulfilled") setMetas(relatorio.value.metricas?.metas ?? []);
    if (lista.status === "fulfilled") setVendas(lista.value.vendas ?? []);
    const falha = [relatorio, lista].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    setErro(falha ? mensagemDeErro(falha.reason, "Parte da tela não carregou.") : null);
  }, [partnerId, hoje]);

  useEffect(() => {
    setMetas(null);
    setVendas(null);
    carregar();
    const intervalo = setInterval(carregar, ATUALIZAR_A_CADA_MS);
    return () => clearInterval(intervalo);
  }, [carregar]);

  const aConfirmar = (vendas ?? []).filter((v) => v.status === "pendente_confirmacao");

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <Cabecalho icone={CalendarCheck} titulo="Hoje" subtitulo={dataComSemana(hoje)} />

      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}

      <OQueFazerAgora partnerId={partnerId} limite={8} />

      {aConfirmar.length > 0 && (
        <Painel
          titulo={
            <>
              Vendas para confirmar <Selo tom="ambar">{aConfirmar.length}</Selo>
            </>
          }
          icone={CircleDollarSign}
        >
          <p className="text-xs text-slate-400">A IA achou estas vendas nas suas conversas. Foi venda mesmo?</p>
          <ul className="space-y-2">
            {aConfirmar.slice(0, 5).map((v) => (
              <VendaAConfirmar key={v.id} venda={v} aoDecidir={carregar} />
            ))}
          </ul>
          {aConfirmar.length > 5 && (
            <button onClick={() => aoIrPara("vendas")} className="text-xs text-red-400 hover:text-red-300 font-semibold min-h-11">
              Ver todas ({aConfirmar.length})
            </button>
          )}
        </Painel>
      )}

      {metas === null && !erro ? (
        <Carregando texto="Buscando suas metas..." />
      ) : (
        metas && <MetasDoDia metas={metas} aoIrPara={aoIrPara} />
      )}
    </div>
  );
};

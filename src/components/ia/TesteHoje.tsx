// Teste no mesmo dia: gera o lote de hoje na hora (sem esperar as 04:30) e, no motor automático, analisa agora.
// Hoje é dia parcial: o arquivo leva essa marca e a IA sabe que o dia ainda não terminou.
import React, { useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Play } from "lucide-react";
import { analisarLoteAgora, gerarLoteDeTeste } from "@/lib/api-comercial";
import { hojeIso } from "@/lib/formatos";
import { STATUS_LOTE } from "@/lib/rotulos";
import { AnaliseManual } from "@/components/ia/AnaliseManual";
import { CLASSE_BOTAO, CLASSE_BOTAO_SEC, Painel, Selo, mensagemDeErro } from "@/components/Pecas";
import type { ConfigIa, LoteGerado } from "@/types";

interface Props {
  partnerId: string;
  config: ConfigIa;
}

export const TesteHoje: React.FC<Props> = ({ partnerId, config }) => {
  const [gerando, setGerando] = useState(false);
  const [analisando, setAnalisando] = useState<string | null>(null);
  const [lotes, setLotes] = useState<LoteGerado[] | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  const automatico = config.motor === "api_batch" && !!config.consentimento_ia_em;
  const manual = config.motor === "manual";

  const gerar = async () => {
    setGerando(true);
    setResumo(null);
    try {
      setLotes(await gerarLoteDeTeste(partnerId));
      toast.success("Lote de hoje gerado.");
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setGerando(false);
    }
  };

  const analisar = async (lote: LoteGerado) => {
    setAnalisando(lote.id);
    try {
      const r = await analisarLoteAgora(lote.id);
      const n = r.resumo?.resultado;
      setLotes((atual) => (atual ?? []).map((l) => (l.id === lote.id ? { ...l, status: "concluido" } : l)));
      setResumo(
        n
          ? `${n.contatos ?? 0} conversas analisadas, ${n.vendas_confirmadas ?? 0} vendas confirmadas, ${n.vendas_pendentes ?? 0} para você decidir.`
          : "Análise aplicada.",
      );
      toast.success("Análise pronta. Veja o Relatório do dia.");
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setAnalisando(null);
    }
  };

  return (
    <>
      <Painel titulo="Testar com o dia de hoje" icone={FlaskConical}>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Gera agora o lote de hoje, sem esperar as 04:30. Hoje ainda não acabou: o arquivo vai marcado como dia
          parcial, e a IA sabe que os números e as conversas valem só até agora. Se o lote do dia já foi analisado, o
          existente é mantido.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={gerar} disabled={gerando} className={CLASSE_BOTAO}>
            {gerando ? "Gerando..." : "Gerar lote de hoje (teste)"}
          </button>
        </div>
        {automatico && !lotes && (
          <p className="text-[11px] text-slate-500">Depois de gerar, o botão “Analisar agora” aparece aqui.</p>
        )}
        {lotes && lotes.length === 0 && <p className="text-xs text-slate-400">Nada para analisar hoje ainda.</p>}
        {lotes && lotes.length > 0 && (
          <ul className="space-y-2">
            {lotes.map((l) => {
              const rotulo = STATUS_LOTE[l.status]?.texto ?? l.status;
              return (
                <li key={l.id} className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/10">
                  <span className="text-xs text-white font-semibold">
                    {lotes.length > 1 ? `Parte ${l.parte}` : "Lote de hoje"}
                  </span>
                  <Selo tom={l.status === "concluido" ? "claro" : l.status === "erro" ? "vermelho" : "neutro"}>{rotulo}</Selo>
                  {automatico && l.status === "pronto" && (
                    <button
                      onClick={() => analisar(l)}
                      disabled={analisando !== null}
                      className={`${CLASSE_BOTAO_SEC} ml-auto`}
                    >
                      <Play className="w-3.5 h-3.5" /> {analisando === l.id ? "Analisando..." : "Analisar agora"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {resumo && <p className="text-xs text-emerald-300">{resumo}</p>}
        {manual && lotes && lotes.length > 0 && (
          <p className="text-[11px] text-slate-400">Modo manual: baixe o arquivo e importe a análise logo abaixo.</p>
        )}
      </Painel>
      {manual && <AnaliseManual partnerId={partnerId} diaInicial={hojeIso()} />}
    </>
  );
};

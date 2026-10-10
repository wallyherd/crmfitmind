// Configurações > Inteligência artificial: motor e autorização, produtos, rastreio do
// tráfego, metas e (no modo manual) baixar o lote e importar a análise.
import React, { useCallback, useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { buscarConfigIa } from "@/lib/api-comercial";
import { MOTORES, rotulo } from "@/lib/rotulos";
import { MotorIa } from "@/components/ia/MotorIa";
import { CatalogoProdutos } from "@/components/ia/CatalogoProdutos";
import { RastreioTrafego } from "@/components/ia/RastreioTrafego";
import { MetasDiarias } from "@/components/ia/MetasDiarias";
import { AnaliseManual } from "@/components/ia/AnaliseManual";
import { Cabecalho, Carregando, ErroCarga, Selo, mensagemDeErro } from "@/components/Pecas";
import type { ConfigIa } from "@/types";

export type AbaIa = "analise" | "manual" | "produtos" | "rastreio" | "metas";

const ABAS: Array<{ id: AbaIa; texto: string }> = [
  { id: "analise", texto: "Análise" },
  { id: "manual", texto: "Análise manual" },
  { id: "produtos", texto: "Produtos" },
  { id: "rastreio", texto: "Rastreio do tráfego" },
  { id: "metas", texto: "Metas diárias" },
];

interface Props {
  partnerId: string;
  isAdmin: boolean;
  abaInicial?: AbaIa;
}

export const InteligenciaArtificialView: React.FC<Props> = ({ partnerId, isAdmin, abaInicial = "analise" }) => {
  const [aba, setAba] = useState<AbaIa>(abaInicial);
  const [config, setConfig] = useState<ConfigIa | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => setAba(abaInicial), [abaInicial]);

  const carregar = useCallback(async () => {
    try {
      setConfig(await buscarConfigIa(partnerId));
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar a configuração da IA."));
    }
  }, [partnerId]);

  useEffect(() => {
    setConfig(null);
    carregar();
  }, [carregar]);

  // A aba manual só existe no motor manual; fora dele, quem pediu a aba cai na principal.
  const manual = config?.motor === "manual";
  const abas = ABAS.filter((a) => a.id !== "manual" || manual);
  const abaAtual: AbaIa = aba === "manual" && config && !manual ? "analise" : aba;

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
      <Cabecalho
        icone={Brain}
        titulo="Inteligência artificial"
        subtitulo="Como as conversas são analisadas, o que a IA pode oferecer, de onde vêm os clientes e as metas do dia."
        acoes={config ? <Selo tom="vermelho">{rotulo(MOTORES, config.motor)}</Selo> : undefined}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">
        {abas.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={abaAtual === a.id}
            onClick={() => setAba(a.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              abaAtual === a.id
                ? "bg-red-600 border-red-500 text-white"
                : "bg-white/[0.03] border-white/10 text-slate-300 hover:border-red-500/40"
            }`}
          >
            {a.texto}
          </button>
        ))}
      </div>

      {abaAtual === "analise" && (
        <>
          {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
          {!erro && !config && <Carregando />}
          {config && <MotorIa partnerId={partnerId} isAdmin={isAdmin} config={config} aoMudar={setConfig} />}
        </>
      )}
      {abaAtual === "manual" && <AnaliseManual partnerId={partnerId} />}
      {abaAtual === "produtos" && <CatalogoProdutos partnerId={partnerId} />}
      {abaAtual === "rastreio" && <RastreioTrafego partnerId={partnerId} />}
      {abaAtual === "metas" && <MetasDiarias partnerId={partnerId} />}
    </div>
  );
};

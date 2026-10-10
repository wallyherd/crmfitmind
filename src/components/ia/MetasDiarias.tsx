// Metas diárias oficiais da empresa. O relatório compara o realizado com elas;
// o "foco sugerido" da IA é só sugestão.
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Target } from "lucide-react";
import { buscarMetas, salvarMetas } from "@/lib/api-comercial";
import { lerValor } from "@/lib/formatos";
import { TIPOS_META } from "@/lib/rotulos";
import { CLASSE_BOTAO, CLASSE_INPUT, Carregando, ErroCarga, Painel, mensagemDeErro } from "@/components/Pecas";
import type { MetaDiaria, TipoMeta } from "@/types";

const CAMPOS: Record<TipoMeta, { rotulo: string; ajuda: string; placeholder: string }> = {
  novas_conversas: { rotulo: "Conversas novas por dia", ajuda: "Pessoas novas falando com você.", placeholder: "10" },
  followups: { rotulo: "Follow-ups por dia", ajuda: "Retornos feitos para quem estava parado.", placeholder: "15" },
  vendas_qtd: { rotulo: "Vendas por dia (quantidade)", ajuda: "Só vendas confirmadas contam.", placeholder: "2" },
  vendas_valor: { rotulo: "Vendas por dia (R$)", ajuda: "Soma das vendas confirmadas.", placeholder: "1.500,00" },
  tempo_resposta_min: {
    rotulo: "Tempo de resposta (máximo, em minutos)",
    ajuda: "Metade dos clientes respondida em até esse tempo.",
    placeholder: "10",
  },
};

type Valores = Record<TipoMeta, string>;

const vazios = (): Valores =>
  Object.fromEntries(TIPOS_META.map((t) => [t, ""])) as Valores;

/** Converte o formulário em metas; devolve a mensagem de erro quando algum campo não serve. */
function lerMetas(valores: Valores): MetaDiaria[] | string {
  const metas: MetaDiaria[] = [];
  for (const tipo of TIPOS_META) {
    const texto = valores[tipo].trim();
    if (!texto) continue;
    const numero = tipo === "vendas_valor" ? lerValor(texto) : /^\d+$/.test(texto) ? Number(texto) : null;
    if (numero === null || (tipo === "tempo_resposta_min" && numero <= 0)) {
      return `Valor inválido em "${CAMPOS[tipo].rotulo}".`;
    }
    metas.push({ tipo, meta: numero });
  }
  return metas;
}

export const MetasDiarias: React.FC<{ partnerId: string }> = ({ partnerId }) => {
  const [valores, setValores] = useState<Valores | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const metas = await buscarMetas(partnerId);
      const novos = vazios();
      for (const m of metas) {
        if (m.tipo in novos && m.meta !== null && m.meta !== undefined) {
          novos[m.tipo] = m.tipo === "vendas_valor" ? String(m.meta).replace(".", ",") : String(m.meta);
        }
      }
      setValores(novos);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar as metas."));
    }
  }, [partnerId]);

  useEffect(() => {
    setValores(null);
    carregar();
  }, [carregar]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valores) return;
    const metas = lerMetas(valores);
    if (typeof metas === "string") return void toast.error(metas);
    setSalvando(true);
    try {
      await salvarMetas(partnerId, metas);
      toast.success("Metas salvas. O relatório passa a comparar com elas.");
    } catch (err) {
      toast.error(mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Painel titulo="Metas diárias" icone={Target}>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Estas são as metas que valem. No Relatório do dia você vê o realizado ao lado de cada uma. Deixe em branco o
        que não quer acompanhar.
      </p>
      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && !valores && <Carregando />}
      {valores && (
        <form onSubmit={salvar} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TIPOS_META.map((tipo) => (
              <label key={tipo} className="block">
                <span className="block text-[11px] font-semibold text-slate-300 mb-0.5">{CAMPOS[tipo].rotulo}</span>
                <span className="block text-[10px] text-slate-500 mb-1">{CAMPOS[tipo].ajuda}</span>
                <input
                  value={valores[tipo]}
                  onChange={(e) => setValores({ ...valores, [tipo]: e.target.value })}
                  inputMode={tipo === "vendas_valor" ? "decimal" : "numeric"}
                  placeholder={CAMPOS[tipo].placeholder}
                  className={CLASSE_INPUT}
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={salvando} className={CLASSE_BOTAO}>
              {salvando ? "Salvando..." : "Salvar metas"}
            </button>
          </div>
        </form>
      )}
    </Painel>
  );
};

// Um contato na análise do dia. Corrigir a categoria ou tirar uma etiqueta da IA
// vira correção (PATCH /api/contatos/:id): o servidor trava o campo e a IA aprende.
import React, { useState } from "react";
import { toast } from "sonner";
import { Lightbulb, Package, Target, Trash2, X } from "lucide-react";
import { ApagarPessoaModal } from "@/components/ApagarPessoaModal";
import { corrigirContato } from "@/lib/api-comercial";
import { pct, prazoDaAcao, telefoneLegivel } from "@/lib/formatos";
import {
  ACOES,
  CATEGORIAS,
  CATEGORIAS_EDITAVEIS,
  ETAPAS,
  MOTIVOS_PERDA,
  PRIORIDADES,
  RISCOS,
  STATUS_COMERCIAL,
  etiquetaLegivel,
  rotulo,
} from "@/lib/rotulos";
import { MensagemSugerida } from "@/components/MensagemSugerida";
import { CLASSE_INPUT, Selo, mensagemDeErro } from "@/components/Pecas";
import type { CategoriaContato, ContatoAnalise } from "@/types";

const TOM_RISCO: Record<string, "vermelho" | "ambar" | "neutro"> = {
  esperando_voce: "vermelho",
  sem_resposta_nossa: "vermelho",
  cliente_sumiu: "ambar",
  vacuo: "ambar",
  followup_atrasado: "ambar",
};

const TOM_PRIORIDADE: Record<string, "vermelho" | "ambar" | "neutro"> = { alta: "vermelho", media: "ambar", baixa: "neutro" };

interface Props {
  contato: ContatoAnalise;
  diaRelatorio: string;
  aoCorrigir: (contato: ContatoAnalise) => void;
  /** Dono da empresa: mostra "Apagar dados desta pessoa (LGPD)". */
  podeApagar?: boolean;
  aoApagar?: (contatoId: string) => void;
}

export const ContatoAnalisado: React.FC<Props> = ({ contato, diaRelatorio, aoCorrigir, podeApagar, aoApagar }) => {
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const acao = contato.proxima_acao;
  const nome = contato.nome || telefoneLegivel(contato.telefone) || "Contato sem nome";
  const opcoesCategoria = CATEGORIAS_EDITAVEIS.includes(contato.categoria)
    ? CATEGORIAS_EDITAVEIS
    : [contato.categoria, ...CATEGORIAS_EDITAVEIS];

  const trocarCategoria = async (categoria: CategoriaContato) => {
    if (categoria === contato.categoria) return;
    setSalvando(true);
    try {
      await corrigirContato(contato.contato_id, { categoria });
      aoCorrigir({ ...contato, categoria, confianca: 1 });
      toast.success("Categoria corrigida. A IA não muda mais este campo.");
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const tirarEtiqueta = async (tag: string) => {
    const tags = contato.tags.filter((t) => t !== tag);
    setSalvando(true);
    try {
      await corrigirContato(contato.contato_id, { tags });
      aoCorrigir({ ...contato, tags });
      toast.success("Etiqueta removida. A IA não coloca de novo.");
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <li className="p-3.5 md:p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
      {/* Quem é */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{nome}</p>
          <p className="text-[11px] text-slate-500">
            {contato.telefone ? telefoneLegivel(contato.telefone) : "Sem telefone (grupo ou número oculto)"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {contato.status_comercial && <Selo tom="claro">{rotulo(STATUS_COMERCIAL, contato.status_comercial)}</Selo>}
          {contato.etapa_funil && contato.etapa_funil !== "nao_se_aplica" && (
            <Selo>{rotulo(ETAPAS, contato.etapa_funil)}</Selo>
          )}
        </div>
      </div>

      {/* Categoria (editável) e riscos */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-full sm:w-52">
          <span className="block text-[10px] font-semibold text-slate-500 mb-1">
            Categoria{contato.confianca !== null && contato.confianca < 1 ? ` · IA tem ${pct(contato.confianca * 100)} de certeza` : ""}
          </span>
          <select
            value={contato.categoria}
            disabled={salvando}
            onChange={(e) => trocarCategoria(e.target.value as CategoriaContato)}
            className={CLASSE_INPUT}
            aria-label={`Categoria de ${nome}`}
          >
            {opcoesCategoria.map((c) => (
              <option key={c} value={c}>
                {rotulo(CATEGORIAS, c)}
              </option>
            ))}
          </select>
        </label>
        {contato.riscos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {contato.riscos.map((r) => (
              <Selo key={r} tom={TOM_RISCO[r] || "neutro"}>
                {rotulo(RISCOS, r)}
              </Selo>
            ))}
          </div>
        )}
      </div>

      {/* Etiquetas da IA: o X é a correção */}
      {contato.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Etiquetas">
          {contato.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[10px] font-semibold bg-white/[0.05] border border-white/10 text-slate-300"
            >
              {etiquetaLegivel(tag)}
              <button
                onClick={() => tirarEtiqueta(tag)}
                disabled={salvando}
                className="p-0.5 rounded-full hover:bg-red-500/30 hover:text-white disabled:opacity-40"
                title="Tirar esta etiqueta (a IA não coloca de novo)"
                aria-label={`Tirar a etiqueta ${etiquetaLegivel(tag)}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {contato.resumo && <p className="text-xs text-slate-300 leading-relaxed break-words">{contato.resumo}</p>}

      {contato.motivo_perda && (
        <p className="text-[11px] text-slate-400">
          <span className="text-slate-500">Perdeu por: </span>
          {rotulo(MOTIVOS_PERDA, contato.motivo_perda.codigo)}
          {contato.motivo_perda.detalhe ? ` — ${contato.motivo_perda.detalhe}` : ""}
        </p>
      )}

      {/* Próxima ação */}
      {acao && acao.tipo !== "nenhuma" && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Target className="w-3.5 h-3.5 text-red-500" />
          <span className="font-semibold text-white">{rotulo(ACOES, acao.tipo)}</span>
          {acao.em_dias !== null && (
            <span className="text-slate-400">{prazoDaAcao(diaRelatorio, acao.em_dias)}</span>
          )}
          <Selo tom={TOM_PRIORIDADE[acao.prioridade] || "neutro"}>{rotulo(PRIORIDADES, acao.prioridade)}</Selo>
        </div>
      )}

      {(contato.produto_sugerido || contato.como_abordar) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {contato.produto_sugerido && (
            <p className="flex gap-2 text-[11px] text-slate-300">
              <Package className="w-3.5 h-3.5 shrink-0 text-slate-500 mt-0.5" />
              <span>
                <span className="text-slate-500">Oferecer: </span>
                {contato.produto_sugerido}
              </span>
            </p>
          )}
          {contato.como_abordar && (
            <p className="flex gap-2 text-[11px] text-slate-300">
              <Lightbulb className="w-3.5 h-3.5 shrink-0 text-slate-500 mt-0.5" />
              <span className="break-words">
                <span className="text-slate-500">Como abordar: </span>
                {contato.como_abordar}
              </span>
            </p>
          )}
        </div>
      )}

      {acao?.mensagem_sugerida && (
        <MensagemSugerida texto={acao.mensagem_sugerida} sugestaoId={contato.sugestao_id} telefone={contato.telefone} />
      )}

      {podeApagar && (
        <div className="pt-1 border-t border-white/5">
          <button
            type="button"
            onClick={() => setApagando(true)}
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" /> Apagar todos os dados desta pessoa (LGPD)
          </button>
        </div>
      )}

      {apagando && (
        <ApagarPessoaModal
          contatoId={contato.contato_id}
          nome={nome}
          onCancelar={() => setApagando(false)}
          onApagado={() => {
            setApagando(false);
            aoApagar?.(contato.contato_id);
          }}
        />
      )}
    </li>
  );
};

// Peças visuais repetidas nas telas de Vendas, Relatório do dia e Inteligência artificial.
import React from "react";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";

export const CLASSE_INPUT =
  "w-full rounded-xl bg-[#0d0d10] border border-white/10 px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-red-500 disabled:opacity-50";
export const CLASSE_ROTULO = "block text-[11px] font-semibold text-slate-400 mb-1";
export const CLASSE_BOTAO =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition";
export const CLASSE_BOTAO_SEC =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141418] hover:bg-[#1c1c22] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold border border-white/10 hover:border-red-500/40 transition";
export const CLASSE_BOTAO_LEVE =
  "inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 disabled:opacity-50 transition";

export const Cabecalho: React.FC<{
  icone: React.ElementType;
  titulo: string;
  subtitulo?: React.ReactNode;
  acoes?: React.ReactNode;
}> = ({ icone: Icone, titulo, subtitulo, acoes }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-white/10">
    <div className="min-w-0">
      <h2 className="text-lg md:text-xl font-bold text-white tracking-tight flex items-center gap-2">
        <Icone className="w-5 h-5 text-red-500 shrink-0" /> {titulo}
      </h2>
      {subtitulo && <p className="text-xs text-slate-400 mt-0.5">{subtitulo}</p>}
    </div>
    {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
  </div>
);

export const Painel: React.FC<{
  titulo?: React.ReactNode;
  icone?: React.ElementType;
  acoes?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ titulo, icone: Icone, acoes, className = "", children }) => (
  <section className={`glass-panel rounded-2xl md:rounded-3xl p-4 md:p-5 space-y-3 ${className}`}>
    {(titulo || acoes) && (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {titulo && (
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            {Icone && <Icone className="w-4 h-4 text-red-500 shrink-0" />}
            {titulo}
          </h3>
        )}
        {acoes}
      </div>
    )}
    {children}
  </section>
);

type Tom = "neutro" | "vermelho" | "ambar" | "claro";

const TONS: Record<Tom, string> = {
  neutro: "bg-white/[0.06] text-slate-300 border-white/10",
  vermelho: "bg-red-500/15 text-red-300 border-red-500/30",
  ambar: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  claro: "bg-white/90 text-black border-white",
};

export const Selo: React.FC<{ tom?: Tom; children: React.ReactNode; className?: string }> = ({
  tom = "neutro",
  children,
  className = "",
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${TONS[tom]} ${className}`}
  >
    {children}
  </span>
);

/** Card de número: rótulo pequeno, número grande e uma linha de detalhe. */
export const Numero: React.FC<{
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: React.ReactNode;
  destaque?: "vermelho" | "ambar";
  icone?: React.ElementType;
}> = ({ rotulo, valor, detalhe, destaque, icone: Icone }) => (
  <div
    className={`glass-card rounded-2xl p-3.5 md:p-4 min-w-0 ${
      destaque === "vermelho" ? "border-red-500/40" : destaque === "ambar" ? "border-amber-500/40" : ""
    }`}
  >
    <div className="flex items-start justify-between gap-2">
      <span className="text-[11px] font-semibold text-slate-400 leading-tight">{rotulo}</span>
      {Icone && <Icone className={`w-4 h-4 shrink-0 ${destaque === "ambar" ? "text-amber-400" : "text-red-500"}`} />}
    </div>
    <div
      className={`mt-2 text-xl md:text-2xl font-extrabold tracking-tight break-words ${
        destaque === "ambar" ? "text-amber-300" : "text-white"
      }`}
    >
      {valor}
    </div>
    {detalhe && <div className="text-[11px] text-slate-500 mt-1 leading-snug">{detalhe}</div>}
  </div>
);

export const Carregando: React.FC<{ texto?: string }> = ({ texto = "Carregando..." }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
    <Loader2 className="w-4 h-4 text-red-500 animate-spin" /> {texto}
  </div>
);

export const Vazio: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-center py-8 px-4 text-xs text-slate-500 leading-relaxed">{children}</div>
);

export const ErroCarga: React.FC<{ mensagem: string; aoTentar?: () => void }> = ({ mensagem, aoTentar }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">
    <span className="flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" /> {mensagem}
    </span>
    {aoTentar && (
      <button onClick={aoTentar} className={CLASSE_BOTAO_SEC}>
        <RefreshCw className="w-3.5 h-3.5" /> Tentar de novo
      </button>
    )}
  </div>
);

export const Modal: React.FC<{ titulo: string; aoFechar: () => void; children: React.ReactNode }> = ({
  titulo,
  aoFechar,
  children,
}) => (
  <div
    className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label={titulo}
  >
    <div className="glass-panel w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 space-y-4 border border-white/10">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-white">{titulo}</h3>
        <button onClick={aoFechar} className="p-1 text-slate-400 hover:text-white" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

/** Mensagem de erro de uma chamada, já em português. */
export function mensagemDeErro(erro: unknown, padrao = "Não foi possível concluir. Tente de novo."): string {
  return erro instanceof Error && erro.message ? erro.message : padrao;
}

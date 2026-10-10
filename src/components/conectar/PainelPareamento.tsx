import React, { useEffect, useState } from "react";
import { Check, Copy, Hash, Loader2, QrCode, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import type { ConexaoPainel } from "@/types";
import { formatarCodigoPareamento, formatarTelefone } from "@/lib/whatsapp";
import { ImagemQr } from "@/components/conectar/ImagemQr";

export type MetodoPareamento = "qr" | "codigo";

interface PainelPareamentoProps {
  conexao: ConexaoPainel;
  metodo: MetodoPareamento;
  telefone?: string | null;
  /** Quando o pedido saiu desta tela (ms); null se o pareamento já estava em curso. */
  pedidoEm: number | null;
  ocupado: boolean;
  onGerarDeNovo: () => void;
  onTrocarJeito: () => void;
  onCancelar: () => void;
}

const Passos: React.FC<{ itens: React.ReactNode[] }> = ({ itens }) => (
  <ol className="space-y-2 text-sm text-slate-300">
    {itens.map((item, i) => (
      <li key={i} className="flex gap-3">
        <span className="w-6 h-6 shrink-0 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold flex items-center justify-center">
          {i + 1}
        </span>
        <span className="leading-relaxed pt-0.5">{item}</span>
      </li>
    ))}
  </ol>
);

export const PainelPareamento: React.FC<PainelPareamentoProps> = ({
  conexao,
  metodo,
  telefone,
  pedidoEm,
  ocupado,
  onGerarDeNovo,
  onTrocarJeito,
  onCancelar,
}) => {
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const qr = conexao.pareamento?.qr || null;
  const codigo = conexao.pareamento?.codigo ? formatarCodigoPareamento(conexao.pareamento.codigo) : null;
  const pronto = metodo === "qr" ? Boolean(qr) : Boolean(codigo);
  const demorando = !pronto && pedidoEm !== null && agora - pedidoEm > 45_000;

  const copiar = async () => {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo.replace("-", ""));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Digite o código no celular.");
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4 sm:p-5 space-y-5">
      <div className="flex items-center gap-2 text-sm font-bold text-white">
        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
        {!pronto && conexao.pareamento?.estado === "solicitado"
          ? "Aguardando o gateway…"
          : metodo === "qr" ? "Conectando pelo QR" : "Conectando pelo código"}
      </div>

      <div className="flex flex-col md:flex-row gap-6 md:items-start">
        <div className="flex justify-center md:justify-start shrink-0">
          {metodo === "qr" ? (
            qr ? (
              <ImagemQr texto={qr} />
            ) : (
              <div className="w-64 h-64 max-w-full rounded-2xl border border-dashed border-white/15 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" /> Gerando o QR…
              </div>
            )
          ) : codigo ? (
            <div className="w-full md:w-auto flex flex-col items-center gap-3 rounded-2xl bg-black border border-white/15 px-5 py-6">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Código</span>
              <span
                className="font-mono font-extrabold text-4xl sm:text-5xl tracking-[0.15em] text-white select-all"
                aria-label={`Código de pareamento ${codigo.split("").join(" ")}`}
              >
                {codigo}
              </span>
              <button
                type="button"
                onClick={copiar}
                className="min-h-[40px] flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5"
              >
                {copiado ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copiado ? "Copiado" : "Copiar código"}
              </button>
            </div>
          ) : (
            <div className="w-full md:w-64 h-40 rounded-2xl border border-dashed border-white/15 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" /> Gerando o código…
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 min-w-0">
          {metodo === "qr" ? (
            <Passos
              itens={[
                "Abra o WhatsApp no celular deste número.",
                <>
                  Toque em <strong className="text-white">Aparelhos conectados</strong> e depois em{" "}
                  <strong className="text-white">Conectar aparelho</strong>.
                </>,
                "Aponte a câmera para o QR desta tela. Ele muda sozinho de tempos em tempos.",
              ]}
            />
          ) : (
            <Passos
              itens={[
                <>
                  Abra o WhatsApp no celular
                  {telefone ? (
                    <>
                      {" "}
                      do número <strong className="text-white font-mono">{formatarTelefone(telefone)}</strong>
                    </>
                  ) : null}
                  .
                </>,
                <>
                  Toque em <strong className="text-white">Aparelhos conectados</strong> e depois em{" "}
                  <strong className="text-white">Conectar aparelho</strong>.
                </>,
                <>
                  Toque em <strong className="text-white">Conectar com número de telefone</strong>.
                </>,
                <>Digite o código que aparece aqui{codigo ? <> (<strong className="font-mono text-white">{codigo}</strong>)</> : null}.</>,
              ]}
            />
          )}

          {demorando && (
            <p className="text-xs text-amber-300 leading-relaxed">
              Pode levar até um minuto para o servidor do WhatsApp responder. Se passar disso, clique em "Gerar de
              novo".
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={onGerarDeNovo}
              disabled={ocupado}
              className="min-h-[44px] flex items-center gap-2 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-semibold text-white disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" /> Gerar de novo
            </button>
            <button
              type="button"
              onClick={onTrocarJeito}
              disabled={ocupado}
              className="min-h-[44px] flex items-center gap-2 px-4 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
            >
              {metodo === "qr" ? <Hash className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
              {metodo === "qr" ? "Usar código" : "Usar QR ou outro número"}
            </button>
            <button
              type="button"
              onClick={onCancelar}
              disabled={ocupado}
              className="min-h-[44px] flex items-center gap-2 px-4 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
            >
              <X className="w-4 h-4" /> Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

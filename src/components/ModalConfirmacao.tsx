import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2 } from "lucide-react";

interface ModalConfirmacaoProps {
  titulo: string;
  children: React.ReactNode;
  textoConfirmar: string;
  perigo?: boolean;
  /** Trava o botão de confirmar (ex.: falta digitar a palavra de segurança). */
  confirmarDesabilitado?: boolean;
  onConfirmar: () => Promise<unknown> | void;
  onCancelar: () => void;
}

export const ModalConfirmacao: React.FC<ModalConfirmacaoProps> = ({
  titulo,
  children,
  textoConfirmar,
  perigo,
  confirmarDesabilitado,
  onConfirmar,
  onCancelar,
}) => {
  const [executando, setExecutando] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !executando) onCancelar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [executando, onCancelar]);

  const confirmar = async () => {
    setExecutando(true);
    try {
      await onConfirmar();
    } finally {
      setExecutando(false);
    }
  };

  // Portal: dentro de um .glass-panel (backdrop-filter) o "fixed" ficaria preso ao cartão.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-confirmacao-titulo"
      onClick={() => !executando && onCancelar()}
    >
      <div
        className="glass-panel w-full max-w-md rounded-3xl p-6 space-y-4 border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="modal-confirmacao-titulo" className="text-base font-bold text-white flex items-center gap-2">
          {perigo && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />}
          {titulo}
        </h3>
        <div className="text-sm text-slate-300 leading-relaxed space-y-2">{children}</div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={executando}
            className="min-h-[44px] px-4 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={executando || confirmarDesabilitado}
            className={`min-h-[44px] px-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60 ${
              perigo ? "bg-red-600 hover:bg-red-500" : "bg-white/10 hover:bg-white/20 border border-white/15"
            }`}
          >
            {executando && <Loader2 className="w-4 h-4 animate-spin" />}
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

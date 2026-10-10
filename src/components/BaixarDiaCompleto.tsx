import React, { useState } from "react";
import { Download, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { baixarDiaCompleto } from "@/lib/baixar";
import { diaLocal, ontem } from "@/lib/whatsapp";

interface BaixarDiaCompletoProps {
  partnerId: string | null;
  /** Fuso da empresa: "ontem" e o limite do seletor seguem o dia dela, não o do navegador. */
  fuso?: string;
  /** Versão em uma linha, para o topo da Central de Chat. */
  compacto?: boolean;
}

/**
 * O arquivo COMPLETO do dia (conversa exata, telefone e nome do WhatsApp) é só do dono:
 * nunca vai para a IA nem fica guardado no servidor.
 */
export const BaixarDiaCompleto: React.FC<BaixarDiaCompletoProps> = ({ partnerId, fuso, compacto }) => {
  const [diaEscolhido, setDia] = useState<string | null>(null);
  const dia = diaEscolhido ?? ontem(new Date(), fuso);
  const [baixando, setBaixando] = useState(false);
  const hoje = diaLocal(new Date(), fuso);

  const baixar = async () => {
    if (!partnerId || !dia) return;
    setBaixando(true);
    try {
      await baixarDiaCompleto(partnerId, dia);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível baixar o arquivo.");
    } finally {
      setBaixando(false);
    }
  };

  const seletor = (
    <input
      type="date"
      value={dia}
      max={hoje}
      onChange={(e) => setDia(e.target.value)}
      aria-label="Dia do arquivo completo"
      className="min-h-[40px] rounded-xl bg-black border border-white/15 px-3 text-base md:text-xs text-white focus:outline-none focus:border-red-500 [color-scheme:dark]"
    />
  );

  const botao = (
    <button
      type="button"
      onClick={baixar}
      disabled={!partnerId || !dia || baixando}
      title="Arquivo completo, com telefone e nome do WhatsApp. Uso interno: não enviar para a IA."
      className="min-h-[40px] flex items-center justify-center gap-2 px-3 rounded-xl bg-black hover:bg-[#16161c] border border-white/15 hover:border-red-500/50 text-xs font-bold text-white transition disabled:opacity-50"
    >
      {baixando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-red-400" />}
      <span>Baixar dia completo (.txt) — não vai para a IA</span>
    </button>
  );

  if (compacto) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {seletor}
        {botao}
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-3xl p-5 border border-white/10 space-y-3">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-white">Arquivo completo do dia</h3>
          <p className="text-xs text-slate-400 leading-relaxed mt-0.5">
            Todas as conversas do dia, exatamente como foram, com telefone e nome do WhatsApp: serve para achar
            quem veio do tráfego sem contato salvo. Uso interno — não envie este arquivo para a IA.
          </p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {seletor}
        {botao}
      </div>
    </div>
  );
};

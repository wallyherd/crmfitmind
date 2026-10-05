import React, { useState } from "react";
import { Conexao } from "@/types";
import {
  QrCode,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

interface ConectorSetupViewProps {
  conexoes: Conexao[];
}

export const ConectorSetupView: React.FC<ConectorSetupViewProps> = ({ conexoes }) => {
  const [copiado, setCopiado] = useState<string | null>(null);
  const conexaoSelecionada = conexoes[0] || null;

  const copiarTexto = (txt: string, label: string) => {
    navigator.clipboard.writeText(txt);
    setCopiado(label);
    toast.success(`${label} copiado!`);
    setTimeout(() => setCopiado(null), 2000);
  };

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="pb-4 border-b border-white/10">
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <QrCode className="w-5 h-5 text-red-500" /> Como Rodar o Conector de WhatsApp
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          O Conector é um programa leve (Node.js + Baileys) que roda em segundo plano e mantém o WhatsApp conectado à plataforma.
        </p>
      </div>

      {/* 3 Step Guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Passo 1 */}
        <div className="glass-panel rounded-3xl p-6 border border-white/10 space-y-3">
          <div className="w-8 h-8 rounded-xl bg-red-500/20 text-red-400 font-bold text-sm flex items-center justify-center font-mono border border-red-500/30">
            1
          </div>
          <h3 className="text-sm font-bold text-white">Abrir a Pasta do Conector</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Navegue até a pasta <code className="text-red-400 font-mono">robo-crm-pacote/conector</code> no seu computador.
          </p>
          <button
            onClick={() => copiarTexto("cd robo-crm-pacote/conector", "Comando")}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-black border border-white/10 text-[11px] font-mono text-slate-300 hover:border-red-500/40 transition"
          >
            <span>cd robo-crm-pacote/conector</span>
            <Copy className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>

        {/* Passo 2 */}
        <div className="glass-panel rounded-3xl p-6 border border-white/10 space-y-3">
          <div className="w-8 h-8 rounded-xl bg-red-500/20 text-red-400 font-bold text-sm flex items-center justify-center font-mono border border-red-500/30">
            2
          </div>
          <h3 className="text-sm font-bold text-white">Executar o Conector</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Dê dois cliques no arquivo <code className="text-red-400 font-mono">iniciar.bat</code> ou execute via terminal.
          </p>
          <button
            onClick={() => copiarTexto("npm start", "Comando Start")}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-black border border-white/10 text-[11px] font-mono text-slate-300 hover:border-red-500/40 transition"
          >
            <span>npm start</span>
            <Copy className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>

        {/* Passo 3 */}
        <div className="glass-panel rounded-3xl p-6 border border-white/10 space-y-3">
          <div className="w-8 h-8 rounded-xl bg-red-500/20 text-red-400 font-bold text-sm flex items-center justify-center font-mono border border-red-500/30">
            3
          </div>
          <h3 className="text-sm font-bold text-white">Escanear o QR Code</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Abra o painel local em <code className="text-red-400 font-mono">http://localhost:3001</code>, cole o Segredo e escaneie com seu WhatsApp!
          </p>
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-lg shadow-red-950/40"
          >
            <span>Abrir Painel Local</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Active Connection Credentials Box */}
      {conexaoSelecionada && (
        <div className="glass-panel rounded-3xl p-6 border border-white/10 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Credenciais da Conexão Atual ({conexaoSelecionada.nome})
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-semibold">ID da Conexão (x-bot-conexao)</label>
              <div className="flex items-center gap-2 bg-black border border-white/10 rounded-xl px-3 py-2">
                <code className="text-xs text-red-400 font-mono flex-1 truncate">{conexaoSelecionada.id}</code>
                <button
                  onClick={() => copiarTexto(conexaoSelecionada.id, "ID da Conexão")}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-semibold">Segredo do Webhook (x-bot-segredo)</label>
              <div className="flex items-center gap-2 bg-black border border-white/10 rounded-xl px-3 py-2">
                <code className="text-xs text-red-400 font-mono flex-1 truncate">
                  {conexaoSelecionada.webhook_segredo}
                </code>
                <button
                  onClick={() => copiarTexto(conexaoSelecionada.webhook_segredo, "Segredo")}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConectorSetupView;

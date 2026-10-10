import React, { useState } from "react";
import { apiJson } from "@/lib/api";
import { Copy, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CredenciaisConectorProps {
  conexaoId: string;
  compacto?: boolean;
}

type Credenciais = { conexaoId: string; segredo: string };

/**
 * O segredo do conector modo PC não vem no /api/data: só é buscado sob clique,
 * fica em memória enquanto a tela estiver aberta e some ao ocultar.
 */
export const CredenciaisConector: React.FC<CredenciaisConectorProps> = ({ conexaoId, compacto }) => {
  const [credenciais, setCredenciais] = useState<Credenciais | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const enderecoCrm = window.location.origin;

  const mostrar = async () => {
    setCarregando(true);
    try {
      const dados = await apiJson<Credenciais>(`/api/conexoes/${encodeURIComponent(conexaoId)}/credenciais`);
      setCredenciais(dados);
    } catch (err: any) {
      toast.error(`Não foi possível buscar as credenciais: ${err.message}`);
    } finally {
      setCarregando(false);
    }
  };

  const copiar = (texto: string, rotulo: string) => {
    navigator.clipboard.writeText(texto);
    setCopiado(rotulo);
    toast.success(`${rotulo} copiado!`);
    setTimeout(() => setCopiado(null), 2000);
  };

  if (!credenciais) {
    return (
      <button
        onClick={mostrar}
        disabled={carregando}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-black hover:bg-[#16161c] border border-white/10 hover:border-red-500/40 text-xs font-semibold text-slate-200 transition disabled:opacity-50"
      >
        {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5 text-red-400" />}
        Mostrar credenciais do conector
      </button>
    );
  }

  const itens: Array<{ rotulo: string; valor: string }> = [
    { rotulo: "Endereço do CRM", valor: enderecoCrm },
    { rotulo: "ID da Conexão (x-bot-conexao)", valor: credenciais.conexaoId },
    { rotulo: "Segredo (x-bot-segredo)", valor: credenciais.segredo },
  ];

  return (
    <div className="space-y-2">
      <div className={compacto ? "space-y-2" : "grid grid-cols-1 md:grid-cols-3 gap-3"}>
        {itens.map((item) => (
          <div key={item.rotulo} className="space-y-1">
            <label className="text-[11px] text-slate-400 font-semibold">{item.rotulo}</label>
            <div className="flex items-center gap-2 bg-black border border-white/10 rounded-xl px-3 py-2">
              <code className="text-xs text-red-400 font-mono flex-1 truncate select-all">{item.valor}</code>
              <button
                onClick={() => copiar(item.valor, item.rotulo)}
                className="p-1 text-slate-400 hover:text-white"
                title="Copiar"
              >
                {copiado === item.rotulo ? <Check className="w-4 h-4 text-red-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={() => setCredenciais(null)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-white"
      >
        <EyeOff className="w-3.5 h-3.5" /> Ocultar credenciais
      </button>
    </div>
  );
};

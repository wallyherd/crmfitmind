// O admin abre uma tela de conteúdo (conversas, funil, vendas...) de uma empresa que não liberou o mentor:
// em vez de erro, um aviso simples. O servidor continua sendo a barreira de verdade.
import React, { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { buscarPrivacidade } from "@/lib/mentor-api";
import { Carregando } from "@/components/Pecas";

export const SemLiberacaoMentor: React.FC<{
  partnerId: string;
  /** Só vale para o admin olhando uma empresa que não é dele. */
  aplicar: boolean;
  nomeEmpresa?: string;
  aoVerMentoria?: () => void;
  children: React.ReactNode;
}> = ({ partnerId, aplicar, nomeEmpresa, aoVerMentoria, children }) => {
  // undefined = lendo; se a leitura falhar, deixa passar (cada rota do servidor recusa sozinha)
  const [liberado, setLiberado] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!aplicar) return;
    let ativo = true;
    setLiberado(undefined);
    buscarPrivacidade(partnerId)
      .then((p) => ativo && setLiberado(p.mentorPodeVerConversas))
      .catch(() => ativo && setLiberado(true));
    return () => {
      ativo = false;
    };
  }, [partnerId, aplicar]);

  if (!aplicar) return <>{children}</>;
  if (liberado === undefined) return <Carregando />;
  if (liberado) return <>{children}</>;

  return (
    <div className="p-4 md:p-8 flex justify-center">
      <div className="max-w-md w-full text-center space-y-3 glass-panel rounded-3xl p-6 md:p-8 border border-white/10">
        <Lock className="w-8 h-8 text-red-500 mx-auto" />
        <p className="text-sm font-bold text-white">O mentorado não liberou as conversas</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          {nomeEmpresa ? `${nomeEmpresa} ainda não` : "Esta empresa ainda não"} permitiu que o mentor veja contatos, mensagens e vendas.
          Os números do dia continuam disponíveis na tela Mentoria.
        </p>
        {aoVerMentoria && (
          <button
            onClick={aoVerMentoria}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
          >
            Ir para Mentoria
          </button>
        )}
      </div>
    </div>
  );
};

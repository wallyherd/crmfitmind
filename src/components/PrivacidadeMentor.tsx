// Chave "Permitir que o mentor veja minhas conversas". Só o dono da empresa muda; desligar vale na hora.
import React, { useEffect, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { buscarPrivacidade, definirPrivacidade } from "@/lib/mentor-api";
import { dataBr } from "@/lib/formatos";
import { Carregando, ErroCarga, Painel, mensagemDeErro } from "@/components/Pecas";

export const PrivacidadeMentor: React.FC<{ partnerId: string; nomeEmpresa: string; ehDono: boolean }> = ({
  partnerId,
  nomeEmpresa,
  ehDono,
}) => {
  const [liberado, setLiberado] = useState<boolean | null>(null);
  const [desde, setDesde] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = () => {
    setErro(null);
    buscarPrivacidade(partnerId)
      .then((p) => {
        setLiberado(p.mentorPodeVerConversas);
        setDesde(p.mentorPodeVerConversasEm);
      })
      .catch((e) => setErro(mensagemDeErro(e, "Não foi possível ler sua opção de privacidade.")));
  };

  useEffect(() => {
    setLiberado(null);
    carregar();
  }, [partnerId]);

  const mudar = async () => {
    if (liberado === null || salvando) return;
    setSalvando(true);
    try {
      const p = await definirPrivacidade(partnerId, !liberado);
      setLiberado(p.mentorPodeVerConversas);
      setDesde(p.mentorPodeVerConversasEm);
      toast.success(p.mentorPodeVerConversas ? "O mentor agora vê suas conversas." : "O mentor não vê mais suas conversas.");
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível salvar. Tente de novo."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Painel titulo={`Privacidade · ${nomeEmpresa}`} icone={Lock}>
      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && liberado === null && <Carregando />}
      {liberado !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`mentor-ve-${partnerId}`} className="text-xs font-semibold text-white">
              Permitir que o mentor veja minhas conversas
            </label>
            <button
              id={`mentor-ve-${partnerId}`}
              type="button"
              role="switch"
              aria-checked={liberado}
              disabled={!ehDono || salvando}
              onClick={mudar}
              className={`relative shrink-0 w-12 h-7 rounded-full border transition disabled:opacity-50 ${
                liberado ? "bg-red-600 border-red-500" : "bg-[#141418] border-white/15"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${liberado ? "translate-x-5" : ""}`}
              />
            </button>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed flex items-start gap-2">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-500" />
            <span>
              {liberado
                ? `O mentor pode ver seus contatos, mensagens e vendas${desde ? ` (liberado em ${dataBr(desde)})` : ""}. Desligue quando quiser: vale na hora.`
                : "Desligado: o mentor vê só os números do dia (quantas conversas, vendas e metas) e se a análise saiu. Ele não vê o resumo da análise, nomes, telefones nem mensagens."}
            </span>
          </p>
          {!ehDono && <p className="text-[11px] text-slate-500">Só o dono da empresa pode mudar esta opção.</p>}
        </div>
      )}
    </Painel>
  );
};

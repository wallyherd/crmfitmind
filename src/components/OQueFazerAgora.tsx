// "O que fazer agora": quem está esperando você, follow-ups vencidos e clientes que sumiram,
// na ordem de urgência que o servidor devolve (GET /api/pendencias).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, MessageCircle, RefreshCw } from "lucide-react";
import { buscarPendencias } from "@/lib/api-comercial";
import { haQuantoTempo, linkWhatsApp, telefoneLegivel } from "@/lib/formatos";
import { abrirLink } from "@/lib/navegador";
import { ETAPAS, MOTIVOS_PENDENCIA, rotulo } from "@/lib/rotulos";
import { MensagemSugerida } from "@/components/MensagemSugerida";
import { CLASSE_BOTAO_LEVE, Carregando, ErroCarga, Painel, Selo, Vazio, mensagemDeErro } from "@/components/Pecas";
import type { Pendencia } from "@/types";

const ATUALIZAR_A_CADA_MS = 120_000;

const TOM_MOTIVO: Record<string, "vermelho" | "ambar" | "neutro"> = {
  esperando_voce: "vermelho",
  followup_vencido: "ambar",
  cliente_sumiu: "neutro",
};

interface Props {
  partnerId: string | null;
  /** Quantas mostrar antes do "ver todas". */
  limite?: number;
}

export const OQueFazerAgora: React.FC<Props> = ({ partnerId, limite = 5 }) => {
  const [itens, setItens] = useState<Pendencia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [verTodas, setVerTodas] = useState(false);
  const pedidoAtual = useRef<string | null>(null);

  const carregar = useCallback(async () => {
    if (!partnerId) return;
    pedidoAtual.current = partnerId;
    setCarregando(true);
    try {
      const lista = await buscarPendencias(partnerId);
      if (pedidoAtual.current !== partnerId) return; // trocou de empresa no meio
      setItens(lista);
      setErro(null);
    } catch (e) {
      if (pedidoAtual.current === partnerId) setErro(mensagemDeErro(e, "Não foi possível carregar as pendências."));
    } finally {
      if (pedidoAtual.current === partnerId) setCarregando(false);
    }
  }, [partnerId]);

  useEffect(() => {
    setItens(null);
    setErro(null);
    setVerTodas(false);
    carregar();
    const intervalo = setInterval(carregar, ATUALIZAR_A_CADA_MS);
    return () => clearInterval(intervalo);
  }, [carregar]);

  if (!partnerId) return null;

  const visiveis = itens ? (verTodas ? itens : itens.slice(0, limite)) : [];

  return (
    <Painel
      titulo={
        <>
          O que fazer agora
          {itens && itens.length > 0 && <Selo tom="vermelho">{itens.length}</Selo>}
        </>
      }
      icone={BellRing}
      acoes={
        <button onClick={carregar} disabled={carregando} className={CLASSE_BOTAO_LEVE} aria-label="Atualizar lista">
          <RefreshCw className={`w-3 h-3 ${carregando ? "animate-spin" : ""}`} /> Atualizar
        </button>
      }
    >
      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && itens === null && <Carregando texto="Buscando quem precisa de você..." />}
      {!erro && itens && itens.length === 0 && (
        <Vazio>Tudo em dia. Ninguém esperando resposta e nenhum follow-up vencido.</Vazio>
      )}

      {visiveis.length > 0 && (
        <ul className="space-y-2">
          {visiveis.map((p) => {
            const nome = p.nome || telefoneLegivel(p.telefone) || "Contato sem nome";
            const link = linkWhatsApp(p.telefone);
            return (
              <li
                key={`${p.contato_id}-${p.motivo}`}
                className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-bold text-white truncate max-w-full">{nome}</span>
                  <Selo tom={TOM_MOTIVO[p.motivo] || "neutro"}>{rotulo(MOTIVOS_PENDENCIA, p.motivo)}</Selo>
                  {p.ha_horas !== null && p.ha_horas !== undefined && (
                    <span className="text-[11px] text-slate-400">{haQuantoTempo(p.ha_horas)}</span>
                  )}
                  {p.etapa && <span className="text-[11px] text-slate-500">· {rotulo(ETAPAS, p.etapa)}</span>}
                </div>

                {p.mensagem_sugerida ? (
                  <MensagemSugerida
                    texto={p.mensagem_sugerida}
                    sugestaoId={p.sugestao_id}
                    telefone={p.telefone}
                    compacta
                  />
                ) : (
                  <button
                    onClick={() => link && abrirLink(link)}
                    disabled={!link}
                    title={link ? "Abrir a conversa no WhatsApp" : "Contato sem telefone"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-[11px] font-bold"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> Abrir no WhatsApp
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {itens && itens.length > limite && (
        <button onClick={() => setVerTodas((v) => !v)} className="text-xs text-red-400 hover:text-red-300 font-semibold">
          {verTodas ? "Mostrar menos" : `Ver todas (${itens.length})`}
        </button>
      )}
    </Painel>
  );
};

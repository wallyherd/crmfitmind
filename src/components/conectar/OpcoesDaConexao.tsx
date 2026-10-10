import React, { useEffect, useMemo, useState } from "react";
import { Bot, History, Loader2, Save, Search, Users } from "lucide-react";
import { toast } from "sonner";
import type { ConexaoPainel, GrupoWhatsApp } from "@/types";
import { salvarOpcoesConexao } from "@/lib/conexoes-api";
import { HISTORICO_MAXIMO_DIAS, limitarHistoricoDias } from "@/lib/whatsapp";
import { ModalConfirmacao } from "@/components/ModalConfirmacao";

interface OpcoesDaConexaoProps {
  conexao: ConexaoPainel;
  onSalvo: () => void;
}

const mesmaLista = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export const OpcoesDaConexao: React.FC<OpcoesDaConexaoProps> = ({ conexao, onSalvo }) => {
  const salvo = conexao.opcoes;
  // Rascunho local: o polling atualiza `conexao` a cada poucos segundos e não pode apagar o que está sendo editado.
  const [dias, setDias] = useState(String(salvo.historicoDias));
  const [grupos, setGrupos] = useState<string[]>(salvo.gruposPermitidos);
  const [filtro, setFiltro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mudandoRobo, setMudandoRobo] = useState(false);
  const [confirmarRobo, setConfirmarRobo] = useState(false);

  // Recomeça o rascunho só ao trocar de conexão.
  useEffect(() => {
    setDias(String(conexao.opcoes.historicoDias));
    setGrupos(conexao.opcoes.gruposPermitidos);
    setFiltro("");
  }, [conexao.id]);

  const diasNumero = limitarHistoricoDias(dias === "" ? salvo.historicoDias : dias);
  const alterado = diasNumero !== salvo.historicoDias || !mesmaLista(grupos, salvo.gruposPermitidos);

  // Grupo marcado que sumiu da lista (saiu do grupo, por exemplo) continua aparecendo para poder desmarcar.
  const listaGrupos: GrupoWhatsApp[] = useMemo(() => {
    const conhecidos = new Set(conexao.grupos_disponiveis.map((g) => g.jid));
    const orfaos = grupos
      .filter((jid) => !conhecidos.has(jid))
      .map((jid) => ({ jid, nome: null, participantes: null }));
    return [...conexao.grupos_disponiveis, ...orfaos].sort((a, b) =>
      (a.nome || a.jid).localeCompare(b.nome || b.jid, "pt-BR")
    );
  }, [conexao.grupos_disponiveis, grupos]);

  const termo = filtro.trim().toLowerCase();
  const gruposVisiveis = termo
    ? listaGrupos.filter((g) => (g.nome || g.jid).toLowerCase().includes(termo))
    : listaGrupos;

  const alternarGrupo = (jid: string) =>
    setGrupos((atual) => (atual.includes(jid) ? atual.filter((g) => g !== jid) : [...atual, jid]));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await salvarOpcoesConexao(conexao.id, { historicoDias: diasNumero, gruposPermitidos: grupos });
      setDias(String(diasNumero));
      toast.success("Opções salvas.");
      onSalvo();
    } catch (err: any) {
      toast.error(`Não foi possível salvar: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const mudarRobo = async (ligar: boolean) => {
    setMudandoRobo(true);
    try {
      await salvarOpcoesConexao(conexao.id, { botAtivo: ligar });
      toast.success(ligar ? "Robô ligado neste número." : "Robô desligado. O CRM só registra as conversas.");
      onSalvo();
    } catch (err: any) {
      toast.error(`Não foi possível mudar o robô: ${err.message}`);
    } finally {
      setMudandoRobo(false);
      setConfirmarRobo(false);
    }
  };

  const roboLigado = salvo.botAtivo;

  return (
    <div className="space-y-5">
      <form onSubmit={salvar} className="space-y-5">
        {/* Histórico inicial */}
        <div className="space-y-2">
          <label htmlFor={`dias-${conexao.id}`} className="flex items-center gap-2 text-sm font-bold text-white">
            <History className="w-4 h-4 text-red-400" /> Histórico inicial
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`dias-${conexao.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={HISTORICO_MAXIMO_DIAS}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              onBlur={() => setDias(String(diasNumero))}
              className="w-24 min-h-[44px] rounded-xl bg-black border border-white/15 px-3 text-base md:text-sm text-white font-mono focus:outline-none focus:border-red-500"
            />
            <span className="text-sm text-slate-300">dias de conversas antigas</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            De 0 a {HISTORICO_MAXIMO_DIAS} (padrão 7). Vale só no primeiro pareamento
            {conexao.status === "conectado" ? ": como este número já está conectado, só muda num próximo pareamento" : ""}
            . O histórico de grupos não vem.
          </p>
        </div>

        {/* Grupos */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Users className="w-4 h-4 text-red-400" /> Grupos que o CRM registra
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Nenhum grupo marcado = nenhuma mensagem de grupo é registrada. O robô nunca responde em grupo.
          </p>

          {listaGrupos.length === 0 ? (
            <p className="text-xs text-slate-500 rounded-xl border border-dashed border-white/10 p-3">
              {conexao.status === "conectado"
                ? "Nenhum grupo encontrado neste WhatsApp."
                : "A lista de grupos aparece depois que o WhatsApp conectar."}
            </p>
          ) : (
            <div className="space-y-2">
              {listaGrupos.length > 8 && (
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="search"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                    placeholder="Buscar grupo"
                    className="w-full min-h-[44px] pl-9 pr-3 rounded-xl bg-black border border-white/15 text-base md:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
                  />
                </div>
              )}
              <ul className="max-h-72 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                {gruposVisiveis.map((g) => (
                  <li key={g.jid}>
                    <label className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] cursor-pointer hover:bg-white/[0.03]">
                      <input
                        type="checkbox"
                        checked={grupos.includes(g.jid)}
                        onChange={() => alternarGrupo(g.jid)}
                        className="w-4 h-4 accent-red-600 shrink-0"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-white truncate">{g.nome || "Grupo sem nome"}</span>
                        {!g.nome && <span className="block text-[11px] text-slate-500 font-mono break-all">{g.jid}</span>}
                      </span>
                      {g.participantes !== null && (
                        <span className="text-[11px] text-slate-500 shrink-0">{g.participantes} pessoas</span>
                      )}
                    </label>
                  </li>
                ))}
                {gruposVisiveis.length === 0 && (
                  <li className="px-3 py-3 text-xs text-slate-500">Nenhum grupo com esse nome.</li>
                )}
              </ul>
              <p className="text-[11px] text-slate-500">{grupos.length} marcado(s)</p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!alterado || salvando}
          className="min-h-[44px] w-full sm:w-auto flex items-center justify-center gap-2 px-5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold text-white disabled:opacity-40 disabled:hover:bg-red-600"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar opções
        </button>
      </form>

      {/* Robô */}
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Bot className="w-4 h-4 text-red-400" /> Robô (respostas automáticas)
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mt-1">
            {roboLigado
              ? "Ligado: o CRM pode enviar mensagens por este número (fluxos e respostas do Central de Chat)."
              : "Desligado: o CRM só registra as conversas e não envia nada por este número."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={roboLigado}
          aria-label="Robô ligado"
          disabled={mudandoRobo}
          onClick={() => (roboLigado ? mudarRobo(false) : setConfirmarRobo(true))}
          className={`self-start sm:self-auto relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition disabled:opacity-50 ${
            roboLigado ? "bg-red-600 border-red-500" : "bg-white/10 border-white/20"
          }`}
        >
          <span
            className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${
              roboLigado ? "translate-x-7" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {confirmarRobo && (
        <ModalConfirmacao
          titulo="Ligar o robô neste número?"
          textoConfirmar="Ligar mesmo assim"
          perigo
          onConfirmar={() => mudarRobo(true)}
          onCancelar={() => setConfirmarRobo(false)}
        >
          <p>
            Com o robô ligado, o CRM passa a <strong className="text-white">enviar mensagens</strong> por este
            WhatsApp.
          </p>
          <p>
            Esta conexão não é a API oficial do WhatsApp. Mensagens automáticas aumentam o{" "}
            <strong className="text-amber-300">risco de o número ser bloqueado (banido)</strong>. Ligue só se for
            usar os fluxos de atendimento, e comece com pouco volume.
          </p>
        </ModalConfirmacao>
      )}
    </div>
  );
};

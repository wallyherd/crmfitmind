// Mensagens de rastreio: o texto que o anúncio já deixa escrito na primeira mensagem do cliente.
// É assim que o sistema conta, sem IA, quantas conversas vieram de cada campanha.
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { alterarRastreio, apagarRastreio, criarRastreio, listarRastreios } from "@/lib/api-comercial";
import {
  CLASSE_BOTAO,
  CLASSE_BOTAO_LEVE,
  CLASSE_BOTAO_SEC,
  CLASSE_INPUT,
  CLASSE_ROTULO,
  Carregando,
  ErroCarga,
  Painel,
  Selo,
  Vazio,
  mensagemDeErro,
} from "@/components/Pecas";
import type { DadosRastreio, MensagemRastreio, ModoRastreio } from "@/types";

const MODOS: Record<ModoRastreio, string> = {
  contem: "Contém o texto",
  exata: "Igual à mensagem",
};

const VAZIO: DadosRastreio = { nome_campanha: "", mensagem_inicial: "", modo: "contem" };

function validar(d: DadosRastreio): string | null {
  const nome = d.nome_campanha.trim();
  if (nome.length < 2 || nome.length > 60) return "O nome da campanha precisa ter de 2 a 60 letras.";
  if (d.mensagem_inicial.trim().length < 3) return "Cole a mensagem do anúncio (pelo menos 3 letras).";
  return null;
}

const FormularioRastreio: React.FC<{
  inicial: DadosRastreio;
  textoBotao: string;
  aoSalvar: (d: DadosRastreio) => Promise<boolean>;
  aoCancelar?: () => void;
}> = ({ inicial, textoBotao, aoSalvar, aoCancelar }) => {
  const [d, setD] = useState<DadosRastreio>(inicial);
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const erro = validar(d);
    if (erro) return void toast.error(erro);
    setSalvando(true);
    const ok = await aoSalvar({
      nome_campanha: d.nome_campanha.trim(),
      mensagem_inicial: d.mensagem_inicial.trim(),
      modo: d.modo,
    });
    setSalvando(false);
    if (ok && !aoCancelar) setD(VAZIO);
  };

  return (
    <form onSubmit={enviar} className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <label className="sm:col-span-2">
          <span className={CLASSE_ROTULO}>Nome da campanha *</span>
          <input
            value={d.nome_campanha}
            onChange={(e) => setD({ ...d, nome_campanha: e.target.value })}
            maxLength={60}
            placeholder="Ex.: Método 30D — outubro"
            className={CLASSE_INPUT}
          />
        </label>
        <label>
          <span className={CLASSE_ROTULO}>Como comparar</span>
          <select
            value={d.modo}
            onChange={(e) => setD({ ...d, modo: e.target.value as ModoRastreio })}
            className={CLASSE_INPUT}
          >
            {(Object.keys(MODOS) as ModoRastreio[]).map((m) => (
              <option key={m} value={m}>
                {MODOS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={CLASSE_ROTULO}>Mensagem automática do anúncio *</span>
        <textarea
          value={d.mensagem_inicial}
          onChange={(e) => setD({ ...d, mensagem_inicial: e.target.value })}
          rows={2}
          maxLength={500}
          placeholder="Ex.: Olá! Vi o anúncio e quero saber mais sobre o Método 30D"
          className={`${CLASSE_INPUT} resize-y`}
        />
      </label>
      <div className="flex justify-end gap-2">
        {aoCancelar && (
          <button type="button" onClick={aoCancelar} className={CLASSE_BOTAO_SEC}>
            Cancelar
          </button>
        )}
        <button type="submit" disabled={salvando} className={CLASSE_BOTAO}>
          {!aoCancelar && <Plus className="w-3.5 h-3.5" />} {salvando ? "Salvando..." : textoBotao}
        </button>
      </div>
    </form>
  );
};

export const RastreioTrafego: React.FC<{ partnerId: string }> = ({ partnerId }) => {
  const [itens, setItens] = useState<MensagemRastreio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setItens(await listarRastreios(partnerId));
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar as mensagens de rastreio."));
    }
  }, [partnerId]);

  useEffect(() => {
    setItens(null);
    carregar();
  }, [carregar]);

  const criar = async (d: DadosRastreio) => {
    try {
      await criarRastreio(partnerId, d);
      toast.success("Mensagem de rastreio cadastrada.");
      await carregar();
      return true;
    } catch (e) {
      toast.error(mensagemDeErro(e));
      return false;
    }
  };

  const salvarEdicao = (id: string) => async (d: DadosRastreio) => {
    try {
      await alterarRastreio(id, d);
      toast.success("Mensagem de rastreio atualizada.");
      setEditando(null);
      await carregar();
      return true;
    } catch (e) {
      toast.error(mensagemDeErro(e));
      return false;
    }
  };

  const apagar = async (r: MensagemRastreio) => {
    if (!confirm(`Apagar a mensagem da campanha "${r.nome_campanha}"? As conversas já contadas continuam contadas.`)) return;
    try {
      await apagarRastreio(r.id);
      toast.success("Mensagem apagada.");
      await carregar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  };

  return (
    <div className="space-y-4">
      <Painel titulo="Mensagem do anúncio" icone={Megaphone}>
        <p className="text-xs text-slate-300 leading-relaxed">
          <strong>Cole aqui a mensagem automática que o anúncio coloca</strong> no WhatsApp do cliente quando ele clica.
        </p>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Quando a primeira mensagem de um contato novo for igual a esse texto (ou contiver esse texto), a conversa
          conta como tráfego pago daquela campanha no Relatório do dia. Use um texto diferente para cada campanha.
        </p>
        <FormularioRastreio inicial={VAZIO} textoBotao="Adicionar campanha" aoSalvar={criar} />
      </Painel>

      <Painel titulo="Campanhas cadastradas">
        {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
        {!erro && itens === null && <Carregando />}
        {itens && itens.length === 0 && (
          <Vazio>Nenhuma campanha ainda. Sem isso, o relatório não sabe quem veio do anúncio.</Vazio>
        )}
        {itens && itens.length > 0 && (
          <ul className="space-y-2">
            {itens.map((r) =>
              editando === r.id ? (
                <li key={r.id} className="p-3 rounded-2xl bg-white/[0.03] border border-red-500/30">
                  <FormularioRastreio
                    inicial={{ nome_campanha: r.nome_campanha, mensagem_inicial: r.mensagem_inicial, modo: r.modo }}
                    textoBotao="Salvar"
                    aoSalvar={salvarEdicao(r.id)}
                    aoCancelar={() => setEditando(null)}
                  />
                </li>
              ) : (
                <li
                  key={r.id}
                  className={`p-3 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                    r.ativo === false ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-bold text-white flex flex-wrap items-center gap-2">
                      {r.nome_campanha} <Selo>{MODOS[r.modo] || r.modo}</Selo>
                      {r.ativo === false && <Selo>Pausada</Selo>}
                    </p>
                    <p className="text-[11px] text-slate-400 break-words">“{r.mensagem_inicial}”</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <button onClick={() => setEditando(r.id)} className={CLASSE_BOTAO_LEVE}>
                      <Pencil className="w-3 h-3" /> Editar
                    </button>
                    <button onClick={() => apagar(r)} className={CLASSE_BOTAO_LEVE}>
                      <Trash2 className="w-3 h-3" /> Apagar
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </Painel>
    </div>
  );
};

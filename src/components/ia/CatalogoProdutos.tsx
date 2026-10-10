// Catálogo de produtos: a IA só sugere o que estiver aqui.
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { alterarProduto, apagarProduto, criarProduto, listarProdutos } from "@/lib/api-comercial";
import { brl, lerValor } from "@/lib/formatos";
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
import type { DadosProduto, Produto } from "@/types";

type Campos = { nome: string; preco: string; preco_minimo: string; descricao_curta: string };

const VAZIO: Campos = { nome: "", preco: "", preco_minimo: "", descricao_curta: "" };

const paraCampo = (v: number | null) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

/** Valida e converte o formulário; devolve a mensagem de erro em texto quando não dá. */
function lerCampos(c: Campos): DadosProduto | string {
  const nome = c.nome.trim();
  if (!nome) return "Dê um nome ao produto.";
  if (nome.length > 80) return "Nome com no máximo 80 letras.";
  const preco = c.preco.trim() ? lerValor(c.preco) : null;
  if (c.preco.trim() && preco === null) return "Preço inválido. Ex.: 497,00";
  const minimo = c.preco_minimo.trim() ? lerValor(c.preco_minimo) : null;
  if (c.preco_minimo.trim() && minimo === null) return "Preço mínimo inválido. Ex.: 397,00";
  if (preco !== null && minimo !== null && minimo > preco) return "O preço mínimo não pode ser maior que o preço.";
  const descricao = c.descricao_curta.trim();
  if (descricao.length > 200) return "Descrição com no máximo 200 letras.";
  return { nome, preco, preco_minimo: minimo, descricao_curta: descricao || null };
}

const FormularioProduto: React.FC<{
  inicial: Campos;
  textoBotao: string;
  aoSalvar: (dados: DadosProduto) => Promise<void>;
  aoCancelar?: () => void;
}> = ({ inicial, textoBotao, aoSalvar, aoCancelar }) => {
  const [c, setC] = useState<Campos>(inicial);
  const [salvando, setSalvando] = useState(false);
  const muda = (campo: keyof Campos) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setC((atual) => ({ ...atual, [campo]: e.target.value }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const dados = lerCampos(c);
    if (typeof dados === "string") return void toast.error(dados);
    setSalvando(true);
    try {
      await aoSalvar(dados);
      if (!aoCancelar) setC(VAZIO);
    } catch {
      // o aviso do erro já apareceu; o formulário fica como estava para corrigir
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
      <label className="sm:col-span-2">
        <span className={CLASSE_ROTULO}>Nome *</span>
        <input value={c.nome} onChange={muda("nome")} maxLength={80} placeholder="Mentoria Start" className={CLASSE_INPUT} />
      </label>
      <label>
        <span className={CLASSE_ROTULO}>Preço (R$)</span>
        <input value={c.preco} onChange={muda("preco")} inputMode="decimal" placeholder="497,00" className={CLASSE_INPUT} />
      </label>
      <label>
        <span className={CLASSE_ROTULO}>Mínimo (R$)</span>
        <input
          value={c.preco_minimo}
          onChange={muda("preco_minimo")}
          inputMode="decimal"
          placeholder="397,00"
          className={CLASSE_INPUT}
        />
      </label>
      <label className="sm:col-span-2">
        <span className={CLASSE_ROTULO}>Descrição curta</span>
        <input
          value={c.descricao_curta}
          onChange={muda("descricao_curta")}
          maxLength={200}
          placeholder="Para quem é e o que entrega"
          className={CLASSE_INPUT}
        />
      </label>
      <div className="sm:col-span-6 flex justify-end gap-2">
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

export const CatalogoProdutos: React.FC<{ partnerId: string }> = ({ partnerId }) => {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setProdutos(await listarProdutos(partnerId));
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar os produtos."));
    }
  }, [partnerId]);

  useEffect(() => {
    setProdutos(null);
    carregar();
  }, [carregar]);

  const criar = async (dados: DadosProduto) => {
    try {
      await criarProduto(partnerId, dados);
      toast.success("Produto cadastrado.");
      await carregar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
      throw e;
    }
  };

  const salvarEdicao = (id: string) => async (dados: DadosProduto) => {
    try {
      await alterarProduto(id, dados);
      toast.success("Produto atualizado.");
      setEditando(null);
      await carregar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  };

  const alternarAtivo = async (p: Produto) => {
    try {
      await alterarProduto(p.id, { ativo: p.ativo === false });
      await carregar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  };

  const apagar = async (p: Produto) => {
    if (!confirm(`Apagar o produto "${p.nome}"?`)) return;
    try {
      await apagarProduto(p.id);
      toast.success("Produto apagado.");
      await carregar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  };

  return (
    <div className="space-y-4">
      <Painel titulo="Cadastrar produto" icone={Package}>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          A IA só sugere produtos desta lista. O preço mínimo é o menor valor que você aceita: a IA não sugere
          desconto abaixo dele.
        </p>
        <FormularioProduto inicial={VAZIO} textoBotao="Adicionar produto" aoSalvar={criar} />
      </Painel>

      <Painel titulo="Seus produtos">
        {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
        {!erro && produtos === null && <Carregando />}
        {produtos && produtos.length === 0 && <Vazio>Nenhum produto ainda. Sem catálogo a IA não sugere o que oferecer.</Vazio>}
        {produtos && produtos.length > 0 && (
          <ul className="space-y-2">
            {produtos.map((p) =>
              editando === p.id ? (
                <li key={p.id} className="p-3 rounded-2xl bg-white/[0.03] border border-red-500/30">
                  <FormularioProduto
                    inicial={{
                      nome: p.nome,
                      preco: paraCampo(p.preco),
                      preco_minimo: paraCampo(p.preco_minimo),
                      descricao_curta: p.descricao_curta || "",
                    }}
                    textoBotao="Salvar"
                    aoSalvar={salvarEdicao(p.id)}
                    aoCancelar={() => setEditando(null)}
                  />
                </li>
              ) : (
                <li
                  key={p.id}
                  className={`p-3 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                    p.ativo === false ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-bold text-white flex flex-wrap items-center gap-2">
                      {p.nome} {p.ativo === false && <Selo>Pausado</Selo>}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {brl(p.preco)}
                      {p.preco_minimo !== null && p.preco_minimo !== undefined ? ` · mínimo ${brl(p.preco_minimo)}` : ""}
                    </p>
                    {p.descricao_curta && <p className="text-[11px] text-slate-500 break-words">{p.descricao_curta}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <button onClick={() => setEditando(p.id)} className={CLASSE_BOTAO_LEVE}>
                      <Pencil className="w-3 h-3" /> Editar
                    </button>
                    {p.ativo !== undefined && (
                      <button onClick={() => alternarAtivo(p)} className={CLASSE_BOTAO_LEVE}>
                        {p.ativo === false ? "Voltar a oferecer" : "Pausar"}
                      </button>
                    )}
                    <button onClick={() => apagar(p)} className={CLASSE_BOTAO_LEVE}>
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

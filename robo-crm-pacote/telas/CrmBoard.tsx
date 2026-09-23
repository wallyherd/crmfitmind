import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { enviarMensagemDireta } from "@/lib/bot-disparos.functions";
import { toast } from "sonner";
import {
  Plus, X, Loader2, Clock, Phone, Mail, Trash2, ArrowRight,
  Pencil, Upload, GripVertical, Check, Send,
} from "lucide-react";

// As tabelas crm_* ainda não estão no types.ts gerado.
const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export type TipoQuadro = "funil" | "quadro";

export interface Coluna {
  id: string;
  nome: string;
  posicao: number;
  cor: string | null;
  tipo: "normal" | "ganho" | "perdido";
  limite_cartoes: number | null;
}

export interface Cartao {
  id: string;
  quadro_id: string;
  coluna_id: string;
  posicao: number;
  titulo: string;
  descricao: string | null;
  contato_nome: string | null;
  contato_telefone: string | null;
  contato_email: string | null;
  origem: string | null;
  prioridade: "baixa" | "normal" | "alta";
  vence_em: string | null;
}

export interface Atividade {
  id: string;
  tipo: string;
  corpo: string | null;
  created_at: string;
  de_coluna_id: string | null;
  para_coluna_id: string | null;
}

const PRIORIDADE_COR: Record<string, string> = {
  alta: "text-red-400",
  normal: "text-white/40",
  baixa: "text-blue-400",
};

const TIPO_PONTO: Record<string, string> = {
  ganho: "bg-emerald-400",
  perdido: "bg-red-400",
  normal: "bg-white/20",
};

const campoCls =
  "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none";

export function CrmBoard({
  quadroId,
  tipo = "funil",
  partnerId,
}: {
  quadroId: string;
  tipo?: TipoQuadro;
  /**
   * Só a academia passa. É o que habilita mandar mensagem pelo próprio sistema
   * em vez de abrir o WhatsApp Web — os outros quadros continuam com o link.
   */
  partnerId?: string;
}) {
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [aberto, setAberto] = useState<Cartao | null>(null);
  const [editandoColuna, setEditandoColuna] = useState<string | null>(null);
  const [nomeColuna, setNomeColuna] = useState("");
  const [criandoColuna, setCriandoColuna] = useState(false);
  const [importando, setImportando] = useState(false);

  const ehFunil = tipo === "funil";
  const rotuloCartao = ehFunil ? "lead" : "tarefa";

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [cRes, kRes] = await Promise.all([
      db.from("crm_colunas").select("*").eq("quadro_id", quadroId).order("posicao"),
      db.from("crm_cartoes").select("*").eq("quadro_id", quadroId).is("arquivado_em", null).order("posicao"),
    ]);
    if (cRes.error) toast.error("Não foi possível carregar as etapas");
    if (kRes.error) toast.error("Não foi possível carregar os cartões");
    setColunas((cRes.data || []) as Coluna[]);
    setCartoes((kRes.data || []) as Cartao[]);
    setCarregando(false);
  }, [quadroId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const daColuna = useCallback(
    (colunaId: string) => cartoes.filter((c) => c.coluna_id === colunaId).sort((a, b) => a.posicao - b.posicao),
    [cartoes],
  );

  // ---- métricas do funil ----
  const metricas = useMemo(() => {
    if (!ehFunil) return null;
    const ganhas = colunas.filter((c) => c.tipo === "ganho").map((c) => c.id);
    const perdidas = colunas.filter((c) => c.tipo === "perdido").map((c) => c.id);
    const ganhos = cartoes.filter((c) => ganhas.includes(c.coluna_id)).length;
    const perdidos = cartoes.filter((c) => perdidas.includes(c.coluna_id)).length;
    const abertos = cartoes.length - ganhos - perdidos;
    const fechados = ganhos + perdidos;
    return {
      total: cartoes.length,
      abertos,
      ganhos,
      perdidos,
      conversao: fechados ? Math.round((ganhos / fechados) * 100) : null,
    };
  }, [cartoes, colunas, ehFunil]);

  // ---- colunas ----
  async function criarColuna(nome: string) {
    const limpo = nome.trim();
    if (!limpo) return;
    const posicao = colunas.length ? Math.max(...colunas.map((c) => c.posicao)) + 1000 : 1000;
    const { data, error } = await db
      .from("crm_colunas")
      .insert({ quadro_id: quadroId, nome: limpo, posicao, tipo: "normal" })
      .select()
      .single();
    if (error) {
      toast.error("Não deu para criar a etapa");
      return;
    }
    setColunas((p) => [...p, data as Coluna]);
    setCriandoColuna(false);
  }

  async function renomearColuna(id: string, nome: string) {
    const limpo = nome.trim();
    if (!limpo) {
      setEditandoColuna(null);
      return;
    }
    const antes = colunas;
    setColunas((p) => p.map((c) => (c.id === id ? { ...c, nome: limpo } : c)));
    setEditandoColuna(null);
    const { error } = await db.from("crm_colunas").update({ nome: limpo }).eq("id", id);
    if (error) {
      setColunas(antes);
      toast.error("Não deu para renomear");
    }
  }

  async function mudarTipoColuna(id: string, novoTipo: Coluna["tipo"]) {
    const antes = colunas;
    setColunas((p) => p.map((c) => (c.id === id ? { ...c, tipo: novoTipo } : c)));
    const { error } = await db.from("crm_colunas").update({ tipo: novoTipo }).eq("id", id);
    if (error) {
      setColunas(antes);
      toast.error("Não deu para mudar o tipo");
    }
  }

  async function apagarColuna(id: string) {
    const qtd = daColuna(id).length;
    if (qtd > 0) {
      toast.error(`Mova os ${qtd} ${rotuloCartao}s desta etapa antes de apagá-la`);
      return;
    }
    const { error } = await db.from("crm_colunas").delete().eq("id", id);
    if (error) {
      toast.error("Não deu para apagar a etapa");
      return;
    }
    setColunas((p) => p.filter((c) => c.id !== id));
    toast.success("Etapa apagada");
  }

  // ---- cartões ----
  async function adicionarCartao(colunaId: string) {
    const titulo = novoTitulo.trim();
    if (!titulo) return;
    const atuais = daColuna(colunaId);
    const posicao = atuais.length ? Math.max(...atuais.map((c) => c.posicao)) + 1000 : 1000;
    const { data, error } = await db
      .from("crm_cartoes")
      .insert({ quadro_id: quadroId, coluna_id: colunaId, titulo, posicao, origem: "manual" })
      .select()
      .single();
    if (error) {
      toast.error(`Não deu para criar o ${rotuloCartao}`);
      return;
    }
    setCartoes((p) => [...p, data as Cartao]);
    setNovoTitulo("");
    setNovoEm(null);
  }

  async function mover(cartaoId: string, colunaId: string, antesDe?: string) {
    const cartao = cartoes.find((c) => c.id === cartaoId);
    if (!cartao) return;
    const destino = daColuna(colunaId).filter((c) => c.id !== cartaoId);

    let posicao: number;
    if (antesDe) {
      const i = destino.findIndex((c) => c.id === antesDe);
      const anterior = i > 0 ? destino[i - 1].posicao : 0;
      const atual = destino[i]?.posicao ?? anterior + 2000;
      posicao = (anterior + atual) / 2;
    } else {
      posicao = destino.length ? Math.max(...destino.map((c) => c.posicao)) + 1000 : 1000;
    }

    const anteriores = cartoes;
    setCartoes((p) => p.map((c) => (c.id === cartaoId ? { ...c, coluna_id: colunaId, posicao } : c)));
    const { error } = await db.from("crm_cartoes").update({ coluna_id: colunaId, posicao }).eq("id", cartaoId);
    if (error) {
      setCartoes(anteriores);
      toast.error("Não deu para mover");
    }
  }

  async function arquivar(cartaoId: string) {
    const { error } = await db
      .from("crm_cartoes")
      .update({ arquivado_em: new Date().toISOString() })
      .eq("id", cartaoId);
    if (error) {
      toast.error("Não deu para arquivar");
      return;
    }
    setCartoes((p) => p.filter((c) => c.id !== cartaoId));
    setAberto(null);
    toast.success("Arquivado");
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <>
      {/* resumo do funil */}
      {ehFunil && metricas && metricas.total > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            { r: "Em aberto", v: metricas.abertos, c: "text-white" },
            { r: "Matriculados", v: metricas.ganhos, c: "text-emerald-400" },
            { r: "Perdidos", v: metricas.perdidos, c: "text-red-400" },
            { r: "Conversão", v: metricas.conversao === null ? "—" : `${metricas.conversao}%`, c: "text-white" },
          ].map((m) => (
            <div key={m.r} className="rounded-2xl border border-white/5 p-4" style={{ backgroundColor: "#1A1A1A" }}>
              <p className="text-xs text-white/50">{m.r}</p>
              <p className={`mt-1 text-xl font-bold ${m.c}`}>{m.v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCriandoColuna(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5"
        >
          <Plus className="h-3.5 w-3.5" /> Nova etapa
        </button>
        {ehFunil && (
          <button
            onClick={() => setImportando(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5"
          >
            <Upload className="h-3.5 w-3.5" /> Importar contatos
          </button>
        )}
        <span className="ml-auto text-xs text-white/30">
          {cartoes.length} {rotuloCartao}
          {cartoes.length === 1 ? "" : "s"} · arraste entre as etapas
        </span>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 lg:max-h-[calc(100vh-19rem)] lg:overflow-y-hidden">
        {colunas.map((coluna) => {
          const lista = daColuna(coluna.id);
          const cheia = coluna.limite_cartoes != null && lista.length >= coluna.limite_cartoes;
          return (
            <div
              key={coluna.id}
              onDragOver={(e) => {
                e.preventDefault();
                setAlvo(coluna.id);
              }}
              onDragLeave={() => setAlvo((a) => (a === coluna.id ? null : a))}
              onDrop={(e) => {
                e.preventDefault();
                setAlvo(null);
                if (arrastando) void mover(arrastando, coluna.id);
                setArrastando(null);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-2xl border p-3 transition-colors ${
                alvo === coluna.id ? "border-primary/40" : "border-white/5"
              }`}
              style={{ backgroundColor: "#151515" }}
            >
              {/* cabeçalho da etapa */}
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TIPO_PONTO[coluna.tipo]}`} />
                {editandoColuna === coluna.id ? (
                  <input
                    autoFocus
                    value={nomeColuna}
                    onChange={(e) => setNomeColuna(e.target.value)}
                    onBlur={() => void renomearColuna(coluna.id, nomeColuna)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renomearColuna(coluna.id, nomeColuna);
                      if (e.key === "Escape") setEditandoColuna(null);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-sm text-white focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditandoColuna(coluna.id);
                      setNomeColuna(coluna.nome);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-white hover:text-primary"
                    title="Clique para renomear"
                  >
                    {coluna.nome}
                  </button>
                )}
                <span className={`shrink-0 text-xs ${cheia ? "text-red-400" : "text-white/40"}`}>
                  {lista.length}
                  {coluna.limite_cartoes ? `/${coluna.limite_cartoes}` : ""}
                </span>
              </div>

              {/* controles da etapa */}
              {editandoColuna === coluna.id && (
                <div className="mb-3 flex items-center gap-2 px-1">
                  <select
                    value={coluna.tipo}
                    onChange={(e) => void mudarTipoColuna(coluna.id, e.target.value as Coluna["tipo"])}
                    className="flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    <option value="normal">Etapa comum</option>
                    <option value="ganho">Fecha como ganho</option>
                    <option value="perdido">Fecha como perdido</option>
                  </select>
                  <button
                    onClick={() => void apagarColuna(coluna.id)}
                    className="rounded-lg p-1.5 text-white/40 hover:text-red-400"
                    title="Apagar etapa"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="min-h-0 flex-1 space-y-2 lg:overflow-y-auto">
                {lista.map((cartao) => (
                  <div
                    key={cartao.id}
                    draggable
                    onDragStart={() => setArrastando(cartao.id)}
                    onDragEnd={() => setArrastando(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAlvo(null);
                      if (arrastando && arrastando !== cartao.id) void mover(arrastando, coluna.id, cartao.id);
                      setArrastando(null);
                    }}
                    onClick={() => setAberto(cartao)}
                    className={`cursor-pointer rounded-xl border border-white/5 p-3 hover:border-white/15 ${
                      arrastando === cartao.id ? "opacity-40" : ""
                    }`}
                    style={{ backgroundColor: "#1F1F1F" }}
                  >
                    <p className="text-sm leading-snug text-white">{cartao.titulo}</p>
                    {(cartao.contato_nome || cartao.contato_telefone) && (
                      <p className="mt-1 truncate text-xs text-white/40">
                        {cartao.contato_nome}
                        {cartao.contato_nome && cartao.contato_telefone ? " · " : ""}
                        {cartao.contato_telefone}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {cartao.origem && (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-white/40">{cartao.origem}</span>
                      )}
                      {cartao.prioridade !== "normal" && (
                        <span className={PRIORIDADE_COR[cartao.prioridade]}>{cartao.prioridade}</span>
                      )}
                      {cartao.vence_em && (
                        <span className="flex items-center gap-1 text-white/40">
                          <Clock className="h-3 w-3" />
                          {new Date(cartao.vence_em).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {novoEm === coluna.id ? (
                <div className="mt-2">
                  <textarea
                    autoFocus
                    value={novoTitulo}
                    onChange={(e) => setNovoTitulo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void adicionarCartao(coluna.id);
                      }
                      if (e.key === "Escape") {
                        setNovoEm(null);
                        setNovoTitulo("");
                      }
                    }}
                    placeholder={ehFunil ? "Nome do contato" : "O que precisa ser feito"}
                    rows={2}
                    className={`${campoCls} resize-none`}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => void adicionarCartao(coluna.id)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                    >
                      Adicionar
                    </button>
                    <button
                      onClick={() => {
                        setNovoEm(null);
                        setNovoTitulo("");
                      }}
                      className="text-white/40 hover:text-white"
                      aria-label="Cancelar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setNovoEm(coluna.id);
                    setNovoTitulo("");
                  }}
                  className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-white/40 hover:bg-white/5 hover:text-white"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar {rotuloCartao}
                </button>
              )}
            </div>
          );
        })}

        {/* nova etapa */}
        {criandoColuna ? (
          <div
            className="w-72 shrink-0 rounded-2xl border border-primary/30 p-3"
            style={{ backgroundColor: "#151515" }}
          >
            <input
              autoFocus
              placeholder="Nome da etapa"
              onKeyDown={(e) => {
                if (e.key === "Enter") void criarColuna((e.target as HTMLInputElement).value);
                if (e.key === "Escape") setCriandoColuna(false);
              }}
              className={campoCls}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={(e) => {
                  const input = (e.currentTarget.parentElement?.previousElementSibling as HTMLInputElement) || null;
                  if (input) void criarColuna(input.value);
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                Criar
              </button>
              <button onClick={() => setCriandoColuna(false)} className="text-white/40 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCriandoColuna(true)}
            className="flex h-12 w-56 shrink-0 items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 text-xs text-white/40 hover:border-white/25 hover:text-white"
          >
            <Plus className="h-4 w-4" /> Nova etapa
          </button>
        )}
      </div>

      {aberto && (
        <DetalheCartao
          cartao={aberto}
          colunas={colunas}
          ehFunil={ehFunil}
          partnerId={partnerId}
          onFechar={() => setAberto(null)}
          onArquivar={() => void arquivar(aberto.id)}
          onSalvo={(c) => {
            setCartoes((p) => p.map((x) => (x.id === c.id ? c : x)));
            setAberto(c);
          }}
        />
      )}

      {importando && (
        <ImportarContatos
          quadroId={quadroId}
          onFechar={() => setImportando(false)}
          onPronto={() => {
            setImportando(false);
            void carregar();
          }}
        />
      )}
    </>
  );
}

const ROTULO_ATIVIDADE: Record<string, string> = {
  comentario: "Comentário",
  mudanca_coluna: "Mudou de etapa",
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  visita: "Visita",
  tarefa: "Tarefa",
  sistema: "Sistema",
};

function DetalheCartao({
  cartao, colunas, ehFunil, partnerId, onFechar, onArquivar, onSalvo,
}: {
  cartao: Cartao;
  colunas: Coluna[];
  ehFunil: boolean;
  partnerId?: string;
  onFechar: () => void;
  onArquivar: () => void;
  onSalvo: (c: Cartao) => void;
}) {
  const [form, setForm] = useState<Cartao>(cartao);
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [comentario, setComentario] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [mandando, setMandando] = useState(false);
  const mandarMensagem = useServerFn(enviarMensagemDireta);

  useEffect(() => setForm(cartao), [cartao]);

  const carregarAtividades = useCallback(async () => {
    const { data } = await db
      .from("crm_atividades").select("*").eq("cartao_id", cartao.id)
      .order("created_at", { ascending: false });
    setAtividades((data || []) as Atividade[]);
  }, [cartao.id]);

  useEffect(() => { void carregarAtividades(); }, [carregarAtividades]);

  async function salvar() {
    setSalvando(true);
    const { error } = await db.from("crm_cartoes").update({
      titulo: form.titulo,
      descricao: form.descricao,
      contato_nome: form.contato_nome,
      contato_telefone: form.contato_telefone,
      contato_email: form.contato_email,
      origem: form.origem,
      prioridade: form.prioridade,
      coluna_id: form.coluna_id,
    }).eq("id", cartao.id);
    setSalvando(false);
    if (error) { toast.error("Não deu para salvar"); return; }
    toast.success("Salvo");
    onSalvo(form);
    void carregarAtividades();
  }

  async function registrar(tipo: string) {
    const corpo = comentario.trim();
    if (!corpo && tipo === "comentario") return;
    const { error } = await db.from("crm_atividades").insert({ cartao_id: cartao.id, tipo, corpo: corpo || null });
    if (error) { toast.error("Não deu para registrar"); return; }
    setComentario("");
    void carregarAtividades();
  }

  const nomeColuna = (id: string | null) => colunas.find((c) => c.id === id)?.nome || "—";
  const zap = (form.contato_telefone || "").replace(/\D/g, "");

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/70 p-4 sm:p-8 overscroll-contain modal-safe items-start sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-2xl rounded-2xl border border-white/10" style={{ backgroundColor: "#1A1A1A" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-white/5 p-5">
          <input
            value={form.titulo}
            onChange={(e) => setForm({ ...form, titulo: e.target.value })}
            className="mr-4 w-full bg-transparent text-lg font-bold text-white focus:outline-none"
          />
          <button onClick={onFechar} className="shrink-0 text-white/40 hover:text-white" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-white/50">Etapa</label>
            <select value={form.coluna_id} onChange={(e) => setForm({ ...form, coluna_id: e.target.value })} className={campoCls}>
              {colunas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Prioridade</label>
            <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Cartao["prioridade"] })} className={campoCls}>
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </div>

          {ehFunil && (
            <>
              <div>
                <label className="mb-1 block text-xs text-white/50">Nome do contato</label>
                <input value={form.contato_nome || ""} onChange={(e) => setForm({ ...form, contato_nome: e.target.value })} className={campoCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">Telefone</label>
                <input value={form.contato_telefone || ""} onChange={(e) => setForm({ ...form, contato_telefone: e.target.value })} className={campoCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">E-mail</label>
                <input value={form.contato_email || ""} onChange={(e) => setForm({ ...form, contato_email: e.target.value })} className={campoCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">Origem</label>
                <input value={form.origem || ""} onChange={(e) => setForm({ ...form, origem: e.target.value })} placeholder="instagram, indicação, whatsapp…" className={campoCls} />
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-white/50">Observações</label>
            <textarea rows={3} value={form.descricao || ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className={`${campoCls} resize-none`} />
          </div>
        </div>

        {/*
          Mandar mensagem sem sair do sistema.

          O botão "Abrir WhatsApp" continua embaixo, mas ele leva para fora: a
          recepção perde o cartão de vista, procura a conversa de novo no
          WhatsApp Web, e o que foi combinado ali não fica registrado em lugar
          nenhum. Por aqui a mensagem entra na mesma fila do resto — com o
          mesmo "digitando" — e a conversa fica amarrada a este cartão.
        */}
        {partnerId && zap.length >= 10 && (
          <div className="border-t border-white/5 px-5 py-4">
            <label className="mb-1 block text-xs text-white/50">
              Mandar mensagem para {form.contato_nome || form.titulo}
            </label>
            <textarea
              rows={3}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Escreva aqui. Sai pelo WhatsApp da academia."
              className={`${campoCls} resize-none`}
            />
            <button
              type="button"
              disabled={!mensagem.trim() || mandando}
              onClick={() => {
                setMandando(true);
                void mandarMensagem({ data: {
                  partnerId,
                  telefone: form.contato_telefone || "",
                  nome: form.contato_nome || form.titulo,
                  cartaoId: cartao.id,
                  texto: mensagem,
                } })
                  .then(() => {
                    setMensagem("");
                    toast.success("Na fila. O conector manda em segundos.");
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Não deu para mandar."))
                  .finally(() => setMandando(false));
              }}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {mandando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Mandar pelo sistema
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-5 py-4">
          <button onClick={() => void salvar()} disabled={salvando} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </button>
          {ehFunil && zap.length >= 10 && (
            <a href={`https://wa.me/${zap.startsWith("55") ? zap : "55" + zap}`} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/5">
              <Phone className="h-4 w-4" /> Abrir WhatsApp
            </a>
          )}
          <button onClick={onArquivar} className="ml-auto inline-flex items-center gap-2 text-sm text-white/40 hover:text-red-400">
            <Trash2 className="h-4 w-4" /> Arquivar
          </button>
        </div>

        <div className="border-t border-white/5 p-5">
          <p className="mb-3 text-sm font-medium text-white">Histórico</p>
          <textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="O que aconteceu nesse contato?" className={`${campoCls} resize-none`} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => void registrar("comentario")} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15">Comentar</button>
            <button onClick={() => void registrar("ligacao")} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"><Phone className="h-3 w-3" /> Liguei</button>
            <button onClick={() => void registrar("whatsapp")} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"><Mail className="h-3 w-3" /> Mandei WhatsApp</button>
            <button onClick={() => void registrar("visita")} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"><Check className="h-3 w-3" /> Veio na academia</button>
          </div>
          <div className="mt-5 space-y-3">
            {!atividades.length && <p className="text-xs text-white/30">Nada registrado ainda.</p>}
            {atividades.map((a) => (
              <div key={a.id} className="flex gap-3 text-xs">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-white/20" />
                <div className="min-w-0">
                  <p className="text-white/70">
                    {ROTULO_ATIVIDADE[a.tipo] || a.tipo}
                    {a.tipo === "mudanca_coluna" && (
                      <span className="text-white/40"> : {nomeColuna(a.de_coluna_id)} <ArrowRight className="inline h-3 w-3" /> {nomeColuna(a.para_coluna_id)}</span>
                    )}
                  </p>
                  {a.corpo && <p className="mt-0.5 text-white/50">{a.corpo}</p>}
                  <p className="mt-0.5 text-white/25">{new Date(a.created_at).toLocaleString("pt-BR")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Importa uma lista de contatos: cola do WhatsApp/planilha ou arquivo CSV. */
function ImportarContatos({ quadroId, onFechar, onPronto }: { quadroId: string; onFechar: () => void; onPronto: () => void }) {
  const [texto, setTexto] = useState("");
  const [origem, setOrigem] = useState("importacao");
  const [enviando, setEnviando] = useState(false);

  // aceita: "nome, telefone, email" por linha, com ; , ou TAB como separador
  const contatos = useMemo(() => {
    return texto
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((linha) => {
        const partes = linha.split(/[;\t,]/).map((p) => p.trim());
        const eTelefone = (s: string) => (s || "").replace(/\D/g, "").length >= 8;
        const nome = partes.find((p) => p && !eTelefone(p) && !p.includes("@")) || "";
        const telefone = partes.find((p) => eTelefone(p)) || "";
        const email = partes.find((p) => p.includes("@")) || "";
        return { nome, telefone, email };
      })
      .filter((c) => c.nome || c.telefone);
  }, [texto]);

  async function importar() {
    if (!contatos.length) { toast.error("Nada para importar"); return; }
    setEnviando(true);
    const { data, error } = await db.rpc("crm_importar_contatos", {
      _quadro_id: quadroId,
      _contatos: contatos,
      _origem: origem.trim() || "importacao",
    });
    setEnviando(false);
    if (error) { toast.error(error.message || "Falhou a importação"); return; }
    const r = Array.isArray(data) ? data[0] : data;
    toast.success(`${r?.criados ?? 0} adicionados · ${r?.ignorados ?? 0} ignorados (repetidos ou vazios)`);
    onPronto();
  }

  async function lerArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setTexto(await f.text());
    e.target.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/70 p-4 sm:p-8 overscroll-contain modal-safe items-start sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10" style={{ backgroundColor: "#1A1A1A" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 p-5">
          <h3 className="text-lg font-bold text-white">Importar contatos</h3>
          <button onClick={onFechar} className="text-white/40 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">
          <label className="mb-1 block text-xs text-white/50">Cole a lista (uma pessoa por linha)</label>
          <textarea
            rows={8}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={"Joana Silva, 65 99999-0001, joana@email.com\nCarlos Souza; 65999990002\nMarina 65 99999-0003"}
            className={`${campoCls} resize-none font-mono text-xs`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5">
              Escolher arquivo CSV
              <input type="file" accept=".csv,.txt" hidden onChange={lerArquivo} />
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50">Origem</span>
              <input value={origem} onChange={(e) => setOrigem(e.target.value)} className="w-36 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none" />
            </div>
          </div>

          <p className="mt-3 text-xs text-white/40">
            {contatos.length
              ? `${contatos.length} contato${contatos.length === 1 ? "" : "s"} reconhecido${contatos.length === 1 ? "" : "s"}. Telefones repetidos neste funil são ignorados.`
              : "Nome, telefone e e-mail são identificados sozinhos, em qualquer ordem."}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => void importar()} disabled={enviando || !contatos.length}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />} Importar {contatos.length || ""}
            </button>
            <button onClick={onFechar} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white">Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

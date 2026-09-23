import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Loader2, Plus, ArrowLeft, KanbanSquare, Filter, Trello } from "lucide-react";
import { toast } from "sonner";
import { CrmBoard, type TipoQuadro } from "@/components/crm/CrmBoard";
import {
  listCrmTargets, criarQuadroCrm, alternarCrm, renomearQuadroCrm,
  type CrmTarget, type CrmQuadro,
} from "@/lib/admin-crm.functions";

export const Route = createFileRoute("/_authenticated/admin/crm")({
  component: AdminCrm,
});

type Aba = "parceiros" | "profissionais";

function AdminCrm() {
  const [dados, setDados] = useState<{ parceiros: CrmTarget[]; profissionais: CrmTarget[] } | null>(null);
  const [aba, setAba] = useState<Aba>("parceiros");
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ quadro: CrmQuadro; dono: string } | null>(null);
  const [criandoEm, setCriandoEm] = useState<CrmTarget | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await listCrmTargets());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível carregar");
    }
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const lista = useMemo(() => {
    const base = (aba === "parceiros" ? dados?.parceiros : dados?.profissionais) ?? [];
    const t = busca.trim().toLowerCase();
    if (!t) return base;
    return base.filter((x) => [x.nome, x.subtitulo].filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [dados, aba, busca]);

  const totais = useMemo(() => {
    const todos = [...(dados?.parceiros ?? []), ...(dados?.profissionais ?? [])];
    const quadros = todos.flatMap((t) => t.quadros);
    return {
      donos: todos.filter((t) => t.quadros.some((q) => !q.arquivadoEm)).length,
      funis: quadros.filter((q) => q.tipo === "funil" && !q.arquivadoEm).length,
      trello: quadros.filter((q) => q.tipo === "quadro" && !q.arquivadoEm).length,
      leads: quadros.reduce((s, q) => s + q.cartoes, 0),
    };
  }, [dados]);

  async function criar(alvo: CrmTarget, nome: string, tipo: TipoQuadro) {
    setOcupado(alvo.id);
    try {
      await criarQuadroCrm({ data: { escopo: alvo.escopo, ownerId: alvo.id, nome, tipo } });
      toast.success(`${tipo === "funil" ? "Funil" : "Quadro"} criado para ${alvo.nome}`);
      setCriandoEm(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para criar");
    }
    setOcupado(null);
  }

  async function alternar(q: CrmQuadro) {
    setOcupado(q.id);
    try {
      await alternarCrm({ data: { quadroId: q.id, ativar: !!q.arquivadoEm } });
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para mudar o estado");
    }
    setOcupado(null);
  }

  async function renomear(q: CrmQuadro) {
    const nome = window.prompt("Novo nome", q.nome);
    if (!nome || nome === q.nome) return;
    try {
      await renomearQuadroCrm({ data: { quadroId: q.id, nome } });
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para renomear");
    }
  }

  // ---- quadro aberto ----
  if (aberto) {
    return (
      <>
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => setAberto(null)} className="rounded-xl border border-white/10 p-2 text-white/60 hover:text-white" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-white">{aberto.quadro.nome}</h1>
            <p className="text-sm text-white/50">
              {aberto.dono} · {aberto.quadro.tipo === "funil" ? "funil de vendas" : "quadro de tarefas"}
            </p>
          </div>
        </div>
        <CrmBoard quadroId={aberto.quadro.id} tipo={aberto.quadro.tipo} />
      </>
    );
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">CRM</h1>
        <p className="text-sm text-white/50">Escolha quem recebe funis e quadros, e acompanhe os leads</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { r: "Com CRM ativo", v: totais.donos, i: KanbanSquare },
          { r: "Funis de vendas", v: totais.funis, i: Filter },
          { r: "Quadros de tarefas", v: totais.trello, i: Trello },
          { r: "Cartões no total", v: totais.leads, i: Plus },
        ].map((c) => (
          <div key={c.r} className="rounded-2xl border border-white/5 p-5" style={{ backgroundColor: "#1A1A1A" }}>
            <div className="mb-3 flex items-start justify-between">
              <p className="text-xs text-white/50">{c.r}</p>
              <c.i className="h-5 w-5 text-primary" />
            </div>
            <p className="text-2xl font-bold text-white">{carregando ? "—" : c.v}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["parceiros", "profissionais"] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`rounded-xl px-4 py-2 text-sm ${aba === a ? "bg-primary text-white" : "border border-white/10 text-white/60 hover:text-white"}`}
          >
            {a === "parceiros" ? "Academias e parceiros" : "Profissionais"}
          </button>
        ))}
        <div className="relative ml-auto min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, cidade ou ramo"
            className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5" style={{ backgroundColor: "#1A1A1A" }}>
        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-12 text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : !lista.length ? (
          <p className="py-12 text-center text-sm text-white/40">Nenhum resultado.</p>
        ) : (
          lista.map((alvo) => (
            <div key={`${alvo.escopo}-${alvo.id}`} className="border-b border-white/5 p-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{alvo.nome}</p>
                  <p className="truncate text-xs text-white/40">{alvo.subtitulo || "sem detalhes"}</p>
                </div>
                <button
                  onClick={() => setCriandoEm(criandoEm?.id === alvo.id ? null : alvo)}
                  disabled={ocupado === alvo.id}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {ocupado === alvo.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Novo
                </button>
              </div>

              {criandoEm?.id === alvo.id && (
                <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
                  <button onClick={() => void criar(alvo, `Funil — ${alvo.nome}`, "funil")}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5">
                    <Filter className="h-3.5 w-3.5" /> Funil de vendas
                  </button>
                  <button onClick={() => void criar(alvo, `Tarefas — ${alvo.nome}`, "quadro")}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5">
                    <Trello className="h-3.5 w-3.5" /> Quadro de tarefas
                  </button>
                  <span className="self-center text-xs text-white/30">
                    o funil vem com as etapas de venda; o quadro vem com a fazer / fazendo / feito
                  </span>
                </div>
              )}

              {alvo.quadros.length > 0 && (
                <div className="mt-3 space-y-2">
                  {alvo.quadros.map((q) => {
                    const ativo = !q.arquivadoEm;
                    return (
                      <div key={q.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                        {q.tipo === "funil" ? <Filter className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Trello className="h-3.5 w-3.5 shrink-0 text-white/40" />}
                        <button onClick={() => void renomear(q)} className="min-w-0 truncate text-sm text-white hover:text-primary" title="Clique para renomear">
                          {q.nome}
                        </button>
                        <span className="shrink-0 text-xs text-white/30">{q.cartoes} cartões</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ativo ? "bg-emerald-400/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
                          {ativo ? "ativo" : "desativado"}
                        </span>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                          <button onClick={() => setAberto({ quadro: q, dono: alvo.nome })}
                            className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:bg-white/5">
                            Abrir
                          </button>
                          <button onClick={() => void alternar(q)} disabled={ocupado === q.id}
                            className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white disabled:opacity-50">
                            {ativo ? "Desativar" : "Reativar"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <p className="mt-4 text-xs text-white/30">
        Cada dono pode ter quantos funis e quadros quiser. O dono entra direto; para liberar um
        funcionário, inclua a permissão <code className="text-white/50">crm</code> no cadastro da equipe dele.
      </p>
    </>
  );
}

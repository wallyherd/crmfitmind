import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Loader2, Megaphone, MessageCircle, Search, X } from "lucide-react";
import {
  criarCampanhaDaColuna,
  obterFunilComCampanhas,
  pessoasDoFunil,
  type ColunaComCampanhas,
  type PessoaDoFunil,
  type RecorteFunil,
} from "@/lib/academia-teste.functions";
import { alvosDoFunil } from "@/lib/bot-disparos.functions";
import { CaixaDeMensagem } from "@/components/partner/PessoasDoRelatorio";

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");

const ROTULO_RECORTE: Record<RecorteFunil, string> = {
  todos: "todos da etapa",
  alcancados: "já receberam campanha",
  so_automatico: "só o aviso automático",
  nunca: "nunca receberam nada",
  sem_telefone: "sem telefone",
};

// O ponto ao lado da coluna do funil. Sai da paleta do painel, e não de cores
// soltas: é a mesma tinta que a tarja de estado usa em toda a academia.
const PONTO_TIPO: Record<string, string> = {
  ganho: "bg-aca-ok",
  perdido: "bg-aca-critico",
  normal: "bg-aca-neutro",
};

/**
 * A lista por trás de um número desta tela.
 *
 * Mesmo princípio da lista do relatório: contagem que esconde gente vira botão.
 * "18 nunca receberam nada" não é trabalho enquanto ninguém puder ver quem são
 * e falar com eles sem sair daqui.
 */
function ListaDoFunil({
  partnerId, coluna, colunaId, recorte, aoFechar,
}: {
  partnerId: string;
  coluna: string;
  colunaId: string;
  recorte: RecorteFunil;
  aoFechar: () => void;
}) {
  const obter = useServerFn(pessoasDoFunil);
  const [pessoas, setPessoas] = useState<PessoaDoFunil[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [escrevendoPara, setEscrevendoPara] = useState<PessoaDoFunil | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    obter({ data: { partnerId, colunaId, recorte } })
      .then((r) => { if (vivo) setPessoas(r.pessoas); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Não consegui carregar a lista."))
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [partnerId, colunaId, recorte]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return pessoas;
    return pessoas.filter((p) =>
      p.nome.toLowerCase().includes(t) || (p.telefone ?? "").includes(t));
  }, [pessoas, busca]);

  return (
    <div
      className="painel-academia fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${coluna} — ${ROTULO_RECORTE[recorte]}`}
      onClick={aoFechar}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-aca-line bg-aca-surface sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-aca-line p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-aca-ink">{coluna}</p>
            <p className="text-[11px] text-aca-muted">
              {carregando ? "carregando…" : `${pessoas.length} · ${ROTULO_RECORTE[recorte]}`}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-aca-muted hover:bg-aca-line hover:text-aca-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {pessoas.length > 8 && (
          <div className="relative border-b border-aca-line p-2">
            <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-aca-fraco" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar por nome ou telefone"
              className="w-full rounded-lg border border-aca-line bg-aca-alto py-1.5 pl-8 pr-2 text-sm text-aca-ink placeholder:text-aca-fraco"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {carregando ? (
            <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-aca-acao" />
          ) : visiveis.length === 0 ? (
            <p className="py-10 text-center text-sm text-aca-muted">
              {pessoas.length === 0 ? "Ninguém nesta situação." : "Ninguém com esse nome."}
            </p>
          ) : (
            <div className="space-y-1">
              {visiveis.map((p) => (
                <div
                  key={p.cartao_id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-aca-alto px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-aca-ink">{p.nome}</p>
                    <p className="truncate text-[11px] text-aca-muted">
                      {p.campanhas === 0
                        ? (p.telefone ? "nunca recebeu campanha" : "sem telefone")
                        : (
                          <>
                            {p.ultima_automatica && <Bot className="mr-1 inline h-3 w-3 text-aca-fraco" />}
                            {p.ultima_campanha} · {dia(p.ultima_campanha_em)}
                            {p.campanhas > 1 && ` · ${p.campanhas} campanhas`}
                          </>
                        )}
                    </p>
                  </div>
                  {p.telefone ? (
                    <button
                      type="button"
                      onClick={() => setEscrevendoPara(p)}
                      aria-label={`Mandar mensagem para ${p.nome}`}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-aca-alto px-2 py-1 text-[11px] font-bold text-aca-ok hover:bg-aca-line"
                    >
                      <MessageCircle className="h-3 w-3" /> Mensagem
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] text-aca-fraco">sem telefone</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {escrevendoPara && (
        <CaixaDeMensagem
          partnerId={partnerId}
          pessoa={escrevendoPara}
          aoFechar={() => setEscrevendoPara(null)}
        />
      )}
    </div>
  );
}

/**
 * Campanha nascida de uma coluna do funil.
 *
 * O caminho todo acontece aqui: a campanha é criada e a lista de contatos vem
 * da própria coluna, sem passar pela aba Robô para montar nada. O envio continua
 * lá — é onde estão o limite diário do chip e o espaçamento entre mensagens.
 */
function NovaCampanhaDaColuna({
  partnerId, quadroId, coluna, aoFechar, aoCriar,
}: {
  partnerId: string;
  quadroId: string;
  coluna: ColunaComCampanhas;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const criar = useServerFn(criarCampanhaDaColuna);
  const puxar = useServerFn(alvosDoFunil);
  const [nome, setNome] = useState(
    `${coluna.coluna} — ${new Date().toLocaleDateString("pt-BR")}`,
  );
  const [mensagem, setMensagem] = useState("");
  const [intervalo, setIntervalo] = useState("20");
  const [ocupado, setOcupado] = useState(false);

  const enviaveis = coluna.pessoas - coluna.sem_telefone;

  const confirmar = async () => {
    setOcupado(true);
    let criada: { id: string; nome: string } | null = null;
    try {
      criada = await criar({
        data: { partnerId, nome, mensagem, intervaloSegundos: Number(intervalo) || 20 },
      });
      const r = await puxar({
        data: { disparoId: criada.id, quadroId, colunaId: coluna.coluna_id },
      });
      toast.success(
        `${r.adicionados} contato(s) em "${criada.nome}". Ela ficou em rascunho na aba Robô — é lá que você dispara.`,
      );
      aoCriar();
      aoFechar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui criar a campanha.";
      // Se a campanha nasceu e só a lista falhou, ela existe e está vazia: dizer
      // isso evita a pessoa criar outra por cima achando que nada aconteceu.
      toast.error(criada ? `${msg} A campanha "${criada.nome}" ficou vazia na aba Robô.` : msg);
      setOcupado(false);
    }
  };

  return (
    <div
      className="painel-academia fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Nova campanha para ${coluna.coluna}`}
      onClick={aoFechar}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-aca-line bg-aca-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-aca-ink">Campanha para “{coluna.coluna}”</p>
            <p className="text-[11px] text-aca-muted">
              {enviaveis} contato(s) com telefone nesta etapa
              {coluna.sem_telefone > 0 && ` · ${coluna.sem_telefone} sem telefone ficam de fora`}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1 text-aca-muted hover:bg-aca-line"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome da campanha"
            className="w-full rounded-xl border border-aca-line bg-aca-alto px-3 py-2 text-sm text-aca-ink placeholder:text-aca-fraco"
          />
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-xl border border-aca-line bg-aca-alto px-3 py-2 text-sm text-aca-ink placeholder:text-aca-fraco"
            placeholder="Oi {nome}! …"
          />
          <p className="text-[10px] text-aca-fraco">
            <span className="font-mono text-aca-muted">{"{nome}"}</span> vira o primeiro nome da pessoa.
          </p>
          <label className="flex flex-wrap items-center gap-2 text-[11px] text-aca-muted">
            Uma mensagem a cada
            <input
              type="number"
              min={5}
              max={600}
              value={intervalo}
              onChange={(e) => setIntervalo(e.target.value)}
              className="w-20 rounded-lg border border-aca-line bg-aca-alto px-2 py-1 text-sm text-aca-ink"
            />
            segundos
            {Number(intervalo) < 15 && (
              <span className="text-aca-atencao">— abaixo de 15s o WhatsApp costuma reclamar</span>
            )}
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] text-aca-fraco">Nasce em rascunho. Nada sai agora.</span>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={ocupado || !nome.trim() || !mensagem.trim() || enviaveis === 0}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-aca-acao px-3 py-2 text-xs font-bold text-aca-acao-ink disabled:opacity-50"
          >
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
            Criar com os contatos da etapa
          </button>
        </div>
      </div>
    </div>
  );
}

function Numero({
  valor, rotulo, cor, aoAbrir,
}: {
  valor: number;
  rotulo: string;
  cor: string;
  aoAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      disabled={valor === 0}
      className="flex-1 rounded-xl bg-aca-alto px-2 py-2 text-left transition enabled:hover:bg-aca-line disabled:opacity-40"
    >
      <p className={`text-lg font-bold ${cor}`}>{valor}</p>
      <p className="text-[10px] leading-tight text-aca-muted">{rotulo}</p>
    </button>
  );
}

/**
 * Funil e campanha num lugar só.
 *
 * A etapa do funil vive no CRM e o histórico de envio vive no Robô, então
 * "quantos desta etapa ainda não receberam nada" custava duas abas e uma
 * conferência manual de telefones. Aqui as duas metades chegam juntas, e cada
 * contagem abre a lista de quem ela representa.
 */
export function FunilComCampanhas({ partnerId }: { partnerId: string }) {
  const obter = useServerFn(obterFunilComCampanhas);
  const [carregando, setCarregando] = useState(true);
  const [quadros, setQuadros] = useState<Array<{ id: string; nome: string }>>([]);
  const [quadroId, setQuadroId] = useState<string | null>(null);
  const [colunas, setColunas] = useState<ColunaComCampanhas[]>([]);
  const [lista, setLista] = useState<{ coluna: ColunaComCampanhas; recorte: RecorteFunil } | null>(null);
  const [novaCampanha, setNovaCampanha] = useState<ColunaComCampanhas | null>(null);

  const carregar = useCallback(async (qId?: string | null) => {
    setCarregando(true);
    try {
      const r = await obter({ data: { partnerId, quadroId: qId ?? null } });
      setQuadros(r.quadros);
      setQuadroId(r.quadroId);
      setColunas(r.colunas);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui carregar o funil.");
    } finally {
      setCarregando(false);
    }
  }, [partnerId]);

  useEffect(() => { void carregar(null); }, [carregar]);

  const totais = useMemo(() => ({
    pessoas: colunas.reduce((s, c) => s + c.pessoas, 0),
    nunca: colunas.reduce((s, c) => s + c.nunca, 0),
  }), [colunas]);

  if (carregando) return <Loader2 className="mx-auto mt-8 h-6 w-6 animate-spin text-aca-acao" />;

  if (!quadroId) {
    return (
      <p className="rounded-xl border border-aca-atencao bg-aca-alto p-3 text-[11px] text-aca-atencao">
        Esta unidade ainda não tem funil no CRM. Crie um na aba CRM e volte aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-aca-line bg-aca-alto p-3">
        <p className="flex items-center gap-2 text-sm font-bold text-aca-ink">
          <Megaphone className="h-4 w-4 text-aca-acao" /> Funis de envio
        </p>
        <p className="text-[11px] text-aca-muted">
          Cada etapa do funil com o que já saiu de campanha para ela.{" "}
          {totais.nunca > 0 && (
            <strong className="text-aca-ink">
              {totais.nunca} de {totais.pessoas} nunca receberam nenhuma mensagem.
            </strong>
          )}
        </p>
      </div>

      {quadros.length > 1 && (
        <select
          value={quadroId}
          onChange={(e) => void carregar(e.target.value)}
          className="w-full rounded-xl border border-aca-line bg-aca-alto px-3 py-2 text-sm text-aca-ink"
        >
          {quadros.map((q) => <option key={q.id} value={q.id}>{q.nome}</option>)}
        </select>
      )}

      {colunas.map((c) => (
        <div key={c.coluna_id} className="rounded-2xl border border-aca-line bg-aca-alto p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold text-aca-ink">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PONTO_TIPO[c.tipo] ?? PONTO_TIPO.normal}`} />
                <span className="truncate">{c.coluna}</span>
              </p>
              <button
                type="button"
                onClick={() => setLista({ coluna: c, recorte: "todos" })}
                disabled={c.pessoas === 0}
                className="text-[11px] text-aca-muted underline-offset-2 enabled:hover:text-aca-ink enabled:hover:underline disabled:opacity-60"
              >
                {c.pessoas} pessoa(s) nesta etapa
              </button>
            </div>
            <button
              type="button"
              onClick={() => setNovaCampanha(c)}
              disabled={c.pessoas - c.sem_telefone === 0}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-aca-acao px-2.5 py-1.5 text-[11px] font-bold text-aca-acao-ink disabled:opacity-40"
            >
              <Megaphone className="h-3.5 w-3.5" /> Campanha
            </button>
          </div>

          {c.pessoas > 0 && (
            <>
              {/* Os três somam o total da etapa: quem tem telefone recebeu ou não,
                  e quem não tem telefone nunca teve chance. */}
              <div className="mt-2 flex gap-2">
                <Numero
                  valor={c.alcancados}
                  rotulo="já receberam"
                  cor="text-aca-ok"
                  aoAbrir={() => setLista({ coluna: c, recorte: "alcancados" })}
                />
                <Numero
                  valor={c.nunca}
                  rotulo="nunca receberam"
                  cor="text-aca-atencao"
                  aoAbrir={() => setLista({ coluna: c, recorte: "nunca" })}
                />
                <Numero
                  valor={c.sem_telefone}
                  rotulo="sem telefone"
                  cor="text-aca-muted"
                  aoAbrir={() => setLista({ coluna: c, recorte: "sem_telefone" })}
                />
              </div>

              {c.so_automatico > 0 && (
                <button
                  type="button"
                  onClick={() => setLista({ coluna: c, recorte: "so_automatico" })}
                  className="mt-1.5 flex items-center gap-1 text-[11px] text-aca-muted underline-offset-2 hover:text-aca-ink hover:underline"
                >
                  <Bot className="h-3 w-3" />
                  {c.so_automatico} receberam só o aviso automático
                </button>
              )}

              <p className="mt-1.5 truncate text-[11px] text-aca-fraco">
                {c.ultima_campanha
                  ? <>Última: <span className="text-aca-muted">{c.ultima_campanha}</span> · {dia(c.ultima_campanha_em)}</>
                  : "Nenhuma campanha saiu para esta etapa."}
              </p>
            </>
          )}
        </div>
      ))}

      {lista && (
        <ListaDoFunil
          partnerId={partnerId}
          coluna={lista.coluna.coluna}
          colunaId={lista.coluna.coluna_id}
          recorte={lista.recorte}
          aoFechar={() => setLista(null)}
        />
      )}

      {novaCampanha && (
        <NovaCampanhaDaColuna
          partnerId={partnerId}
          quadroId={quadroId}
          coluna={novaCampanha}
          aoFechar={() => setNovaCampanha(null)}
          aoCriar={() => void carregar(quadroId)}
        />
      )}
    </div>
  );
}

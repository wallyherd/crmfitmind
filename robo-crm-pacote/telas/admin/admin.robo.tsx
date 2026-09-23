import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Loader2, Plus, Bot, MessageSquare, Send, Copy, Check,
  Wifi, WifiOff, QrCode, AlertTriangle, RefreshCw, Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  listBotAlvos, criarBotConexao, verSegredoConexao, alternarBotConexao,
  enviarTesteBot, listarConversasBot,
  type BotAlvo, type BotConexao,
} from "@/lib/admin-robo.functions";

export const Route = createFileRoute("/_authenticated/admin/robo")({
  component: AdminRobo,
});

const SELO: Record<BotConexao["status"], { txt: string; cls: string; Icon: typeof Wifi }> = {
  conectado: { txt: "conectado", cls: "bg-emerald-400/10 text-emerald-400", Icon: Wifi },
  aguardando_qr: { txt: "aguardando QR", cls: "bg-amber-400/10 text-amber-400", Icon: QrCode },
  desconectado: { txt: "desconectado", cls: "bg-white/5 text-white/40", Icon: WifiOff },
  erro: { txt: "com erro", cls: "bg-red-400/10 text-red-400", Icon: AlertTriangle },
};

const campoCls =
  "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none";

function AdminRobo() {
  const [alvos, setAlvos] = useState<BotAlvo[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [credenciais, setCredenciais] = useState<{ id: string; segredo: string; nome: string } | null>(null);
  const [testando, setTestando] = useState<BotConexao | null>(null);
  const [caixa, setCaixa] = useState<{ conexao: BotConexao; conversas: any[] } | null>(null);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      const r = await listBotAlvos();
      setAlvos(r.parceiros);
    } catch (e) {
      if (!silencioso) toast.error(e instanceof Error ? e.message : "Não foi possível carregar");
    }
    if (!silencioso) setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  // enquanto a página estiver aberta, atualiza o estado das conexões sozinho
  useEffect(() => {
    const t = setInterval(() => void carregar(true), 8000);
    return () => clearInterval(t);
  }, [carregar]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return alvos;
    return alvos.filter((a) => [a.nome, a.subtitulo].filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [alvos, busca]);

  const totais = useMemo(() => {
    const cx = alvos.flatMap((a) => a.conexoes);
    return {
      conexoes: cx.filter((c) => !c.arquivadoEm).length,
      online: cx.filter((c) => c.status === "conectado" && !c.arquivadoEm).length,
      conversas: cx.reduce((s, c) => s + c.conversas, 0),
      fila: cx.reduce((s, c) => s + c.naFila, 0),
    };
  }, [alvos]);

  async function criar(alvo: BotAlvo) {
    setOcupado(alvo.id);
    try {
      const r = await criarBotConexao({ data: { escopo: alvo.escopo, ownerId: alvo.id, nome: `WhatsApp — ${alvo.nome}` } });
      setCredenciais({ id: r.conexaoId, segredo: r.segredo, nome: alvo.nome });
      await carregar(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para criar");
    }
    setOcupado(null);
  }

  async function verSegredo(c: BotConexao, nome: string) {
    try {
      const r = await verSegredoConexao({ data: { conexaoId: c.id } });
      setCredenciais({ id: c.id, segredo: r.segredo, nome });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para ler");
    }
  }

  async function alternar(c: BotConexao) {
    setOcupado(c.id);
    try {
      await alternarBotConexao({ data: { conexaoId: c.id, ativar: !!c.arquivadoEm } });
      await carregar(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para mudar");
    }
    setOcupado(null);
  }

  async function abrirCaixa(c: BotConexao) {
    try {
      const r = await listarConversasBot({ data: { conexaoId: c.id } });
      setCaixa({ conexao: c, conversas: r.conversas });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para carregar");
    }
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Robô de WhatsApp</h1>
        <p className="text-sm text-white/50">Conecte o número de cada academia e acompanhe as conversas</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { r: "Conexões ativas", v: totais.conexoes, i: Bot },
          { r: "Online agora", v: totais.online, i: Wifi },
          { r: "Conversas", v: totais.conversas, i: MessageSquare },
          { r: "Esperando envio", v: totais.fila, i: Send },
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

      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar academia" className={`${campoCls} pl-10 py-2.5`} />
        </div>
        <button onClick={() => void carregar()} className="rounded-xl border border-white/10 p-2.5 text-white/60 hover:text-white" title="Atualizar">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5" style={{ backgroundColor: "#1A1A1A" }}>
        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-12 text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : !lista.length ? (
          <p className="py-12 text-center text-sm text-white/40">Nenhuma academia encontrada.</p>
        ) : (
          lista.map((alvo) => (
            <div key={alvo.id} className="border-b border-white/5 p-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{alvo.nome}</p>
                  <p className="truncate text-xs text-white/40">{alvo.subtitulo || "sem detalhes"}</p>
                </div>
                <button onClick={() => void criar(alvo)} disabled={ocupado === alvo.id}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                  {ocupado === alvo.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Conectar número
                </button>
              </div>

              {alvo.conexoes.length > 0 && (
                <div className="mt-3 space-y-2">
                  {alvo.conexoes.map((c) => {
                    const selo = SELO[c.status];
                    const ativo = !c.arquivadoEm;
                    const vistoHa = c.vistoEm ? Math.round((Date.now() - new Date(c.vistoEm).getTime()) / 60000) : null;
                    return (
                      <div key={c.id} className="rounded-xl border border-white/5 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <selo.Icon className={`h-3.5 w-3.5 shrink-0 ${c.status === "conectado" ? "text-emerald-400" : "text-white/40"}`} />
                          <span className="min-w-0 truncate text-sm text-white">{c.nome}</span>
                          {c.numero && <span className="shrink-0 font-mono text-xs text-white/40">{c.numero}</span>}
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ativo ? selo.cls : "bg-white/5 text-white/40"}`}>
                            {ativo ? selo.txt : "desativada"}
                          </span>
                          {c.naFila > 0 && (
                            <span className="shrink-0 rounded-full bg-amber-400/10 px-2 py-0.5 text-xs text-amber-400">
                              {c.naFila} na fila
                            </span>
                          )}
                        </div>

                        {c.statusDetalhe && <p className="mt-1 text-xs text-white/40">{c.statusDetalhe}</p>}
                        <p className="mt-1 text-xs text-white/25">
                          {c.conversas} conversa{c.conversas === 1 ? "" : "s"}
                          {vistoHa !== null && ` · PC visto ${vistoHa < 2 ? "agora" : `há ${vistoHa} min`}`}
                          {vistoHa === null && " · o conector ainda não se apresentou"}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button onClick={() => void verSegredo(c, alvo.nome)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:bg-white/5">
                            <Eye className="h-3 w-3" /> Dados do conector
                          </button>
                          <button onClick={() => setTestando(c)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:bg-white/5">
                            <Send className="h-3 w-3" /> Enviar teste
                          </button>
                          <button onClick={() => void abrirCaixa(c)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:bg-white/5">
                            <MessageSquare className="h-3 w-3" /> Conversas
                          </button>
                          <button onClick={() => void alternar(c)} disabled={ocupado === c.id}
                            className="ml-auto rounded-lg border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white disabled:opacity-50">
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
        O conector roda no PC da academia e busca o que precisa enviar — a nuvem não alcança aquele
        computador. Depois de conectar, use <span className="text-white/50">Dados do conector</span> para
        pegar o identificador e o segredo.
      </p>

      {credenciais && <ModalCredenciais dados={credenciais} onFechar={() => setCredenciais(null)} />}
      {testando && <ModalTeste conexao={testando} onFechar={() => setTestando(null)} onEnviado={() => void carregar(true)} />}
      {caixa && <ModalConversas caixa={caixa} onFechar={() => setCaixa(null)} />}
    </>
  );
}

/** Mostra endereço, identificador e segredo para colar no conector do PC. */
function ModalCredenciais({ dados, onFechar }: { dados: { id: string; segredo: string; nome: string }; onFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const base = typeof window !== "undefined" ? window.location.origin : "";

  async function copiar(texto: string, qual: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 1800);
    } catch {
      toast.error("Não consegui copiar — selecione e copie na mão");
    }
  }

  const campos = [
    { rotulo: "Endereço da FitMind", valor: base, qual: "base" },
    { rotulo: "Identificador da conexão", valor: dados.id, qual: "id" },
    { rotulo: "Segredo", valor: dados.segredo, qual: "segredo" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/70 p-4 sm:p-8 overscroll-contain modal-safe items-start sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10" style={{ backgroundColor: "#1A1A1A" }} onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/5 p-5">
          <h3 className="text-lg font-bold text-white">Dados do conector</h3>
          <p className="text-sm text-white/50">{dados.nome}</p>
        </div>
        <div className="space-y-3 p-5">
          {campos.map((c) => (
            <div key={c.qual}>
              <label className="mb-1 block text-xs text-white/50">{c.rotulo}</label>
              <div className="flex items-center gap-2">
                <input readOnly value={c.valor} className={`${campoCls} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
                <button onClick={() => void copiar(c.valor, c.qual)}
                  className="shrink-0 rounded-xl border border-white/10 p-2.5 text-white/60 hover:text-white" title="Copiar">
                  {copiado === c.qual ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/50">
            <p className="mb-2 font-medium text-white/70">No PC da academia:</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>Abra a pasta do conector e dê dois cliques em <span className="font-mono text-white/70">iniciar.bat</span></li>
              <li>Cole os três campos acima no painel e clique em Salvar</li>
              <li>Clique em Testar ligação — a luz da nuvem tem que ficar verde</li>
              <li>Leia o QR com o WhatsApp do número da academia</li>
            </ol>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
            O segredo dá acesso a enviar e ler mensagens desta conexão. Não mande por grupo de
            WhatsApp nem por e-mail — cole direto no conector pelo AnyDesk.
          </div>

          <button onClick={onFechar} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Enfileira uma mensagem de teste — é o botão que prova a ponta a ponta. */
function ModalTeste({ conexao, onFechar, onEnviado }: { conexao: BotConexao; onFechar: () => void; onEnviado: () => void }) {
  const [telefone, setTelefone] = useState("");
  const [corpo, setCorpo] = useState("Teste do robô da FitMind. Se você recebeu isto, está funcionando.");
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    const limpo = telefone.replace(/\D/g, "");
    if (limpo.length < 10) { toast.error("Telefone incompleto — use DDD + número"); return; }
    setEnviando(true);
    try {
      await enviarTesteBot({ data: { conexaoId: conexao.id, telefone: limpo, corpo } });
      toast.success("Na fila. O conector vai enviar em alguns segundos.");
      onEnviado();
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para enfileirar");
    }
    setEnviando(false);
  }

  const offline = conexao.status !== "conectado";

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/70 p-4 sm:p-8 overscroll-contain modal-safe items-start sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-md rounded-2xl border border-white/10" style={{ backgroundColor: "#1A1A1A" }} onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/5 p-5">
          <h3 className="text-lg font-bold text-white">Enviar mensagem de teste</h3>
          <p className="text-sm text-white/50">{conexao.nome}</p>
        </div>
        <div className="space-y-3 p-5">
          {offline && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
              Esta conexão não está conectada agora. A mensagem fica na fila e sai assim que o
              conector voltar — não se perde.
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-white/50">Telefone com DDD</label>
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="65 99999-0000" className={campoCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Mensagem</label>
            <textarea rows={3} value={corpo} onChange={(e) => setCorpo(e.target.value)} className={`${campoCls} resize-none`} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void enviar()} disabled={enviando}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Colocar na fila
            </button>
            <button onClick={onFechar} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Caixa de entrada simples: as últimas conversas daquele número. */
function ModalConversas({ caixa, onFechar }: { caixa: { conexao: BotConexao; conversas: any[] }; onFechar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/70 p-4 sm:p-8 overscroll-contain modal-safe items-start sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-xl rounded-2xl border border-white/10" style={{ backgroundColor: "#1A1A1A" }} onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/5 p-5">
          <h3 className="text-lg font-bold text-white">Conversas</h3>
          <p className="text-sm text-white/50">{caixa.conexao.nome}</p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!caixa.conversas.length ? (
            <p className="p-8 text-center text-sm text-white/40">
              Nenhuma conversa ainda. Assim que alguém mandar mensagem para o número da academia, ela aparece aqui.
            </p>
          ) : (
            caixa.conversas.map((c) => (
              <div key={c.id} className="border-b border-white/5 p-4 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{c.nome || "sem nome"}</span>
                  <span className="font-mono text-xs text-white/40">{c.telefone}</span>
                  <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    c.estado === "humano" ? "bg-amber-400/10 text-amber-400" :
                    c.estado === "encerrada" ? "bg-white/5 text-white/40" : "bg-emerald-400/10 text-emerald-400"
                  }`}>
                    {c.estado === "humano" ? "com atendente" : c.estado === "encerrada" ? "encerrada" : "robô"}
                  </span>
                </div>
                {c.ultimaMensagem && (
                  <p className="mt-1 truncate text-xs text-white/50">
                    <span className="text-white/30">{c.ultimaDirecao === "saida" ? "nós:" : "cliente:"}</span> {c.ultimaMensagem}
                    {c.ultimaDirecao === "saida" && c.ultimoStatus === "pendente" && (
                      <span className="ml-2 text-amber-400">esperando envio</span>
                    )}
                  </p>
                )}
                {c.ultima_mensagem_em && (
                  <p className="mt-0.5 text-xs text-white/25">{new Date(c.ultima_mensagem_em).toLocaleString("pt-BR")}</p>
                )}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-white/5 p-4">
          <button onClick={onFechar} className="w-full rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

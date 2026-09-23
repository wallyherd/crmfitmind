import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  alvosDoFunil, alvosColados, alvosDaAcademia, resumoDisparo, dispararCampanha, cancelarCampanha,
} from "@/lib/bot-disparos.functions";
import { toast } from "sonner";
import {
  Bot, MessageSquare, Send, Plus, Loader2, Wifi, WifiOff, QrCode, AlertTriangle,
  Copy, Check, Trash2, Play, Pause, ChevronRight, Megaphone, Smartphone, RefreshCw,
} from "lucide-react";

// as tabelas bot_* ainda não estão no types.ts gerado
const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

const campo =
  "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none";
const cartao = "rounded-2xl border border-white/5";

type Aba = "numeros" | "atendimento" | "conversas" | "disparos";

interface Conexao {
  id: string; nome: string; numero: string | null; status: string;
  status_detalhe: string | null; visto_em: string | null; arquivado_em: string | null;
  webhook_segredo: string; prioridade: number; limite_diario: number | null;
  enviadas_hoje: number; contador_dia: string | null;
  bloqueado_em: string | null; bloqueado_motivo: string | null;
}

interface Fluxo {
  id: string; nome: string; ativo: boolean; gatilho_tipo: string;
  gatilho_valor: string | null; passo_inicial_id: string | null;
}

interface Passo {
  id: string; fluxo_id: string; chave: string; tipo: string;
  conteudo: string | null; posicao: number; proximo_passo_id: string | null;
}

interface Opcao {
  id: string; passo_id: string; rotulo: string; gatilho: string;
  proximo_passo_id: string | null; posicao: number;
}

const SELO: Record<string, { txt: string; cls: string }> = {
  conectado: { txt: "conectado", cls: "bg-emerald-400/10 text-emerald-400" },
  aguardando_qr: { txt: "aguardando QR", cls: "bg-amber-400/10 text-amber-400" },
  desconectado: { txt: "desconectado", cls: "bg-white/5 text-white/40" },
  erro: { txt: "com erro", cls: "bg-red-400/10 text-red-400" },
};

const TIPO_PASSO: Record<string, string> = {
  mensagem: "Só fala e segue",
  pergunta: "Pergunta e espera resposta",
  acao: "Executa algo",
  transferir: "Passa para atendente",
  encerrar: "Encerra a conversa",
};

export function PartnerRoboPanel({ partnerId }: { partnerId: string }) {
  const [aba, setAba] = useState<Aba>("numeros");
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregarConexoes = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    const { data, error } = await db
      .from("bot_conexoes").select("*")
      .eq("escopo", "parceiro").eq("owner_id", partnerId)
      .order("prioridade");
    if (error && !silencioso) toast.error("Não foi possível carregar os números");
    setConexoes((data || []) as Conexao[]);
    if (!silencioso) setCarregando(false);
  }, [partnerId]);

  useEffect(() => { void carregarConexoes(); }, [carregarConexoes]);
  useEffect(() => {
    const t = setInterval(() => void carregarConexoes(true), 10000);
    return () => clearInterval(t);
  }, [carregarConexoes]);

  const online = conexoes.filter((c) => c.status === "conectado" && !c.arquivado_em).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Robô de WhatsApp</h2>
        <p className="text-sm text-white/50">
          Atenda quem chama no WhatsApp da academia sem estar online — e vire lead no funil sozinho
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { k: "numeros", r: "Números", i: Smartphone },
          { k: "atendimento", r: "Atendimento automático", i: Bot },
          { k: "conversas", r: "Conversas", i: MessageSquare },
          { k: "disparos", r: "Disparos", i: Megaphone },
        ] as const).map((x) => (
          <button
            key={x.k}
            onClick={() => setAba(x.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${
              aba === x.k ? "bg-primary text-white" : "border border-white/10 text-white/60 hover:text-white"
            }`}
          >
            <x.i className="h-4 w-4" /> {x.r}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-white/30">
          {online} de {conexoes.filter((c) => !c.arquivado_em).length} número{conexoes.length === 1 ? "" : "s"} online
        </span>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-12 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          {aba === "numeros" && (
            <AbaNumeros partnerId={partnerId} conexoes={conexoes} recarregar={() => void carregarConexoes()} />
          )}
          {aba === "atendimento" && <AbaAtendimento partnerId={partnerId} />}
          {aba === "conversas" && <AbaConversas conexoes={conexoes} />}
          {aba === "disparos" && <AbaDisparos partnerId={partnerId} temNumero={online > 0} />}
        </>
      )}
    </div>
  );
}

/* ============================================================
   NÚMEROS — conectar celulares e ver quem está de pé
   ============================================================ */
function AbaNumeros({
  partnerId, conexoes, recarregar,
}: { partnerId: string; conexoes: Conexao[]; recarregar: () => void }) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [credenciais, setCredenciais] = useState<Conexao | null>(null);

  async function criar() {
    const n = nome.trim() || `WhatsApp ${conexoes.length + 1}`;
    setCriando(true);
    // prioridade cresce: o primeiro cadastrado é o principal, os outros são reserva
    const prioridade = (conexoes.length + 1) * 10;
    const { data, error } = await db
      .from("bot_conexoes")
      .insert({ escopo: "parceiro", owner_id: partnerId, nome: n, prioridade, limite_diario: 300 })
      .select("*").single();
    setCriando(false);
    if (error) { toast.error("Não deu para criar o número"); return; }
    setNome("");
    setCredenciais(data as Conexao);
    recarregar();
  }

  async function alternar(c: Conexao) {
    const { error } = await db.from("bot_conexoes")
      .update({ arquivado_em: c.arquivado_em ? null : new Date().toISOString() })
      .eq("id", c.id);
    if (error) { toast.error("Não deu para mudar"); return; }
    recarregar();
  }

  async function desbloquear(c: Conexao) {
    const { error } = await db.from("bot_conexoes")
      .update({ bloqueado_em: null, bloqueado_motivo: null, status: "desconectado" })
      .eq("id", c.id);
    if (error) { toast.error("Não deu para desbloquear"); return; }
    toast.success("Número liberado. Leia o QR de novo no conector.");
    recarregar();
  }

  async function mudarLimite(c: Conexao, limite: number | null) {
    await db.from("bot_conexoes").update({ limite_diario: limite }).eq("id", c.id);
    recarregar();
  }

  return (
    <div className="space-y-4">
      <div className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
        <p className="text-sm text-white/70">
          Cadastre mais de um número. Se um for bloqueado pelo WhatsApp, o robô passa a usar o
          próximo sozinho — sem ninguém precisar mexer.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder="Apelido do número (ex.: recepção)"
            className={`${campo} max-w-xs`}
          />
          <button onClick={() => void criar()} disabled={criando}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Conectar número
          </button>
        </div>
      </div>

      {!conexoes.length && (
        <div className={`${cartao} p-8 text-center`} style={{ backgroundColor: "#1A1A1A" }}>
          <Bot className="mx-auto h-8 w-8 text-white/20" />
          <p className="mt-3 text-sm text-white">Nenhum número conectado ainda</p>
          <p className="mt-1 text-sm text-white/50">Cadastre o primeiro acima para começar.</p>
        </div>
      )}

      {conexoes.map((c) => {
        const selo = SELO[c.status] ?? SELO.erro;
        const ativo = !c.arquivado_em;
        const vistoHa = c.visto_em ? Math.round((Date.now() - new Date(c.visto_em).getTime()) / 60000) : null;
        const usadoHoje = c.contador_dia === new Date().toISOString().slice(0, 10) ? c.enviadas_hoje : 0;
        return (
          <div key={c.id} className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
            <div className="flex flex-wrap items-center gap-2">
              {c.status === "conectado" ? <Wifi className="h-4 w-4 text-emerald-400" />
                : c.status === "aguardando_qr" ? <QrCode className="h-4 w-4 text-amber-400" />
                : <WifiOff className="h-4 w-4 text-white/40" />}
              <span className="text-sm font-medium text-white">{c.nome}</span>
              {c.numero && <span className="font-mono text-xs text-white/40">{c.numero}</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs ${ativo ? selo.cls : "bg-white/5 text-white/40"}`}>
                {ativo ? selo.txt : "desativado"}
              </span>
              {c.bloqueado_em && (
                <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs text-red-400">bloqueado</span>
              )}
              <span className="ml-auto text-xs text-white/30">ordem {c.prioridade}</span>
            </div>

            {c.bloqueado_motivo && (
              <p className="mt-2 text-xs text-red-400/80">{c.bloqueado_motivo}</p>
            )}
            {c.status_detalhe && !c.bloqueado_em && (
              <p className="mt-2 text-xs text-white/40">{c.status_detalhe}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-white/40">
              <span>
                {usadoHoje}{c.limite_diario ? ` de ${c.limite_diario}` : ""} enviadas hoje
              </span>
              <span>
                {vistoHa === null ? "o conector ainda não se apresentou"
                  : vistoHa < 2 ? "conector online agora" : `conector visto há ${vistoHa} min`}
              </span>
              <label className="flex items-center gap-2">
                limite por dia
                <input
                  type="number" min={0}
                  defaultValue={c.limite_diario ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    void mudarLimite(c, v === "" ? null : Math.max(0, Number(v)));
                  }}
                  className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setCredenciais(c)}
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:bg-white/5">
                Dados do conector
              </button>
              {c.bloqueado_em && (
                <button onClick={() => void desbloquear(c)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1 text-xs text-amber-300 hover:bg-white/5">
                  <RefreshCw className="h-3 w-3" /> Usar de novo
                </button>
              )}
              <button onClick={() => void alternar(c)}
                className="ml-auto rounded-lg border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white">
                {ativo ? "Desativar" : "Reativar"}
              </button>
            </div>
          </div>
        );
      })}

      {credenciais && <ModalCredenciais conexao={credenciais} onFechar={() => setCredenciais(null)} />}
    </div>
  );
}

function ModalCredenciais({ conexao, onFechar }: { conexao: Conexao; onFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const campos = [
    { r: "Endereço da FitMind", v: base, k: "base" },
    { r: "Identificador da conexão", v: conexao.id, k: "id" },
    { r: "Segredo", v: conexao.webhook_segredo, k: "seg" },
  ];
  async function copiar(t: string, k: string) {
    try { await navigator.clipboard.writeText(t); setCopiado(k); setTimeout(() => setCopiado(null), 1800); }
    catch { toast.error("Selecione e copie na mão"); }
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/70 p-4 sm:p-8 overscroll-contain modal-safe items-start sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10" style={{ backgroundColor: "#1A1A1A" }} onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/5 p-5">
          <h3 className="text-lg font-bold text-white">Dados do conector</h3>
          <p className="text-sm text-white/50">{conexao.nome}</p>
        </div>
        <div className="space-y-3 p-5">
          {campos.map((c) => (
            <div key={c.k}>
              <label className="mb-1 block text-xs text-white/50">{c.r}</label>
              <div className="flex items-center gap-2">
                <input readOnly value={c.v} onFocus={(e) => e.currentTarget.select()} className={`${campo} font-mono text-xs`} />
                <button onClick={() => void copiar(c.v, c.k)} className="shrink-0 rounded-xl border border-white/10 p-2.5 text-white/60 hover:text-white">
                  {copiado === c.k ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/50">
            <p className="mb-2 font-medium text-white/70">No computador da academia:</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>Abra a pasta do conector e clique em <span className="font-mono text-white/70">iniciar.bat</span></li>
              <li>Cole os três campos acima e salve</li>
              <li>Leia o QR com o WhatsApp deste número</li>
            </ol>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
            O segredo dá acesso a ler e enviar mensagens deste número. Não mande por grupo nem e-mail.
          </div>
          <button onClick={onFechar} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">Fechar</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ATENDIMENTO AUTOMÁTICO — montar o que o robô fala
   ============================================================ */
function AbaAtendimento({ partnerId }: { partnerId: string }) {
  const [fluxos, setFluxos] = useState<Fluxo[]>([]);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await db.from("bot_fluxos").select("*")
      .eq("escopo", "parceiro").eq("owner_id", partnerId)
      .is("arquivado_em", null).order("created_at");
    setFluxos((data || []) as Fluxo[]);
    setCarregando(false);
  }, [partnerId]);

  useEffect(() => { void carregar(); }, [carregar]);

  /** Cria um atendimento já pronto para usar, com o menu clássico de academia. */
  async function criarPadrao() {
    const { data: f, error } = await db.from("bot_fluxos")
      .insert({ escopo: "parceiro", owner_id: partnerId, nome: "Atendimento inicial", gatilho_tipo: "primeira_mensagem", ativo: false })
      .select("*").single();
    if (error) { toast.error("Não deu para criar"); return; }
    const fluxo = f as Fluxo;

    const passos = [
      { chave: "boas_vindas", tipo: "pergunta", posicao: 1000,
        conteudo: "Oi! Que bom falar com você 😊 Como posso ajudar?" },
      { chave: "planos", tipo: "mensagem", posicao: 2000,
        conteudo: "Temos planos mensal, trimestral e anual. Quer que alguém te explique os valores?" },
      { chave: "experimental", tipo: "mensagem", posicao: 3000,
        conteudo: "Sua aula experimental é por nossa conta! Me diz um dia e horário que combina para você." },
      { chave: "horarios", tipo: "mensagem", posicao: 4000,
        conteudo: "Funcionamos de segunda a sexta das 6h às 22h, e sábado das 8h às 12h." },
      { chave: "humano", tipo: "transferir", posicao: 5000,
        conteudo: "Já vou chamar alguém da recepção para te atender. Um instante!" },
    ];
    const { data: criados, error: e2 } = await db.from("bot_passos")
      .insert(passos.map((p) => ({ ...p, fluxo_id: fluxo.id }))).select("id, chave");
    if (e2) { toast.error("Criei o atendimento, mas as etapas falharam"); void carregar(); return; }

    const porChave = new Map((criados as Array<{ id: string; chave: string }>).map((p) => [p.chave, p.id]));
    await db.from("bot_opcoes").insert([
      { passo_id: porChave.get("boas_vindas"), rotulo: "Saber os planos", gatilho: "1", proximo_passo_id: porChave.get("planos"), posicao: 1000 },
      { passo_id: porChave.get("boas_vindas"), rotulo: "Aula experimental", gatilho: "2", proximo_passo_id: porChave.get("experimental"), posicao: 2000 },
      { passo_id: porChave.get("boas_vindas"), rotulo: "Horários", gatilho: "3", proximo_passo_id: porChave.get("horarios"), posicao: 3000 },
      { passo_id: porChave.get("boas_vindas"), rotulo: "Falar com alguém", gatilho: "4", proximo_passo_id: porChave.get("humano"), posicao: 4000 },
    ]);
    await db.from("bot_fluxos").update({ passo_inicial_id: porChave.get("boas_vindas") }).eq("id", fluxo.id);

    toast.success("Atendimento criado. Revise o texto e ative quando quiser.");
    await carregar();
    setAbertoId(fluxo.id);
  }

  if (carregando) {
    return <div className="flex items-center gap-2 py-8 text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  }

  if (abertoId) {
    const f = fluxos.find((x) => x.id === abertoId);
    return f ? <EditorFluxo fluxo={f} onVoltar={() => { setAbertoId(null); void carregar(); }} /> : null;
  }

  return (
    <div className="space-y-4">
      {!fluxos.length ? (
        <div className={`${cartao} p-8 text-center`} style={{ backgroundColor: "#1A1A1A" }}>
          <Bot className="mx-auto h-8 w-8 text-white/20" />
          <p className="mt-3 text-sm text-white">Nenhum atendimento automático ainda</p>
          <p className="mt-1 text-sm text-white/50">
            Crie um pronto e ajuste os textos. Nada é enviado até você ativar.
          </p>
          <button onClick={() => void criarPadrao()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            <Plus className="h-4 w-4" /> Criar atendimento pronto
          </button>
        </div>
      ) : (
        <>
          {fluxos.map((f) => (
            <button key={f.id} onClick={() => setAbertoId(f.id)}
              className={`${cartao} flex w-full items-center gap-3 p-4 text-left hover:border-white/15`}
              style={{ backgroundColor: "#1A1A1A" }}>
              <Bot className={`h-4 w-4 ${f.ativo ? "text-emerald-400" : "text-white/30"}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{f.nome}</p>
                <p className="text-xs text-white/40">
                  {f.gatilho_tipo === "palavra_chave" ? `quando alguém escrever: ${f.gatilho_valor}` : "na primeira mensagem"}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${f.ativo ? "bg-emerald-400/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
                {f.ativo ? "ativo" : "desligado"}
              </span>
              <ChevronRight className="h-4 w-4 text-white/30" />
            </button>
          ))}
          <button onClick={() => void criarPadrao()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/5">
            <Plus className="h-4 w-4" /> Novo atendimento
          </button>
        </>
      )}
    </div>
  );
}

/** Editor de um atendimento: as etapas e o que cada uma responde. */
function EditorFluxo({ fluxo, onVoltar }: { fluxo: Fluxo; onVoltar: () => void }) {
  const [passos, setPassos] = useState<Passo[]>([]);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [f, setF] = useState<Fluxo>(fluxo);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [p, o] = await Promise.all([
      db.from("bot_passos").select("*").eq("fluxo_id", fluxo.id).order("posicao"),
      db.from("bot_opcoes").select("*").order("posicao"),
    ]);
    const listaPassos = (p.data || []) as Passo[];
    setPassos(listaPassos);
    const ids = new Set(listaPassos.map((x) => x.id));
    setOpcoes(((o.data || []) as Opcao[]).filter((x) => ids.has(x.passo_id)));
  }, [fluxo.id]);

  useEffect(() => { void carregar(); }, [carregar]);

  const opcoesDe = (passoId: string) => opcoes.filter((o) => o.passo_id === passoId).sort((a, b) => a.posicao - b.posicao);
  const nomePasso = (id: string | null) => passos.find((p) => p.id === id)?.chave ?? "—";

  async function salvarFluxo(mudanca: Partial<Fluxo>) {
    setSalvando(true);
    const novo = { ...f, ...mudanca };
    setF(novo);
    const { error } = await db.from("bot_fluxos").update(mudanca).eq("id", f.id);
    setSalvando(false);
    if (error) toast.error("Não deu para salvar");
  }

  async function salvarPasso(id: string, mudanca: Partial<Passo>) {
    setPassos((ps) => ps.map((p) => (p.id === id ? { ...p, ...mudanca } : p)));
    const { error } = await db.from("bot_passos").update(mudanca).eq("id", id);
    if (error) toast.error("Não deu para salvar a etapa");
  }

  async function novoPasso() {
    const chave = `etapa_${passos.length + 1}`;
    const posicao = passos.length ? Math.max(...passos.map((p) => p.posicao)) + 1000 : 1000;
    const { data, error } = await db.from("bot_passos")
      .insert({ fluxo_id: f.id, chave, tipo: "mensagem", conteudo: "", posicao }).select("*").single();
    if (error) { toast.error("Não deu para criar a etapa"); return; }
    setPassos((ps) => [...ps, data as Passo]);
  }

  async function apagarPasso(id: string) {
    const { error } = await db.from("bot_passos").delete().eq("id", id);
    if (error) { toast.error("Não deu para apagar"); return; }
    setPassos((ps) => ps.filter((p) => p.id !== id));
    setOpcoes((os) => os.filter((o) => o.passo_id !== id));
  }

  async function novaOpcao(passoId: string) {
    const atuais = opcoesDe(passoId);
    const { data, error } = await db.from("bot_opcoes").insert({
      passo_id: passoId, rotulo: "Nova opção", gatilho: String(atuais.length + 1),
      posicao: (atuais.length + 1) * 1000,
    }).select("*").single();
    if (error) { toast.error("Não deu para criar a opção"); return; }
    setOpcoes((os) => [...os, data as Opcao]);
  }

  async function salvarOpcao(id: string, mudanca: Partial<Opcao>) {
    setOpcoes((os) => os.map((o) => (o.id === id ? { ...o, ...mudanca } : o)));
    const { error } = await db.from("bot_opcoes").update(mudanca).eq("id", id);
    if (error) toast.error("Não deu para salvar a opção");
  }

  async function apagarOpcao(id: string) {
    await db.from("bot_opcoes").delete().eq("id", id);
    setOpcoes((os) => os.filter((o) => o.id !== id));
  }

  const semInicial = !f.passo_inicial_id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onVoltar} className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white">
          Voltar
        </button>
        <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })}
          onBlur={() => void salvarFluxo({ nome: f.nome })}
          className="min-w-0 flex-1 bg-transparent text-lg font-bold text-white focus:outline-none" />
        {salvando && <Loader2 className="h-4 w-4 animate-spin text-white/40" />}
        <button
          onClick={() => void salvarFluxo({ ativo: !f.ativo })}
          disabled={semInicial && !f.ativo}
          title={semInicial ? "Escolha a etapa de início antes de ativar" : ""}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40 ${
            f.ativo ? "border border-white/10 text-white/70 hover:bg-white/5" : "bg-emerald-600 text-white hover:opacity-90"
          }`}>
          {f.ativo ? <><Pause className="h-4 w-4" /> Desligar</> : <><Play className="h-4 w-4" /> Ativar</>}
        </button>
      </div>

      <div className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-white/50">Quando o robô entra</label>
            <select value={f.gatilho_tipo} onChange={(e) => void salvarFluxo({ gatilho_tipo: e.target.value })} className={campo}>
              <option value="primeira_mensagem">Assim que a pessoa manda a primeira mensagem</option>
              <option value="palavra_chave">Só quando escrever certas palavras</option>
            </select>
          </div>
          {f.gatilho_tipo === "palavra_chave" && (
            <div>
              <label className="mb-1 block text-xs text-white/50">Palavras (separadas por vírgula)</label>
              <input value={f.gatilho_valor ?? ""} onChange={(e) => setF({ ...f, gatilho_valor: e.target.value })}
                onBlur={() => void salvarFluxo({ gatilho_valor: f.gatilho_valor })}
                placeholder="plano, valor, matrícula" className={campo} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-white/50">Etapa de início</label>
            <select value={f.passo_inicial_id ?? ""} onChange={(e) => void salvarFluxo({ passo_inicial_id: e.target.value || null })} className={campo}>
              <option value="">— escolha —</option>
              {passos.map((p) => <option key={p.id} value={p.id}>{p.chave}</option>)}
            </select>
          </div>
        </div>
        {semInicial && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Escolha por qual etapa a conversa começa. Sem isso o robô não pode ser ativado.
          </div>
        )}
      </div>

      {passos.map((p) => (
        <div key={p.id} className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
          <div className="flex flex-wrap items-center gap-2">
            <input value={p.chave} onChange={(e) => setPassos((ps) => ps.map((x) => x.id === p.id ? { ...x, chave: e.target.value } : x))}
              onBlur={() => void salvarPasso(p.id, { chave: p.chave })}
              className="w-40 rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-white focus:outline-none" />
            <select value={p.tipo} onChange={(e) => void salvarPasso(p.id, { tipo: e.target.value })}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none">
              {Object.entries(TIPO_PASSO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {f.passo_inicial_id === p.id && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">início</span>
            )}
            <button onClick={() => void apagarPasso(p.id)} className="ml-auto text-white/30 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <textarea rows={2} value={p.conteudo ?? ""}
            onChange={(e) => setPassos((ps) => ps.map((x) => x.id === p.id ? { ...x, conteudo: e.target.value } : x))}
            onBlur={() => void salvarPasso(p.id, { conteudo: p.conteudo })}
            placeholder="O que o robô fala nesta etapa"
            className={`${campo} mt-3 resize-none`} />

          {p.tipo === "pergunta" ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-white/50">Opções que a pessoa pode escolher</p>
              {opcoesDe(p.id).map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2">
                  <input value={o.gatilho} onChange={(e) => setOpcoes((os) => os.map((x) => x.id === o.id ? { ...x, gatilho: e.target.value } : x))}
                    onBlur={() => void salvarOpcao(o.id, { gatilho: o.gatilho })}
                    className="w-14 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-center text-xs text-white focus:outline-none" />
                  <input value={o.rotulo} onChange={(e) => setOpcoes((os) => os.map((x) => x.id === o.id ? { ...x, rotulo: e.target.value } : x))}
                    onBlur={() => void salvarOpcao(o.id, { rotulo: o.rotulo })}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none" />
                  <span className="text-xs text-white/30">leva para</span>
                  <select value={o.proximo_passo_id ?? ""} onChange={(e) => void salvarOpcao(o.id, { proximo_passo_id: e.target.value || null })}
                    className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none">
                    <option value="">— fim —</option>
                    {passos.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.chave}</option>)}
                  </select>
                  <button onClick={() => void apagarOpcao(o.id)} className="text-white/30 hover:text-red-400">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button onClick={() => void novaOpcao(p.id)} className="text-xs text-white/40 hover:text-white">
                + adicionar opção
              </button>
            </div>
          ) : p.tipo === "mensagem" ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
              depois vai para
              <select value={p.proximo_passo_id ?? ""} onChange={(e) => void salvarPasso(p.id, { proximo_passo_id: e.target.value || null })}
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none">
                <option value="">— encerra —</option>
                {passos.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.chave}</option>)}
              </select>
            </div>
          ) : null}
        </div>
      ))}

      <button onClick={() => void novoPasso()}
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-2 text-sm text-white/50 hover:border-white/30 hover:text-white">
        <Plus className="h-4 w-4" /> Nova etapa
      </button>
    </div>
  );
}

/* ============================================================
   CONVERSAS — quem falou, e assumir quando quiser
   ============================================================ */
function AbaConversas({ conexoes }: { conexoes: Conexao[] }) {
  const [conversas, setConversas] = useState<any[]>([]);
  const [aberta, setAberta] = useState<any | null>(null);
  const [mensagens, setMensagens] = useState<any[]>([]);
  const [resposta, setResposta] = useState("");
  const [carregando, setCarregando] = useState(true);
  // Em que etapa do funil esta quem esta falando. Sem isto, responder e as
  // cegas: a mesma frase serve para quem acabou de chegar e para quem ja
  // desistiu duas vezes.
  const [etapas, setEtapas] = useState<Record<string, string>>({});

  const ids = useMemo(() => conexoes.map((c) => c.id), [conexoes]);

  const carregar = useCallback(async () => {
    if (!ids.length) { setConversas([]); setCarregando(false); return; }
    const { data } = await db.from("bot_conversas")
      .select("id, telefone, nome, estado, ultima_mensagem_em, cartao_id, conexao_id")
      .in("conexao_id", ids)
      .order("ultima_mensagem_em", { ascending: false, nullsFirst: false })
      .limit(50);
    setConversas(data || []);
    setCarregando(false);

    const cartoes = (data || []).map((c: any) => c.cartao_id).filter(Boolean);
    if (!cartoes.length) { setEtapas({}); return; }
    const { data: cards } = await db.from("crm_cartoes").select("id, coluna_id").in("id", cartoes);
    const colunaIds = [...new Set((cards || []).map((c: any) => c.coluna_id).filter(Boolean))];
    if (!colunaIds.length) { setEtapas({}); return; }
    const { data: cols } = await db.from("crm_colunas").select("id, nome").in("id", colunaIds);
    const nomeDaColuna = new Map((cols || []).map((c: any) => [c.id, c.nome]));
    const mapa: Record<string, string> = {};
    for (const c of cards || []) {
      const nome = nomeDaColuna.get((c as any).coluna_id);
      if (nome) mapa[(c as any).id] = nome as string;
    }
    setEtapas(mapa);
  }, [ids]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(() => void carregar(), 8000);
    return () => clearInterval(t);
  }, [carregar]);

  const abrir = useCallback(async (c: any) => {
    setAberta(c);
    const { data } = await db.from("bot_mensagens")
      .select("id, direcao, corpo, status, created_at")
      .eq("conversa_id", c.id).order("created_at").limit(100);
    setMensagens(data || []);
  }, []);

  async function enviar() {
    const texto = resposta.trim();
    if (!texto || !aberta) return;
    const { error } = await db.from("bot_mensagens").insert({
      conversa_id: aberta.id, direcao: "saida", tipo: "texto", corpo: texto, status: "pendente",
    });
    if (error) { toast.error("Não deu para enviar"); return; }
    // quem responde assume a conversa; o robô para de interferir
    if (aberta.estado === "bot") {
      await db.from("bot_conversas").update({ estado: "humano" }).eq("id", aberta.id);
      setAberta({ ...aberta, estado: "humano" });
    }
    setResposta("");
    await abrir({ ...aberta, estado: "humano" });
    toast.success("Na fila. O conector envia em segundos.");
  }

  async function devolverAoRobo() {
    if (!aberta) return;
    await db.from("bot_conversas").update({ estado: "bot", passo_atual_id: null }).eq("id", aberta.id);
    setAberta({ ...aberta, estado: "bot" });
    void carregar();
  }

  if (carregando) {
    return <div className="flex items-center gap-2 py-8 text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  }

  if (!conversas.length) {
    return (
      <div className={`${cartao} p-8 text-center`} style={{ backgroundColor: "#1A1A1A" }}>
        <MessageSquare className="mx-auto h-8 w-8 text-white/20" />
        <p className="mt-3 text-sm text-white">Nenhuma conversa ainda</p>
        <p className="mt-1 text-sm text-white/50">
          Assim que alguém mandar mensagem para o WhatsApp da academia, aparece aqui — e vira lead no funil.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className={`${cartao} max-h-[560px] overflow-y-auto`} style={{ backgroundColor: "#1A1A1A" }}>
        {conversas.map((c) => (
          <button key={c.id} onClick={() => void abrir(c)}
            className={`w-full border-b border-white/5 p-3 text-left last:border-b-0 hover:bg-white/5 ${aberta?.id === c.id ? "bg-white/5" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-sm text-white">{c.nome || "sem nome"}</span>
              <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs ${
                c.estado === "humano" ? "bg-amber-400/10 text-amber-400"
                : c.estado === "encerrada" ? "bg-white/5 text-white/40" : "bg-emerald-400/10 text-emerald-400"}`}>
                {c.estado === "humano" ? "com você" : c.estado === "encerrada" ? "encerrada" : "robô"}
              </span>
            </div>
            <p className="font-mono text-xs text-white/40">{c.telefone}</p>
            {c.cartao_id && etapas[c.cartao_id] && (
              <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {etapas[c.cartao_id]}
              </span>
            )}
            {c.ultima_mensagem_em && (
              <p className="mt-0.5 text-xs text-white/25">{new Date(c.ultima_mensagem_em).toLocaleString("pt-BR")}</p>
            )}
          </button>
        ))}
      </div>

      <div className={`${cartao} flex flex-col`} style={{ backgroundColor: "#1A1A1A", minHeight: 400 }}>
        {!aberta ? (
          <p className="m-auto p-8 text-sm text-white/40">Escolha uma conversa ao lado</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-white/5 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{aberta.nome || aberta.telefone}</p>
                <p className="font-mono text-xs text-white/40">{aberta.telefone}</p>
              </div>
              {aberta.estado === "humano" && (
                <button onClick={() => void devolverAoRobo()}
                  className="ml-auto rounded-lg border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white">
                  Devolver ao robô
                </button>
              )}
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-4" style={{ maxHeight: 380 }}>
              {mensagens.map((m) => (
                <div key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    m.direcao === "saida" ? "bg-primary/20 text-white" : "bg-white/5 text-white"}`}>
                    <p className="whitespace-pre-wrap">{m.corpo}</p>
                    <p className="mt-1 text-xs text-white/30">
                      {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      {m.direcao === "saida" && m.status === "pendente" && " · esperando envio"}
                      {m.direcao === "saida" && m.status === "erro" && " · falhou"}
                    </p>
                  </div>
                </div>
              ))}
              {!mensagens.length && <p className="text-sm text-white/40">Sem mensagens.</p>}
            </div>

            <div className="flex gap-2 border-t border-white/5 p-3">
              <input value={resposta} onChange={(e) => setResposta(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void enviar(); }}
                placeholder="Responder…" className={campo} />
              <button onClick={() => void enviar()} className="shrink-0 rounded-xl bg-primary px-4 text-sm font-medium text-white hover:opacity-90">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   DISPAROS — avisar muita gente sem queimar o chip
   ============================================================ */
function AbaDisparos({ partnerId, temNumero }: { partnerId: string; temNumero: boolean }) {
  const [disparos, setDisparos] = useState<any[]>([]);
  const [quadros, setQuadros] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<any | null>(null);
  const [nome, setNome] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [criando, setCriando] = useState(false);
  const [intervalo, setIntervalo] = useState("20");

  const carregar = useCallback(async () => {
    const [d, q] = await Promise.all([
      db.from("bot_disparos").select("*").eq("escopo", "parceiro").eq("owner_id", partnerId)
        .order("created_at", { ascending: false }).limit(20),
      db.from("crm_quadros").select("id, nome, tipo").eq("escopo", "parceiro").eq("owner_id", partnerId)
        .eq("tipo", "funil").is("arquivado_em", null),
    ]);
    setDisparos(d.data || []);
    setQuadros(q.data || []);
    setCarregando(false);
  }, [partnerId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    if (!nome.trim() || !mensagem.trim()) { toast.error("Dê um nome e escreva a mensagem"); return; }
    setCriando(true);
    const { data, error } = await db.from("bot_disparos").insert({
      escopo: "parceiro", owner_id: partnerId, nome: nome.trim(), mensagem: mensagem.trim(),
      status: "rascunho", intervalo_segundos: Math.max(5, Number(intervalo) || 20),
    }).select("*").single();
    setCriando(false);
    if (error) { toast.error("Não deu para criar"); return; }
    setNome(""); setMensagem("");
    await carregar();
    setAberto(data);
  }

  if (carregando) {
    return <div className="flex items-center gap-2 py-8 text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  }

  if (aberto) {
    return <DetalheDisparo disparo={aberto} quadros={quadros} temNumero={temNumero}
      onVoltar={() => { setAberto(null); void carregar(); }} />;
  }

  return (
    <div className="space-y-4">
      {!temNumero && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Nenhum número conectado. Conecte um em "Números" antes de disparar.
        </div>
      )}

      <div className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
        <p className="text-sm font-medium text-white">Nova campanha</p>
        <p className="mt-1 text-xs text-white/50">
          Para avisar do desafio, lembrar da avaliação, chamar para promoção. Escreva{" "}
          <span className="font-mono text-white/70">{"{nome}"}</span> onde quiser o primeiro nome da pessoa.
        </p>
        <div className="mt-3 space-y-3">
          <input value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder="Nome da campanha (ex.: Desafio de janeiro)" className={campo} />
          <textarea rows={3} value={mensagem} onChange={(e) => setMensagem(e.target.value)}
            placeholder="Oi {nome}! Abriram as inscrições do desafio…" className={`${campo} resize-none`} />
          {/*
            O intervalo era fixo em 20s no codigo. E a protecao mais importante
            do chip e a academia nao podia nem ver, quanto mais ajustar: lista
            grande pede mais folga, aviso urgente para poucos pede menos.
          */}
          <label className="flex flex-wrap items-center gap-2 text-xs text-white/50">
            Uma mensagem a cada
            <input
              type="number" min={5} max={600}
              value={intervalo}
              onChange={(e) => setIntervalo(e.target.value)}
              className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white focus:outline-none"
            />
            segundos
            {Number(intervalo) < 15 && (
              <span className="text-amber-300">— abaixo de 15s o WhatsApp costuma reclamar</span>
            )}
          </label>
          <button onClick={() => void criar()} disabled={criando}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Criar campanha
          </button>
        </div>
      </div>

      {!disparos.length ? (
        <p className="py-6 text-center text-sm text-white/40">Nenhuma campanha ainda.</p>
      ) : disparos.map((d) => (
        <button key={d.id} onClick={() => setAberto(d)}
          className={`${cartao} flex w-full items-center gap-3 p-4 text-left hover:border-white/15`}
          style={{ backgroundColor: "#1A1A1A" }}>
          <Megaphone className="h-4 w-4 shrink-0 text-white/40" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{d.nome}</p>
            <p className="truncate text-xs text-white/40">{d.mensagem}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            d.status === "concluido" ? "bg-emerald-400/10 text-emerald-400"
            : d.status === "enviando" ? "bg-amber-400/10 text-amber-400"
            : d.status === "cancelado" ? "bg-red-400/10 text-red-400"
            : "bg-white/5 text-white/40"}`}>{d.status}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
        </button>
      ))}
    </div>
  );
}

/** Monta a lista de contatos e dispara. */
function DetalheDisparo({
  disparo, quadros, temNumero, onVoltar,
}: { disparo: any; quadros: any[]; temNumero: boolean; onVoltar: () => void }) {
  const [d, setD] = useState<any>(disparo);
  const [resumo, setResumo] = useState<any>(null);
  const [alvos, setAlvos] = useState<any[]>([]);
  const [quadroId, setQuadroId] = useState<string>(quadros[0]?.id ?? "");
  const [colado, setColado] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  const [publico, setPublico] = useState<"ativos" | "inativos" | "todos">("inativos");
  const [diasMin, setDiasMin] = useState(15);
  const [diasMax, setDiasMax] = useState(365);
  // Teto baixo de proposito: e mais facil subir depois do que desfazer envio.
  const [limite, setLimite] = useState(50);
  const puxarAcademia = useServerFn(alvosDaAcademia);
  const puxarFunil = useServerFn(alvosDoFunil);
  const puxarColados = useServerFn(alvosColados);
  const verResumo = useServerFn(resumoDisparo);
  const disparar = useServerFn(dispararCampanha);
  const cancelar = useServerFn(cancelarCampanha);

  const carregar = useCallback(async () => {
    const [r, a, atual] = await Promise.all([
      verResumo({ data: { disparoId: d.id } }).catch(() => null),
      db.from("bot_disparo_alvos").select("id, telefone, nome, status, erro").eq("disparo_id", d.id).limit(200),
      db.from("bot_disparos").select("*").eq("id", d.id).maybeSingle(),
    ]);
    setResumo(r);
    setAlvos(a.data || []);
    if (atual.data) setD(atual.data);
  }, [d.id, verResumo]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    if (d.status !== "enviando" && d.status !== "enfileirando") return;
    const t = setInterval(() => void carregar(), 10000);
    return () => clearInterval(t);
  }, [d.status, carregar]);

  const rascunho = d.status === "rascunho";

  async function acao(nome: string, fn: () => Promise<any>, msg?: (r: any) => string) {
    setOcupado(nome);
    try {
      const r = await fn();
      if (msg) toast.success(msg(r));
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu certo");
    }
    setOcupado(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onVoltar} className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white">Voltar</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-white">{d.nome}</p>
          <p className="text-xs text-white/40">
            {d.status} · uma mensagem a cada {d.intervalo_segundos}s
          </p>
        </div>
      </div>

      <div className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
        <p className="whitespace-pre-wrap text-sm text-white/70">{d.mensagem}</p>
      </div>

      {resumo && resumo.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { r: "Contatos", v: resumo.total, c: "text-white" },
            { r: "Na fila", v: resumo.enfileirado, c: "text-amber-400" },
            { r: "Enviados", v: resumo.enviado, c: "text-emerald-400" },
            { r: "Com erro", v: resumo.erro, c: "text-red-400" },
          ].map((x) => (
            <div key={x.r} className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
              <p className="text-xs text-white/50">{x.r}</p>
              <p className={`mt-1 text-xl font-bold ${x.c}`}>{x.v}</p>
            </div>
          ))}
        </div>
      )}

      {rascunho && (
        <div className={`${cartao} space-y-4 p-4`} style={{ backgroundColor: "#1A1A1A" }}>
          <p className="text-sm font-medium text-white">Para quem enviar</p>

          {quadros.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs text-white/50">Puxar os contatos de um funil</label>
                <select value={quadroId} onChange={(e) => setQuadroId(e.target.value)} className={campo}>
                  {quadros.map((q) => <option key={q.id} value={q.id}>{q.nome}</option>)}
                </select>
              </div>
              <button
                onClick={() => void acao("funil",
                  () => puxarFunil({ data: { disparoId: d.id, quadroId } }),
                  (r) => `${r.adicionados} adicionados · ${r.repetidos} já estavam na lista`)}
                disabled={!quadroId || ocupado === "funil"}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50">
                {ocupado === "funil" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Puxar do funil
              </button>
            </div>
          )}

          {/*
            Aluno de academia não é cartão de funil nem usuário da plataforma: o
            telefone dele mora na credencial do leitor. Sem esta fonte, avisar os
            alunos exigiria exportar e colar lista na mão toda vez.
          */}
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 p-3">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-xs text-white/50">Puxar alunos da academia</label>
              <select value={publico} onChange={(e) => setPublico(e.target.value as typeof publico)} className={campo}>
                <option value="ativos">Quem está em dia — para avisar de benefício, evento, novidade</option>
                <option value="inativos">Quem parou de pagar — para chamar de volta</option>
                <option value="todos">Todo mundo cadastrado no leitor</option>
              </select>
            </div>
            {publico === "inativos" && (
              <div className="w-[150px]">
                <label className="mb-1 block text-xs text-white/50">Parou há (dias)</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} max={3650} value={diasMin}
                    onChange={(e) => setDiasMin(Number(e.target.value))} className={campo} />
                  <span className="text-xs text-white/40">a</span>
                  <input type="number" min={1} max={3650} value={diasMax}
                    onChange={(e) => setDiasMax(Number(e.target.value))} className={campo} />
                </div>
              </div>
            )}
            <div className="w-[110px]">
              {/* Teto por leva: mandar para centenas de uma vez queima o chip. */}
              <label className="mb-1 block text-xs text-white/50">No máximo</label>
              <input type="number" min={1} max={500} value={limite}
                onChange={(e) => setLimite(Number(e.target.value))} className={campo} />
            </div>
            <button
              onClick={() => void acao("academia",
                () => puxarAcademia({ data: { disparoId: d.id, publico, diasMin, diasMax, limite } }),
                (r) => `${r.adicionados} adicionados · ${r.repetidos} já estavam na lista`)}
              disabled={ocupado === "academia"}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50">
              {ocupado === "academia" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Puxar da academia
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/50">Ou cole uma lista (um por linha)</label>
            <textarea rows={4} value={colado} onChange={(e) => setColado(e.target.value)}
              placeholder={"Joana, 65 99999-0001\nCarlos; 65999990002"}
              className={`${campo} resize-none font-mono text-xs`} />
            <button
              onClick={() => void acao("colado",
                () => puxarColados({ data: { disparoId: d.id, texto: colado } }),
                (r) => `${r.adicionados} adicionados · ${r.repetidos} repetidos`).then(() => setColado(""))}
              disabled={!colado.trim() || ocupado === "colado"}
              className="mt-2 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5 disabled:opacity-50">
              {ocupado === "colado" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Adicionar colados
            </button>
          </div>
        </div>
      )}

      {rascunho && resumo && resumo.total > 0 && (
        <div className={`${cartao} p-4`} style={{ backgroundColor: "#1A1A1A" }}>
          {!confirmar ? (
            <>
              <p className="text-sm text-white">
                Pronto para enviar para <b>{resumo.pendente}</b> pessoa{resumo.pendente === 1 ? "" : "s"}.
              </p>
              <p className="mt-1 text-xs text-white/50">
                Vai levar cerca de {Math.ceil((resumo.pendente * d.intervalo_segundos) / 60)} minutos —
                as mensagens saem espaçadas de propósito, porque mandar tudo de uma vez é o que faz o
                WhatsApp bloquear o número.
              </p>
              <button onClick={() => setConfirmar(true)} disabled={!temNumero}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
                <Send className="h-4 w-4" /> Disparar
              </button>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Isso envia mensagem de verdade para {resumo.pendente} pessoa{resumo.pendente === 1 ? "" : "s"} e
                não dá para desfazer o que já saiu. Confere o texto antes.
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void acao("disparar",
                    () => disparar({ data: { disparoId: d.id } }),
                    (r) => r.ficamParaDepois > 0
                      ? `${r.enfileirados} na fila · ${r.ficamParaDepois} ficaram para amanhã (limite do número)`
                      : `${r.enfileirados} na fila · leva ~${r.minutosEstimados} min`
                  ).then(() => setConfirmar(false))}
                  disabled={ocupado === "disparar"}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                  {ocupado === "disparar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Confirmar envio
                </button>
                <button onClick={() => setConfirmar(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white">Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}

      {(d.status === "enviando" || d.status === "enfileirando") && (
        <button
          onClick={() => void acao("cancelar", () => cancelar({ data: { disparoId: d.id } }),
            (r) => `${r.canceladas} mensagens tiradas da fila`)}
          disabled={ocupado === "cancelar"}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-red-400 disabled:opacity-50">
          {ocupado === "cancelar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
          Parar o que ainda não saiu
        </button>
      )}

      {alvos.length > 0 && (
        <div className={`${cartao} max-h-80 overflow-y-auto`} style={{ backgroundColor: "#1A1A1A" }}>
          {alvos.map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-b border-white/5 px-4 py-2 last:border-b-0">
              <span className="min-w-0 truncate text-sm text-white">{a.nome || "sem nome"}</span>
              <span className="font-mono text-xs text-white/40">{a.telefone}</span>
              <span className={`ml-auto shrink-0 text-xs ${
                a.status === "enviado" ? "text-emerald-400"
                : a.status === "erro" ? "text-red-400"
                : a.status === "enfileirado" ? "text-amber-400" : "text-white/30"}`}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

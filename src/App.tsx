import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Partner,
  Conexao,
  QuadroCrm,
  ColunaCrm,
  CartaoCrm,
  Conversa,
  DisparoCampanha,
  Fluxo,
  Passo,
  MeResposta,
} from "@/types";
import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";
import { MaisView } from "@/components/MaisView";
import { DashboardView } from "@/components/DashboardView";
import { CrmBoardView } from "@/components/CrmBoardView";
import { RoboView } from "@/components/RoboView";
import { ConversasView } from "@/components/ConversasView";
import { DisparosView } from "@/components/DisparosView";
import { AdminView } from "@/components/AdminView";
import { UsuariosAdminView } from "@/components/UsuariosAdminView";
import { ConectarWhatsAppView } from "@/components/ConectarWhatsAppView";
import { SettingsView } from "@/components/SettingsView";
import { MentoriaView } from "@/components/MentoriaView";
import { SemLiberacaoMentor } from "@/components/SemLiberacaoMentor";
import { VendasView } from "@/components/VendasView";
import { RelatorioDiaView } from "@/components/RelatorioDiaView";
import { OQueFazerAgora } from "@/components/OQueFazerAgora";
import { HojeView } from "@/components/HojeView";
import { InteligenciaArtificialView } from "@/components/InteligenciaArtificialView";
import { TokensIaView } from "@/components/TokensIaView";
import { LandingPageView } from "@/components/LandingPageView";
import { LoginView } from "@/components/LoginView";
import { NovaSenhaForm } from "@/components/NovaSenhaForm";
import {
  supabase,
  supabaseConfigurado,
  chegouPorLinkDeRecuperacao,
  linkDeAuthInvalido,
} from "@/lib/supabase";
import { apiJson, aoPerderAcesso, comQuery, MENSAGEM_SAIDA } from "@/lib/api";
import {
  ABAS_SO_ADMIN,
  CAMINHO_DA_ABA,
  abaDoCaminho,
  caminhoDaConversa,
  conversaDoCaminho,
  type TabType,
} from "@/lib/rotas";
import { Toaster, toast } from "sonner";
import { AtualizacaoApp } from "@/pwa/AtualizacaoApp";
import { limparCacheApi } from "@/pwa/limparCacheApi";
import { Loader2, AlertTriangle, Building2, KeyRound, LogOut, RefreshCw } from "lucide-react";

const CHAVE_EMPRESA = "crm_empresa_atual";
const AVISO_LINK_INVALIDO = "Este link de acesso é inválido ou já expirou. Peça outro em \"Esqueci a senha\".";

function lerEmpresaSalva(): string | null {
  try {
    return localStorage.getItem(CHAVE_EMPRESA);
  } catch {
    return null;
  }
}

function salvarEmpresa(id: string) {
  try {
    localStorage.setItem(CHAVE_EMPRESA, id);
  } catch {
    // preferência só deste navegador; sem storage, segue sem lembrar
  }
}

type Aviso = { texto: string; bloqueio: boolean };

// No celular a raiz abre em "Hoje"; no computador, no Dashboard.
const noCelular = () => window.matchMedia("(max-width: 767px)").matches;
const abaDaUrl = (): TabType => {
  const aba = abaDoCaminho(window.location.pathname);
  if (aba === "dashboard" && window.location.pathname === "/" && noCelular()) return "hoje";
  return aba ?? "dashboard";
};

const TelaCentral: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-[#07090e] text-slate-100 flex items-center justify-center p-6">
    <div className="max-w-md w-full glass-panel rounded-3xl p-8 border border-white/10 space-y-5 shadow-2xl">
      {children}
    </div>
  </div>
);

const TelaCarregando: React.FC<{ texto: string }> = ({ texto }) => (
  <div className="min-h-screen bg-[#07090e] flex flex-col items-center justify-center text-slate-400 space-y-3">
    <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
    <p className="text-xs font-semibold">{texto}</p>
  </div>
);

const ConfiguracaoAusente: React.FC = () => (
  <TelaCentral>
    <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
      <AlertTriangle className="w-5 h-5" /> Configuração incompleta
    </div>
    <p className="text-xs text-slate-300 leading-relaxed">
      Este build do CRM foi gerado sem as variáveis <code className="text-red-400">VITE_SUPABASE_URL</code> e{" "}
      <code className="text-red-400">VITE_SUPABASE_ANON_KEY</code>. Sem elas não é possível entrar.
    </p>
    <p className="text-xs text-slate-400 leading-relaxed">
      Quem administra o projeto precisa defini-las nas variáveis de ambiente da hospedagem (ou no{" "}
      <code>.env</code> local) e gerar o build de novo.
    </p>
  </TelaCentral>
);

export const App: React.FC = () => (supabaseConfigurado ? <AppComSupabase /> : <ConfiguracaoAusente />);

const AppComSupabase: React.FC = () => {
  // undefined = ainda lendo a sessão salva
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined);
  const [recuperandoSenha, setRecuperandoSenha] = useState(chegouPorLinkDeRecuperacao);
  const [pageMode, setPageMode] = useState<"landing" | "login">(linkDeAuthInvalido ? "login" : "landing");
  const [aviso, setAviso] = useState<Aviso | null>(
    linkDeAuthInvalido ? { texto: AVISO_LINK_INVALIDO, bloqueio: false } : null
  );

  const [me, setMe] = useState<MeResposta | null>(null);
  const [erroMe, setErroMe] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const empresaRef = useRef<string | null>(null);
  empresaRef.current = empresaId;
  // Logout pedido pelo usuário: um 401 atrasado do polling não deve virar "sessão expirada".
  const saidaManual = useRef(false);

  // A aba vem do endereço: recarregar mantém a tela e o voltar do navegador funciona.
  const [activeTab, setAbaAtiva] = useState<TabType>(abaDaUrl);
  // Em /conversas/:id a conversa aberta também vem do endereço (o voltar do Android fecha a conversa).
  const [conversaId, setConversaId] = useState<string | null>(() => conversaDoCaminho(window.location.pathname));

  const irPara = useCallback((caminho: string, substituir: boolean) => {
    if (window.location.pathname === caminho) return;
    if (substituir) window.history.replaceState(null, "", caminho);
    else window.history.pushState(null, "", caminho);
  }, []);

  const setActiveTab = useCallback(
    (aba: TabType, substituir = false) => {
      setAbaAtiva(aba);
      setConversaId(null);
      irPara(CAMINHO_DA_ABA[aba], substituir);
    },
    [irPara]
  );

  const abrirConversa = useCallback(
    (id: string | null) => {
      setAbaAtiva("conversas");
      setConversaId(id);
      irPara(caminhoDaConversa(id), false);
    },
    [irPara]
  );

  useEffect(() => {
    const aoNavegar = () => {
      setAbaAtiva(abaDaUrl());
      setConversaId(conversaDoCaminho(window.location.pathname));
    };
    window.addEventListener("popstate", aoNavegar);
    return () => window.removeEventListener("popstate", aoNavegar);
  }, []);

  const [partnersDados, setPartnersDados] = useState<Partner[]>([]);
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [fusoEmpresa, setFusoEmpresa] = useState<string | undefined>(undefined);
  const [quadros, setQuadros] = useState<QuadroCrm[]>([]);
  const [quadroAtivo, setQuadroAtivo] = useState<QuadroCrm | null>(null);
  const [colunas, setColunas] = useState<ColunaCrm[]>([]);
  const [cartoes, setCartoes] = useState<CartaoCrm[]>([]);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [campanhas, setCampanhas] = useState<DisparoCampanha[]>([]);
  const [fluxos, setFluxos] = useState<Fluxo[]>([]);
  const [passos, setPassos] = useState<Passo[]>([]);

  const limparDados = () => {
    setPartnersDados([]);
    setConexoes([]);
    setQuadros([]);
    setQuadroAtivo(null);
    setColunas([]);
    setCartoes([]);
    setConversas([]);
    setCampanhas([]);
    setFluxos([]);
    setPassos([]);
  };

  // O portão do app é a sessão do Supabase Auth.
  useEffect(() => {
    let ativo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSessao(data.session);
      if (chegouPorLinkDeRecuperacao && !data.session) {
        setRecuperandoSenha(false);
        setAviso({ texto: AVISO_LINK_INVALIDO, bloqueio: false });
        setPageMode("login");
      }
      if (linkDeAuthInvalido) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      if (evento === "PASSWORD_RECOVERY") setRecuperandoSenha(true);
      setSessao(novaSessao);
    });

    const pararDeOuvir = aoPerderAcesso((motivo) => {
      if (saidaManual.current) return;
      setAviso({ texto: MENSAGEM_SAIDA[motivo], bloqueio: motivo !== "sessao_expirada" });
      setPageMode("login");
    });

    return () => {
      ativo = false;
      subscription.unsubscribe();
      pararDeOuvir();
    };
  }, []);

  const userId = sessao?.user?.id || null;

  const carregarMe = useCallback(async () => {
    setErroMe(null);
    try {
      const dados = await apiJson<MeResposta>("/api/me");
      const empresas = dados.partners || [];
      setMe({ ...dados, partners: empresas });
      setEmpresaId((atual) => {
        const ids = empresas.map((p) => p.id);
        if (atual && ids.includes(atual)) return atual;
        const salva = lerEmpresaSalva();
        if (salva && ids.includes(salva)) return salva;
        return ids[0] || null;
      });
    } catch (err: any) {
      setErroMe(err?.message || "Não foi possível carregar sua conta.");
    }
  }, []);

  useEffect(() => {
    setMe(null);
    setErroMe(null);
    setEmpresaId(null);
    limparDados();
    if (userId) {
      saidaManual.current = false;
      setAviso(null);
      carregarMe();
    }
  }, [userId, carregarMe]);

  const carregarDados = async () => {
    const pedidoPara = empresaRef.current;
    if (!pedidoPara) return;
    try {
      const json = await apiJson<any>(
        comQuery("/api/data", { partnerId: pedidoPara, quadroId: quadroAtivo?.id })
      );
      // Troca de empresa no meio do caminho: descarta a resposta da anterior.
      if (empresaRef.current !== pedidoPara) return;

      setPartnersDados((json.partners as Partner[]) || []);
      setConexoes((json.conexoes as Conexao[]) || []);
      setFusoEmpresa(typeof json.fuso === "string" ? json.fuso : undefined);
      const listaQuadros = (json.quadros as QuadroCrm[]) || [];
      setQuadros(listaQuadros);
      if (!quadroAtivo && listaQuadros[0]) setQuadroAtivo(listaQuadros[0]);
      setColunas((json.colunas as ColunaCrm[]) || []);
      setCartoes((json.cartoes as CartaoCrm[]) || []);
      setConversas((json.conversas as Conversa[]) || []);
      setCampanhas((json.campanhas as DisparoCampanha[]) || []);
      setFluxos((json.fluxos as Fluxo[]) || []);
      setPassos((json.passos as Passo[]) || []);
    } catch (err: any) {
      console.warn("Erro ao carregar dados:", err?.message);
    }
  };

  // Link direto para tela de admin por quem não é admin: volta ao Dashboard.
  useEffect(() => {
    if (me && !me.isAdmin && ABAS_SO_ADMIN.includes(activeTab)) setActiveTab("dashboard", true);
  }, [me, activeTab, setActiveTab]);

  useEffect(() => {
    if (!me || !empresaId) return;
    carregarDados();
    const interval = setInterval(carregarDados, 5000);
    return () => clearInterval(interval);
  }, [me, empresaId, quadroAtivo?.id]);

  const selecionarEmpresa = (id: string) => {
    if (id === empresaId) return;
    salvarEmpresa(id);
    limparDados();
    setEmpresaId(id);
  };

  const recarregarTudo = async () => {
    await carregarMe();
    await carregarDados();
  };

  const handleLogout = async () => {
    saidaManual.current = true;
    await limparCacheApi();
    await supabase.auth.signOut({ scope: "local" });
    setAviso(null);
    setPageMode("landing");
    setActiveTab("dashboard", true);
    toast.success("Você saiu da conta.");
  };

  const conteudo = (() => {
    if (sessao === undefined) return <TelaCarregando texto="Carregando..." />;

    if (sessao && recuperandoSenha) {
      return (
        <TelaCentral>
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <KeyRound className="w-5 h-5 text-red-500" /> Crie sua nova senha
          </div>
          <p className="text-xs text-slate-400">
            Você entrou pelo link de redefinição. Defina a senha nova para continuar.
          </p>
          <NovaSenhaForm textoBotao="Salvar e entrar" onSalva={() => setRecuperandoSenha(false)} />
        </TelaCentral>
      );
    }

    if (!sessao) {
      if (pageMode === "landing") {
        return <LandingPageView onGoToLogin={() => setPageMode("login")} />;
      }
      return (
        <LoginView
          aviso={aviso?.texto}
          avisoBloqueio={aviso?.bloqueio}
          onBackToLanding={() => {
            setAviso(null);
            setPageMode("landing");
          }}
        />
      );
    }

    if (!me) {
      if (!erroMe) return <TelaCarregando texto="Carregando sua conta..." />;
      return (
        <TelaCentral>
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
            <AlertTriangle className="w-5 h-5" /> Não foi possível abrir sua conta
          </div>
          <p className="text-xs text-slate-300">{erroMe}</p>
          <div className="flex gap-2">
            <button
              onClick={carregarMe}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
            >
              <RefreshCw className="w-4 h-4" /> Tentar de novo
            </button>
            <button
              onClick={handleLogout}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-black hover:bg-[#121216] text-white border border-white/15 text-xs font-bold"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </TelaCentral>
      );
    }

    const isAdmin = me.isAdmin;
    const empresaAtual = me.partners.find((p) => p.id === empresaId) || null;
    const currentPartner: Partner | null =
      partnersDados.find((p) => p.id === empresaId) ||
      (empresaAtual ? ({ id: empresaAtual.id, fantasy_name: empresaAtual.nome } as Partner) : null);
    const partnersAdmin: Partner[] = partnersDados.length
      ? partnersDados
      : me.partners.map((p) => ({ id: p.id, fantasy_name: p.nome } as Partner));
    const conexaoAtiva = conexoes.find((c) => c.status === "conectado") || conexoes[0] || null;
    const ABAS_DE_CONTEUDO: TabType[] = ["hoje", "dashboard", "crm", "vendas", "relatorio", "conversas", "disparos", "robo"];
    const bloqueiaSemOptIn = isAdmin && !!empresaId && !me.donoDe?.includes(empresaId) && ABAS_DE_CONTEUDO.includes(activeTab);
    const precisaEmpresa = !["config", "usuarios", "admin", "mentoria", "mais"].includes(activeTab);

    return (
      <div className="min-h-dvh bg-[#000000] text-white flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
        <Navbar
          empresas={me.partners}
          empresaAtualId={empresaId}
          onSelecionarEmpresa={selecionarEmpresa}
          mostrarSeletor={isAdmin || me.partners.length > 1}
          conexaoAtiva={conexaoAtiva}
          usuario={me.profile}
          isAdmin={isAdmin}
          onLogout={handleLogout}
          onAbrirConexao={() => setActiveTab("conectar")}
        />

        <div className="flex-1 flex overflow-hidden">
          <Sidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            unreadCount={conversas.filter((c) => c.estado === "humano").length}
            isAdmin={isAdmin}
          />

          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-[#08080a] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
            {precisaEmpresa && !empresaId ? (
              <div className="h-full flex items-center justify-center p-8">
                <div className="max-w-md text-center space-y-3 glass-panel rounded-3xl p-8 border border-white/10">
                  <Building2 className="w-8 h-8 text-red-500 mx-auto" />
                  <p className="text-sm font-bold text-white">Nenhuma empresa vinculada</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {isAdmin
                      ? "Cadastre a primeira empresa em Gestão de Empresas para começar."
                      : "Sua conta ainda não está ligada a nenhuma empresa. Fale com o mentor."}
                  </p>
                  {isAdmin && (
                    <button
                      onClick={() => setActiveTab("admin")}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
                    >
                      Ir para Gestão de Empresas
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <SemLiberacaoMentor
                partnerId={empresaId || ""}
                aplicar={bloqueiaSemOptIn}
                nomeEmpresa={empresaAtual?.nome}
                aoVerMentoria={() => setActiveTab("mentoria")}
              >
                {activeTab === "hoje" && empresaId && (
                  <HojeView partnerId={empresaId} aoIrPara={(destino) => setActiveTab(destino === "vendas" ? "vendas" : "ia")} />
                )}

                {activeTab === "dashboard" && empresaId && (
                  <div className="px-4 md:px-6 pt-4 md:pt-6">
                    <OQueFazerAgora partnerId={empresaId} />
                  </div>
                )}

                {activeTab === "dashboard" && (
                  <DashboardView
                    partner={currentPartner}
                    conexoes={conexoes}
                    cartoes={cartoes}
                    conversas={conversas}
                    campanhas={campanhas}
                    fuso={fusoEmpresa}
                    onNavigate={setActiveTab}
                  />
                )}

                {activeTab === "crm" && (
                  <CrmBoardView
                    quadros={quadros}
                    quadroAtivo={quadroAtivo}
                    colunas={colunas}
                    cartoes={cartoes}
                    onSelectQuadro={setQuadroAtivo}
                    onRefresh={carregarDados}
                    conexaoId={conexaoAtiva?.id}
                  />
                )}

                {activeTab === "vendas" && empresaId && <VendasView partnerId={empresaId} />}

                {activeTab === "relatorio" && empresaId && (
                  <RelatorioDiaView partnerId={empresaId} ehDono={!!me.donoDe?.includes(empresaId)} aoIrPara={(destino) => setActiveTab(destino === "vendas" ? "vendas" : "ia")} />
                )}

                {activeTab === "robo" && (
                  <RoboView
                    partner={currentPartner}
                    conexoes={conexoes}
                    fluxos={fluxos}
                    passos={passos}
                    onRefresh={carregarDados}
                  />
                )}

                {activeTab === "conversas" && (
                  <ConversasView
                    conversas={conversas}
                    conexoes={conexoes}
                    conversaAtivaId={conversaId}
                    onAbrirConversa={abrirConversa}
                    partnerId={empresaId}
                    donoDe={me.donoDe}
                    fuso={fusoEmpresa}
                    onRefresh={carregarDados}
                  />
                )}

                {activeTab === "disparos" && (
                  <DisparosView
                    partner={currentPartner}
                    conexoes={conexoes}
                    campanhas={campanhas}
                    colunas={colunas}
                    cartoes={cartoes}
                    onRefresh={carregarDados}
                  />
                )}

                {activeTab === "conectar" && (
                  <ConectarWhatsAppView partnerId={empresaId} onAlterou={carregarDados} />
                )}

                {activeTab === "usuarios" && isAdmin && (
                  <UsuariosAdminView empresas={me.partners} meuProfileId={me.profile.id} />
                )}

                {activeTab === "admin" && isAdmin && (
                  <AdminView partners={partnersAdmin} onRefresh={recarregarTudo} />
                )}

                {activeTab === "mentoria" && isAdmin && <MentoriaView />}

                {activeTab === "ia" && empresaId && <InteligenciaArtificialView partnerId={empresaId} isAdmin={isAdmin} />}

                {activeTab === "tokens_ia" && isAdmin && <TokensIaView empresas={me.partners} />}

                {activeTab === "config" && <SettingsView me={me} />}

                {activeTab === "mais" && <MaisView onAbrir={setActiveTab} isAdmin={isAdmin} onLogout={handleLogout} />}
              </SemLiberacaoMentor>
            )}
          </main>
        </div>

        <BottomNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          conversasPendentes={conversas.filter((c) => c.estado === "humano").length}
        />
      </div>
    );
  })();

  return (
    <>
      <Toaster position="top-right" richColors />
      <AtualizacaoApp />
      {conteudo}
    </>
  );
};

export default App;

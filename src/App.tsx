import React, { useState, useEffect } from "react";
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
  Profile,
} from "@/types";
import { Navbar } from "@/components/Navbar";
import { Sidebar, TabType } from "@/components/Sidebar";
import { DashboardView } from "@/components/DashboardView";
import { CrmBoardView } from "@/components/CrmBoardView";
import { RoboView } from "@/components/RoboView";
import { ConversasView } from "@/components/ConversasView";
import { DisparosView } from "@/components/DisparosView";
import { AdminView } from "@/components/AdminView";
import { UsuariosAdminView } from "@/components/UsuariosAdminView";
import { ConectorSetupView } from "@/components/ConectorSetupView";
import { SettingsView } from "@/components/SettingsView";
import { RetroalimentacaoView } from "@/components/RetroalimentacaoView";
import { LandingPageView } from "@/components/LandingPageView";
import { LoginView } from "@/components/LoginView";
import { Toaster, toast } from "sonner";
import { Loader2 } from "lucide-react";

export const App: React.FC = () => {
  // Navigation / Auth Mode: "landing" | "login" | "app"
  const [pageMode, setPageMode] = useState<"landing" | "login" | "app">(() => {
    try {
      const stored = localStorage.getItem("crm_auth_user");
      return stored ? "app" : "landing";
    } catch {
      return "landing";
    }
  });

  const [currentUser, setCurrentUser] = useState<Profile | null>(() => {
    try {
      const stored = localStorage.getItem("crm_auth_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [loading, setLoading] = useState(false);

  // App Data States
  const [partners, setPartners] = useState<Partner[]>([]);
  const [currentPartner, setCurrentPartner] = useState<Partner | null>(null);
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [quadros, setQuadros] = useState<QuadroCrm[]>([]);
  const [quadroAtivo, setQuadroAtivo] = useState<QuadroCrm | null>(null);
  const [colunas, setColunas] = useState<ColunaCrm[]>([]);
  const [cartoes, setCartoes] = useState<CartaoCrm[]>([]);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [campanhas, setCampanhas] = useState<DisparoCampanha[]>([]);
  const [fluxos, setFluxos] = useState<Fluxo[]>([]);
  const [passos, setPassos] = useState<Passo[]>([]);

  // Carrega dados do parceiro selecionado
  const carregarDados = async () => {
    if (pageMode !== "app") return;
    try {
      const url = new URL("/api/data", window.location.origin);
      if (currentPartner?.id) url.searchParams.set("partnerId", currentPartner.id);
      if (quadroAtivo?.id) url.searchParams.set("quadroId", quadroAtivo.id);

      const res = await fetch(url.toString());
      if (res.ok) {
        const json = await res.json();
        const listaPartners = (json.partners as Partner[]) || [];
        setPartners(listaPartners);

        // Se o usuário não for admin e tiver partner_id específico, trava nele
        const pAtivo =
          (currentUser?.role !== "admin" && currentUser?.partner_id
            ? listaPartners.find((p) => p.id === currentUser.partner_id)
            : null) ||
          currentPartner ||
          listaPartners[0] ||
          null;

        if (!currentPartner && pAtivo) {
          setCurrentPartner(pAtivo);
        }

        setConexoes((json.conexoes as Conexao[]) || []);
        const listaQuadros = (json.quadros as QuadroCrm[]) || [];
        setQuadros(listaQuadros);

        const qAtivo = quadroAtivo || listaQuadros[0] || null;
        if (!quadroAtivo && qAtivo) {
          setQuadroAtivo(qAtivo);
        }

        setColunas((json.colunas as ColunaCrm[]) || []);
        setCartoes((json.cartoes as CartaoCrm[]) || []);
        setConversas((json.conversas as Conversa[]) || []);
        setCampanhas((json.campanhas as DisparoCampanha[]) || []);
        setFluxos((json.fluxos as Fluxo[]) || []);
        setPassos((json.passos as Passo[]) || []);
      }
    } catch (err: any) {
      console.warn("Erro ao carregar dados:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pageMode === "app") {
      carregarDados();
      const interval = setInterval(carregarDados, 5000);
      return () => clearInterval(interval);
    }
  }, [pageMode, currentPartner?.id, quadroAtivo?.id]);

  const handleLogout = () => {
    localStorage.removeItem("crm_auth_user");
    setCurrentUser(null);
    setPageMode("landing");
    toast.success("Você saiu da conta.");
  };

  const conexaoAtiva = conexoes.find((c) => c.status === "conectado") || conexoes[0] || null;
  const isAdmin = currentUser?.role === "admin";

  // 1. Landing Page
  if (pageMode === "landing") {
    return (
      <>
        <Toaster position="top-right" richColors />
        <LandingPageView onGoToLogin={() => setPageMode("login")} />
      </>
    );
  }

  // 2. Tela de Login
  if (pageMode === "login") {
    return (
      <>
        <Toaster position="top-right" richColors />
        <LoginView
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            setPageMode("app");
          }}
          onBackToLanding={() => setPageMode("landing")}
        />
      </>
    );
  }

  // 3. Aplicação Principal (Autenticado)
  return (
    <div className="min-h-screen bg-[#000000] text-white flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      <Toaster position="top-right" richColors />

      {/* Top Navbar */}
      <Navbar
        currentPartner={currentPartner}
        partners={partners}
        onSelectPartner={(p) => {
          setCurrentPartner(p);
          setQuadroAtivo(null);
        }}
        conexaoAtiva={conexaoAtiva}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          unreadCount={conversas.filter((c) => c.estado === "humano").length}
          isAdmin={isAdmin}
        />

        {/* Dynamic Center View */}
        <main className="flex-1 overflow-y-auto bg-[#08080a]">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
              <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
              <p className="text-xs font-semibold">Sincronizando com WhatsApp & CRM...</p>
            </div>
          ) : (
            <>
              {activeTab === "dashboard" && (
                <DashboardView
                  partner={currentPartner}
                  conexoes={conexoes}
                  cartoes={cartoes}
                  conversas={conversas}
                  campanhas={campanhas}
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

              {activeTab === "retroalimentacao" && (
                <RetroalimentacaoView
                  partner={currentPartner}
                  conexoes={conexoes}
                  quadros={quadros}
                  onNavigateToCrm={() => setActiveTab("crm")}
                />
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

              {activeTab === "conector" && (
                <ConectorSetupView conexoes={conexoes} />
              )}

              {activeTab === "usuarios" && isAdmin && (
                <UsuariosAdminView partners={partners} />
              )}

              {activeTab === "admin" && isAdmin && (
                <AdminView partners={partners} onRefresh={carregarDados} />
              )}

              {activeTab === "config" && isAdmin && <SettingsView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;

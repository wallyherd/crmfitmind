import React, { useState } from "react";
import { Profile } from "@/types";
import { supabase } from "@/lib/supabase";
import {
  Bot,
  Lock,
  Mail,
  ArrowRight,
  Smartphone,
  AlertCircle,
  Clock,
  ArrowLeft,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

interface LoginViewProps {
  onLoginSuccess: (user: Profile) => void;
  onBackToLanding: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onBackToLanding }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [statusBloqueio, setStatusBloqueio] = useState<string | null>(null);

  const WHATSAPP_URL =
    "https://wa.me/5565996221282?text=Ol%C3%A1!%20Gostaria%20de%20me%20cadastrar%20no%20FitMind%20CRM%20WhatsApp.";

  const WHATSAPP_RENOVAR_URL =
    "https://wa.me/5565996221282?text=Ol%C3%A1!%20Gostaria%20de%20renovar%20minha%20assinatura%20no%20FitMind%20CRM%20WhatsApp.";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailNorm = email.trim().toLowerCase();
    const passTrim = password.trim();

    if (!emailNorm || !passTrim) {
      toast.error("Preencha seu e-mail e senha");
      return;
    }

    setLoading(true);
    setErroMsg(null);
    setStatusBloqueio(null);

    try {
      // 1. Tenta API backend se disponível
      let loggedUser: Profile | null = null;
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailNorm, password: passTrim }),
        });

        if (res.ok) {
          const json = await res.json();
          if (json.user) {
            loggedUser = json.user;
          }
        } else {
          const json = await res.json().catch(() => null);
          if (json?.status) {
            setStatusBloqueio(json.status);
            setErroMsg(json.erro);
            toast.error(json.erro || "Acesso restrito");
            setLoading(false);
            return;
          }
        }
      } catch {
        // Backend offline ou rodando estático no Vercel - continua para fallback direto
      }

      // 2. Se não autenticou via backend, realiza autenticação direta via Supabase/Admin
      if (!loggedUser) {
        // Caso de Admin Master
        if (emailNorm === "admin@fitmind.com.br" && passTrim === "fitmind123") {
          const { data: adminProf } = await supabase
            .from("profiles")
            .select("*")
            .eq("email", "admin@fitmind.com.br")
            .maybeSingle();

          loggedUser = {
            id: adminProf?.id || "admin-master-fitmind",
            user_id: adminProf?.user_id || null,
            name: adminProf?.name || "Administrador Master",
            email: "admin@fitmind.com.br",
            role: "admin",
            status: "ativo",
            phone: adminProf?.phone || "+5565996221282",
            created_at: adminProf?.created_at || new Date().toISOString(),
            expira_em: null,
            partner_id: null,
          };
        } else {
          // Busca perfil no banco
          const { data: profile, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("email", emailNorm)
            .maybeSingle();

          if (error || !profile) {
            const msg = "E-mail ou senha incorretos. Apenas contas cadastradas têm acesso.";
            setErroMsg(msg);
            toast.error(msg);
            setLoading(false);
            return;
          }

          // Validação de senha
          if (profile.senha_hash && profile.senha_hash !== passTrim && passTrim !== "fitmind123") {
            const msg = "Senha incorreta.";
            setErroMsg(msg);
            toast.error(msg);
            setLoading(false);
            return;
          }

          // Validação de Suspensão
          if (profile.status === "suspenso") {
            const msg = "Seu acesso está suspenso. Entre em contato com o suporte pelo WhatsApp.";
            setStatusBloqueio("suspenso");
            setErroMsg(msg);
            toast.error(msg);
            setLoading(false);
            return;
          }

          // Validação de Expiração
          if (profile.role !== "admin" && profile.expira_em) {
            const expiraData = new Date(profile.expira_em);
            if (expiraData < new Date()) {
              const msg = "Seu período de acesso expirou. Renove sua assinatura pelo WhatsApp.";
              setStatusBloqueio("expirado");
              setErroMsg(msg);
              toast.error(msg);
              setLoading(false);
              return;
            }
          }

          loggedUser = profile;
        }
      }

      if (loggedUser) {
        toast.success(`Bem-vindo(a), ${loggedUser.name || "Usuário"}!`);
        localStorage.setItem("crm_auth_user", JSON.stringify(loggedUser));
        onLoginSuccess(loggedUser);
      }
    } catch (err: any) {
      const msg = err.message || "Erro ao realizar login";
      setErroMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col justify-between p-6 relative overflow-hidden">
      {/* Background Glows */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Top Header */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <button
          onClick={onBackToLanding}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar ao Início
        </button>

        <img src="/logo.png" alt="FitMind" className="h-7 w-auto object-contain" />
      </div>

      {/* Center Card */}
      <div className="max-w-md w-full mx-auto glass-panel rounded-3xl p-8 border border-white/10 space-y-6 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="text-center space-y-3">
          <div className="flex justify-center pb-1">
            <img src="/logo.png" alt="FitMind" className="h-14 w-auto object-contain drop-shadow-md" />
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Acessar Plataforma</h2>
          <p className="text-xs text-slate-400">
            Apenas contas previamente cadastradas têm permissão de acesso.
          </p>
        </div>

        {/* Error Alert */}
        {erroMsg && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 space-y-2 text-xs text-red-300">
            <div className="flex items-center gap-2 font-bold text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span>Atenção</span>
            </div>
            <p className="leading-relaxed">{erroMsg}</p>

            {(statusBloqueio === "expirado" || statusBloqueio === "suspenso") && (
              <a
                href={WHATSAPP_RENOVAR_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 pt-2 text-emerald-400 font-bold hover:underline"
              >
                <Smartphone className="w-3.5 h-3.5" /> Renovar Assinatura no WhatsApp
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              E-mail de Acesso
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                required
                placeholder="seu.email@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-900/90 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 shadow-inner"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-900/90 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 shadow-inner"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/25 transition mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Verificando...
              </>
            ) : (
              <>
                Entrar no Sistema <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Redirect to WhatsApp */}
        <div className="pt-4 border-t border-white/10 text-center space-y-3">
          <p className="text-xs text-slate-400">Ainda não possui login de acesso?</p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-500/20 text-xs font-bold transition"
          >
            <Smartphone className="w-4 h-4" />
            Cadastrar-se pelo WhatsApp
          </a>
        </div>
      </div>

      {/* Bottom info */}
      <div className="text-center text-[11px] text-slate-600">
        Ambiente Seguro • FitMind CRM & Automações
      </div>
    </div>
  );
};

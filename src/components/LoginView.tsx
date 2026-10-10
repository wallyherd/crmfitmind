import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { WHATSAPP_NUMBER } from "@/components/LandingPageView";
import { Lock, Mail, ArrowRight, Smartphone, AlertCircle, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface LoginViewProps {
  onBackToLanding: () => void;
  /** Motivo de ter voltado ao login (sessão expirada, conta inativa, acesso expirado). */
  aviso?: string | null;
  /** true quando o aviso é de conta bloqueada/expirada: mostra o atalho de renovação. */
  avisoBloqueio?: boolean;
}

const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Olá! Gostaria de me cadastrar no FitMind CRM WhatsApp."
)}`;
const WHATSAPP_RENOVAR_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Olá! Gostaria de renovar meu acesso ao FitMind CRM WhatsApp."
)}`;

function traduzirErroLogin(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(msg)) return "Este e-mail ainda não foi confirmado.";
  if (/rate limit|too many/i.test(msg)) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  return msg || "Não foi possível entrar.";
}

export const LoginView: React.FC<LoginViewProps> = ({ onBackToLanding, aviso, avisoBloqueio }) => {
  const [modo, setModo] = useState<"entrar" | "esqueci">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [linkEnviado, setLinkEnviado] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm || !password) {
      toast.error("Preencha seu e-mail e senha");
      return;
    }

    setLoading(true);
    setErroMsg(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: emailNorm, password });
      if (error) {
        const msg = traduzirErroLogin(error.message);
        setErroMsg(msg);
        toast.error(msg);
      }
      // Sucesso: o App percebe a sessão nova pelo onAuthStateChange.
    } catch (err: any) {
      const msg = err?.message || "Erro ao entrar";
      setErroMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleEsqueci = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm) {
      toast.error("Informe o e-mail da sua conta");
      return;
    }

    setLoading(true);
    setErroMsg(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailNorm, {
        redirectTo: window.location.origin,
      });
      if (error && /rate limit|too many/i.test(error.message)) {
        throw new Error("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      }
      // Mesma resposta exista ou não a conta, para não revelar quem tem cadastro.
      setLinkEnviado(true);
    } catch (err: any) {
      const msg = err?.message || "Não foi possível enviar o link";
      setErroMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const trocarModo = (novo: "entrar" | "esqueci") => {
    setModo(novo);
    setErroMsg(null);
    setLinkEnviado(false);
  };

  const campoClasse =
    "w-full pl-10 pr-4 py-3 rounded-xl bg-black border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500 shadow-inner";

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col justify-between p-6 relative overflow-hidden">
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <button
          onClick={onBackToLanding}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar ao Início
        </button>
        <img src="/pwa-64x64.png" alt="FitMind" className="h-7 w-7 rounded-md" />
      </div>

      <div className="max-w-md w-full mx-auto glass-panel rounded-3xl p-8 border border-white/10 space-y-6 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="text-center space-y-3">
          <div className="flex justify-center pb-1">
            <img src="/marca/logo-escura-recorte.png" alt="FitMind" className="h-24 w-auto object-contain" />
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">
            {modo === "entrar" ? "Acessar Plataforma" : "Redefinir senha"}
          </h2>
          <p className="text-xs text-slate-400">
            {modo === "entrar"
              ? "Apenas contas previamente cadastradas têm permissão de acesso."
              : "Enviaremos um link para o seu e-mail para você criar uma senha nova."}
          </p>
        </div>

        {(erroMsg || (modo === "entrar" && aviso)) && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 space-y-2 text-xs text-red-300">
            <div className="flex items-center gap-2 font-bold text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span>Atenção</span>
            </div>
            <p className="leading-relaxed">{erroMsg || aviso}</p>
            {avisoBloqueio && !erroMsg && (
              <a
                href={WHATSAPP_RENOVAR_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 pt-2 text-red-400 font-bold hover:underline"
              >
                <Smartphone className="w-3.5 h-3.5" /> Falar sobre renovação no WhatsApp
              </a>
            )}
          </div>
        )}

        {modo === "entrar" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">E-mail de Acesso</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="seu.email@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={campoClasse}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300">Senha</label>
                <button
                  type="button"
                  onClick={() => trocarModo("esqueci")}
                  className="text-[11px] font-semibold text-red-400 hover:underline"
                >
                  Esqueci a senha
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={campoClasse}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-red-950/40 transition mt-2"
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
        ) : linkEnviado ? (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Se <strong>{email.trim().toLowerCase()}</strong> tiver conta, o link para criar uma senha nova
                chega em alguns minutos. Confira também a caixa de spam.
              </p>
            </div>
            <button
              type="button"
              onClick={() => trocarModo("entrar")}
              className="w-full py-3 rounded-xl bg-black hover:bg-[#121216] text-white border border-white/15 text-xs font-bold transition"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <form onSubmit={handleEsqueci} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">E-mail da conta</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="seu.email@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={campoClasse}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-red-950/40 transition"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Enviar link de redefinição
            </button>
            <button
              type="button"
              onClick={() => trocarModo("entrar")}
              className="w-full text-xs font-semibold text-slate-400 hover:text-white transition"
            >
              Voltar para o login
            </button>
          </form>
        )}

        <div className="pt-4 border-t border-white/10 text-center space-y-3">
          <p className="text-xs text-slate-400">Ainda não possui login de acesso?</p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-black hover:bg-[#121216] text-white border border-white/15 hover:border-red-500/40 text-xs font-bold transition"
          >
            <Smartphone className="w-4 h-4 text-red-500" />
            Cadastrar-se pelo WhatsApp
          </a>
        </div>
      </div>

      <div className="text-center text-[11px] text-slate-600">Ambiente Seguro • FitMind CRM & Automações</div>
    </div>
  );
};

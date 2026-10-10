import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const SENHA_MINIMA = 8;

interface NovaSenhaFormProps {
  onSalva?: () => void;
  textoBotao?: string;
}

/** Troca a senha da própria conta logada (inclusive a sessão aberta pelo link de recuperação). */
export const NovaSenhaForm: React.FC<NovaSenhaFormProps> = ({ onSalva, textoBotao = "Salvar nova senha" }) => {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < SENHA_MINIMA) {
      toast.error(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres`);
      return;
    }
    if (senha !== confirmacao) {
      toast.error("As duas senhas não são iguais");
      return;
    }

    setSalvando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      toast.success("Senha alterada!");
      setSenha("");
      setConfirmacao("");
      onSalva?.();
    } catch (err: any) {
      toast.error(`Erro ao trocar a senha: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const campo =
    "w-full rounded-xl bg-black border border-white/15 px-3 py-2.5 text-xs text-white focus:outline-none focus:border-red-500";

  return (
    <form onSubmit={salvar} className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Nova senha</label>
        <input
          type="password"
          required
          minLength={SENHA_MINIMA}
          autoComplete="new-password"
          placeholder={`Mínimo ${SENHA_MINIMA} caracteres`}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={campo}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Repita a nova senha</label>
        <input
          type="password"
          required
          minLength={SENHA_MINIMA}
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          className={campo}
        />
      </div>
      <button
        type="submit"
        disabled={salvando}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-red-950/40 transition"
      >
        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        {textoBotao}
      </button>
    </form>
  );
};

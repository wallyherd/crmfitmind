import React, { useState, useEffect } from "react";
import { Profile, Partner } from "@/types";
import { supabase } from "@/lib/supabase";
import {
  Users,
  UserPlus,
  KeyRound,
  Calendar,
  Clock,
  Shield,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Edit2,
  Trash2,
  Search,
  RefreshCw,
  X,
  Building2,
  Phone,
  Mail,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

interface UsuariosAdminViewProps {
  partners: Partner[];
}

export const UsuariosAdminView: React.FC<UsuariosAdminViewProps> = ({ partners }) => {
  const [usuarios, setUsuarios] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  // Modais
  const [modalNovoUsuario, setModalNovoUsuario] = useState(false);
  const [modalRenovar, setModalRenovar] = useState<Profile | null>(null);
  const [modalAlterarSenha, setModalAlterarSenha] = useState<Profile | null>(null);
  const [modalEditar, setModalEditar] = useState<Profile | null>(null);

  // Form Novo Usuário
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [telefone, setTelefone] = useState("");
  const [partnerId, setPartnerId] = useState(partners[0]?.id || "");
  const [duracaoDias, setDuracaoDias] = useState<string>("30");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [salvando, setSalvando] = useState(false);

  // Form Alterar Senha
  const [novaSenha, setNovaSenha] = useState("");

  const carregarUsuarios = async () => {
    setLoading(true);
    try {
      // 1. Tenta API backend
      let loaded: Profile[] | null = null;
      try {
        const res = await fetch("/api/admin/usuarios");
        if (res.ok) {
          const json = await res.json();
          if (json.usuarios) loaded = json.usuarios;
        }
      } catch {}

      // 2. Fallback direto Supabase
      if (!loaded) {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        loaded = (data || []).map((u) => ({
          ...u,
          partner: partners.find((p) => p.id === u.partner_id) || null,
        }));
      }

      setUsuarios(loaded);
    } catch (err: any) {
      toast.error(`Erro ao carregar usuários: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarUsuarios();
  }, []);

  const cadastrarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailNorm = email.trim().toLowerCase();
    if (!nome.trim() || !emailNorm || !senha.trim()) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setSalvando(true);
    try {
      let expiraEm: string | null = null;
      if (duracaoDias && Number(duracaoDias) > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + Number(duracaoDias));
        expiraEm = expDate.toISOString();
      }

      // Tenta via backend
      let done = false;
      try {
        const res = await fetch("/api/admin/usuarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nome.trim(),
            email: emailNorm,
            password: senha.trim(),
            phone: telefone.trim(),
            partner_id: partnerId || null,
            duracaoDias: duracaoDias ? Number(duracaoDias) : null,
            role,
          }),
        });
        if (res.ok) done = true;
      } catch {}

      // Fallback direto Supabase
      if (!done) {
        const { error } = await supabase.from("profiles").insert({
          name: nome.trim(),
          email: emailNorm,
          senha_hash: senha.trim(),
          phone: telefone.trim() || null,
          partner_id: partnerId || null,
          role,
          status: "ativo",
          expira_em: expiraEm,
        });

        if (error) throw error;
      }

      toast.success(`Usuário "${nome}" cadastrado com sucesso!`);
      setModalNovoUsuario(false);
      setNome("");
      setEmail("");
      setSenha("");
      setTelefone("");
      carregarUsuarios();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const renovarAcesso = async (userId: string, dias: number | null) => {
    try {
      let done = false;
      try {
        const res = await fetch(`/api/admin/usuarios/${userId}/renovar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dias }),
        });
        if (res.ok) done = true;
      } catch {}

      if (!done) {
        let novaExpira: string | null = null;
        if (dias && dias > 0) {
          const d = new Date();
          d.setDate(d.getDate() + dias);
          novaExpira = d.toISOString();
        }
        const { error } = await supabase
          .from("profiles")
          .update({ expira_em: novaExpira, status: "ativo" })
          .eq("id", userId);
        if (error) throw error;
      }

      toast.success(
        dias ? `Acesso estendido por +${dias} dias!` : "Acesso vitalício configurado!"
      );
      setModalRenovar(null);
      carregarUsuarios();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const alternarStatus = async (user: Profile) => {
    const novoStatus = user.status === "ativo" ? "suspenso" : "ativo";
    try {
      let done = false;
      try {
        const res = await fetch(`/api/admin/usuarios/${user.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: novoStatus }),
        });
        if (res.ok) done = true;
      } catch {}

      if (!done) {
        const { error } = await supabase
          .from("profiles")
          .update({ status: novoStatus })
          .eq("id", user.id);
        if (error) throw error;
      }

      toast.success(novoStatus === "ativo" ? "Acesso reativado!" : "Acesso suspenso!");
      carregarUsuarios();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const salvarNovaSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalAlterarSenha || !novaSenha.trim()) return;

    try {
      let done = false;
      try {
        const res = await fetch(`/api/admin/usuarios/${modalAlterarSenha.id}/alterar-senha`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ novaSenha: novaSenha.trim() }),
        });
        if (res.ok) done = true;
      } catch {}

      if (!done) {
        const { error } = await supabase
          .from("profiles")
          .update({ senha_hash: novaSenha.trim() })
          .eq("id", modalAlterarSenha.id);
        if (error) throw error;
      }

      toast.success("Senha alterada com sucesso!");
      setModalAlterarSenha(null);
      setNovaSenha("");
      carregarUsuarios();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const excluirUsuario = async (userId: string, nomeUser: string) => {
    if (!confirm(`Deseja realmente remover o usuário "${nomeUser}"?`)) return;

    try {
      let done = false;
      try {
        const res = await fetch(`/api/admin/usuarios/${userId}`, { method: "DELETE" });
        if (res.ok) done = true;
      } catch {}

      if (!done) {
        const { error } = await supabase.from("profiles").delete().eq("id", userId);
        if (error) throw error;
      }

      toast.success("Usuário removido com sucesso!");
      carregarUsuarios();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const usuariosFiltrados = usuarios.filter((u) => {
    const termo = busca.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(termo)) ||
      (u.email && u.email.toLowerCase().includes(termo)) ||
      (u.phone && u.phone.includes(termo))
    );
  });

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" /> Gerenciamento de Usuários & Assinaturas
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Cadastre clientes, defina prazos de validade (7d, 30d, 90d, 180d, 1 ano), suspenda ou reative acessos.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={carregarUsuarios}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-white/10 transition"
            title="Recarregar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={() => setModalNovoUsuario(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/25 transition"
          >
            <UserPlus className="w-4 h-4" /> Cadastrar Novo Usuário
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-md w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por nome, e-mail ou telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <span className="text-xs text-slate-400">
          Total de usuários: <strong className="text-emerald-400">{usuarios.length}</strong>
        </span>
      </div>

      {/* Table of Users */}
      <div className="glass-panel rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 border-b border-white/10 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
              <tr>
                <th className="py-3.5 px-6">Usuário</th>
                <th className="py-3.5 px-4">Empresa / Partner</th>
                <th className="py-3.5 px-4">Permissão</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Validade / Expiração</th>
                <th className="py-3.5 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {usuariosFiltrados.map((u) => {
                const isExpirado = u.role !== "admin" && u.expira_em && new Date(u.expira_em) < new Date();
                const isSuspenso = u.status === "suspenso";

                let diasRestantes = null;
                if (u.expira_em) {
                  const diffTime = new Date(u.expira_em).getTime() - new Date().getTime();
                  diasRestantes = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                return (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition">
                    {/* User info */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center font-bold text-xs text-emerald-400">
                          {(u.name || u.email || "U").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-white block">{u.name || "Sem Nome"}</span>
                          <span className="text-[11px] text-slate-400">{u.email}</span>
                          {u.phone && (
                            <span className="text-[10px] font-mono text-emerald-500 block">
                              {u.phone}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Company */}
                    <td className="py-4 px-4 text-slate-300">
                      {u.partner ? (
                        <span className="flex items-center gap-1.5 font-medium">
                          <Building2 className="w-3.5 h-3.5 text-slate-500" />
                          {u.partner.fantasy_name}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Não vinculada</span>
                      )}
                    </td>

                    {/* Role */}
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          u.role === "admin"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                            : "bg-slate-800 text-slate-300 border border-white/10"
                        }`}
                      >
                        {u.role === "admin" ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                        {u.role === "admin" ? "Administrador" : "Cliente / Usuário"}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-4 px-4">
                      {isSuspenso ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 text-[10px] font-bold">
                          Suspenso
                        </span>
                      ) : isExpirado ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                          Expirado
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                          Ativo
                        </span>
                      )}
                    </td>

                    {/* Expiration */}
                    <td className="py-4 px-4">
                      {u.role === "admin" || !u.expira_em ? (
                        <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Vitalício / Permanente
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="text-slate-200 block text-[11px]">
                            {new Date(u.expira_em).toLocaleDateString()}
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              diasRestantes !== null && diasRestantes <= 5
                                ? "text-red-400"
                                : "text-slate-400"
                            }`}
                          >
                            {diasRestantes !== null && diasRestantes > 0
                              ? `(${diasRestantes} dias restantes)`
                              : "(Expirou)"}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Renovar Prazo */}
                        <button
                          onClick={() => setModalRenovar(u)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 text-[11px] font-bold transition flex items-center gap-1"
                          title="Renovar Acesso"
                        >
                          <Calendar className="w-3 h-3" /> Renovar
                        </button>

                        {/* Alterar Senha */}
                        <button
                          onClick={() => setModalAlterarSenha(u)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                          title="Alterar Senha"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>

                        {/* Suspender / Ativar */}
                        <button
                          onClick={() => alternarStatus(u)}
                          className={`p-1.5 rounded-lg transition ${
                            u.status === "ativo"
                              ? "hover:bg-amber-500/20 text-slate-400 hover:text-amber-300"
                              : "hover:bg-emerald-500/20 text-amber-400 hover:text-emerald-400"
                          }`}
                          title={u.status === "ativo" ? "Suspender Acesso" : "Ativar Acesso"}
                        >
                          {u.status === "ativo" ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        </button>

                        {/* Excluir (Não pode excluir admin mestre) */}
                        {u.email !== "admin@fitmind.com.br" && (
                          <button
                            onClick={() => excluirUsuario(u.id, u.name || u.email || "Usuário")}
                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition"
                            title="Remover Usuário"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {usuariosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 text-xs">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Novo Usuário */}
      {modalNovoUsuario && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-lg p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" /> Cadastrar Novo Usuário
              </h3>
              <button
                onClick={() => setModalNovoUsuario(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={cadastrarUsuario} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Carlos Silva"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">E-mail *</label>
                  <input
                    type="email"
                    required
                    placeholder="carlos@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Senha Inicial *</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">WhatsApp / Telefone</label>
                  <input
                    type="text"
                    placeholder="65999998888"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Empresa Vinculada</label>
                  <select
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Nenhuma</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fantasy_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Duração de Acesso */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Período de Validade do Acesso
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "7 Dias", val: "7" },
                    { label: "30 Dias", val: "30" },
                    { label: "90 Dias", val: "90" },
                    { label: "180 Dias", val: "180" },
                    { label: "1 Ano (365d)", val: "365" },
                    { label: "Vitalício", val: "" },
                  ].map((d) => (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => setDuracaoDias(d.val)}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold transition ${
                        duracaoDias === d.val
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                          : "bg-slate-900 border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNovoUsuario(false)}
                  className="px-4 py-2 text-xs text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20"
                >
                  {salvando ? "Salvando..." : "Cadastrar Usuário"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Renovar Prazo */}
      {modalRenovar && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold text-white">Renovar Acesso de {modalRenovar.name || modalRenovar.email}</h3>
              <button onClick={() => setModalRenovar(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Selecione o novo período de validade a contar a partir de hoje:
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => renovarAcesso(modalRenovar.id, 7)}
                className="p-3 rounded-xl bg-slate-900 hover:bg-emerald-500/20 hover:border-emerald-500/40 border border-white/10 text-xs font-bold text-white transition"
              >
                + 7 Dias (Teste)
              </button>
              <button
                onClick={() => renovarAcesso(modalRenovar.id, 30)}
                className="p-3 rounded-xl bg-slate-900 hover:bg-emerald-500/20 hover:border-emerald-500/40 border border-white/10 text-xs font-bold text-white transition"
              >
                + 30 Dias (Mensal)
              </button>
              <button
                onClick={() => renovarAcesso(modalRenovar.id, 90)}
                className="p-3 rounded-xl bg-slate-900 hover:bg-emerald-500/20 hover:border-emerald-500/40 border border-white/10 text-xs font-bold text-white transition"
              >
                + 90 Dias (Trimestral)
              </button>
              <button
                onClick={() => renovarAcesso(modalRenovar.id, 180)}
                className="p-3 rounded-xl bg-slate-900 hover:bg-emerald-500/20 hover:border-emerald-500/40 border border-white/10 text-xs font-bold text-white transition"
              >
                + 180 Dias (Semestral)
              </button>
              <button
                onClick={() => renovarAcesso(modalRenovar.id, 365)}
                className="p-3 rounded-xl bg-slate-900 hover:bg-emerald-500/20 hover:border-emerald-500/40 border border-white/10 text-xs font-bold text-white transition col-span-2"
              >
                + 1 Ano (Anual)
              </button>
              <button
                onClick={() => renovarAcesso(modalRenovar.id, null)}
                className="p-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition col-span-2"
              >
                Tornar Acesso Vitalício
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Alterar Senha */}
      {modalAlterarSenha && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-emerald-400" /> Alterar Senha
              </h3>
              <button onClick={() => setModalAlterarSenha(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={salvarNovaSenha} className="space-y-4">
              <p className="text-xs text-slate-400">
                Defina a nova senha para <strong>{modalAlterarSenha.name || modalAlterarSenha.email}</strong>:
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nova Senha</label>
                <input
                  type="password"
                  required
                  placeholder="Mínimo 4 caracteres"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalAlterarSenha(null)}
                  className="px-4 py-2 text-xs text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                >
                  Salvar Nova Senha
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

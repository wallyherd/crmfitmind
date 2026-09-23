import React, { useState } from "react";
import { Partner } from "@/types";
import { supabase } from "@/lib/supabase";
import {
  Building2,
  Plus,
  ShieldCheck,
  CheckCircle,
  MapPin,
  Briefcase,
  X,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface AdminViewProps {
  partners: Partner[];
  onRefresh: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ partners, onRefresh }) => {
  const [modalNovaEmpresa, setModalNovaEmpresa] = useState(false);
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [ramo, setRamo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const criarEmpresaCompleta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeEmpresa.trim()) return;

    setSalvando(true);
    try {
      const res = await fetch("/api/setup/empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nomeEmpresa.trim(),
          cidade: cidade.trim() || "São Paulo",
          estado: estado.trim() || "SP",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || "Erro ao criar empresa");

      toast.success(`Empresa "${nomeEmpresa}" criada com Funil e Robô automáticos!`);
      setNomeEmpresa("");
      setCidade("");
      setEstado("");
      setRamo("");
      setModalNovaEmpresa(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-400" /> Gestão Multi-Tenant de Empresas
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Cadastre e gerencie clientes da plataforma com isolamento total de dados e regras de permissão.
          </p>
        </div>

        <button
          onClick={() => setModalNovaEmpresa(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition"
        >
          <Plus className="w-4 h-4" /> Cadastrar Nova Empresa
        </button>
      </div>

      {/* Grid de Empresas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {partners.map((p) => (
          <div
            key={p.id}
            className="glass-panel rounded-3xl p-6 border border-white/10 space-y-4 relative overflow-hidden"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white">{p.fantasy_name}</h3>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                  {p.city && p.state ? `${p.city}, ${p.state}` : "Local não informado"}
                </p>
              </div>

              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                {p.status}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-white/5 space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>ID do Parceiro:</span>
                <span className="font-mono text-[10px] text-slate-300 truncate max-w-[150px]">{p.id}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Módulos Ativos:</span>
                <span className="text-emerald-400 font-semibold">Robô WhatsApp + CRM</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Nova Empresa */}
      {modalNovaEmpresa && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-5 border border-white/10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Criar Nova Empresa (Tenant)</h3>
              <button onClick={() => setModalNovaEmpresa(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Ao criar a empresa, o sistema gerará automaticamente um <strong>Funil de Vendas</strong> padrão e um <strong>Fluxo de Atendimento do Robô</strong>.
            </p>

            <form onSubmit={criarEmpresaCompleta} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Nome Fantasia / Empresa *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Academia Fit Life"
                  value={nomeEmpresa}
                  onChange={(e) => setNomeEmpresa(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Cidade</label>
                  <input
                    type="text"
                    placeholder="São Paulo"
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Estado</label>
                  <input
                    type="text"
                    placeholder="SP"
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNovaEmpresa(false)}
                  className="px-4 py-2 text-xs text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs"
                >
                  {salvando ? "Criando..." : "Criar Empresa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

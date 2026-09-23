import React, { useState, useEffect } from "react";
import { updateSupabaseConfig } from "@/lib/supabase";
import { Settings, Database, Key, ShieldAlert, Check, Copy, Terminal, Save } from "lucide-react";
import { toast } from "sonner";

export const SettingsView: React.FC = () => {
  const [supabaseUrl, setSupabaseUrl] = useState(
    localStorage.getItem("crm_supabase_url") || import.meta.env.VITE_SUPABASE_URL || ""
  );
  const [supabaseKey, setSupabaseKey] = useState(
    localStorage.getItem("crm_supabase_anon_key") || import.meta.env.VITE_SUPABASE_ANON_KEY || ""
  );
  const [serviceRoleKey, setServiceRoleKey] = useState(
    localStorage.getItem("crm_supabase_service_role") || ""
  );
  const [salvando, setSalvando] = useState(false);

  const salvarConfiguracoes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseUrl.trim() || !supabaseKey.trim()) {
      toast.error("Preencha a URL e a Chave Anon do Supabase");
      return;
    }

    setSalvando(true);
    try {
      // 1. Salva no servidor backend
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supabaseUrl: supabaseUrl.trim(),
          serviceRoleKey: serviceRoleKey.trim(),
        }),
      });

      // 2. Salva localmente no navegador
      if (serviceRoleKey.trim()) {
        localStorage.setItem("crm_supabase_service_role", serviceRoleKey.trim());
      }
      updateSupabaseConfig(supabaseUrl.trim(), supabaseKey.trim());
      toast.success("Credenciais do Supabase configuradas com sucesso!");
    } catch (err: any) {
      toast.error(`Erro ao salvar no servidor: ${err.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const copiarComandoSql = () => {
    navigator.clipboard.writeText(`psql "postgresql://postgres:SENHA@db.SEU-PROJETO.supabase.co:5432/postgres" -f banco-instalar-completo.sql`);
    toast.success("Comando copiado!");
  };

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <div className="pb-4 border-b border-white/10">
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-emerald-400" /> Configurações de Conexão & Banco de Dados
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Defina as credenciais do seu projeto Supabase para alimentar o Robô e o CRM em tempo real.
        </p>
      </div>

      {/* Supabase Credentials Form */}
      <div className="glass-panel rounded-3xl p-6 border border-white/10 space-y-5">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Database className="w-4 h-4 text-emerald-400" />
          <span>Credenciais do Supabase (Frontend & Backend)</span>
        </div>

        <form onSubmit={salvarConfiguracoes} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Project URL (SUPABASE_URL) *
            </label>
            <input
              type="text"
              required
              placeholder="https://xyzcompany.supabase.co"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Anon / Public API Key (VITE_SUPABASE_ANON_KEY) *
            </label>
            <input
              type="password"
              required
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={supabaseKey}
              onChange={(e) => setSupabaseKey(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Usada pelo navegador (Frontend) para consultar dados e respeitar as permissões RLS.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center justify-between">
              <span>Service Role / Secret Key (SUPABASE_SERVICE_ROLE_KEY)</span>
              <span className="text-[10px] text-amber-400 font-normal">Chave Secreta do Servidor</span>
            </label>
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (service_role)"
              value={serviceRoleKey}
              onChange={(e) => setServiceRoleKey(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Usada exclusivamente pelo servidor backend para processar webhooks do WhatsApp e enfileirar mensagens.
            </span>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={salvando}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20"
            >
              <Save className="w-4 h-4" />
              {salvando ? "Salvando..." : "Salvar Credenciais e Conectar"}
            </button>
          </div>
        </form>
      </div>

      {/* Script SQL Master */}
      <div className="glass-panel rounded-3xl p-6 border border-white/10 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span>Script SQL de Instalação do Banco</span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          O arquivo <code className="text-emerald-400 font-mono">banco-instalar-completo.sql</code> contém todas as 15 tabelas, 18 funções com RLS e gatilhos consolidados. Para executar no seu Supabase:
        </p>

        <ol className="list-decimal list-inside text-xs text-slate-300 space-y-1.5 pl-1">
          <li>Abra o painel do seu projeto no Supabase &gt; <strong>SQL Editor</strong>.</li>
          <li>Cole o conteúdo do arquivo <code className="text-emerald-400 font-mono">banco-instalar-completo.sql</code>.</li>
          <li>Clique em <strong>Run</strong> para criar toda a estrutura em uma única transação.</li>
        </ol>

        <button
          onClick={copiarComandoSql}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-white/10 transition"
        >
          <Copy className="w-3.5 h-3.5 text-emerald-400" />
          Copiar Comando de Instalação psql
        </button>
      </div>
    </div>
  );
};

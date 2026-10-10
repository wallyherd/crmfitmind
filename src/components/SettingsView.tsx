import React from "react";
import { MeResposta } from "@/types";
import { supabaseUrlPublica } from "@/lib/supabase";
import { NovaSenhaForm } from "@/components/NovaSenhaForm";
import { Settings, User, Database, KeyRound, Building2 } from "lucide-react";
import { PrivacidadeMentor } from "@/components/PrivacidadeMentor";

interface SettingsViewProps {
  me: MeResposta;
}

const Linha: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-white/5 last:border-0 text-xs">
    <span className="text-slate-400">{rotulo}</span>
    <span className="text-white font-medium text-right break-all">{children}</span>
  </div>
);

export const SettingsView: React.FC<SettingsViewProps> = ({ me }) => {
  const { profile, isAdmin, partners } = me;
  const empresasDoDono = partners.filter((p) => me.donoDe?.includes(p.id));
  const validade = profile.expira_em
    ? new Date(profile.expira_em).toLocaleDateString("pt-BR")
    : "Sem data de expiração";

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-4xl mx-auto">
      <div className="pb-4 border-b border-white/10">
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-red-500" /> Minha Conta
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Dados da sua conta e do projeto em que o CRM está rodando.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel rounded-3xl p-4 md:p-6 border border-white/10 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <User className="w-4 h-4 text-red-500" /> Conta
          </div>
          <div>
            <Linha rotulo="Nome">{profile.name || "—"}</Linha>
            <Linha rotulo="E-mail">{profile.email || "—"}</Linha>
            <Linha rotulo="Telefone">{profile.phone || "—"}</Linha>
            <Linha rotulo="Função">{isAdmin ? "Administrador" : "Mentorado"}</Linha>
            <Linha rotulo="Situação">{profile.status}</Linha>
            <Linha rotulo="Acesso válido até">{validade}</Linha>
          </div>
        </div>

        <div className="glass-panel rounded-3xl p-4 md:p-6 border border-white/10 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <KeyRound className="w-4 h-4 text-red-500" /> Trocar minha senha
          </div>
          <NovaSenhaForm />
        </div>

        <div className="glass-panel rounded-3xl p-4 md:p-6 border border-white/10 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Building2 className="w-4 h-4 text-red-500" /> Empresas com acesso
          </div>
          {partners.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhuma empresa vinculada.</p>
          ) : (
            <ul className="text-xs text-slate-200 space-y-1.5">
              {partners.map((p) => (
                <li key={p.id}>{p.nome}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass-panel rounded-3xl p-4 md:p-6 border border-white/10 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Database className="w-4 h-4 text-red-500" /> Projeto
          </div>
          <Linha rotulo="Supabase (URL pública)">
            <code className="font-mono text-red-400">{supabaseUrlPublica}</code>
          </Linha>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            As chaves do banco ficam só nas variáveis de ambiente do servidor e do build; não são configuradas por
            esta tela.
          </p>
        </div>
      </div>

      {empresasDoDono.map((p) => (
        <PrivacidadeMentor key={p.id} partnerId={p.id} nomeEmpresa={p.nome} ehDono />
      ))}
    </div>
  );
};

import React from "react";
import { Partner, Conexao, Profile } from "@/types";
import { Bot, ShieldCheck, Shield, Building2, Wifi, WifiOff, LogOut, User } from "lucide-react";

interface NavbarProps {
  currentPartner: Partner | null;
  partners: Partner[];
  onSelectPartner: (partner: Partner) => void;
  conexaoAtiva: Conexao | null;
  currentUser?: Profile | null;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentPartner,
  partners,
  onSelectPartner,
  conexaoAtiva,
  currentUser,
  onLogout,
}) => {
  const isConectado = conexaoAtiva?.status === "conectado";

  return (
    <header className="h-16 border-b border-white/10 bg-[#0c0e17]/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-40">
      {/* Brand & Logo */}
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="FitMind" className="h-9 w-auto object-contain" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
              CRM & Robô WhatsApp
            </span>
          </div>
        </div>
      </div>

      {/* Center / Partner Switcher */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 bg-slate-900/90 border border-white/10 rounded-xl px-3 py-1.5 shadow-inner">
          <Building2 className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-slate-400 font-medium">Empresa:</span>
          {partners.length > 0 ? (
            <select
              value={currentPartner?.id || ""}
              onChange={(e) => {
                const found = partners.find((p) => p.id === e.target.value);
                if (found) onSelectPartner(found);
              }}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
            >
              {partners.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                  {p.fantasy_name} {p.city ? `(${p.city})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-amber-400 font-medium">Nenhuma cadastrada</span>
          )}
        </div>
      </div>

      {/* Right / Status & User Actions */}
      <div className="flex items-center gap-3">
        {/* WhatsApp Connection status badge */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
            isConectado
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/10"
              : "bg-amber-500/10 border-amber-500/30 text-amber-300"
          }`}
        >
          {isConectado ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <Wifi className="w-3.5 h-3.5" />
              <span>{conexaoAtiva?.numero ? `WhatsApp: ${conexaoAtiva.numero}` : "Conectado"}</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span>{conexaoAtiva ? `WhatsApp: ${conexaoAtiva.status}` : "WhatsApp Desconectado"}</span>
            </>
          )}
        </div>

        {/* User Info Badge */}
        {currentUser && (
          <div className="flex items-center gap-2 bg-slate-900/90 border border-white/10 px-3 py-1.5 rounded-xl">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              {(currentUser.name || currentUser.email || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <span className="text-xs font-bold text-white block leading-tight truncate max-w-[120px]">
                {currentUser.name || currentUser.email}
              </span>
              <span className="text-[10px] text-emerald-400 font-semibold block uppercase">
                {currentUser.role === "admin" ? "Administrador" : "Cliente"}
              </span>
            </div>
          </div>
        )}

        {/* Logout Button */}
        {onLogout && (
          <button
            onClick={onLogout}
            className="p-2 rounded-xl bg-slate-900 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-white/10 transition"
            title="Sair da Conta"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};

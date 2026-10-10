import React from "react";
import { Conexao, EmpresaAcesso, MeResposta } from "@/types";
import { Building2, Wifi, WifiOff, LogOut } from "lucide-react";
import { formatarTelefone, rotuloStatus } from "@/lib/whatsapp";

interface NavbarProps {
  empresas: EmpresaAcesso[];
  empresaAtualId: string | null;
  onSelecionarEmpresa: (id: string) => void;
  /** Só admin ou quem tem mais de uma empresa escolhe; os demais veem o nome fixo. */
  mostrarSeletor: boolean;
  conexaoAtiva: Conexao | null;
  usuario: MeResposta["profile"] | null;
  isAdmin: boolean;
  onLogout: () => void;
  onAbrirConexao: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  empresas,
  empresaAtualId,
  onSelecionarEmpresa,
  mostrarSeletor,
  conexaoAtiva,
  usuario,
  isAdmin,
  onLogout,
  onAbrirConexao,
}) => {
  const isConectado = conexaoAtiva?.status === "conectado";
  const empresaAtual = empresas.find((e) => e.id === empresaAtualId) || null;
  const textoConexao = isConectado
    ? conexaoAtiva?.numero
      ? `WhatsApp: ${formatarTelefone(conexaoAtiva.numero)}`
      : "WhatsApp conectado"
    : conexaoAtiva
      ? `WhatsApp: ${rotuloStatus(conexaoAtiva.status)}`
      : "WhatsApp desconectado";

  return (
    <header className="h-14 md:h-16 border-b border-white/10 bg-black/90 backdrop-blur-md px-3 md:px-6 flex items-center justify-between gap-2 sticky top-0 z-30">
      {/* Marca */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <img src="/pwa-64x64.png" alt="FitMind" className="md:hidden h-8 w-8 rounded-md" />
        <img src="/marca/logo-escura-recorte.png" alt="FitMind" className="hidden md:block h-11 w-auto object-contain" />
        <span className="hidden lg:inline text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold border border-red-500/30">
          CRM & Robô WhatsApp
        </span>
      </div>

      {/* Empresa */}
      <div className="flex items-center gap-2 bg-[#0d0d0f] border border-white/10 rounded-xl px-2.5 md:px-3 py-1.5 shadow-inner min-w-0">
        <Building2 className="w-4 h-4 text-red-400 shrink-0" />
        <span className="hidden md:inline text-xs text-slate-400 font-medium">Empresa:</span>
        {empresas.length === 0 ? (
          <span className="text-xs text-amber-400 font-medium truncate">Nenhuma vinculada</span>
        ) : mostrarSeletor ? (
          <select
            value={empresaAtualId || ""}
            onChange={(e) => onSelecionarEmpresa(e.target.value)}
            aria-label="Empresa"
            className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer min-w-0 max-w-[110px] sm:max-w-[200px] truncate"
          >
            {empresas.map((p) => (
              <option key={p.id} value={p.id} className="bg-black text-white">
                {p.nome}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-semibold text-white truncate max-w-[110px] sm:max-w-[200px]">
            {empresaAtual?.nome || empresas[0].nome}
          </span>
        )}
      </div>

      {/* Status do WhatsApp e conta */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <button
          type="button"
          onClick={onAbrirConexao}
          title={textoConexao}
          aria-label={textoConexao}
          className={`min-h-[40px] flex items-center gap-2 px-2.5 md:px-3 rounded-xl border text-xs font-medium transition-all ${
            isConectado
              ? "bg-red-500/10 border-red-500/30 text-red-400 shadow-sm shadow-red-500/10"
              : "bg-amber-500/10 border-amber-500/30 text-amber-300"
          }`}
        >
          {isConectado ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <Wifi className="w-3.5 h-3.5 text-red-400" />
            </>
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className="hidden lg:inline">{textoConexao}</span>
        </button>

        {usuario && (
          <div className="hidden sm:flex items-center gap-2 bg-[#0d0d0f] border border-white/10 px-3 py-1.5 rounded-xl">
            <div className="w-6 h-6 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center font-bold text-xs">
              {(usuario.name || usuario.email || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden md:block text-left">
              <span className="text-xs font-bold text-white block leading-tight truncate max-w-[120px]">
                {usuario.name || usuario.email}
              </span>
              <span className="text-[10px] text-red-400 font-semibold block uppercase">
                {isAdmin ? "Administrador" : "Mentorado"}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={onLogout}
          className="hidden md:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-[#0d0d0f] hover:bg-red-600 text-slate-400 hover:text-white border border-white/10 transition shadow-sm"
          title="Sair da Conta"
          aria-label="Sair da conta"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

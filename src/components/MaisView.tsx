import React from "react";
import { Download, LogOut } from "lucide-react";
import { montarMenu } from "@/components/Sidebar";
import type { TabType } from "@/lib/rotas";
import { useInstalarApp } from "@/pwa/useInstalarApp";

interface MaisViewProps {
  onAbrir: (tab: TabType) => void;
  isAdmin: boolean;
  onLogout: () => void;
}

// Estas já estão no menu inferior.
const FORA_DO_MAIS: TabType[] = ["hoje", "conversas", "crm", "vendas"];

/** Menu do celular: tudo que não cabe nos quatro botões do menu inferior. */
export const MaisView: React.FC<MaisViewProps> = ({ onAbrir, isAdmin, onLogout }) => {
  const { instalado, podeInstalar, instalar, dicaIos } = useInstalarApp();
  const itens = montarMenu().filter((i) => !FORA_DO_MAIS.includes(i.id) && (!i.adminOnly || isAdmin));

  return (
    <div className="p-4 space-y-2 max-w-xl mx-auto">
      <h2 className="text-lg font-bold text-white pb-2">Mais</h2>

      {itens.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onAbrir(item.id)}
            className="w-full min-h-[48px] flex items-center gap-3 px-4 rounded-2xl bg-white/[0.03] border border-white/10 text-sm font-semibold text-slate-200 text-left"
          >
            <Icon className="w-4 h-4 text-red-500 shrink-0" />
            {item.label}
          </button>
        );
      })}

      {!instalado && podeInstalar && (
        <button
          type="button"
          onClick={instalar}
          className="w-full min-h-[48px] flex items-center gap-3 px-4 rounded-2xl bg-red-600/15 border border-red-500/30 text-sm font-semibold text-red-200 text-left"
        >
          <Download className="w-4 h-4 shrink-0" />
          Instalar app
        </button>
      )}
      {dicaIos && (
        <p className="text-xs text-slate-400 px-1 leading-relaxed">
          Para instalar no iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início".
        </p>
      )}

      <button
        type="button"
        onClick={onLogout}
        className="w-full min-h-[48px] flex items-center gap-3 px-4 rounded-2xl bg-white/[0.03] border border-white/10 text-sm font-semibold text-slate-300 text-left"
      >
        <LogOut className="w-4 h-4 shrink-0" />
        Sair
      </button>
    </div>
  );
};

import React from "react";
import { CalendarCheck, MessageSquareText, KanbanSquare, CircleDollarSign, Menu } from "lucide-react";
import type { TabType } from "@/lib/rotas";

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  /** Conversas que esperam atendimento humano. */
  conversasPendentes?: number;
}

const ITENS: Array<{ id: TabType; label: string; icon: React.ElementType }> = [
  { id: "hoje", label: "Hoje", icon: CalendarCheck },
  { id: "conversas", label: "Conversas", icon: MessageSquareText },
  { id: "crm", label: "Funil", icon: KanbanSquare },
  { id: "vendas", label: "Vendas", icon: CircleDollarSign },
  { id: "mais", label: "Mais", icon: Menu },
];

// Telas que moram dentro do "Mais" deixam o botão Mais aceso.
const NO_MAIS: TabType[] = ["dashboard", "relatorio", "robo", "disparos", "conectar", "mentoria", "admin", "usuarios", "tokens_ia", "ia", "config"];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, conversasPendentes = 0 }) => (
  <nav
    aria-label="Menu principal"
    className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
  >
    <ul className="grid grid-cols-5">
      {ITENS.map((item) => {
        const Icon = item.icon;
        const ativo = activeTab === item.id || (item.id === "mais" && NO_MAIS.includes(activeTab));
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onTabChange(item.id)}
              aria-current={ativo ? "page" : undefined}
              className={`relative w-full h-16 flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                ativo ? "text-red-400" : "text-slate-400"
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {item.id === "conversas" && conversasPendentes > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-4 text-center">
                    {conversasPendentes > 99 ? "99+" : conversasPendentes}
                  </span>
                )}
              </span>
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
);

import React from "react";
import {
  CalendarCheck,
  LayoutDashboard,
  KanbanSquare,
  Bot,
  MessageSquareText,
  Megaphone,
  Smartphone,
  Building2,
  Users,
  Settings,
  Sparkles,
  CircleDollarSign,
  Brain,
  KeyRound,
  GraduationCap,
} from "lucide-react";
import type { TabType } from "@/lib/rotas";

export type { TabType } from "@/lib/rotas";

export type ItemMenu = {
  id: TabType;
  label: string;
  icon: React.ElementType;
  badge?: number | string;
  section?: string;
  adminOnly?: boolean;
};

export const montarMenu = (unreadCount = 0): ItemMenu[] => [
  { id: "hoje", label: "Hoje", icon: CalendarCheck, section: "PRINCIPAL" },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "crm", label: "Funil de Vendas", icon: KanbanSquare },
  { id: "vendas", label: "Vendas", icon: CircleDollarSign },
  { id: "relatorio", label: "Relatório do dia", icon: Sparkles, section: "INTELIGÊNCIA COMERCIAL" },
  { id: "conectar", label: "Conectar WhatsApp", icon: Smartphone, section: "WHATSAPP" },
  { id: "conversas", label: "Central de Chat", icon: MessageSquareText, badge: unreadCount > 0 ? unreadCount : undefined },
  { id: "robo", label: "Robô & Fluxos", icon: Bot, section: "AUTOMAÇÃO" },
  { id: "disparos", label: "Campanhas / Disparos", icon: Megaphone },
  { id: "mentoria", label: "Mentoria", icon: GraduationCap, section: "ADMINISTRAÇÃO", adminOnly: true },
  { id: "usuarios", label: "Gestão de Usuários", icon: Users, adminOnly: true },
  { id: "admin", label: "Gestão de Empresas", icon: Building2, adminOnly: true },
  { id: "tokens_ia", label: "Tokens de IA", icon: KeyRound, adminOnly: true },
  { id: "ia", label: "Inteligência artificial", icon: Brain, section: "CONFIGURAÇÕES" },
  { id: "config", label: "Minha Conta", icon: Settings, section: "CONTA" },
];

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  unreadCount?: number;
  isAdmin?: boolean;
}

/** Só do tablet para cima; no celular a navegação é o menu inferior (BottomNav). */
export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, unreadCount = 0, isAdmin = false }) => {
  const visibleItems = montarMenu(unreadCount).filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className="hidden md:flex w-64 shrink-0 border-r border-white/10 bg-black flex-col p-3 select-none overflow-y-auto"
      aria-label="Menu principal"
    >
      <nav className="space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <React.Fragment key={item.id}>
              {item.section && (
                <div className="pt-4 pb-1.5 px-3">
                  <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">{item.section}</p>
                </div>
              )}
              <button
                onClick={() => onTabChange(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-red-600/30 via-red-600/20 to-transparent text-white font-bold border border-red-500/40 shadow-sm shadow-red-950/30"
                    : "text-slate-400 hover:text-white hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 transition-colors ${isActive ? "text-red-500" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                    {item.badge}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </nav>
    </aside>
  );
};

import React from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Bot,
  MessageSquareText,
  Megaphone,
  QrCode,
  Building2,
  Users,
  Settings,
  Sparkles,
} from "lucide-react";

export type TabType =
  | "dashboard"
  | "crm"
  | "retroalimentacao"
  | "robo"
  | "conversas"
  | "disparos"
  | "conector"
  | "admin"
  | "usuarios"
  | "config";

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  unreadCount?: number;
  isAdmin?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  unreadCount = 0,
  isAdmin = false,
}) => {
  const menuItems: Array<{
    id: TabType;
    label: string;
    icon: React.ElementType;
    badge?: number | string;
    section?: string;
    adminOnly?: boolean;
  }> = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, section: "PRINCIPAL" },
    { id: "crm", label: "Funil de Vendas", icon: KanbanSquare },
    { id: "retroalimentacao", label: "Retroalimentação IA", icon: Sparkles, section: "INTELIGÊNCIA COMERCIAL" },
    { id: "robo", label: "Robô & Fluxos", icon: Bot, section: "AUTOMAÇÃO & WHATSAPP" },
    { id: "conversas", label: "Central de Chat", icon: MessageSquareText, badge: unreadCount > 0 ? unreadCount : undefined },
    { id: "disparos", label: "Campanhas / Disparos", icon: Megaphone },
    { id: "conector", label: "Conector WhatsApp", icon: QrCode, section: "SISTEMA" },
    { id: "usuarios", label: "Gestão de Usuários", icon: Users, section: "ADMINISTRAÇÃO", adminOnly: true },
    { id: "admin", label: "Gestão de Empresas", icon: Building2, adminOnly: true },
    { id: "config", label: "Configurações & BD", icon: Settings, adminOnly: true },
  ];

  const visibleItems = menuItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="w-64 border-r border-white/10 bg-black flex flex-col justify-between p-3 select-none">
      <div className="space-y-6">
        {/* Navigation Sections */}
        <div className="space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <React.Fragment key={item.id}>
                {item.section && (
                  <div className="pt-4 pb-1.5 px-3">
                    <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                      {item.section}
                    </p>
                  </div>
                )}
                <button
                  onClick={() => onTabChange(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                    isActive
                      ? "bg-gradient-to-r from-red-600/30 via-red-600/20 to-transparent text-white font-bold border border-red-500/40 shadow-sm shadow-red-950/30"
                      : "text-slate-400 hover:text-white hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        isActive ? "text-red-500" : "text-slate-400"
                      }`}
                    />
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
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>Versão Conector</span>
          <span className="font-mono text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded text-[10px]">v1.03.00</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>Status API</span>
          <span className="flex items-center gap-1 text-red-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            Online
          </span>
        </div>
      </div>
    </aside>
  );
};

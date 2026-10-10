// Cada aba do painel tem um endereço, para o link direto (/conectar) e o botão voltar funcionarem.

export type TabType =
  | "dashboard"
  | "hoje"
  | "crm"
  | "vendas"
  | "relatorio"
  | "robo"
  | "conversas"
  | "disparos"
  | "conectar"
  | "mentoria"
  | "admin"
  | "usuarios"
  | "tokens_ia"
  | "ia"
  | "config"
  | "mais";

export const CAMINHO_DA_ABA: Record<TabType, string> = {
  dashboard: "/",
  hoje: "/hoje",
  crm: "/funil",
  vendas: "/vendas",
  relatorio: "/relatorio",
  robo: "/robo",
  conversas: "/conversas",
  disparos: "/disparos",
  conectar: "/conectar",
  mentoria: "/admin/mentoria",
  admin: "/admin/empresas",
  usuarios: "/admin/usuarios",
  tokens_ia: "/admin/tokens-ia",
  ia: "/ia",
  config: "/conta",
  mais: "/mais",
};

const PADRAO_CONVERSA = /^\/conversas\/([^/]+)$/;

// Endereços antigos ou apelidos que levam à mesma tela.
const APELIDOS: Record<string, TabType> = {
  "/conector": "conectar",
  "/painel": "dashboard",
  "/retroalimentacao": "relatorio",
};

export function abaDoCaminho(caminho: string): TabType | null {
  const limpo = (caminho || "/").replace(/\/+$/, "") || "/";
  for (const [aba, alvo] of Object.entries(CAMINHO_DA_ABA)) {
    if (alvo === limpo) return aba as TabType;
  }
  if (PADRAO_CONVERSA.test(limpo)) return "conversas";
  return APELIDOS[limpo] ?? null;
}

export const ABAS_SO_ADMIN: TabType[] = ["mentoria", "admin", "usuarios", "tokens_ia"];

/** Em /conversas/:id devolve o id; fora disso, null. */
export function conversaDoCaminho(caminho: string): string | null {
  const limpo = (caminho || "/").replace(/\/+$/, "");
  const achou = PADRAO_CONVERSA.exec(limpo);
  if (!achou) return null;
  try {
    return decodeURIComponent(achou[1]);
  } catch {
    return null;
  }
}

export const caminhoDaConversa = (id: string | null): string =>
  id ? `${CAMINHO_DA_ABA.conversas}/${encodeURIComponent(id)}` : CAMINHO_DA_ABA.conversas;

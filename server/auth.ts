import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ehUuid, type Contexto } from "./contexto.js";
import type { Db } from "./supabase.js";

export type PerfilAutenticado = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  expira_em: string | null;
};

export type Autenticacao = {
  userId: string;
  profileId: string;
  role: string;
  isAdmin: boolean;
  partnerIds: string[];
  // Papel e permissões em cada empresa (partner_members): a RLS exige 'robo' para o que é do WhatsApp.
  empresas: Record<string, { papel: string; permissoes: string[] }>;
  perfil: PerfilAutenticado;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: Autenticacao;
      corpoBruto?: Buffer;
    }
  }
}

// Caminhos relativos a /api que têm autenticação própria (conector, gateway e cron com CRON_SECRET)
// ou são públicos. Sem ponto no gateway para "/gateway/../x" não escapar.
export const ROTAS_ABERTAS = /^\/(health|bot\/(eventos|fila|confirmar|atualizacao)|gateway(\/[\w-]+)+|cron\/(exportar|ia-enviar|ia-coletar|manutencao|ler-comprovantes))$/;

// Prefixo do token da rotina de IA; a rota /api/ia/* valida.
export const PREFIXO_TOKEN_IA = "crmia_";

export function tokenBearer(req: Request): string {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization || "").trim());
  return m ? m[1] : "";
}

export function podeAcessarPartner(auth: Autenticacao | undefined, partnerId: unknown): boolean {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  return typeof partnerId === "string" && auth.partnerIds.includes(partnerId);
}

// Quem é da empresa: o dono, ou o membro com a permissão ('robo' = WhatsApp, 'crm' = funil). Sem o atalho do admin.
export function ehMembroComPermissao(auth: Autenticacao | undefined, partnerId: unknown, permissao: "robo" | "crm"): boolean {
  if (!auth || typeof partnerId !== "string") return false;
  const m = auth.empresas?.[partnerId];
  return !!m && (m.papel === "owner" || m.permissoes.includes(permissao));
}

// ESTRUTURA da empresa (conexões, quadros, metas, produtos): membro com a permissão ou admin.
// Conteúdo (mensagens, contatos, cartões, vendas, lotes, análises) NÃO passa por aqui: use podeVerConteudo.
export function podeNaEmpresa(auth: Autenticacao | undefined, partnerId: unknown, permissao: "robo" | "crm"): boolean {
  if (!auth) return false;
  return auth.isAdmin || ehMembroComPermissao(auth, partnerId, permissao);
}

export const ERRO_SEM_CONTEUDO = "sem_permissao_conteudo";

// A guarda única do conteúdo, espelho de pode_ver_conteudo() no banco (migração 004): membro com a
// permissão, ou admin quando o dono da empresa liberou (mentor_pode_ver_conversas). O opt-in é lido
// do banco a cada chamada, para desligar valer na hora.
export async function podeVerConteudo(db: Db, auth: Autenticacao | undefined, partnerId: unknown, permissao: "robo" | "crm"): Promise<boolean> {
  if (!auth || typeof partnerId !== "string") return false;
  if (ehMembroComPermissao(auth, partnerId, permissao)) return true;
  if (!auth.isAdmin || !ehUuid(partnerId)) return false;
  const { data, error } = await db.from("partner_acesso_config").select("mentor_pode_ver_conversas").eq("partner_id", partnerId).maybeSingle();
  if (error) throw error;
  return data?.mentor_pode_ver_conversas === true;
}

// Conteúdo de uma conexão (conversas e mensagens). Só a conexão de empresa tem opt-in; a de escopo 'admin'
// é do próprio admin; coach e profissional são só do próprio dono, sem atalho do admin (como no banco).
export async function podeVerConteudoDaConexao(db: Db, auth: Autenticacao | undefined, conexao: { escopo: string; owner_id: string | null }): Promise<boolean> {
  if (conexao.escopo === "parceiro") return podeVerConteudo(db, auth, conexao.owner_id, "robo");
  if (conexao.escopo === "admin") return !!auth?.isAdmin;
  // Coach e profissional (legado): o conteúdo é só do próprio dono, sem atalho do admin — como no banco (conteudo_do_dono).
  return (conexao.escopo === "coach" || conexao.escopo === "profissional") && !!auth && conexao.owner_id === auth.profileId;
}

// Só o dono (papel owner) da empresa, sem o atalho do admin: a privacidade do mentorado é dele.
export function ehDonoMembro(auth: Autenticacao | undefined, partnerId: unknown): boolean {
  return !!auth && typeof partnerId === "string" && auth.empresas?.[partnerId]?.papel === "owner";
}

// Dono da empresa ou admin: configuração (consentimento da IA, motor). O CONTEÚDO que essas rotas tocam
// passa antes por podeVerConteudo.
export function ehDonoDaEmpresa(auth: Autenticacao | undefined, partnerId: unknown): boolean {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  return typeof partnerId === "string" && auth.empresas?.[partnerId]?.papel === "owner";
}

// partnerId pedido na query ou no corpo (o front antigo manda partner_id).
export function partnerIdPedido(req: Request): unknown {
  const q = req.query?.partnerId;
  if (q !== undefined) return q;
  const corpo = req.body && typeof req.body === "object" ? req.body : {};
  if (corpo.partnerId !== undefined && corpo.partnerId !== null && corpo.partnerId !== "") return corpo.partnerId;
  if (corpo.partner_id !== undefined && corpo.partner_id !== null && corpo.partner_id !== "") return corpo.partner_id;
  return undefined;
}

export function criarAutenticacao(ctx: Contexto): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (ROTAS_ABERTAS.test(req.path)) return next();

      const token = tokenBearer(req);
      if (!token) return res.status(401).json({ erro: "nao_autenticado" });
      if (token.startsWith(PREFIXO_TOKEN_IA)) {
        return req.path.startsWith("/ia/") ? next() : res.status(401).json({ erro: "sessao_invalida" });
      }

      const db = ctx.db();
      const { data: dadosUsuario, error: erroUsuario } = await db.auth.getUser(token);
      const usuario = dadosUsuario?.user;
      if (erroUsuario || !usuario) return res.status(401).json({ erro: "sessao_invalida" });

      const { data: perfil, error: erroPerfil } = await db
        .from("profiles")
        .select("id, name, email, phone, role, status, expira_em")
        .eq("user_id", usuario.id)
        .maybeSingle();
      if (erroPerfil) throw erroPerfil;
      if (!perfil) return res.status(403).json({ erro: "sem_perfil" });
      if (perfil.status !== "ativo") return res.status(403).json({ erro: "conta_inativa" });

      const isAdmin = perfil.role === "admin";
      if (!isAdmin && perfil.expira_em && new Date(perfil.expira_em).getTime() < ctx.agora().getTime()) {
        return res.status(403).json({ erro: "acesso_expirado" });
      }

      const { data: membros, error: erroMembros } = await db
        .from("partner_members")
        .select("partner_id, papel, permissoes")
        .eq("profile_id", perfil.id);
      if (erroMembros) throw erroMembros;
      const empresas: Autenticacao["empresas"] = {};
      for (const m of (membros || []) as Array<{ partner_id: string; papel?: string; permissoes?: string[] }>) {
        empresas[m.partner_id] = { papel: m.papel === "owner" ? "owner" : "membro", permissoes: Array.isArray(m.permissoes) ? m.permissoes : [] };
      }

      req.auth = {
        userId: usuario.id,
        profileId: perfil.id,
        role: perfil.role,
        isAdmin,
        partnerIds: Object.keys(empresas),
        empresas,
        perfil: perfil as PerfilAutenticado,
      };

      const pedido = partnerIdPedido(req);
      if (pedido !== undefined && !podeAcessarPartner(req.auth, pedido)) {
        return res.status(403).json({ erro: "sem_acesso" });
      }
      return next();
    } catch (e) {
      return next(e);
    }
  };
}

export const exigirAdmin: RequestHandler = (req, res, next) => {
  if (!req.auth) return res.status(401).json({ erro: "nao_autenticado" });
  if (!req.auth.isAdmin) return res.status(403).json({ erro: "sem_acesso" });
  return next();
};

// Para rotas com :partnerId no caminho (query e corpo já passam pelo middleware).
export const exigirPartner: RequestHandler = (req, res, next) => {
  const pedido = req.params?.partnerId ?? partnerIdPedido(req);
  if (pedido === undefined) return res.status(400).json({ erro: "partnerId é obrigatório" });
  if (!ehUuid(pedido)) return res.status(400).json({ erro: "partnerId inválido" });
  if (!podeAcessarPartner(req.auth, pedido)) return res.status(403).json({ erro: "sem_acesso" });
  return next();
};

// Para rotas do WhatsApp com partnerId na query, no corpo ou no caminho.
export function exigirPermissao(permissao: "robo" | "crm"): RequestHandler {
  return (req, res, next) => {
    const pedido = req.params?.partnerId ?? partnerIdPedido(req);
    if (!podeNaEmpresa(req.auth, pedido, permissao)) return res.status(403).json({ erro: "sem_acesso" });
    return next();
  };
}

// Rotas de conteúdo com partnerId na query, no corpo ou no caminho: sem acesso à empresa é 403 sem_acesso;
// o admin sem o opt-in do dono recebe 403 sem_permissao_conteudo.
export function exigirConteudo(ctx: Contexto, permissao: "robo" | "crm"): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ erro: "nao_autenticado" });
    const pedido = req.params?.partnerId ?? partnerIdPedido(req);
    if (pedido === undefined) return res.status(400).json({ erro: "partnerId é obrigatório" });
    if (!ehUuid(pedido)) return res.status(400).json({ erro: "partnerId inválido" });
    if (!podeNaEmpresa(req.auth, pedido, permissao)) return res.status(403).json({ erro: "sem_acesso" });
    podeVerConteudo(ctx.db(), req.auth, pedido, permissao)
      .then((ok) => (ok ? next() : res.status(403).json({ erro: ERRO_SEM_CONTEUDO })))
      .catch(next);
  };
}

// Compara segredos sem vazar o tamanho nem a posição da diferença.
export function segredoConfere(recebido: unknown, esperado: unknown): boolean {
  if (typeof recebido !== "string" || typeof esperado !== "string" || !recebido || !esperado) return false;
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

const sha256hex = (corpo: Buffer | string) => createHash("sha256").update(corpo).digest("hex");

// hex(HMAC_SHA256(GATEWAY_SECRET, ts.METODO.caminho.sha256(corpo))) — contrato da Fase 1.
export function assinaturaGateway(segredo: string, ts: string, metodo: string, caminho: string, corpo: Buffer | string): string {
  const base = `${ts}.${metodo.toUpperCase()}.${caminho}.${sha256hex(corpo ?? "")}`;
  return createHmac("sha256", segredo).update(base).digest("hex");
}

export const JANELA_GATEWAY_MS = 300_000;

export function assinaturaGatewayValida(req: Request, segredo: string | undefined, agoraMs: number): boolean {
  if (!segredo) return false;
  const ts = String(req.headers["x-gateway-ts"] || "");
  const assinatura = String(req.headers["x-gateway-assinatura"] || "");
  if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(assinatura)) return false;
  if (Math.abs(agoraMs - Number(ts)) > JANELA_GATEWAY_MS) return false;
  const caminho = req.originalUrl.split("?")[0];
  const esperada = assinaturaGateway(segredo, ts, req.method, caminho, req.corpoBruto ?? "");
  return timingSafeEqual(Buffer.from(esperada, "hex"), Buffer.from(assinatura.toLowerCase(), "hex"));
}

import type { RequestHandler } from "express";
import { partnerIdPedido, podeNaEmpresa } from "../auth.js";
import { ehUuid } from "../contexto.js";
import type { Db } from "../supabase.js";

// Rotas de ESTRUTURA do mentorado (config, produtos, metas, rastreamento): login (JWT) e a permissão 'crm' na
// empresa pedida; o admin passa. Rota que lê ou grava CONTEÚDO usa exigirConteudo (server/auth.ts). Token crmia_ não entra aqui.
export const exigirCrm: RequestHandler = (req, res, next) => {
  if (!req.auth) return res.status(401).json({ erro: "nao_autenticado" });
  const pedido = partnerIdPedido(req);
  if (pedido === undefined) return res.status(400).json({ erro: "partnerId é obrigatório" });
  if (!ehUuid(pedido)) return res.status(400).json({ erro: "partnerId inválido" });
  if (!podeNaEmpresa(req.auth, pedido, "crm")) return res.status(403).json({ erro: "sem_acesso" });
  return next();
};

export const partnerDoPedido = (req: Parameters<RequestHandler>[0]): string => String(partnerIdPedido(req));

export function diaValido(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Dia de hoje no fuso da empresa (AAAA-MM-DD).
export function hojeNoFuso(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

// Só as empresas que escolheram a rotina do dono, autorizaram o envio das conversas e mantêm a liberação do
// mentor: estar no token não basta, e desligar a liberação para a rotina na hora.
export async function empresasDaRotina(db: Db, partnerIds: string[]): Promise<string[]> {
  if (partnerIds.length === 0) return [];
  const { data, error } = await db
    .from("ia_retroalimentacao_config")
    .select("partner_id")
    .in("partner_id", partnerIds)
    .eq("motor", "rotina_dono")
    .not("consentimento_ia_em", "is", null);
  if (error) throw error;
  const candidatas = (data || []).map((c: { partner_id: string }) => c.partner_id);
  if (candidatas.length === 0) return [];
  const { data: liberadas, error: erroLiberacao } = await db
    .from("partner_acesso_config")
    .select("partner_id")
    .in("partner_id", candidatas)
    .eq("mentor_pode_ver_conversas", true);
  if (erroLiberacao) throw erroLiberacao;
  const ok = new Set((liberadas || []).map((c: { partner_id: string }) => c.partner_id));
  return candidatas.filter((id) => ok.has(id));
}

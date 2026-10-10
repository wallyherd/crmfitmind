// Visão do mentor (admin) e privacidade do mentorado. O mentor vê números, estados e o resumo do dia de
// todas as empresas; o conteúdo (contatos, conversas) só nas que o dono liberou (mentor_pode_ver_conversas).
import type { Express } from "express";
import { ehDonoMembro, exigirAdmin, podeAcessarPartner, podeVerConteudo } from "../auth.js";
import { assincrono, ehUuid, type Contexto } from "../contexto.js";
import { diaValido, hojeNoFuso } from "../ia/acesso.js";
import { fusoValido } from "../arquivo-completo.js";
import { montarRelatorioDia } from "./relatorios.js";

const privacidadeParaTela = (c: { mentor_pode_ver_conversas?: boolean | null; mentor_pode_ver_conversas_em?: string | null } | null) => ({
  mentorPodeVerConversas: c?.mentor_pode_ver_conversas === true,
  mentorPodeVerConversasEm: c?.mentor_pode_ver_conversas_em ?? null,
});

export function registrarRotasMentor(app: Express, ctx: Contexto) {
  // Uma linha por empresa ativa (mentor_painel): números do dia, conexões, metas, alertas e o opt-in.
  // Sem telefone, sem nome de contato, sem texto de mensagem: nada disto precisa do opt-in.
  app.get(
    "/api/mentor/painel",
    exigirAdmin,
    assincrono(async (req, res) => {
      const dia = req.query.dia;
      if (dia !== undefined && !diaValido(dia)) return res.status(400).json({ erro: "dia inválido (use AAAA-MM-DD)" });
      const { data, error } = await ctx.db().rpc("mentor_painel", { _dia: dia ?? null });
      if (error) throw error;
      return res.json({ dia: dia ?? null, empresas: data || [] });
    }),
  );

  // Números e resumo do dia de uma empresa; os contatos (nome e telefone) só com o opt-in.
  app.get(
    "/api/mentor/empresas/:partnerId/relatorio",
    exigirAdmin,
    assincrono(async (req, res) => {
      const { partnerId } = req.params;
      if (!ehUuid(partnerId)) return res.status(400).json({ erro: "partnerId inválido" });
      const db = ctx.db();
      const { data: empresa, error } = await db.from("partners").select("id, fantasy_name").eq("id", partnerId).maybeSingle();
      if (error) throw error;
      if (!empresa) return res.status(404).json({ erro: "nao_encontrado" });

      let dia = req.query.dia;
      if (dia === undefined) {
        const { data: cfg } = await db.from("partner_acesso_config").select("timezone").eq("partner_id", partnerId).maybeSingle();
        dia = hojeNoFuso(ctx.agora(), fusoValido(cfg?.timezone));
      }
      if (!diaValido(dia)) return res.status(400).json({ erro: "dia inválido (use AAAA-MM-DD)" });

      const optIn = await podeVerConteudo(db, req.auth, partnerId, "crm");
      const relatorio = await montarRelatorioDia(db, partnerId, dia, optIn);
      return res.json({ empresa: { id: empresa.id, nome: empresa.fantasy_name }, opt_in: optIn, ...relatorio });
    }),
  );

  // Privacidade do mentorado. Ler: quem é da empresa (ou o admin). Mudar: só o dono, nunca o admin.
  app.get(
    "/api/empresa/privacidade",
    assincrono(async (req, res) => {
      const partnerId = req.query.partnerId;
      if (!ehUuid(partnerId)) return res.status(400).json({ erro: "partnerId inválido" });
      if (!podeAcessarPartner(req.auth, partnerId)) return res.status(403).json({ erro: "sem_acesso" });
      const { data, error } = await ctx
        .db()
        .from("partner_acesso_config")
        .select("mentor_pode_ver_conversas, mentor_pode_ver_conversas_em")
        .eq("partner_id", partnerId)
        .maybeSingle();
      if (error) throw error;
      return res.json(privacidadeParaTela(data));
    }),
  );

  app.put(
    "/api/empresa/privacidade",
    assincrono(async (req, res) => {
      const corpo = req.body && typeof req.body === "object" ? req.body : {};
      const partnerId = corpo.partnerId ?? corpo.partner_id ?? req.query.partnerId;
      if (!ehUuid(partnerId)) return res.status(400).json({ erro: "partnerId inválido" });
      if (typeof corpo.mentorPodeVerConversas !== "boolean") return res.status(400).json({ erro: "mentorPodeVerConversas deve ser true ou false" });
      if (!ehDonoMembro(req.auth, partnerId)) return res.status(403).json({ erro: "so_o_dono" });

      const { data, error } = await ctx
        .db()
        .rpc("empresa_definir_privacidade", { _partner_id: partnerId, _profile_id: req.auth!.profileId, _mentor_pode_ver: corpo.mentorPodeVerConversas });
      if (error) {
        // O banco confere de novo: dono com o acesso vencido não consegue liberar (desligar sempre pode).
        if (error.code === "42501" || /so_o_dono/.test(String(error.message))) return res.status(403).json({ erro: "so_o_dono" });
        throw error;
      }
      return res.json(privacidadeParaTela(data));
    }),
  );
}

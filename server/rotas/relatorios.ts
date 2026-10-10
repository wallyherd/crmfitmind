// Relatório do dia e "o que fazer agora". Os números vêm do SQL (crm_metricas_dia, crm_pendencias);
// a IA só entra com o resumo e a análise por contato, e o telefone é resolvido aqui, para a tela do dono.
import type { Express } from "express";
import { fusoValido } from "../arquivo-completo.js";
import { exigirConteudo } from "../auth.js";
import { assincrono, type Contexto } from "../contexto.js";
import { diaValido, partnerDoPedido } from "../ia/acesso.js";
import type { Db } from "../supabase.js";

type LinhaLote = { status: string; partes: number; motor: string | null; versao: number };

// Estado único para as partes da versão mais nova do dia.
export function estadoDoLote(linhas: LinhaLote[], motorDaAnalise: string | null) {
  const vivas = linhas.filter((l) => l.status !== "expirado" && l.status !== "ignorado");
  if (vivas.length === 0) return { status: "sem_lote", partes: 0, motor: null };
  const versao = Math.max(...vivas.map((l) => l.versao));
  const daVersao = vivas.filter((l) => l.versao === versao);
  const tem = (...s: string[]) => daVersao.some((l) => s.includes(l.status));
  const status = tem("erro") ? "erro" : tem("reservado") ? "reservado" : daVersao.every((l) => l.status === "concluido") ? "concluido" : "pronto";
  return { status, partes: Math.max(...daVersao.map((l) => l.partes)), motor: motorDaAnalise ?? daVersao[0].motor ?? null };
}

async function contatosDoRelatorio(db: Db, partnerId: string, leads: any[]) {
  const ids = leads.map((l) => l?.contato_id).filter(Boolean);
  const porId = new Map<string, any>();
  if (ids.length) {
    const { data, error } = await db.from("contatos").select("id, nome, telefone, categoria").eq("partner_id", partnerId).in("id", ids);
    if (error) throw error;
    for (const c of data || []) porId.set(c.id, c);
  }
  return leads
    .filter((l) => l?.contato_id)
    .map((l) => {
      const c = porId.get(l.contato_id);
      const pa = l.proxima_acao && typeof l.proxima_acao === "object" ? l.proxima_acao : null;
      return {
        contato_id: l.contato_id,
        nome: c?.nome ?? null,
        telefone: c?.telefone ?? null,
        categoria: c?.categoria ?? l.categoria,
        confianca: typeof l.confianca === "number" ? l.confianca : null,
        etapa_funil: l.etapa_funil ?? null,
        tags: Array.isArray(l.tags) ? l.tags : [],
        status_comercial: l.status_comercial ?? null,
        riscos: Array.isArray(l.riscos) ? l.riscos : [],
        motivo_perda: l.motivo_perda ?? null,
        proxima_acao: pa && pa.tipo !== "nenhuma" ? { tipo: pa.tipo, em_dias: pa.em_dias ?? null, prioridade: pa.prioridade ?? "media", mensagem_sugerida: pa.mensagem_sugerida ?? null } : null,
        sugestao_id: l.sugestao_id ?? null,
        produto_sugerido: l.produto_sugerido ?? null,
        como_abordar: l.como_abordar ?? null,
        resumo: l.resumo ?? null,
      };
    });
}

// Números do dia de UMA empresa. O texto da análise (resumo e contatos) só entra com comContatos: o resumo cita
// o primeiro nome, o que a pessoa disse e o valor das vendas. Sem o opt-in do dono, o mentor vê os números e se há análise.
export async function montarRelatorioDia(db: Db, partnerId: string, dia: string, comContatos: boolean) {
  const { data: cfg } = await db.from("partner_acesso_config").select("timezone").eq("partner_id", partnerId).maybeSingle();
  const fuso = fusoValido(cfg?.timezone);

  const [metricas, lotes, relatorio] = await Promise.all([
    db.rpc("crm_metricas_dia", { _partner_id: partnerId, _dia: dia }),
    db.from("ia_lotes").select("status, partes, motor, versao").eq("partner_id", partnerId).eq("dia", dia),
    db.from("ia_relatorios_diarios").select(comContatos ? "resumo, leads_analisados, analise_id, engine" : "analise_id, engine").eq("partner_id", partnerId).eq("data_referencia", dia).maybeSingle(),
  ]);
  if (metricas.error) throw metricas.error;
  if (lotes.error) throw lotes.error;
  if (relatorio.error) throw relatorio.error;

  const rel = relatorio.data as { resumo?: unknown; leads_analisados?: unknown; analise_id?: string | null; engine?: string | null } | null;
  const temAnalise = !!rel?.analise_id && (!comContatos || !!rel.resumo);
  const analise = !temAnalise
    ? null
    : comContatos
      ? { resumo: rel!.resumo, texto_oculto: false, contatos: await contatosDoRelatorio(db, partnerId, Array.isArray(rel!.leads_analisados) ? rel!.leads_analisados : []) }
      : { resumo: null, texto_oculto: true, contatos: [] };
  return {
    dia,
    fuso,
    metricas: metricas.data,
    lote: estadoDoLote((lotes.data || []) as LinhaLote[], temAnalise ? rel?.engine ?? null : null),
    analise,
  };
}

export function registrarRotasRelatorios(app: Express, ctx: Contexto) {
  app.get(
    "/api/relatorios/dia",
    exigirConteudo(ctx, "crm"),
    assincrono(async (req, res) => {
      const dia = req.query.dia;
      if (!diaValido(dia)) return res.status(400).json({ erro: "dia inválido (use AAAA-MM-DD)" });
      return res.json(await montarRelatorioDia(ctx.db(), partnerDoPedido(req), dia, true));
    }),
  );

  app.get(
    "/api/pendencias",
    exigirConteudo(ctx, "crm"),
    assincrono(async (req, res) => {
      const { data, error } = await ctx.db().rpc("crm_pendencias", { _partner_id: partnerDoPedido(req), _corte: ctx.agora().toISOString(), _limite: 50 });
      if (error) throw error;
      const lista = (data || []) as any[];
      return res.json(
        lista
          .filter((p) => p.contato_id)
          .map((p) => ({
            contato_id: p.contato_id,
            nome: p.nome ?? null,
            telefone: p.telefone ?? null,
            motivo: p.motivo,
            ha_horas: p.ha_horas === null || p.ha_horas === undefined ? null : Number(p.ha_horas),
            etapa: p.etapa ?? null,
            mensagem_sugerida: p.mensagem_sugerida ?? null,
            sugestao_id: p.sugestao_id ?? null,
          })),
      );
    }),
  );
}

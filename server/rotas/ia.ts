// Rotas da IA: configuração, correções do mentorado, motor manual (baixar o lote e importar a análise),
// rotina do dono (token crmia_) e administração dos tokens. A rota é quem valida o crmia_ (o middleware
// só o deixa passar em /api/ia/*): um token nunca abre rota de outro assunto e só enxerga os partners dele.
import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, RequestHandler } from "express";
import { ERRO_SEM_CONTEUDO, PREFIXO_TOKEN_IA, ehDonoDaEmpresa, ehDonoMembro, exigirConteudo, podeNaEmpresa, podeVerConteudo, tokenBearer } from "../auth.js";
import { assincrono, ehUuid, texto, type Contexto } from "../contexto.js";
import { fusoValido } from "../arquivo-completo.js";
import { diaValido, empresasDaRotina, exigirCrm, hojeNoFuso, partnerDoPedido } from "../ia/acesso.js";
import { aplicarResultado, type Principal } from "../ia/aplicar.js";
import { apagarComprovantes } from "../comprovantes.js";
import { apagarArquivos, baixarArquivo, montarLoteTxt } from "../ia/arquivos.js";
import { CATEGORIAS } from "../ia/contrato.js";
import { analisarLoteAgora } from "../ia/motor-api.js";
import { exportarDia } from "./cron.js";
import type { Db } from "../supabase.js";

const sha256hex = (t: string) => createHash("sha256").update(t).digest("hex");
const MOTORES = ["api_batch", "manual", "rotina_dono"];
const CATEGORIAS_CORRECAO = ["nao_classificado", ...CATEGORIAS, "grupo"];
const ORIGENS_CORRECAO = ["trafego_pago", "organico", "indicacao", "desconhecido"];

type TokenIa = { id: string; partnerIds: string[]; escopos: string[] };

async function tokenDaRequisicao(db: Db, req: Request): Promise<TokenIa | null> {
  const bruto = tokenBearer(req);
  if (!bruto.startsWith(PREFIXO_TOKEN_IA)) return null;
  const { data, error } = await db.from("ia_tokens").select("id, partner_ids, escopos, revogado_em").eq("token_hash", sha256hex(bruto)).maybeSingle();
  if (error) throw error;
  if (!data || data.revogado_em) return null;
  await db.from("ia_tokens").update({ ultimo_uso_em: new Date().toISOString() }).eq("id", data.id);
  return { id: data.id, partnerIds: data.partner_ids ?? [], escopos: data.escopos ?? [] };
}

const exigirLogin: RequestHandler = (req, res, next) => (req.auth ? next() : res.status(401).json({ erro: "nao_autenticado" }));

export function registrarRotasIa(app: Express, ctx: Contexto) {
  // Exige token crmia_ válido com o escopo; deixa o token em res.locals.
  const exigirToken =
    (escopo: string): RequestHandler =>
    (req, res, next) => {
      tokenDaRequisicao(ctx.db(), req)
        .then((t) => {
          if (!t) return res.status(401).json({ erro: "token_invalido" });
          if (!t.escopos.includes(escopo)) return res.status(403).json({ erro: "sem_escopo" });
          res.locals.token = t;
          return next();
        })
        .catch(next);
    };

  // ----------------------------------------------------------------- configuração
  const configParaTela = (c: any) => ({
    motor: c?.motor ?? "manual",
    consentimento_ia_em: c?.consentimento_ia_em ?? null,
    limiar_confianca: c?.limiar_confianca === undefined || c?.limiar_confianca === null ? 0.75 : Number(c.limiar_confianca),
    autoconfirmar_pix: c?.autoconfirmar_pix === true,
    teto_autoconfirmacao: c?.teto_autoconfirmacao === undefined || c?.teto_autoconfirmacao === null ? 2000 : Number(c.teto_autoconfirmacao),
  });
  const COLUNAS_CONFIG = "motor, consentimento_ia_em, limiar_confianca, autoconfirmar_pix, teto_autoconfirmacao";

  app.get(
    "/api/ia/config",
    exigirCrm,
    assincrono(async (req, res) => {
      const { data, error } = await ctx.db().from("ia_retroalimentacao_config").select(COLUNAS_CONFIG).eq("partner_id", partnerDoPedido(req)).maybeSingle();
      if (error) throw error;
      return res.json(configParaTela(data));
    }),
  );

  app.put(
    "/api/ia/config",
    exigirCrm,
    assincrono(async (req, res) => {
      const partnerId = partnerDoPedido(req);
      const corpo = req.body ?? {};
      const db = ctx.db();
      const { data: atual, error } = await db.from("ia_retroalimentacao_config").select(COLUNAS_CONFIG).eq("partner_id", partnerId).maybeSingle();
      if (error) throw error;

      const mudancas: Record<string, unknown> = {};
      // O consentimento LGPD e a escolha de quem recebe as conversas são do dono da empresa. O admin só liga a rotina do dono
      // (que já exige o opt-in) e pode voltar para o manual, que não manda nada para fora.
      const soDono = corpo.consentir === true || corpo.consentir === false || (corpo.motor !== undefined && corpo.motor !== "rotina_dono" && corpo.motor !== "manual");
      const motorDoAdmin = corpo.motor === "rotina_dono" || corpo.motor === "manual";
      if (soDono && !ehDonoMembro(req.auth, partnerId)) return res.status(403).json({ erro: "so_o_dono" });
      if (motorDoAdmin && !ehDonoDaEmpresa(req.auth, partnerId)) return res.status(403).json({ erro: "so_o_dono" });
      if (corpo.consentir === true) mudancas.consentimento_ia_em = ctx.agora().toISOString();
      if (corpo.consentir === false) mudancas.consentimento_ia_em = null;
      if (corpo.motor !== undefined) {
        if (!MOTORES.includes(corpo.motor)) return res.status(400).json({ erro: "motor inválido" });
        // A rotina do dono usa a conta Claude do Erick: só o admin liga.
        if (corpo.motor === "rotina_dono" && !req.auth!.isAdmin) return res.status(403).json({ erro: "motor_so_do_admin" });
        // E ela entrega o texto das conversas ao mentor: só com a liberação do dono (ou se ele for da empresa).
        if (corpo.motor === "rotina_dono" && !(await podeVerConteudo(db, req.auth, partnerId, "crm"))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
        mudancas.motor = corpo.motor;
      }
      if (corpo.limiar_confianca !== undefined) {
        const n = Number(corpo.limiar_confianca);
        if (!Number.isFinite(n) || n < 0 || n > 1) return res.status(400).json({ erro: "limiar_confianca deve ficar entre 0 e 1" });
        mudancas.limiar_confianca = n;
      }
      if (corpo.autoconfirmar_pix !== undefined) mudancas.autoconfirmar_pix = corpo.autoconfirmar_pix === true;
      if (corpo.teto_autoconfirmacao !== undefined) {
        const n = Number(corpo.teto_autoconfirmacao);
        if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return res.status(400).json({ erro: "teto_autoconfirmacao inválido" });
        mudancas.teto_autoconfirmacao = n;
      }
      // LGPD: as conversas só vão para a Anthropic depois do consentimento da empresa.
      let motorFinal = (mudancas.motor ?? atual?.motor ?? "manual") as string;
      const consentimentoFinal = (mudancas.consentimento_ia_em !== undefined ? mudancas.consentimento_ia_em : atual?.consentimento_ia_em) as string | null | undefined;
      if (corpo.consentir === false && motorFinal !== "manual") {
        // Retirar a autorização desliga o que envia as conversas para fora; "manual" é o mentorado levando o arquivo por conta própria.
        mudancas.motor = motorFinal = "manual";
      }
      if ((motorFinal === "api_batch" || motorFinal === "rotina_dono") && !consentimentoFinal) return res.status(409).json({ erro: "consentimento_necessario" });

      const { data, error: e2 } = await db
        .from("ia_retroalimentacao_config")
        .upsert({ partner_id: partnerId, ...mudancas }, { onConflict: "partner_id" })
        .select(COLUNAS_CONFIG)
        .single();
      if (e2) throw e2;
      return res.json(configParaTela(data));
    }),
  );

  // ------------------------------------------------------- correções do mentorado
  app.patch(
    "/api/contatos/:id",
    exigirLogin,
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!ehUuid(req.params.id)) return res.status(400).json({ erro: "id inválido" });
      const { data: contato, error } = await db.from("contatos").select("id, partner_id, campos_travados").eq("id", req.params.id).maybeSingle();
      if (error) throw error;
      if (!contato || !podeNaEmpresa(req.auth, contato.partner_id, "crm")) return res.status(404).json({ erro: "nao_encontrado" });
      if (!(await podeVerConteudo(db, req.auth, contato.partner_id, "crm"))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });

      const corpo = req.body ?? {};
      const mudancas: Record<string, unknown> = {};
      // O gatilho do banco marca fonte 'manual', trava o campo e grava o ia_feedback da correção.
      if (corpo.categoria !== undefined) {
        if (!CATEGORIAS_CORRECAO.includes(corpo.categoria)) return res.status(400).json({ erro: "categoria inválida" });
        mudancas.categoria = corpo.categoria;
      }
      if (corpo.origem_tipo !== undefined) {
        if (!ORIGENS_CORRECAO.includes(corpo.origem_tipo)) return res.status(400).json({ erro: "origem_tipo inválido" });
        mudancas.origem_tipo = corpo.origem_tipo;
      }
      let tags: string[] | null = null;
      if (corpo.tags !== undefined) {
        if (!Array.isArray(corpo.tags) || corpo.tags.length > 10) return res.status(400).json({ erro: "tags deve ser uma lista de até 10 itens" });
        tags = [...new Set(corpo.tags.map((t: unknown) => texto(t).toLowerCase().slice(0, 30)).filter(Boolean))] as string[];
        mudancas.campos_travados = [...new Set([...(contato.campos_travados ?? []), "tags"])];
      }
      if (Object.keys(mudancas).length === 0) return res.status(400).json({ erro: "nada para alterar" });

      if (tags) {
        const aplicou = await trocarTags(db, contato.id, tags);
        if (!aplicou) return res.status(409).json({ erro: "contato_sem_cartao" });
      }
      const { data, error: e2 } = await db.from("contatos").update({ ...mudancas, updated_at: ctx.agora().toISOString() }).eq("id", contato.id).select("id, categoria, origem_tipo, campos_travados").single();
      if (e2) throw e2;
      return res.json({ ...data, ...(tags ? { tags } : {}) });
    }),
  );

  // Pedido do titular (LGPD): apaga a pessoa de todas as tabelas e os .txt do Storage que tinham a conversa dela.
  app.delete(
    "/api/contatos/:id",
    exigirLogin,
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!ehUuid(req.params.id)) return res.status(400).json({ erro: "id inválido" });
      const { data: contato, error } = await db.from("contatos").select("id, partner_id").eq("id", req.params.id).maybeSingle();
      if (error) throw error;
      // Quem não é da empresa vê o mesmo que contato inexistente; dentro dela, só o dono apaga uma pessoa.
      if (!contato || !podeNaEmpresa(req.auth, contato.partner_id, "crm")) return res.status(404).json({ erro: "nao_encontrado" });
      if (!(await podeVerConteudo(db, req.auth, contato.partner_id, "crm"))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      if (!ehDonoMembro(req.auth, contato.partner_id)) return res.status(403).json({ erro: "so_o_dono" });
      const { data, error: e2 } = await db.rpc("lgpd_apagar_contato", { _contato_id: contato.id });
      if (e2) throw e2;
      const arquivos: string[] = Array.isArray(data?.arquivos) ? data.arquivos : [];
      let falhaArquivos: string | null = null;
      if (arquivos.length) {
        falhaArquivos = await apagarArquivos(db, arquivos);
        if (!falhaArquivos) {
          const { error: e3 } = await db.rpc("ia_marcar_arquivos_apagados", { _caminhos: arquivos });
          if (e3) console.error("[lgpd] arquivos apagados, mas a marca no banco falhou:", e3.message);
        } else {
          // O banco já apagou e deixou os lotes marcados como pendentes: /api/cron/manutencao tenta apagar de novo.
          console.error("[lgpd] contato apagado, mas arquivos do Storage ficaram:", falhaArquivos);
        }
      }
      // Os comprovantes (imagem/PDF) que a pessoa mandou: o banco já os deixou na fila de apagar; se o Storage falhar,
      // a manutenção tenta de novo.
      const comprovantes: string[] = Array.isArray(data?.comprovantes_apagar) ? data.comprovantes_apagar : [];
      let falhaComprovantes: string | null = null;
      if (comprovantes.length) {
        falhaComprovantes = (await apagarComprovantes(db, comprovantes)).falha;
        if (falhaComprovantes) console.error("[lgpd] contato apagado, mas comprovantes do Storage ficaram:", falhaComprovantes);
      }
      return res.json({
        ok: true,
        apagado: data?.apagado === true,
        ...(falhaArquivos ? { arquivos_com_falha: arquivos } : {}),
        ...(falhaComprovantes ? { comprovantes_com_falha: comprovantes } : {}),
      });
    }),
  );

  app.post(
    "/api/ia/sugestoes/:id",
    exigirLogin,
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!ehUuid(req.params.id)) return res.status(400).json({ erro: "id inválido" });
      const { data: sugestao, error } = await db.from("ia_sugestoes").select("id, partner_id").eq("id", req.params.id).maybeSingle();
      if (error) throw error;
      if (!sugestao || !podeNaEmpresa(req.auth, sugestao.partner_id, "crm")) return res.status(404).json({ erro: "nao_encontrado" });
      if (!(await podeVerConteudo(db, req.auth, sugestao.partner_id, "crm"))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      const { acao, texto_final, motivo } = req.body ?? {};
      if (!["usou", "editou", "descartou"].includes(acao)) return res.status(400).json({ erro: "acao deve ser usou, editou ou descartou" });
      const { error: e2 } = await db.rpc("ia_responder_sugestao", {
        _id: sugestao.id,
        _acao: acao,
        _texto_final: texto(texto_final).slice(0, 1000) || null,
        _motivo: texto(motivo).slice(0, 200) || null,
        _profile_id: req.auth!.profileId,
      });
      if (e2) throw e2;
      return res.json({ ok: true });
    }),
  );

  // ----------------------------------------------------------------- motor manual
  app.get(
    "/api/ia/lotes",
    exigirConteudo(ctx, "crm"),
    assincrono(async (req, res) => {
      const dia = req.query.dia;
      if (typeof dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return res.status(400).json({ erro: "dia inválido (use AAAA-MM-DD)" });
      const { data, error } = await ctx
        .db()
        .from("ia_lotes")
        .select("id, dia, parte, versao, status, tokens_estimados")
        .eq("partner_id", partnerDoPedido(req))
        .eq("dia", dia)
        .in("status", ["pronto", "reservado", "concluido", "erro"])
        .order("parte", { ascending: true });
      if (error) throw error;
      const linhas = (data || []) as any[];
      const versao = Math.max(0, ...linhas.map((l) => l.versao));
      return res.json(linhas.filter((l) => l.versao === versao).map(({ id, dia: d, parte, status, tokens_estimados }) => ({ id, dia: String(d).slice(0, 10), parte, status, tokens_estimados })));
    }),
  );

  app.get(
    "/api/ia/lotes/:id/arquivo",
    exigirLogin,
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!ehUuid(req.params.id)) return res.status(400).json({ erro: "id inválido" });
      const { data: lote, error } = await db.from("ia_lotes").select("id, partner_id, status, arquivo_path, arquivo_apagado_em").eq("id", req.params.id).maybeSingle();
      if (error) throw error;
      if (!lote || !podeNaEmpresa(req.auth, lote.partner_id, "crm")) return res.status(404).json({ erro: "nao_encontrado" });
      // O texto das mensagens é do WhatsApp ('robo'), como na tela de conversas: quem só tem o funil não o lê por aqui.
      if (!podeNaEmpresa(req.auth, lote.partner_id, "robo")) return res.status(403).json({ erro: "sem_acesso" });
      if (!(await podeVerConteudo(db, req.auth, lote.partner_id, "crm")) || !(await podeVerConteudo(db, req.auth, lote.partner_id, "robo"))) {
        return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      }
      if (!["pronto", "reservado", "concluido", "erro"].includes(lote.status)) return res.status(409).json({ erro: `lote_${lote.status}` });
      const txt = await montarLoteTxt(db, lote, null);
      if (txt === null) return res.status(410).json({ erro: "arquivo_apagado" });
      return res.type("text/plain; charset=utf-8").send(txt);
    }),
  );

  // ------------------------------------------------- teste no mesmo dia (sem esperar o cron das 04:30)
  // Só o dono da empresa ou o admin com o opt-in de conteúdo. Gera uma versão nova do lote; se o dia já está em análise
  // ou concluído, a montagem do banco recusa e o lote existente fica como está (409).
  app.post(
    "/api/ia/lotes/gerar",
    exigirConteudo(ctx, "crm"),
    assincrono(async (req, res) => {
      const partnerId = partnerDoPedido(req);
      if (!ehDonoDaEmpresa(req.auth, partnerId)) return res.status(403).json({ erro: "so_o_dono" });
      const db = ctx.db();
      const { data: cfg, error } = await db.from("partner_acesso_config").select("timezone").eq("partner_id", partnerId).maybeSingle();
      if (error) throw error;
      const fuso = fusoValido(cfg?.timezone);
      const agora = ctx.agora();
      const hoje = hojeNoFuso(agora, fuso);
      const dia = req.body?.dia === undefined || req.body?.dia === null || req.body?.dia === "" ? hoje : req.body.dia;
      if (!diaValido(dia)) return res.status(400).json({ erro: "dia inválido (use AAAA-MM-DD)" });
      const limite = hojeNoFuso(new Date(agora.getTime() - 7 * 864e5), fuso);
      if (dia > hoje || dia < limite) return res.status(400).json({ erro: `dia fora do intervalo (de ${limite} até ${hoje})` });
      const hora = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
      try {
        const lotes = await exportarDia(db, partnerId, dia, dia === hoje ? hora : undefined);
        return res.json({ lotes });
      } catch (e) {
        const msg = String((e as { message?: unknown })?.message ?? e);
        if (/ja esta em analise|esta sendo gerado/.test(msg)) return res.status(409).json({ erro: "lote_em_andamento", mensagem: "Esse dia já está em análise, foi concluído ou está sendo gerado." });
        throw e;
      }
    }),
  );

  // Teste do motor automático: manda só este lote para a API, direto (não é Batch: é teste e a resposta volta na hora).
  app.post(
    "/api/ia/lotes/:id/analisar-agora",
    exigirLogin,
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!ehUuid(req.params.id)) return res.status(400).json({ erro: "id inválido" });
      const { data: lote, error } = await db.from("ia_lotes").select("id, partner_id, dia, arquivo_path, arquivo_apagado_em").eq("id", req.params.id).maybeSingle();
      if (error) throw error;
      if (!lote || !podeNaEmpresa(req.auth, lote.partner_id, "crm")) return res.status(404).json({ erro: "nao_encontrado" });
      if (!(await podeVerConteudo(db, req.auth, lote.partner_id, "crm"))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      if (!ehDonoDaEmpresa(req.auth, lote.partner_id)) return res.status(403).json({ erro: "so_o_dono" });
      const { data: cfg, error: e2 } = await db.from("ia_retroalimentacao_config").select("motor, consentimento_ia_em").eq("partner_id", lote.partner_id).maybeSingle();
      if (e2) throw e2;
      if (cfg?.motor !== "api_batch") return res.status(409).json({ erro: "motor_nao_e_api_batch" });
      if (!cfg.consentimento_ia_em) return res.status(409).json({ erro: "consentimento_necessario" });
      let cliente;
      try {
        cliente = ctx.anthropic();
      } catch {
        return res.status(503).json({ erro: "ia_indisponivel", mensagem: "A chave da Anthropic (ANTHROPIC_API_KEY) não está configurada no servidor. Avise o mentor." });
      }
      const r = await analisarLoteAgora(db, cliente, ctx.modeloIa(), { ...lote, dia: String(lote.dia).slice(0, 10) });
      if (!r.ok) return res.status(r.http!).json({ erro: r.erro, ...(r.motivo ? { motivo: r.motivo } : {}) });
      return res.json({ ok: true, lote_id: lote.id, resumo: r.corpo });
    }),
  );

  // JWT do mentorado (manual) ou token da rotina; o motor da análise tem que combinar com a credencial.
  app.post(
    "/api/ia/resultado",
    assincrono(async (req, res) => {
      const db = ctx.db();
      let principal: Principal;
      if (tokenBearer(req).startsWith(PREFIXO_TOKEN_IA)) {
        const t = await tokenDaRequisicao(db, req);
        if (!t) return res.status(401).json({ erro: "token_invalido" });
        if (!t.escopos.includes("ia:resultado")) return res.status(403).json({ erro: "sem_escopo" });
        principal = { tipo: "token", id: t.id, partnerIds: t.partnerIds };
      } else if (req.auth) {
        principal = { tipo: "usuario", auth: req.auth };
      } else {
        return res.status(401).json({ erro: "nao_autenticado" });
      }
      const r = await aplicarResultado(db, req.body, principal, {
        reservaId: typeof req.headers["x-reserva-id"] === "string" ? (req.headers["x-reserva-id"] as string) : undefined,
        substituir: principal.tipo === "usuario" && req.query.substituir === "1",
        buscarTexto: (lote) => baixarArquivo(db, lote.arquivo_path),
      });
      return res.status(r.http).json(r.corpo);
    }),
  );

  // ------------------------------------------------------------ rotina do dono (crmia_)
  app.get(
    "/api/ia/pendentes",
    exigirToken("ia:lotes"),
    assincrono(async (req, res) => {
      const t = res.locals.token as TokenIa;
      const empresas = await empresasDaRotina(ctx.db(), t.partnerIds);
      if (empresas.length === 0) return res.json({ lotes: [] });
      const limite = Math.min(Math.max(parseInt(String(req.query.limite ?? "3"), 10) || 3, 1), 10);
      const agora = ctx.agora();
      const desde = new Date(agora.getTime() - 7 * 864e5).toISOString().slice(0, 10);
      const { data, error } = await ctx
        .db()
        .from("ia_lotes")
        .select("id, partner_id, dia, versao, parte, partes, status, reservado_ate, tentativas, conversas, pendentes, mensagens, tokens_estimados")
        .in("partner_id", empresas)
        .in("status", ["pronto", "reservado"])
        .gte("dia", desde)
        .order("dia", { ascending: true })
        .limit(100);
      if (error) throw error;
      const livres = ((data || []) as any[])
        .filter((l) => l.tentativas < 3 && (l.status === "pronto" || (l.reservado_ate && new Date(l.reservado_ate).getTime() < agora.getTime())))
        .slice(0, limite);
      return res.json({
        lotes: livres.map((l) => ({
          lote_id: l.id,
          partner_id: l.partner_id,
          dia: String(l.dia).slice(0, 10),
          versao: l.versao,
          parte: l.parte,
          partes: l.partes,
          conversas: l.conversas + l.pendentes,
          mensagens: l.mensagens,
          tokens_estimados: l.tokens_estimados,
        })),
      });
    }),
  );

  const loteDoToken = async (db: Db, t: TokenIa, id: string) => {
    if (!ehUuid(id)) return null;
    const { data, error } = await db.from("ia_lotes").select("id, partner_id, status, arquivo_path, arquivo_apagado_em").eq("id", id).maybeSingle();
    if (error) throw error;
    // Lote de outra empresa responde igual a lote que não existe.
    return data && t.partnerIds.includes(data.partner_id) ? data : null;
  };

  app.post(
    "/api/ia/lotes/:id/reservar",
    exigirToken("ia:lotes"),
    assincrono(async (req, res) => {
      const db = ctx.db();
      const t = res.locals.token as TokenIa;
      const lote = await loteDoToken(db, t, String(req.params.id));
      if (!lote) return res.status(404).json({ erro: "nao_encontrado" });
      if (!(await empresasDaRotina(db, [lote.partner_id])).length) return res.status(409).json({ erro: "empresa_fora_da_rotina" });
      const { data: reserva, error } = await db.rpc("ia_reservar_lote", { _lote_id: lote.id, _quem: `token:${t.id}` });
      if (error) throw error;
      if (!reserva) return res.status(409).json({ erro: "lote_indisponivel" });
      const txt = await montarLoteTxt(db, lote, reserva);
      if (txt === null) {
        await db.rpc("ia_registrar_falha", { _lote_id: lote.id, _reserva_id: reserva, _motivo: "arquivo do lote indisponível no Storage" });
        return res.status(410).json({ erro: "arquivo_apagado" });
      }
      return res.type("text/plain; charset=utf-8").send(txt);
    }),
  );

  app.post(
    "/api/ia/lotes/:id/falha",
    exigirToken("ia:lotes"),
    assincrono(async (req, res) => {
      const db = ctx.db();
      const lote = await loteDoToken(db, res.locals.token as TokenIa, String(req.params.id));
      if (!lote) return res.status(404).json({ erro: "nao_encontrado" });
      if (!(await empresasDaRotina(db, [lote.partner_id])).length) return res.status(403).json({ erro: "sem_acesso" });
      const reserva = String(req.headers["x-reserva-id"] ?? "");
      if (!ehUuid(reserva)) return res.status(400).json({ erro: "X-Reserva-Id é obrigatório" });
      const { data, error } = await db.rpc("ia_registrar_falha", { _lote_id: lote.id, _reserva_id: reserva, _motivo: texto(req.body?.motivo).slice(0, 300) || null });
      if (error) throw error;
      if (!data) return res.status(409).json({ erro: "reserva_nao_confere" });
      return res.json({ ok: true, status: data });
    }),
  );

  // ------------------------------------------------------------------ admin: tokens
  app.get(
    "/api/admin/ia/tokens",
    assincrono(async (_req, res) => {
      const { data, error } = await ctx.db().from("ia_tokens").select("id, nome, partner_ids, created_at, ultimo_uso_em, revogado_em").order("created_at", { ascending: false });
      if (error) throw error;
      return res.json({ tokens: data || [] });
    }),
  );

  app.post(
    "/api/admin/ia/tokens",
    assincrono(async (req, res) => {
      const db = ctx.db();
      const nome = texto(req.body?.nome);
      const ids = req.body?.partnerIds;
      if (nome.length < 1 || nome.length > 80) return res.status(400).json({ erro: "nome deve ter de 1 a 80 caracteres" });
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || !ids.every(ehUuid)) return res.status(400).json({ erro: "partnerIds deve ter de 1 a 5 empresas" });
      const partnerIds = [...new Set(ids as string[])];
      const { data: existentes, error } = await db.from("partners").select("id").in("id", partnerIds);
      if (error) throw error;
      if ((existentes || []).length !== partnerIds.length) return res.status(400).json({ erro: "empresa não encontrada" });

      // O token aparece uma vez, nesta resposta; no banco fica só o hash.
      const token = `${PREFIXO_TOKEN_IA}${randomBytes(32).toString("base64url")}`;
      const { data, error: e2 } = await db
        .from("ia_tokens")
        .insert({ nome, token_hash: sha256hex(token), partner_ids: partnerIds, criado_por: req.auth!.profileId })
        .select("id")
        .single();
      if (e2) throw e2;
      return res.status(201).json({ id: data.id, token });
    }),
  );

  app.delete(
    "/api/admin/ia/tokens/:id",
    assincrono(async (req, res) => {
      if (!ehUuid(req.params.id)) return res.status(400).json({ erro: "id inválido" });
      const { data, error } = await ctx.db().from("ia_tokens").update({ revogado_em: ctx.agora().toISOString() }).eq("id", req.params.id).is("revogado_em", null).select("id");
      if (error) throw error;
      if (!data || data.length === 0) return res.status(404).json({ erro: "nao_encontrado" });
      return res.json({ ok: true });
    }),
  );
}

// Deixa no cartão do contato exatamente estas etiquetas (os gatilhos do banco gravam o aprendizado).
async function trocarTags(db: Db, contatoId: string, tags: string[]): Promise<boolean> {
  const { data: cartao, error } = await db.from("crm_cartoes").select("id, quadro_id").eq("contato_id", contatoId).is("arquivado_em", null).limit(1).maybeSingle();
  if (error) throw error;
  if (!cartao) return false;
  const { data: etiquetas, error: e2 } = await db.from("crm_etiquetas").select("id, nome").eq("quadro_id", cartao.quadro_id);
  if (e2) throw e2;
  const porNome = new Map<string, string>((etiquetas || []).map((e: any) => [String(e.nome).toLowerCase(), e.id]));
  const { data: ligadas, error: e3 } = await db.from("crm_cartao_etiquetas").select("etiqueta_id").eq("cartao_id", cartao.id);
  if (e3) throw e3;
  const atuais = new Set((ligadas || []).map((l: any) => l.etiqueta_id));

  const alvo = new Set<string>();
  for (const nome of tags) {
    let id = porNome.get(nome);
    if (!id) {
      const { data: nova, error: e4 } = await db.from("crm_etiquetas").insert({ quadro_id: cartao.quadro_id, nome }).select("id").single();
      if (e4) throw e4;
      id = nova.id as string;
    }
    alvo.add(id);
  }
  for (const id of atuais) {
    if (alvo.has(id)) continue;
    const { error: e5 } = await db.from("crm_cartao_etiquetas").delete().eq("cartao_id", cartao.id).eq("etiqueta_id", id);
    if (e5) throw e5;
  }
  for (const id of alvo) {
    if (atuais.has(id)) continue;
    const { error: e6 } = await db.from("crm_cartao_etiquetas").insert({ cartao_id: cartao.id, etiqueta_id: id, origem: "manual" });
    if (e6) throw e6;
  }
  return true;
}

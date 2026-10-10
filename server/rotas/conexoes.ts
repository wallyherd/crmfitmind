import type { Express } from "express";
import { ERRO_SEM_CONTEUDO, exigirPartner, exigirPermissao, partnerIdPedido, podeNaEmpresa, podeVerConteudo, podeVerConteudoDaConexao, type Autenticacao } from "../auth.js";
import type { MotivoCampainha } from "../campainha.js";
import { assincrono, ehUuid, soDigitos, texto, type Contexto } from "../contexto.js";

// Conexão é da empresa (escopo 'parceiro'); só o admin e quem tem a permissão 'robo' nela (como a RLS) mexem.
export function podeAcessarConexao(auth: Autenticacao, conexao: { escopo: string; owner_id: string | null }) {
  if (auth.isAdmin) return true;
  return conexao.escopo === "parceiro" && podeNaEmpresa(auth, conexao.owner_id, "robo");
}

// Colunas que a tela pode ver (nunca webhook_segredo).
export const COLUNAS_PAINEL =
  "id, escopo, owner_id, nome, numero, modo, status, status_detalhe, visto_em, pareamento, opcoes, bot_ativo, grupos_disponiveis, arquivado_em, desconectada_em";

export const HISTORICO_PADRAO_DIAS = 7;
export const HISTORICO_MAXIMO_DIAS = 30;
// R1: mais que isso num IP só aumenta o risco de banimento; o 2º gateway ainda não existe.
export const LIMITE_CONEXOES_GATEWAY = 25;
// Cota de cada empresa, para uma só não esgotar o teto de todas. O global só conta conexão em uso
// (já pareada, conectada ou com pareamento pedido); conexão nova que ninguém usou não trava as outras.
export const LIMITE_GATEWAY_POR_EMPRESA = 3;
export const LIMITE_PC_POR_EMPRESA = 10;
const JID_GRUPO = /^[0-9]+(-[0-9]+)?@g\.us$/;

export type OpcoesConexao = { gruposPermitidos: string[]; historicoDias: number; botAtivo: boolean };

export function opcoesDaConexao(c: { opcoes?: any; bot_ativo?: unknown }): OpcoesConexao {
  const o = c.opcoes && typeof c.opcoes === "object" ? c.opcoes : {};
  const grupos = Array.isArray(o.gruposPermitidos) ? o.gruposPermitidos : [];
  const dias = Number(o.historicoDias);
  return {
    gruposPermitidos: [...new Set<string>(grupos.filter((g: unknown) => typeof g === "string" && JID_GRUPO.test(g)))],
    historicoDias: Number.isFinite(dias) ? Math.min(HISTORICO_MAXIMO_DIAS, Math.max(0, Math.trunc(dias))) : HISTORICO_PADRAO_DIAS,
    botAtivo: c.bot_ativo === true,
  };
}

// O que a tela mostra do pareamento: estado, QR ou código (nunca o telefone pedido).
function pareamentoParaTela(p: any) {
  if (!p || typeof p !== "object") return null;
  const estado = typeof p.estado === "string" ? p.estado : p.solicitadoEm ? "solicitado" : null;
  if (!estado) return null;
  const r: Record<string, unknown> = { estado, atualizadoEm: p.atualizadoEm ?? p.solicitadoEm ?? null };
  if (typeof p.qr === "string") r.qr = p.qr;
  if (typeof p.codigo === "string") r.codigo = p.codigo;
  return r;
}

// O QR e o código de pareamento dão o WhatsApp do mentorado a quem os ler: o admin sem o opt-in do dono
// vê o estado da conexão, não o pareamento nem a lista de grupos.
export function conexaoParaPainel(c: Record<string, any>, comPareamento = true) {
  return {
    id: c.id,
    nome: c.nome,
    numero: c.numero ?? null,
    modo: c.modo === "gateway" ? "gateway" : "pc",
    status: c.status,
    status_detalhe: c.status_detalhe ?? null,
    visto_em: c.visto_em ?? null,
    pareamento: comPareamento ? pareamentoParaTela(c.pareamento) : null,
    opcoes: opcoesDaConexao(c),
    // O nome dos grupos de WhatsApp do mentorado também é dele: segue o mesmo opt-in do pareamento.
    grupos_disponiveis: comPareamento && Array.isArray(c.grupos_disponiveis) ? c.grupos_disponiveis : [],
  };
}

// Telefone do pareamento por código, como o gateway normaliza (CONTRATO §3.7): com "+", E.164 de 8 a 15
// dígitos como está; sem "+", 10 ou 11 dígitos ganham 55 e o resultado tem de ter de 12 a 15.
export function telefoneDoPareamento(valor: unknown): string | null {
  const bruto = texto(valor);
  let d = soDigitos(bruto);
  if (bruto.startsWith("+")) return d.length >= 8 && d.length <= 15 ? d : null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

export function registrarRotasConexoes(app: Express, ctx: Contexto) {
  // A conexão como a tela a vê: sem o pareamento para quem não pode ver o conteúdo dela.
  async function paraTela(req: any, conexao: Record<string, any>) {
    return conexaoParaPainel(conexao, await podeVerConteudoDaConexao(ctx.db(), req.auth, conexao as { escopo: string; owner_id: string | null }));
  }

  // Lê a conexão e confere o acesso; responde o erro e devolve null quando não pode. Com conteudo:true
  // (parear, que expõe QR e código), o admin que não é da empresa só passa com o opt-in do dono.
  async function conexaoDoUsuario(req: any, res: any, conteudo = false) {
    const { id } = req.params;
    if (!ehUuid(id)) {
      res.status(400).json({ erro: "id inválido" });
      return null;
    }
    const { data: conexao, error } = await ctx.db().from("bot_conexoes").select(COLUNAS_PAINEL).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!conexao || conexao.arquivado_em) {
      res.status(404).json({ erro: "nao_encontrada" });
      return null;
    }
    if (!podeAcessarConexao(req.auth!, conexao)) {
      res.status(403).json({ erro: "sem_acesso" });
      return null;
    }
    if (conteudo && !(await podeVerConteudoDaConexao(ctx.db(), req.auth, conexao))) {
      res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      return null;
    }
    return conexao as Record<string, any>;
  }

  async function atualizar(id: string, mudanca: Record<string, unknown>) {
    const { data, error } = await ctx.db().from("bot_conexoes").update(mudanca).eq("id", id).select(COLUNAS_PAINEL).single();
    if (error) throw error;
    return data as Record<string, any>;
  }

  // A campainha é cortesia: sem ela o gateway relê sozinho em até 60 s.
  async function tocar(conexao: Record<string, any>, motivo: MotivoCampainha) {
    if (conexao.modo !== "gateway") return;
    try {
      await ctx.campainha(conexao.id, motivo);
    } catch {
      // nunca derruba a rota da tela
    }
  }

  app.get(
    "/api/conexoes",
    exigirPartner,
    exigirPermissao("robo"),
    assincrono(async (req, res) => {
      const { data, error } = await ctx
        .db()
        .from("bot_conexoes")
        .select(COLUNAS_PAINEL)
        .eq("escopo", "parceiro")
        .eq("owner_id", req.query.partnerId as string)
        .is("arquivado_em", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const comPareamento = await podeVerConteudo(ctx.db(), req.auth, req.query.partnerId, "robo");
      return res.json((data || []).map((c: Record<string, any>) => conexaoParaPainel(c, comPareamento)));
    }),
  );

  app.post(
    "/api/conexoes",
    exigirPartner,
    exigirPermissao("robo"),
    assincrono(async (req, res) => {
      const nome = texto(req.body?.nome);
      if (!nome || nome.length > 80) return res.status(400).json({ erro: "nome é obrigatório (até 80 caracteres)" });
      const modo = req.body?.modo === undefined ? "gateway" : req.body.modo;
      if (modo !== "gateway" && modo !== "pc") return res.status(400).json({ erro: "modo deve ser 'gateway' ou 'pc'" });
      const db = ctx.db();
      const partnerId = partnerIdPedido(req) as string;

      // Conexão que ninguém arquivou nem desconectou conta na cota da empresa, pareada ou não.
      const { data: daEmpresa, error: erroEmpresa } = await db
        .from("bot_conexoes")
        .select("id")
        .eq("modo", modo)
        .eq("escopo", "parceiro")
        .eq("owner_id", partnerId)
        .is("arquivado_em", null)
        .is("desconectada_em", null);
      if (erroEmpresa) throw erroEmpresa;
      const cotaEmpresa = modo === "gateway" ? LIMITE_GATEWAY_POR_EMPRESA : LIMITE_PC_POR_EMPRESA;
      if ((daEmpresa || []).length >= cotaEmpresa) return res.status(409).json({ erro: "limite_de_conexoes_da_empresa" });

      if (modo === "gateway") {
        const { data: ativas, error: erroAtivas } = await db
          .from("bot_conexoes")
          .select("id, status, numero, pareamento")
          .eq("modo", "gateway")
          .is("arquivado_em", null)
          .is("desconectada_em", null);
        if (erroAtivas) throw erroAtivas;
        const emUso = (ativas || []).filter((c: any) => c.status !== "desconectado" || c.numero || c.pareamento);
        if (emUso.length >= LIMITE_CONEXOES_GATEWAY) return res.status(409).json({ erro: "limite_de_conexoes_do_gateway" });
      }

      const { data, error } = await db
        .from("bot_conexoes")
        .insert({
          escopo: "parceiro",
          owner_id: partnerId,
          nome,
          modo,
          status: "desconectado",
          bot_ativo: false,
          criado_por: req.auth!.profileId,
        })
        .select(COLUNAS_PAINEL)
        .single();
      if (error) throw error;
      return res.status(201).json(conexaoParaPainel(data as Record<string, any>));
    }),
  );

  app.post(
    "/api/conexoes/:id/parear",
    assincrono(async (req, res) => {
      const conexao = await conexaoDoUsuario(req, res, true);
      if (!conexao) return;
      if (conexao.modo !== "gateway") return res.status(400).json({ erro: "conexao_modo_pc" });

      const metodo = req.body?.metodo;
      if (metodo !== "qr" && metodo !== "codigo") return res.status(400).json({ erro: "metodo deve ser 'qr' ou 'codigo'" });
      const telefone = metodo === "codigo" ? telefoneDoPareamento(req.body?.telefone) : null;
      if (metodo === "codigo" && !telefone) return res.status(400).json({ erro: "telefone inválido" });

      // solicitadoEm novo a cada pedido: é assim que o gateway sabe que é outro pareamento.
      const agora = ctx.agora().toISOString();
      const pedido: Record<string, unknown> = { metodo, solicitadoEm: agora, estado: "solicitado", atualizadoEm: agora };
      if (telefone) pedido.telefone = telefone;
      const atualizada = await atualizar(conexao.id, { pareamento: pedido, desconectada_em: null });
      await tocar(atualizada, "parear");
      return res.json(await paraTela(req, atualizada));
    }),
  );

  // Tira a conexão da lista e libera a cota; o gateway sai do aparelho (conexão arquivada continua na
  // lista dele por um tempo com desconectar:true).
  app.post(
    "/api/conexoes/:id/arquivar",
    assincrono(async (req, res) => {
      const conexao = await conexaoDoUsuario(req, res);
      if (!conexao) return;
      const agora = ctx.agora().toISOString();
      const atualizada = await atualizar(conexao.id, { arquivado_em: agora, desconectada_em: agora, pareamento: null });
      await tocar(atualizada, "desconectar");
      return res.json({ ok: true });
    }),
  );

  app.post(
    "/api/conexoes/:id/desconectar",
    assincrono(async (req, res) => {
      const conexao = await conexaoDoUsuario(req, res);
      if (!conexao) return;
      if (conexao.modo !== "gateway") return res.status(400).json({ erro: "conexao_modo_pc" });
      // Grava deveRodar:false ANTES da campainha: ela só faz o gateway reler a lista (CONTRATO §4).
      const atualizada = await atualizar(conexao.id, { desconectada_em: ctx.agora().toISOString(), pareamento: null });
      await tocar(atualizada, "desconectar");
      return res.json(await paraTela(req, atualizada));
    }),
  );

  app.patch(
    "/api/conexoes/:id/opcoes",
    assincrono(async (req, res) => {
      // Decide o que entra no CRM e na IA (grupos, histórico, robô): sem o opt-in do dono o admin não mexe.
      const conexao = await conexaoDoUsuario(req, res, true);
      if (!conexao) return;
      const corpo = req.body && typeof req.body === "object" ? req.body : {};
      const atuais = opcoesDaConexao(conexao);
      const opcoes: Record<string, unknown> = {
        ...(conexao.opcoes && typeof conexao.opcoes === "object" ? conexao.opcoes : {}),
        gruposPermitidos: atuais.gruposPermitidos,
        historicoDias: atuais.historicoDias,
      };
      const mudanca: Record<string, unknown> = {};

      if (corpo.gruposPermitidos !== undefined) {
        const g = corpo.gruposPermitidos;
        if (!Array.isArray(g) || g.length > 500 || !g.every((x: unknown) => typeof x === "string" && JID_GRUPO.test(x))) {
          return res.status(400).json({ erro: "gruposPermitidos deve ser uma lista de jids de grupo (…@g.us)" });
        }
        opcoes.gruposPermitidos = [...new Set(g)];
      }
      if (corpo.historicoDias !== undefined) {
        const d = corpo.historicoDias;
        if (!Number.isInteger(d) || d < 0 || d > HISTORICO_MAXIMO_DIAS) {
          return res.status(400).json({ erro: `historicoDias deve ser um inteiro de 0 a ${HISTORICO_MAXIMO_DIAS}` });
        }
        opcoes.historicoDias = d;
      }
      if (corpo.botAtivo !== undefined) {
        if (typeof corpo.botAtivo !== "boolean") return res.status(400).json({ erro: "botAtivo deve ser true ou false" });
        mudanca.bot_ativo = corpo.botAtivo;
      }
      mudanca.opcoes = opcoes;

      const atualizada = await atualizar(conexao.id, mudanca);
      await tocar(atualizada, "opcoes");
      return res.json(await paraTela(req, atualizada));
    }),
  );

  // Segredo do conector modo PC: só sob pedido explícito, nunca no /api/data.
  app.get(
    "/api/conexoes/:id/credenciais",
    assincrono(async (req, res) => {
      const { id } = req.params;
      if (!ehUuid(id)) return res.status(400).json({ erro: "id inválido" });

      const { data: conexao, error } = await ctx
        .db()
        .from("bot_conexoes")
        .select("id, escopo, owner_id, webhook_segredo, arquivado_em")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!conexao || conexao.arquivado_em) return res.status(404).json({ erro: "nao_encontrada" });
      if (!podeAcessarConexao(req.auth!, conexao)) return res.status(403).json({ erro: "sem_acesso" });
      if (!(await podeVerConteudoDaConexao(ctx.db(), req.auth, conexao))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });

      return res.json({ conexaoId: conexao.id, segredo: conexao.webhook_segredo });
    }),
  );
}

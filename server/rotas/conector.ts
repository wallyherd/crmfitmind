import type { Express, Request } from "express";
import { assinaturaGatewayValida, JANELA_GATEWAY_MS, segredoConfere } from "../auth.js";
import { BUCKET_COMPROVANTES, bytesConferem, MAX_COMPROVANTE_BYTES, mimetypePermitido, subirComprovante } from "../comprovantes.js";
import { assincrono, ehUuid, soDigitos, texto, type Contexto } from "../contexto.js";
import { opcoesDaConexao } from "./conexoes.js";

// Rotas de quem captura o WhatsApp (gateway/CONTRATO.md). Ficam fora do
// middleware de sessão e se autenticam aqui:
//   - gateway (VPS): HMAC em x-gateway-ts + x-gateway-assinatura, sobre o corpo cru;
//   - modo PC: x-bot-conexao + x-bot-segredo, uma conexão só.

type ConexaoRobo = {
  id: string;
  escopo: string;
  owner_id: string | null;
  modo: string | null;
  bot_ativo: boolean | null;
  arquivado_em: string | null;
};
type Origem = { via: "gateway" } | { via: "pc"; conexao: ConexaoRobo };

const COLUNAS_ROBO = "id, escopo, owner_id, modo, bot_ativo, arquivado_em";
const MAX_EVENTOS = 500;
const FILA_GATEWAY = { padrao: 50, maximo: 50 };
const FILA_PC = { padrao: 10, maximo: 50 };
// Conexão apagada continua na lista por um tempo com desconectar:true, para o gateway sair do aparelho.
const ARQUIVADA_NA_LISTA_MS = 30 * 86_400_000;

const veioDoGateway = (req: Request) =>
  req.headers["x-gateway-ts"] !== undefined || req.headers["x-gateway-assinatura"] !== undefined;

function limiteDe(valor: unknown, { padrao, maximo }: { padrao: number; maximo: number }) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? Math.min(n, maximo) : padrao;
}

function pareamentoParaGateway(p: any) {
  if (!p || typeof p !== "object" || (p.metodo !== "qr" && p.metodo !== "codigo") || typeof p.solicitadoEm !== "string") return null;
  return {
    metodo: p.metodo,
    ...(p.metodo === "codigo" && typeof p.telefone === "string" ? { telefone: p.telefone } : {}),
    solicitadoEm: p.solicitadoEm,
  };
}

const paraFila = (m: any) => ({ id: m.id, conexaoId: m.conexao_id, para: m.para, corpo: m.corpo, tipo: "texto" });

// O conector antigo do PC lê msg.telefone (e não "para"): só quando o destino é um número de telefone.
const paraFilaPc = (m: any) => {
  const [numero, dominio] = String(m.para ?? "").split("@");
  return { ...paraFila(m), ...(/^\d{8,15}$/.test(numero) && (!dominio || dominio === "s.whatsapp.net") ? { telefone: numero } : {}) };
};

// O conector antigo manda o evento sem chatJid e com "em" no lugar de waEm. Aceita, mas como
// "offline": captura a conversa e nunca aciona o robô (perder a mensagem calado era pior).
function eventoDoConectorAntigo(ev: any) {
  if (!ev || typeof ev !== "object" || ev.tipo !== "mensagem" || ev.chatJid !== undefined) return ev;
  const jid = texto(ev.jid).toLowerCase();
  const telefone = soDigitos(ev.telefone);
  const chatJid = jid || (telefone ? `${telefone}@s.whatsapp.net` : "");
  if (!chatJid) return ev;
  return { ...ev, chatJid, waEm: ev.waEm ?? ev.em, origemEvento: "offline" };
}

export function registrarRotasConector(app: Express, ctx: Contexto) {
  async function autenticar(req: Request, aceita: { gateway: boolean; pc: boolean }): Promise<Origem | null> {
    // Quem manda cabeçalho do gateway é conferido só como gateway (sem cair para o segredo do PC).
    if (veioDoGateway(req)) {
      if (!aceita.gateway) return null;
      if (!assinaturaGatewayValida(req, ctx.segredoGateway(), ctx.agora().getTime())) return null;
      // A mesma requisição assinada não vale duas vezes (vale 5 min; quem a capturar não a reenvia).
      const assinatura = String(req.headers["x-gateway-assinatura"]).toLowerCase();
      const { data: nova, error } = await ctx
        .db()
        .rpc("bot_gateway_assinatura_nova", { _assinatura: assinatura, _expira_em: new Date(ctx.agora().getTime() + 2 * JANELA_GATEWAY_MS).toISOString() });
      if (error) throw error;
      return nova === true ? { via: "gateway" } : null;
    }
    if (!aceita.pc) return null;
    const id = req.headers["x-bot-conexao"];
    const segredo = req.headers["x-bot-segredo"];
    if (!ehUuid(id) || typeof segredo !== "string" || !segredo) return null;
    const { data } = await ctx.db().from("bot_conexoes").select(`${COLUNAS_ROBO}, webhook_segredo`).eq("id", id).maybeSingle();
    if (!data || data.arquivado_em || data.modo === "gateway" || !segredoConfere(segredo, data.webhook_segredo)) return null;
    const { webhook_segredo: _segredo, ...conexao } = data;
    return { via: "pc", conexao: conexao as ConexaoRobo };
  }

  const negar = (res: any) => res.status(401).json({ erro: "credencial_invalida" });

  app.post(
    "/api/bot/eventos",
    assincrono(async (req, res) => {
      const origem = await autenticar(req, { gateway: true, pc: true });
      if (!origem) return negar(res);
      const db = ctx.db();

      const corpo = req.body;
      if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return res.status(400).json({ erro: "envelope_invalido" });
      // O gateway sempre manda {eventos: [...]}; um evento solto também vale.
      const lista: unknown[] | null = Array.isArray(corpo.eventos)
        ? corpo.eventos
        : corpo.eventos === undefined && typeof corpo.tipo === "string"
          ? [corpo]
          : null;
      const eventos = lista && origem.via === "pc" ? lista.map(eventoDoConectorAntigo) : lista;
      if (!eventos) return res.status(400).json({ erro: "eventos precisa ser uma lista" });
      if (eventos.length > MAX_EVENTOS) return res.status(413).json({ erro: `no máximo ${MAX_EVENTOS} eventos por chamada` });

      let conexao: ConexaoRobo;
      if (origem.via === "gateway") {
        if (!ehUuid(corpo.conexaoId)) return res.status(400).json({ erro: "conexaoId invalido" });
        const { data, error } = await db.from("bot_conexoes").select(COLUNAS_ROBO).eq("id", corpo.conexaoId).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ erro: "conexao_nao_encontrada" });
        if (data.modo !== "gateway") return res.status(403).json({ erro: "conexao_nao_e_do_gateway" });
        conexao = data as ConexaoRobo;
      } else {
        conexao = origem.conexao;
      }
      // Apagada pelo dono: nada mais é gravado; o gateway tira os eventos do spool.
      if (conexao.arquivado_em) {
        return res.json({ ok: true, processados: 0, erros: eventos.map((_e, indice) => ({ indice, erro: "conexao_arquivada" })) });
      }

      const { data: r, error } = await db.rpc("bot_registrar_eventos", { _conexao_id: conexao.id, _eventos: eventos });
      if (error) throw error;

      // Trava 1 (rota): o banco já filtrou; confere de novo com o evento cru e a conexão.
      let enfileiradas = 0;
      for (const item of (r?.responder ?? []) as any[]) {
        const ev = eventos[item?.indice] as any;
        const individual = ev && ev.grupo !== true && !String(ev.chatJid || "").endsWith("@g.us");
        if (conexao.bot_ativo !== true || !individual || ev.deMim === true || ev.origemEvento !== "tempo_real") continue;
        if (!ehUuid(item.conversaId)) continue;
        try {
          const acao = await ctx.motor(db, {
            conexao: { id: conexao.id, escopo: conexao.escopo, owner_id: conexao.owner_id },
            conversaId: item.conversaId,
            telefone: texto(item.telefone),
            texto: texto(item.texto),
            nome: typeof item.nome === "string" ? item.nome : null,
          });
          enfileiradas += Number((acao as any)?.enfileiradas) || 0;
        } catch (e) {
          console.error("[bot-engine] falha:", e);
        }
      }
      if (enfileiradas > 0 && conexao.modo === "gateway") {
        try {
          await ctx.campainha(conexao.id, "fila");
        } catch {
          // o gateway lê a fila sozinho a cada 30 s
        }
      }

      return res.json({ ok: true, processados: Number(r?.processados) || 0, erros: Array.isArray(r?.erros) ? r.erros : [] });
    }),
  );

  app.get(
    "/api/bot/fila",
    assincrono(async (req, res) => {
      const origem = await autenticar(req, { gateway: false, pc: true });
      if (!origem || origem.via !== "pc") return negar(res);
      const { data, error } = await ctx.db().rpc("bot_reservar_fila", {
        _conexao_id: origem.conexao.id,
        _limite: limiteDe(req.query.limite, FILA_PC),
      });
      if (error) throw error;
      return res.json({ mensagens: (data || []).map(paraFilaPc) });
    }),
  );

  app.post(
    "/api/bot/confirmar",
    assincrono(async (req, res) => {
      const origem = await autenticar(req, { gateway: true, pc: true });
      if (!origem) return negar(res);
      const { id, status } = req.body || {};
      if (!ehUuid(id)) return res.status(400).json({ erro: "id invalido" });
      if (status !== "enviada" && status !== "erro") return res.status(400).json({ erro: "status deve ser 'enviada' ou 'erro'" });

      const { data: r, error } = await ctx.db().rpc("bot_confirmar_envio", {
        _id: id,
        _status: status,
        _wa_id: texto(req.body.waId).slice(0, 120) || null,
        _erro: texto(req.body.erro).slice(0, 300) || null,
        _conexao_id: origem.via === "pc" ? origem.conexao.id : null,
      });
      if (error) throw error;
      if (r === "nao_encontrada") return res.status(404).json({ erro: "mensagem_nao_encontrada" });
      return res.json({ ok: true, ...(r === "ja_confirmada" ? { jaConfirmada: true } : {}) });
    }),
  );

  // Atualização automática do conector antigo: desligada de propósito até existir pacote assinado
  // (servir código do banco para os PCs era uma porta de entrada).
  app.get(
    "/api/bot/atualizacao",
    assincrono(async (req, res) => {
      const origem = await autenticar(req, { gateway: false, pc: true });
      if (!origem) return negar(res);
      return res.json({ atualizacao: false });
    }),
  );

  app.get(
    "/api/gateway/conexoes",
    assincrono(async (req, res) => {
      if (!(await autenticar(req, { gateway: true, pc: false }))) return negar(res);
      const { data, error } = await ctx
        .db()
        .from("bot_conexoes")
        .select("id, modo, bot_ativo, opcoes, pareamento, arquivado_em, desconectada_em")
        .eq("modo", "gateway")
        .eq("escopo", "parceiro")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const corte = ctx.agora().getTime() - ARQUIVADA_NA_LISTA_MS;
      const conexoes = (data || [])
        .filter((c: any) => !c.arquivado_em || Date.parse(c.arquivado_em) > corte)
        .map((c: any) => {
          const deveRodar = !c.arquivado_em && !c.desconectada_em;
          return {
            id: c.id,
            deveRodar,
            ...(deveRodar ? {} : { desconectar: true }),
            pareamento: deveRodar ? pareamentoParaGateway(c.pareamento) : null,
            opcoes: opcoesDaConexao(c),
          };
        });
      return res.json({ conexoes });
    }),
  );

  // Comprovante do cliente (imagem ou PDF), corpo cru assinado com o mesmo HMAC das outras chamadas.
  // Cabeçalhos: Content-Type = mimetype, x-conexao-id (gateway), x-wa-id, x-chat-jid.
  // Respostas que o gateway entende: 200 guardado (ou já estava); 404 mensagem ainda desconhecida (tenta de novo);
  // 400/403/413/415/422 recusa definitiva (o gateway descarta o arquivo); 401 e 5xx tentam de novo.
  app.post(
    "/api/gateway/midia",
    assincrono(async (req, res) => {
      // Antes da assinatura: o parser só guarda os bytes dos tipos da lista, e sem eles a assinatura nunca confere.
      const mimetype = mimetypePermitido(req.headers["content-type"]);
      if (!mimetype) return res.status(415).json({ erro: "mimetype" });
      const origem = await autenticar(req, { gateway: true, pc: true });
      if (!origem) return negar(res);
      const db = ctx.db();

      const arquivo = req.body;
      if (!Buffer.isBuffer(arquivo) || arquivo.length === 0) return res.status(400).json({ erro: "corpo_vazio" });
      if (arquivo.length > MAX_COMPROVANTE_BYTES) return res.status(413).json({ erro: "arquivo_grande_demais" });
      if (!bytesConferem(mimetype, arquivo)) return res.status(415).json({ erro: "conteudo_nao_confere" });

      const conexaoId = origem.via === "pc" ? origem.conexao.id : req.headers["x-conexao-id"];
      if (!ehUuid(conexaoId)) return res.status(400).json({ erro: "conexaoId invalido" });
      if (origem.via === "pc" && req.headers["x-conexao-id"] !== undefined && req.headers["x-conexao-id"] !== conexaoId) {
        return res.status(403).json({ erro: "conexao_diferente" });
      }
      const waId = texto(req.headers["x-wa-id"]);
      const chatJid = texto(req.headers["x-chat-jid"]);
      if (!waId || waId.length > 120 || !chatJid || chatJid.length > 120) return res.status(400).json({ erro: "cabecalhos_invalidos" });

      if (origem.via === "gateway") {
        const { data: cx, error } = await db.from("bot_conexoes").select("id, modo").eq("id", conexaoId).maybeSingle();
        if (error) throw error;
        if (!cx) return res.status(404).json({ erro: "conexao_nao_encontrada" });
        if (cx.modo !== "gateway") return res.status(403).json({ erro: "conexao_nao_e_do_gateway" });
      }

      const prep = async () => {
        const { data, error } = await db.rpc("comprovante_preparar", { _conexao_id: conexaoId, _wa_id: waId, _chat_jid: chatJid, _mimetype: mimetype });
        if (error) throw error;
        return (data ?? {}) as { ok?: boolean; ja?: boolean; erro?: string; mensagemId?: string; caminho?: string };
      };
      const recusa = (erro: string) => {
        if (erro === "mensagem_desconhecida" || erro === "conexao") return res.status(404).json({ erro });
        if (erro === "sem_empresa") return res.status(403).json({ erro });
        if (erro === "mimetype") return res.status(415).json({ erro });
        return res.status(422).json({ erro }); // grupo, de_mim, tipo, privacidade
      };

      const p = await prep();
      if (!p.ok) return recusa(String(p.erro ?? "recusado"));
      if (p.ja) return res.json({ ok: true, ja: true });
      if (!p.caminho || !ehUuid(p.mensagemId)) throw new Error("comprovante_preparar sem caminho");

      const falha = await subirComprovante(db, p.caminho, arquivo, mimetype);
      if (falha) throw new Error(`storage: ${falha}`);
      const { data: gravou, error: erroRegistro } = await db.rpc("comprovante_registrar", { _mensagem_id: p.mensagemId, _caminho: p.caminho });
      if (erroRegistro) throw erroRegistro;
      if (gravou !== true) {
        // Não gravou: a conversa virou privada durante o upload, ou outra chamada igual chegou antes (mesmo caminho).
        const de_novo = await prep();
        if (de_novo.ok && de_novo.ja) return res.json({ ok: true, ja: true });
        const { error: e2 } = await db.storage.from(BUCKET_COMPROVANTES).remove([p.caminho]);
        if (e2) console.error("[midia] arquivo sem dono ficou no Storage:", e2.message);
        return recusa(String(de_novo.erro ?? "privacidade"));
      }
      return res.json({ ok: true });
    }),
  );

  app.get(
    "/api/gateway/fila",
    assincrono(async (req, res) => {
      if (!(await autenticar(req, { gateway: true, pc: false }))) return negar(res);
      const { data, error } = await ctx.db().rpc("bot_reservar_fila", {
        _conexao_id: null,
        // A query não entra na assinatura (CONTRATO): quem adultera a URL não muda o tamanho do lote.
        _limite: FILA_GATEWAY.padrao,
      });
      if (error) throw error;
      return res.json({ mensagens: (data || []).map(paraFila) });
    }),
  );
}

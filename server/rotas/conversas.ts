import type { Express, Response } from "express";
import {
  dataValida,
  disposicaoAnexo,
  FUSO_PADRAO,
  fusoValido,
  inicioDoDia,
  montarArquivo,
  periodoDaConversa,
  periodoDoDia,
  proximoDia,
  type DadosArquivo,
} from "../arquivo-completo.js";
import { ERRO_SEM_CONTEUDO, ehDonoDaEmpresa, exigirPartner, podeVerConteudo, podeVerConteudoDaConexao } from "../auth.js";
import { linkDoComprovante, VALIDADE_LINK_SEG } from "../comprovantes.js";
import { assincrono, ehUuid, texto, type Contexto } from "../contexto.js";
import type { Db } from "../supabase.js";
import { podeAcessarConexao } from "./conexoes.js";

const PRIVACIDADES = ["normal", "so_metadados", "ignorar"];
const ESTADOS = ["bot", "humano", "encerrada"];

async function fusoDaEmpresa(db: Db, partnerId: string | null | undefined): Promise<string> {
  if (!partnerId) return FUSO_PADRAO;
  const { data, error } = await db.from("partner_acesso_config").select("timezone").eq("partner_id", partnerId).maybeSingle();
  if (error) throw error;
  return fusoValido(data?.timezone);
}

// O .txt sai direto na resposta: nada é gravado no servidor nem no Storage.
function enviarTxt(res: Response, nome: string, conteudo: string) {
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Content-Disposition", disposicaoAnexo(nome));
  return res.send(conteudo);
}

export function registrarRotasConversas(app: Express, ctx: Contexto) {
  // Conversa + conexão, com o acesso conferido; responde o erro e devolve null quando não pode.
  async function conversaDoUsuario(req: any, res: Response, colunas: string, id: unknown = req.params.id) {
    if (!ehUuid(id)) {
      res.status(400).json({ erro: "id inválido" });
      return null;
    }
    const db = ctx.db();
    const { data: conversa, error } = (await db
      .from("bot_conversas")
      .select(`id, conexao_id, ${colunas}`)
      .eq("id", id)
      .maybeSingle()) as { data: Record<string, any> | null; error: unknown };
    if (error) throw error;
    if (!conversa) {
      res.status(404).json({ erro: "nao_encontrada" });
      return null;
    }
    const { data: conexao, error: erroConexao } = await db
      .from("bot_conexoes")
      .select("id, escopo, owner_id")
      .eq("id", conversa.conexao_id)
      .maybeSingle();
    if (erroConexao) throw erroConexao;
    if (!conexao) {
      res.status(404).json({ erro: "nao_encontrada" });
      return null;
    }
    if (!podeAcessarConexao(req.auth!, conexao)) {
      res.status(403).json({ erro: "sem_acesso" });
      return null;
    }
    // Mensagens e telefones: o admin que não é da empresa só passa com o opt-in do dono.
    if (!(await podeVerConteudoDaConexao(db, req.auth, conexao as { escopo: string; owner_id: string | null }))) {
      res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      return null;
    }
    return { conversa: conversa as Record<string, any>, conexao: conexao as Record<string, any> };
  }

  app.patch(
    "/api/conversas/:id",
    assincrono(async (req, res) => {
      const corpo = req.body && typeof req.body === "object" ? req.body : {};
      const mudanca: Record<string, unknown> = {};
      if (corpo.privacidade !== undefined) {
        if (!PRIVACIDADES.includes(corpo.privacidade)) return res.status(400).json({ erro: "privacidade inválida" });
        mudanca.privacidade = corpo.privacidade;
      }
      if (corpo.estado !== undefined) {
        if (!ESTADOS.includes(corpo.estado)) return res.status(400).json({ erro: "estado inválido" });
        mudanca.estado = corpo.estado;
        mudanca.encerrada_em = corpo.estado === "encerrada" ? ctx.agora().toISOString() : null;
      }
      if (Object.keys(mudanca).length === 0) return res.status(400).json({ erro: "nada para mudar" });

      const achada = await conversaDoUsuario(req, res, "tipo");
      if (!achada) return;
      // Trava da rota; o banco também recusa (bot_conversas_grupo_sem_robo).
      if (mudanca.estado === "bot" && achada.conversa.tipo === "grupo") return res.status(400).json({ erro: "grupo_sem_robo" });

      // Privacidade diferente de 'normal' apaga o texto já gravado (gatilho no banco, C16).
      const { data, error } = await ctx
        .db()
        .from("bot_conversas")
        .update(mudanca)
        .eq("id", achada.conversa.id)
        .select("id, estado, privacidade, encerrada_em")
        .single();
      if (error) throw error;
      return res.json({ ok: true, conversa: data });
    }),
  );

  // Comprovante que o cliente mandou: link assinado de 60 s para o arquivo no bucket privado.
  // Mesma guarda do conteúdo (membro, ou admin com o opt-in do dono); o arquivo em si nunca passa pelo servidor.
  app.get(
    "/api/mensagens/:id/arquivo",
    assincrono(async (req, res) => {
      const { id } = req.params;
      if (!ehUuid(id)) return res.status(400).json({ erro: "id inválido" });
      const db = ctx.db();
      const { data: mensagem, error } = await db
        .from("bot_mensagens")
        .select("id, conversa_id, tipo, direcao, arquivo_path")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!mensagem) return res.status(404).json({ erro: "nao_encontrada" });
      const achada = await conversaDoUsuario(req, res, "tipo, privacidade", mensagem.conversa_id);
      if (!achada) return;
      // Conversa que virou privada perde o arquivo (o banco limpa o caminho); aqui vale também para a corrida.
      if (!mensagem.arquivo_path || achada.conversa.privacidade !== "normal" || achada.conversa.tipo !== "individual") {
        return res.status(404).json({ erro: "sem_arquivo" });
      }
      const link = await linkDoComprovante(db, mensagem.arquivo_path);
      if (!link) return res.status(502).json({ erro: "link_indisponivel" });
      return res.json({
        url: link,
        expira_em: new Date(ctx.agora().getTime() + VALIDADE_LINK_SEG * 1000).toISOString(),
        tipo: /\.pdf$/i.test(mensagem.arquivo_path) ? "pdf" : "imagem",
      });
    }),
  );

  app.get(
    "/api/conversas/dia-completo.txt",
    exigirPartner,
    assincrono(async (req, res) => {
      const dia = texto(req.query.dia);
      if (!dataValida(dia)) return res.status(400).json({ erro: "dia deve ser AAAA-MM-DD" });
      const partnerId = req.query.partnerId as string;
      // Telefone, nome e conversa exata de todos os contatos: só o dono da empresa (ou o admin).
      if (!ehDonoDaEmpresa(req.auth, partnerId)) return res.status(403).json({ erro: "sem_acesso" });
      const db = ctx.db();
      if (!(await podeVerConteudo(db, req.auth, partnerId, "robo"))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      const fuso = await fusoDaEmpresa(db, partnerId);

      const { data, error } = await db.rpc("bot_arquivo_completo", {
        _partner_id: partnerId,
        _conversa_id: null,
        _de: inicioDoDia(dia, fuso).toISOString(),
        _ate: inicioDoDia(proximoDia(dia), fuso).toISOString(),
      });
      if (error) throw error;
      const { data: empresa } = await db.from("partners").select("fantasy_name").eq("id", partnerId).maybeSingle();

      const conteudo = montarArquivo({
        dados: (data || { conversas: [], mensagens: [] }) as DadosArquivo,
        fuso,
        agora: ctx.agora(),
        empresa: empresa?.fantasy_name ?? null,
        periodo: periodoDoDia(dia),
      });
      return enviarTxt(res, `conversas-completas-${dia}.txt`, conteudo);
    }),
  );

  app.get(
    "/api/conversas/:id/completa.txt",
    assincrono(async (req, res) => {
      const de = req.query.de === undefined || req.query.de === "" ? null : texto(req.query.de);
      const ate = req.query.ate === undefined || req.query.ate === "" ? null : texto(req.query.ate);
      if ((de !== null && !dataValida(de)) || (ate !== null && !dataValida(ate))) {
        return res.status(400).json({ erro: "de e ate devem ser AAAA-MM-DD" });
      }
      if (de && ate && de > ate) return res.status(400).json({ erro: "de depois de ate" });

      const achada = await conversaDoUsuario(req, res, "telefone");
      if (!achada) return;
      if (!ehDonoDaEmpresa(req.auth, achada.conexao.owner_id)) return res.status(403).json({ erro: "sem_acesso" });
      const db = ctx.db();
      const partnerId = achada.conexao.escopo === "parceiro" ? achada.conexao.owner_id : null;
      const fuso = await fusoDaEmpresa(db, partnerId);

      const { data, error } = await db.rpc("bot_arquivo_completo", {
        _partner_id: null,
        _conversa_id: achada.conversa.id,
        _de: de ? inicioDoDia(de, fuso).toISOString() : null,
        _ate: ate ? inicioDoDia(proximoDia(ate), fuso).toISOString() : null,
      });
      if (error) throw error;
      const { data: empresa } = partnerId
        ? await db.from("partners").select("fantasy_name").eq("id", partnerId).maybeSingle()
        : { data: null };

      const conteudo = montarArquivo({
        dados: (data || { conversas: [], mensagens: [] }) as DadosArquivo,
        fuso,
        agora: ctx.agora(),
        empresa: empresa?.fantasy_name ?? null,
        periodo: periodoDaConversa(de, ate),
      });
      // A Vercel corta respostas acima de ~4,5 MB; sem período, avisa em vez de entregar cortado.
      if (!de && !ate && Buffer.byteLength(conteudo, "utf8") > 4_000_000) {
        return res.status(413).json({ erro: "arquivo_grande_demais", mensagem: "Conversa grande demais para baixar inteira. Informe um período (de e ate)." });
      }
      const quem = String(achada.conversa.telefone || achada.conversa.id.slice(0, 8));
      const sufixo = de || ate ? `-${de ?? "inicio"}-a-${ate ?? "hoje"}` : "";
      return enviarTxt(res, `conversa-completa-${quem}${sufixo}.txt`, conteudo);
    }),
  );
}

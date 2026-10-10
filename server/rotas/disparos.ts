import type { Express } from "express";
import { ERRO_SEM_CONTEUDO, podeVerConteudoDaConexao } from "../auth.js";
import { assincrono, ehUuid, soDigitos, texto, type Contexto } from "../contexto.js";
import { podeAcessarConexao } from "./conexoes.js";

export function registrarRotasDisparos(app: Express, ctx: Contexto) {
  // Mensagem avulsa pelo CRM: vai para a fila da conexão, que precisa ser de uma empresa do usuário.
  app.post(
    "/api/bot/disparos/enviar-direta",
    assincrono(async (req, res) => {
      const auth = req.auth!;
      const db = ctx.db();
      const { conexaoId, cartaoId } = req.body || {};
      const telefone = soDigitos(req.body?.telefone);
      const corpo = texto(req.body?.texto);

      if (!ehUuid(conexaoId) || !telefone || !corpo) {
        return res.status(400).json({ erro: "Campos obrigatórios ausentes" });
      }
      if (telefone.length < 10 || telefone.length > 15) return res.status(400).json({ erro: "Telefone inválido" });
      if (corpo.length > 4000) return res.status(400).json({ erro: "Texto longo demais" });
      if (cartaoId != null && cartaoId !== "" && !ehUuid(cartaoId)) return res.status(400).json({ erro: "cartaoId inválido" });

      const { data: conexao, error: erroConexao } = await db
        .from("bot_conexoes")
        .select("id, escopo, owner_id, arquivado_em, modo, bot_ativo")
        .eq("id", conexaoId)
        .maybeSingle();
      if (erroConexao) throw erroConexao;
      if (!conexao || conexao.arquivado_em) return res.status(404).json({ erro: "Conexão não encontrada" });
      if (!podeAcessarConexao(auth, conexao)) return res.status(403).json({ erro: "sem_acesso" });
      // Falar pela conversa do mentorado é conteúdo dele: o admin só com o opt-in do dono.
      if (!(await podeVerConteudoDaConexao(db, auth, conexao))) return res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
      // Robô desligado = nenhum envio pela conexão (o gateway também recusa): avisa já, em vez de virar erro na fila.
      if (conexao.bot_ativo !== true) return res.status(409).json({ erro: "envio_desligado" });

      // O cartão tem de ser de um quadro da mesma empresa da conexão.
      if (cartaoId) {
        const { data: cartao } = await db
          .from("crm_cartoes")
          .select("id, crm_quadros!inner(escopo, owner_id)")
          .eq("id", cartaoId)
          .maybeSingle();
        const quadro = (cartao as any)?.crm_quadros;
        if (!quadro || quadro.escopo !== conexao.escopo || quadro.owner_id !== conexao.owner_id) {
          return res.status(403).json({ erro: "sem_acesso" });
        }
      }

      const { data: conversa } = await db
        .from("bot_conversas")
        .select("id, ultima_entrada_em")
        .eq("conexao_id", conexaoId)
        .eq("telefone", telefone)
        .maybeSingle();
      // No gateway (VPS), só responde quem já escreveu: mensagem fria de número não oficial é o que mais bane.
      if (conexao.modo === "gateway" && !conversa?.ultima_entrada_em) {
        return res.status(409).json({ erro: "contato_nunca_escreveu" });
      }

      let conversaId: string | undefined = conversa?.id;
      if (!conversaId) {
        const { data: nova, error } = await db
          .from("bot_conversas")
          .insert({ conexao_id: conexaoId, telefone, estado: "humano", cartao_id: cartaoId || null })
          .select("id")
          .single();
        if (error) throw error;
        conversaId = nova?.id;
      }
      if (!conversaId) return res.status(500).json({ erro: "Falha ao criar conversa" });

      const { data: msg, error } = await db
        .from("bot_mensagens")
        .insert({
          conversa_id: conversaId,
          direcao: "saida",
          tipo: "texto",
          corpo,
          status: "pendente",
          autor: "crm",
          enviada_por: auth.profileId,
        })
        .select("id")
        .single();
      if (error) return res.status(500).json({ erro: error.message });

      // O mentorado assumiu a conversa: o robô não entra no meio enquanto a resposta espera na fila
      // (ultima_saida_em só muda quando ela sai de fato).
      const { error: erroEstado } = await db.from("bot_conversas").update({ estado: "humano" }).eq("id", conversaId).eq("estado", "bot");
      if (erroEstado) throw erroEstado;

      if (cartaoId) {
        try {
          await db.rpc("bot_registrar_no_cartao", { _conversa_id: conversaId, _texto: corpo, _direcao: "saida", _autor: "crm" });
        } catch {
          // a linha do tempo do cartão é acessória
        }
      }
      if (conexao.modo === "gateway") {
        try {
          await ctx.campainha(conexao.id, "fila");
        } catch {
          // o gateway lê a fila sozinho a cada 30 s
        }
      }
      return res.json({ ok: true, mensagemId: msg?.id });
    }),
  );
}

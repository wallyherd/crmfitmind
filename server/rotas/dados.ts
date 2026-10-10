import type { Express } from "express";
import { fusoValido } from "../arquivo-completo.js";
import { podeAcessarPartner, podeNaEmpresa, podeVerConteudo } from "../auth.js";
import { assincrono, ehUuid, semSegredos, type Contexto } from "../contexto.js";
import { partnersAcessiveis } from "./conta.js";

const VAZIO = { conexoes: [], quadros: [], colunas: [], cartoes: [], conversas: [], campanhas: [], fluxos: [], passos: [] };

export function registrarRotasDados(app: Express, ctx: Contexto) {
  // Sincronização central do painel: tudo de UMA empresa por chamada.
  app.get(
    "/api/data",
    assincrono(async (req, res) => {
      const auth = req.auth!;
      const db = ctx.db();
      const partners = await partnersAcessiveis(db, auth);

      const pedido = req.query.partnerId;
      if (pedido !== undefined && !ehUuid(pedido)) return res.status(400).json({ erro: "partnerId inválido" });
      const partnerId = (pedido as string | undefined) || partners[0]?.id;
      if (!partnerId) return res.json({ partners, ...VAZIO });
      if (!podeAcessarPartner(auth, partnerId)) return res.status(403).json({ erro: "sem_acesso" });

      // Como a RLS: o que é do WhatsApp pede 'robo'; o funil pede 'crm' (dono e admin têm as duas).
      const verRobo = podeNaEmpresa(auth, partnerId, "robo");
      const verCrm = podeNaEmpresa(auth, partnerId, "crm");
      // Estrutura (conexões, funil, campanhas, fluxos) o admin vê sempre; cartões e conversas, só com o opt-in do dono.
      const [conteudoRobo, conteudoCrm] = await Promise.all([
        verRobo ? podeVerConteudo(db, auth, partnerId, "robo") : false,
        verCrm ? podeVerConteudo(db, auth, partnerId, "crm") : false,
      ]);
      const nada = Promise.resolve({ data: [], error: null });
      // O fuso da empresa recorta o dia do arquivo completo; a tela usa o mesmo para sugerir o dia.
      const { data: cfg } = await db.from("partner_acesso_config").select("timezone").eq("partner_id", partnerId).maybeSingle();
      const fuso = fusoValido(cfg?.timezone);
      const [connsRes, qdrsRes, campsRes, flxsRes] = await Promise.all([
        verRobo ? db.from("bot_conexoes").select("*").eq("escopo", "parceiro").eq("owner_id", partnerId).is("arquivado_em", null) : nada,
        verCrm ? db.from("crm_quadros").select("*").eq("escopo", "parceiro").eq("owner_id", partnerId).is("arquivado_em", null) : nada,
        verRobo ? db.from("bot_disparos").select("*").eq("escopo", "parceiro").eq("owner_id", partnerId).order("created_at", { ascending: false }) : nada,
        verRobo ? db.from("bot_fluxos").select("*").eq("escopo", "parceiro").eq("owner_id", partnerId).is("arquivado_em", null) : nada,
      ]);
      for (const r of [connsRes, qdrsRes, campsRes, flxsRes]) if (r.error) throw r.error;

      // O QR, o código de pareamento e os nomes dos grupos dão o WhatsApp a quem os ler: só para quem vê o conteúdo.
      const conexoes = (connsRes.data || []).map((c: Record<string, unknown>) => (conteudoRobo ? semSegredos(c) : { ...semSegredos(c), pareamento: null, grupos_disponiveis: [] }));
      const quadros = qdrsRes.data || [];
      const campanhas = campsRes.data || [];
      const fluxos = flxsRes.data || [];

      // quadroId de outra empresa não pode servir de atalho para ler cartões alheios.
      const pedidoQuadro = req.query.quadroId;
      if (pedidoQuadro !== undefined && !quadros.some((q: { id: string }) => q.id === pedidoQuadro)) {
        return res.status(403).json({ erro: "sem_acesso" });
      }
      const quadroId = (pedidoQuadro as string | undefined) || quadros[0]?.id;

      let colunas: unknown[] = [];
      let cartoes: unknown[] = [];
      if (quadroId) {
        const [colsRes, crtsRes] = await Promise.all([
          db.from("crm_colunas").select("*").eq("quadro_id", quadroId).order("posicao", { ascending: true }),
          conteudoCrm ? db.from("crm_cartoes").select("*").eq("quadro_id", quadroId).is("arquivado_em", null).order("posicao", { ascending: true }) : nada,
        ]);
        if (colsRes.error) throw colsRes.error;
        if (crtsRes.error) throw crtsRes.error;
        colunas = colsRes.data || [];
        cartoes = crtsRes.data || [];
      }

      const connIds = conexoes.map((c: { id: string }) => c.id);
      let conversas: unknown[] = [];
      if (conteudoRobo && connIds.length > 0) {
        const { data, error } = await db.from("bot_conversas").select("*").in("conexao_id", connIds).order("updated_at", { ascending: false });
        if (error) throw error;
        conversas = data || [];
      }

      const flxIds = fluxos.map((f: { id: string }) => f.id);
      let passos: unknown[] = [];
      if (flxIds.length > 0) {
        const { data, error } = await db.from("bot_passos").select("*").in("fluxo_id", flxIds).order("posicao", { ascending: true });
        if (error) throw error;
        passos = data || [];
      }

      return res.json({ partners, fuso, conteudoLiberado: { conversas: conteudoRobo, cartoes: conteudoCrm }, conexoes, quadros, colunas, cartoes, conversas, campanhas, fluxos, passos });
    }),
  );
}

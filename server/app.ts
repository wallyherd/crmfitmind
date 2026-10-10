import cors from "cors";
import express, { type ErrorRequestHandler, type Express } from "express";
import { criarAutenticacao, exigirAdmin } from "./auth.js";
import { processarMensagem } from "./bot-engine.js";
import { criarCampainha, segredoGatewayDoAmbiente, type Campainha } from "./campainha.js";
import { MAX_COMPROVANTE_BYTES, MIMETYPES_COMPROVANTE } from "./comprovantes.js";
import type { Contexto } from "./contexto.js";
import { clienteAnthropicDoAmbiente, modeloDoAmbiente, type ClienteAnthropic } from "./ia/motor-api.js";
import { registrarRotasAdmin } from "./rotas/admin.js";
import { registrarRotasComercial } from "./rotas/comercial.js";
import { registrarRotasConector } from "./rotas/conector.js";
import { registrarRotasConexoes } from "./rotas/conexoes.js";
import { registrarRotasConta } from "./rotas/conta.js";
import { registrarRotasConversas } from "./rotas/conversas.js";
import { registrarRotasCron } from "./rotas/cron.js";
import { registrarRotasDados } from "./rotas/dados.js";
import { registrarRotasDisparos } from "./rotas/disparos.js";
import { registrarRotasIa } from "./rotas/ia.js";
import { registrarRotasMentor } from "./rotas/mentor.js";
import { registrarRotasRelatorios } from "./rotas/relatorios.js";
import { modeloComprovanteDoAmbiente } from "./comprovante-leitura.js";
import { supabaseDoAmbiente, type Db } from "./supabase.js";

export type Dependencias = {
  supabase?: Db;
  agora?: () => Date;
  origens?: string[];
  segredoGateway?: string;
  campainha?: Campainha;
  motor?: typeof processarMensagem;
  segredoCron?: string;
  anthropic?: ClienteAnthropic;
  modeloIa?: string;
  modeloComprovante?: string;
};

const ORIGENS_PADRAO = ["https://crm-fitmind-whatsapp.vercel.app", "http://localhost:5173"];

// Rotas que existiam e foram tiradas de propósito: respondem 404 mesmo sem login.
const ROTAS_REMOVIDAS = ["/api/config", "/api/auth/login"];

export function origensPermitidas(valor = process.env.APP_ORIGIN): string[] {
  const lista = (valor || "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  return lista.length ? lista : ORIGENS_PADRAO;
}

export function criarApp(deps: Dependencias = {}): Express {
  const agora = deps.agora ?? (() => new Date());
  const ctx: Contexto = {
    db: () => deps.supabase ?? supabaseDoAmbiente(),
    agora,
    segredoGateway: () => segredoGatewayDoAmbiente(deps.segredoGateway ?? process.env.GATEWAY_SECRET),
    campainha: deps.campainha ?? criarCampainha({ agora: () => agora().getTime() }),
    motor: deps.motor ?? processarMensagem,
    segredoCron: () => deps.segredoCron ?? process.env.CRON_SECRET,
    anthropic: () => deps.anthropic ?? clienteAnthropicDoAmbiente(),
    modeloIa: () => deps.modeloIa ?? modeloDoAmbiente(),
    modeloComprovante: () => deps.modeloComprovante ?? modeloComprovanteDoAmbiente(),
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: deps.origens ?? origensPermitidas() }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  // Comprovante (imagem ou PDF) que o gateway sobe: o corpo é o arquivo cru, e a assinatura HMAC cobre esses bytes.
  // 4 MB é o teto do arquivo; acima disso o parser responde 413 (entity.too.large).
  app.use(
    "/api/gateway/midia",
    express.raw({
      type: [...MIMETYPES_COMPROVANTE],
      limit: MAX_COMPROVANTE_BYTES,
      verify: (req, _res, buf) => {
        (req as express.Request).corpoBruto = buf;
      },
    }),
  );
  // O corpo bruto fica guardado para a assinatura HMAC do gateway (Fase 1).
  app.use(
    express.json({
      limit: "4mb",
      verify: (req, _res, buf) => {
        (req as express.Request).corpoBruto = buf;
      },
    }),
  );

  app.all(ROTAS_REMOVIDAS, (_req, res) => res.status(404).json({ erro: "nao_encontrado" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: ctx.agora().toISOString() }));

  app.use("/api", criarAutenticacao(ctx));
  app.use("/api/admin", exigirAdmin);
  app.use("/api/mentor", exigirAdmin);

  registrarRotasConector(app, ctx);
  registrarRotasConta(app, ctx);
  registrarRotasDados(app, ctx);
  registrarRotasConexoes(app, ctx);
  registrarRotasConversas(app, ctx);
  registrarRotasDisparos(app, ctx);
  registrarRotasAdmin(app, ctx);
  registrarRotasRelatorios(app, ctx);
  registrarRotasComercial(app, ctx);
  registrarRotasIa(app, ctx);
  registrarRotasMentor(app, ctx);
  registrarRotasCron(app, ctx);

  app.use("/api", (_req, res) => res.status(404).json({ erro: "nao_encontrado" }));
  app.use(tratarErro);
  return app;
}

const tratarErro: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") return res.status(400).json({ erro: "json_invalido" });
  if (err?.type === "entity.too.large") return res.status(413).json({ erro: "corpo_grande_demais" });
  console.error("[api] erro:", err);
  if (res.headersSent) return;
  return res.status(500).json({ erro: "erro_interno" });
};

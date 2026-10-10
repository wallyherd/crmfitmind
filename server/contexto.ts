import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { processarMensagem } from "./bot-engine.js";
import type { Campainha } from "./campainha.js";
import type { ClienteAnthropic } from "./ia/motor-api.js";
import type { Db } from "./supabase.js";

// O que as rotas recebem de fora: banco, relógio, segredo do gateway, campainha
// e motor do robô, injetáveis para os testes.
export type Contexto = {
  db: () => Db;
  agora: () => Date;
  segredoGateway: () => string | undefined;
  campainha: Campainha;
  motor: typeof processarMensagem;
  // Fase 3: segredo do cron, cliente da Anthropic (criado só quando precisa) e modelo da API Batch.
  segredoCron: () => string | undefined;
  anthropic: () => ClienteAnthropic;
  modeloIa: () => string;
  // Tarefa Q2: modelo (barato) que lê os comprovantes.
  modeloComprovante: () => string;
};

// Express 4 não captura rejeição de handler async; repassa para o tratador de erro.
export function assincrono(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

export function soDigitos(v: unknown): string {
  return texto(v).replace(/\D/g, "");
}

// Colunas de bot_conexoes que nunca saem do servidor.
const COLUNAS_SECRETAS = ["webhook_segredo", "vinculo_hash"];

export function semSegredos<T extends Record<string, unknown>>(linha: T): T {
  const copia: Record<string, unknown> = { ...linha };
  for (const c of COLUNAS_SECRETAS) delete copia[c];
  return copia as T;
}

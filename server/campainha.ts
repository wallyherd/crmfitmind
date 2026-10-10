import { assinaturaGateway } from "./auth.js";

// Campainha do gateway (gateway/CONTRATO.md §6): POST {GATEWAY_URL}/acordar com a
// mesma assinatura HMAC. Não leva conteúdo, só faz o gateway reler conexões ou fila.
// "Dispara e esquece": timeout curto e nenhuma falha sobe para a rota que tocou.

export type MotivoCampainha = "fila" | "parear" | "desconectar" | "opcoes";
export type Campainha = (conexaoId: string, motivo: MotivoCampainha) => Promise<boolean>;

export const CAMINHO_ACORDAR = "/acordar";
export const TIMEOUT_CAMPAINHA_MS = 1500;
export const TAMANHO_MINIMO_SEGREDO = 32;

// Segredo curto demais vale como ausente: as rotas do gateway recusam e a campainha não toca.
export function segredoGatewayDoAmbiente(valor = process.env.GATEWAY_SECRET): string | undefined {
  return valor && valor.length >= TAMANHO_MINIMO_SEGREDO ? valor : undefined;
}

type OpcoesCampainha = {
  url?: () => string | undefined;
  segredo?: () => string | undefined;
  fetch?: typeof fetch;
  agora?: () => number;
  timeoutMs?: number;
  log?: (msg: string) => void;
};

export function criarCampainha(op: OpcoesCampainha = {}): Campainha {
  const url = op.url ?? (() => process.env.GATEWAY_URL);
  const segredo = op.segredo ?? (() => segredoGatewayDoAmbiente());
  const agora = op.agora ?? Date.now;
  const timeoutMs = op.timeoutMs ?? TIMEOUT_CAMPAINHA_MS;
  const log = op.log ?? ((m: string) => console.warn(m));

  return async (conexaoId, motivo) => {
    const base = (url() || "").trim();
    const chave = segredo();
    // Sem GATEWAY_URL (piloto no PC, sem endereço público) não toca: o gateway lê sozinho a cada 30/60 s.
    if (!base || !chave) return false;
    let destino: URL;
    try {
      destino = new URL(CAMINHO_ACORDAR, base);
    } catch {
      log("[campainha] GATEWAY_URL inválida");
      return false;
    }
    const corpo = JSON.stringify({ conexaoId, motivo });
    const ts = String(agora());
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);
    try {
      const res = await (op.fetch ?? fetch)(destino, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gateway-ts": ts,
          "x-gateway-assinatura": assinaturaGateway(chave, ts, "POST", CAMINHO_ACORDAR, corpo),
        },
        body: corpo,
        signal: controle.signal,
      });
      return res.ok;
    } catch (e: any) {
      log(`[campainha] ${motivo} ${conexaoId}: ${e?.name === "AbortError" ? "sem resposta" : e?.message || e}`);
      return false;
    } finally {
      clearTimeout(relogio);
    }
  };
}

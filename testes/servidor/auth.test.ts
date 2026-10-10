// Peças puras da autenticação: rotas abertas, comparação de segredo e assinatura do gateway (contrato da Fase 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { ROTAS_ABERTAS, assinaturaGateway, assinaturaGatewayValida, segredoConfere } from "../../server/auth.ts";

test("só health, as 4 rotas do conector e /gateway/* ficam fora da sessão", () => {
  for (const p of ["/health", "/bot/eventos", "/bot/fila", "/bot/confirmar", "/bot/atualizacao", "/gateway/conexoes", "/gateway/fila"]) {
    assert.ok(ROTAS_ABERTAS.test(p), p);
  }
  for (const p of [
    "/bot/disparos/enviar-direta", "/bot/fila/extra", "/data", "/admin/usuarios", "/gateway", "/gateway/",
    "/gateway/../admin/usuarios", "/gateway/./x", "/BOT/FILA", "/healthz", "/ia/lote",
  ]) {
    assert.ok(!ROTAS_ABERTAS.test(p), p);
  }
});

test("segredoConfere", () => {
  assert.equal(segredoConfere("abc", "abc"), true);
  assert.equal(segredoConfere("abc", "abd"), false);
  assert.equal(segredoConfere("abc", "abcd"), false);
  assert.equal(segredoConfere("", ""), false);
  assert.equal(segredoConfere(undefined, "abc"), false);
  assert.equal(segredoConfere(["abc"], "abc"), false);
});

test("assinatura do gateway segue a fórmula do contrato", () => {
  const corpo = '{"eventos":[]}';
  const esperada = createHmac("sha256", "s3gr3do")
    .update(`1700000000000.POST./api/bot/eventos.${createHash("sha256").update(corpo).digest("hex")}`)
    .digest("hex");
  assert.equal(assinaturaGateway("s3gr3do", "1700000000000", "post", "/api/bot/eventos", corpo), esperada);
});

test("assinaturaGatewayValida: confere corpo, caminho, janela de 5 min e segredo", () => {
  const agora = 1_700_000_000_000;
  const corpo = Buffer.from('{"conexaoId":"x","eventos":[]}');
  const pedido = (ts: number, extra: Partial<{ corpo: Buffer; url: string; assinatura: string; metodo: string }> = {}) => {
    const url = extra.url ?? "/api/bot/eventos?x=1";
    const assinatura = extra.assinatura ?? assinaturaGateway("segredo", String(ts), "POST", "/api/bot/eventos", corpo);
    return {
      headers: { "x-gateway-ts": String(ts), "x-gateway-assinatura": assinatura },
      method: extra.metodo ?? "POST",
      originalUrl: url,
      corpoBruto: extra.corpo ?? corpo,
    } as any;
  };
  assert.equal(assinaturaGatewayValida(pedido(agora), "segredo", agora), true, "a query não entra na assinatura");
  assert.equal(assinaturaGatewayValida(pedido(agora - 299_000), "segredo", agora), true);
  assert.equal(assinaturaGatewayValida(pedido(agora - 301_000), "segredo", agora), false, "velho demais");
  assert.equal(assinaturaGatewayValida(pedido(agora + 301_000), "segredo", agora), false, "do futuro");
  assert.equal(assinaturaGatewayValida(pedido(agora, { corpo: Buffer.from("{}") }), "segredo", agora), false, "corpo trocado");
  assert.equal(assinaturaGatewayValida(pedido(agora, { url: "/api/bot/confirmar" }), "segredo", agora), false, "outro caminho");
  assert.equal(assinaturaGatewayValida(pedido(agora, { metodo: "GET" }), "segredo", agora), false, "outro método");
  assert.equal(assinaturaGatewayValida(pedido(agora), "outro", agora), false, "outro segredo");
  assert.equal(assinaturaGatewayValida(pedido(agora), undefined, agora), false, "sem GATEWAY_SECRET nada passa");
  assert.equal(assinaturaGatewayValida(pedido(agora, { assinatura: "zz" }), "segredo", agora), false);
});

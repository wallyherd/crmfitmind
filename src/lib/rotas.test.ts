// Roda com: node --test src/lib/rotas.test.ts  (Node >= 23.6 executa TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMINHO_DA_ABA, abaDoCaminho, caminhoDaConversa, conversaDoCaminho, type TabType } from "./rotas.ts";

test("cada aba volta do próprio endereço", () => {
  for (const [aba, caminho] of Object.entries(CAMINHO_DA_ABA)) {
    assert.equal(abaDoCaminho(caminho), aba as TabType);
  }
});

test("/conectar, barra no fim, endereço antigo do conector e desconhecido", () => {
  assert.equal(abaDoCaminho("/conectar"), "conectar");
  assert.equal(abaDoCaminho("/conectar/"), "conectar");
  assert.equal(abaDoCaminho("/conector"), "conectar");
  assert.equal(abaDoCaminho(""), "dashboard");
  assert.equal(abaDoCaminho("/nao-existe"), null);
});

test("/conversas/:id abre Conversas e devolve o id", () => {
  assert.equal(abaDoCaminho("/conversas/abc-1"), "conversas");
  assert.equal(conversaDoCaminho("/conversas/abc-1"), "abc-1");
  assert.equal(conversaDoCaminho("/conversas/a%20b/"), "a b");
  assert.equal(conversaDoCaminho("/conversas"), null);
  assert.equal(conversaDoCaminho("/funil"), null);
  assert.equal(caminhoDaConversa("abc-1"), "/conversas/abc-1");
  assert.equal(caminhoDaConversa(null), "/conversas");
});

test("/hoje e /mais", () => {
  assert.equal(abaDoCaminho("/hoje"), "hoje");
  assert.equal(abaDoCaminho("/mais"), "mais");
});
